"use strict";

/* ------------------------------------------------------------------ *
 * db.js — SQLite foundation (Electron main process only)
 *
 * Owns the single better-sqlite3 connection, schema migrations,
 * prepared statements and low-level CRUD used by store.js.
 *
 * Design rules:
 *   - parameterized queries only, never string-concatenated SQL
 *   - multi-step writes run inside transactions
 *   - WAL journal + synchronous=NORMAL for crash-safe durability
 *   - foreign keys enforced (projects -> tasks detach on delete)
 *   - ordering is persisted via an integer `position` column so the
 *     UI list order survives restarts exactly as before
 * ------------------------------------------------------------------ */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

/* ------------------------------ constants -------------------------- */

const MIGRATIONS = [
  {
    name: "001_initial",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'active',
          priority    TEXT NOT NULL DEFAULT 'medium',
          color       TEXT,
          start_date  TEXT,
          target_date TEXT,
          tags        TEXT NOT NULL DEFAULT '[]',
          repo_url    TEXT,
          root_path   TEXT,
          extra_notes TEXT,
          position    INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_projects_position ON projects(position);

        CREATE TABLE IF NOT EXISTS tasks (
          id           TEXT PRIMARY KEY,
          project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
          title        TEXT NOT NULL,
          description  TEXT NOT NULL DEFAULT '',
          status       TEXT NOT NULL DEFAULT 'planned',
          priority     TEXT NOT NULL DEFAULT 'medium',
          type         TEXT NOT NULL DEFAULT 'other',
          effort       TEXT NOT NULL DEFAULT 'medium',
          tags         TEXT NOT NULL DEFAULT '[]',
          notes        TEXT NOT NULL DEFAULT '',
          start_date   TEXT,
          due_date     TEXT,
          completed_at INTEGER,
          archived     INTEGER NOT NULL DEFAULT 0,
          pinned       INTEGER NOT NULL DEFAULT 0,
          file_name    TEXT,
          file_path    TEXT,
          commit_id    TEXT,
          extra_details TEXT,
          position     INTEGER NOT NULL DEFAULT 0,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(position);

        CREATE TABLE IF NOT EXISTS activity_log (
          id        TEXT PRIMARY KEY,
          entity    TEXT NOT NULL,
          entity_id TEXT,
          action    TEXT NOT NULL,
          title     TEXT NOT NULL DEFAULT '',
          details   TEXT,
          at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at);

        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: "002_work_context",
    up(db) {
      const sql = [
        "ALTER TABLE tasks ADD COLUMN file_name TEXT",
        "ALTER TABLE tasks ADD COLUMN file_path TEXT",
        "ALTER TABLE tasks ADD COLUMN commit_id TEXT",
        "ALTER TABLE tasks ADD COLUMN extra_details TEXT",
        "ALTER TABLE projects ADD COLUMN repo_url TEXT",
        "ALTER TABLE projects ADD COLUMN root_path TEXT",
        "ALTER TABLE projects ADD COLUMN extra_notes TEXT",
      ];
      for (const stmt of sql) {
        try {
          db.exec(stmt);
        } catch (err) {
          if (!/duplicate column name|already exists/i.test(err.message)) throw err;
        }
      }
    },
  },
];

const TASK_COLUMNS = `
  id, project_id AS projectId, title, description, status, priority, type,
  effort, tags, notes, start_date AS startDate, due_date AS dueDate,
  completed_at AS completedAt, archived, pinned, file_name AS fileName,
  file_path AS filePath, commit_id AS commitId, extra_details AS extraDetails, position,
  created_at AS createdAt, updated_at AS updatedAt`;

const PROJECT_COLUMNS = `
  id, name, description, status, priority, color,
  start_date AS startDate, target_date AS targetDate, tags, repo_url AS repoUrl,
  root_path AS rootPath, extra_notes AS extraNotes, position,
  created_at AS createdAt, updated_at AS updatedAt`;

const ACTIVITY_COLUMNS = `
  id, entity, entityId, entity_id AS entityIdRaw, action, title, details, at`;

const ACTIVITY_LIMIT = 800;

let db = null;
let stmts = null;

/* ---------------------------- lifecycle ---------------------------- */

function open(dataDir) {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupsDir(dataDir), { recursive: true });

  db = new Database(path.join(dataDir, "forge.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec(
    `CREATE TABLE IF NOT EXISTS meta (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );`
  );

  migrate();
  prepareStatements();
  return db;
}

function close() {
  if (!db) return;
  try {
    stmts = null;
    db.close();
  } catch (err) {
    console.error("[db] close failed:", err.message);
  } finally {
    db = null;
  }
}

function isOpen() {
  return Boolean(db);
}

/**
 * Consistent online copy of the database (safe while WAL is active).
 * Returns a promise; resolves when the destination file is complete.
 */
function backupToFile(destination) {
  if (!db) return Promise.reject(new Error("Database is not open"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return db.backup(destination);
}

function checkpoint() {
  if (!db) return;
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
  } catch (err) {
    console.error("[db] checkpoint failed:", err.message);
  }
}

function migrate() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     );`
  );
  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name)
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      migration.up(db);
      db
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, Date.now());
    })();
    console.log(`[db] applied migration ${migration.name}`);
  }
}

/* ------------------------- prepared statements --------------------- */

function prepareStatements() {
  stmts = {
    /* tasks */
    taskGet: db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`),
    taskInsert: db.prepare(`
      INSERT INTO tasks (
        id, project_id, title, description, status, priority, type, effort,
        tags, notes, start_date, due_date, completed_at, archived, pinned,
        position, created_at, updated_at
      ) VALUES (
        @id, @projectId, @title, @description, @status, @priority, @type,
        @effort, @tags, @notes, @startDate, @dueDate, @completedAt,
        @archived, @pinned, @position, @createdAt, @updatedAt
      )`),
    taskUpdate: db.prepare(`
      UPDATE tasks SET
        project_id = @projectId, title = @title, description = @description,
        status = @status, priority = @priority, type = @type, effort = @effort,
        tags = @tags, notes = @notes, start_date = @startDate,
        due_date = @dueDate, completed_at = @completedAt,
        archived = @archived, pinned = @pinned, position = @position,
        created_at = @createdAt, updated_at = @updatedAt
      WHERE id = @id`),
    taskDelete: db.prepare(`DELETE FROM tasks WHERE id = ?`),
    taskShiftRightExclusive: db.prepare(
      `UPDATE tasks SET position = position + 1 WHERE position > ?`
    ),
    taskShiftRightInclusive: db.prepare(
      `UPDATE tasks SET position = position + 1 WHERE position >= ?`
    ),
    taskMinPosition: db.prepare(`SELECT MIN(position) AS p FROM tasks`),
    taskMaxPosition: db.prepare(`SELECT MAX(position) AS p FROM tasks`),
    /* projects */
    projectGet: db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`),
    projectInsert: db.prepare(`
      INSERT INTO projects (
        id, name, description, status, priority, color, start_date,
        target_date, tags, position, created_at, updated_at
      ) VALUES (
        @id, @name, @description, @status, @priority, @color, @startDate,
        @targetDate, @tags, @position, @createdAt, @updatedAt
      )`),
    projectUpdate: db.prepare(`
      UPDATE projects SET
        name = @name, description = @description, status = @status,
        priority = @priority, color = @color, start_date = @startDate,
        target_date = @targetDate, tags = @tags, position = @position,
        created_at = @createdAt, updated_at = @updatedAt
      WHERE id = @id`),
    projectDelete: db.prepare(`DELETE FROM projects WHERE id = ?`),
    projectMinPosition: db.prepare(`SELECT MIN(position) AS p FROM projects`),
    /* activity */
    activityInsert: db.prepare(`
      INSERT INTO activity_log (id, entity, entity_id, action, title, details, at)
      VALUES (@id, @entity, @entityId, @action, @title, @details, @at)`),
    activityTrim: db.prepare(`
      DELETE FROM activity_log WHERE id IN (
        SELECT id FROM activity_log ORDER BY at DESC LIMIT -1 OFFSET ?
      )`),
    activityClear: db.prepare(`DELETE FROM activity_log`),
    /* settings */
    settingUpsert: db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
    settingAll: db.prepare(`SELECT key, value FROM settings`),
    /* full replace (import / reset) */
    wipeTasks: db.prepare(`DELETE FROM tasks`),
    wipeProjects: db.prepare(`DELETE FROM projects`),
    wipeActivity: db.prepare(`DELETE FROM activity_log`),
    wipeSettings: db.prepare(`DELETE FROM settings`),
    detachTasksFromProject: db.prepare(
      `UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?`
    ),
  };
}

/* ------------------------------- meta ------------------------------ */

const getMeta = (key) =>
  db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;

const setMeta = (key, value) =>
  db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, String(value));

/* --------------------------- row <-> model ------------------------- */

const bit = (v) => (v ? 1 : 0);
const j = (v) => JSON.stringify(v ?? []);

function taskToRow(task, position) {
  return {
    id: task.id,
    projectId: task.projectId ?? null,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    type: task.type,
    effort: task.effort,
    tags: j(task.tags),
    notes: task.notes,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    fileName: task.fileName ?? null,
    filePath: task.filePath ?? null,
    commitId: task.commitId ?? null,
    extraDetails: task.extraDetails ?? null,
    completedAt: task.completedAt ?? null,
    archived: bit(task.archived),
    pinned: bit(task.pinned),
    position: position ?? 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function projectToRow(project, position) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    color: project.color ?? null,
    startDate: project.startDate ?? null,
    targetDate: project.targetDate ?? null,
    tags: j(project.tags),
    repoUrl: project.repoUrl ?? null,
    rootPath: project.rootPath ?? null,
    extraNotes: project.extraNotes ?? null,
    position: position ?? 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    type: row.type,
    projectId: row.projectId,
    tags: safeParse(row.tags, []),
    notes: row.notes,
    effort: row.effort,
    startDate: row.startDate,
    dueDate: row.dueDate,
    fileName: row.fileName,
    filePath: row.filePath,
    commitId: row.commitId,
    extraDetails: row.extraDetails,
    completedAt: row.completedAt,
    archived: Boolean(row.archived),
    pinned: Boolean(row.pinned),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    priority: row.priority,
    color: row.color,
    startDate: row.startDate,
    targetDate: row.targetDate,
    tags: safeParse(row.tags, []),
    repoUrl: row.repoUrl,
    rootPath: row.rootPath,
    extraNotes: row.extraNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function activityToRow(entry) {
  return {
    id: entry.id,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    action: entry.action,
    title: entry.title ?? "",
    details: entry.details ?? null,
    at: entry.at,
  };
}

function rowToActivity(row) {
  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    title: row.title,
    details: row.details,
    at: row.at,
  };
}

function safeParse(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------ reads ------------------------------ */

function getAllTasks() {
  return db
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY position ASC`)
    .all()
    .map(rowToTask);
}

function getAllProjects() {
  return db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY position ASC`)
    .all()
    .map(rowToProject);
}

function getAllActivity(limit) {
  return db
    .prepare(
      `SELECT id, entity, entity_id AS entityId, action, title, details, at
       FROM activity_log ORDER BY at DESC, rowid DESC LIMIT ?`
    )
    .all(limit)
    .map(rowToActivity);
}

function getAllSettings() {
  const out = {};
  for (const row of stmts.settingAll.iterate()) out[row.key] = safeParse(row.value, null);
  return out;
}

/* ------------------------------ writes ----------------------------- */

function minPosition(tableStmt, fallback) {
  const row = tableStmt.get();
  return Number.isFinite(row?.p) ? row.p : fallback;
}

function insertTask(task) {
  const pos =
    task.position ??
    minPosition(stmts.taskMinPosition, 0) - 1;
  stmts.taskInsert.run(taskToRow(task, pos));
}

function updateTask(task) {
  // Preserve the stored slot unless the caller supplies an explicit one.
  const current = stmts.taskGet.get(task.id);
  const pos = task.position ?? current?.position ?? 0;
  stmts.taskUpdate.run(taskToRow(task, pos));
}

function deleteTaskById(id) {
  stmts.taskDelete.run(id);
}

/** Duplicate: copy appears directly below its source, everything after shifts. */
function duplicateTaskPositionAware(sourceId, copy) {
  const src = stmts.taskGet.get(sourceId);
  const tx = db.transaction(() => {
    const srcPos = src ? src.position : maxTaskPosition();
    stmts.taskShiftRightExclusive.run(srcPos);
    stmts.taskInsert.run(taskToRow(copy, srcPos + 1));
  });
  tx.immediate();
  return copy;
}

function maxTaskPosition() {
  return minPosition(stmts.taskMaxPosition, 0);
}

/**
 * Undo-delete: put the task back at array index `index`.
 * Everything currently occupying that slot or later shifts down one.
 */
function restoreTaskAt(task, index) {
  const tx = db.transaction(() => {
    let pos;
    const ordered = db
      .prepare(`SELECT id, position FROM tasks ORDER BY position ASC`)
      .all();
    const occupant = ordered[index];
    if (!occupant && ordered.length === 0) {
      pos = 0;
    } else if (!occupant) {
      pos = ordered[ordered.length - 1].position + 1;
    } else if (index === 0) {
      pos = ordered[0].position - 1;
    } else {
      pos = occupant.position;
      stmts.taskShiftRightInclusive.run(pos);
    }
    stmts.taskInsert.run(taskToRow(task, pos));
  });
  tx.immediate();
}

function insertProject(project) {
  const pos = minPosition(stmts.projectMinPosition, 0) - 1;
  stmts.projectInsert.run(projectToRow(project, pos));
}

function updateProject(project) {
  const current = db
    .prepare(`SELECT position FROM projects WHERE id = ?`)
    .get(project.id);
  const pos = current?.position ?? 0;
  stmts.projectUpdate.run(projectToRow(project, pos));
}

/** Delete project; tasks referencing it are detached in the same transaction. */
function deleteProjectCascade(id, now) {
  const tx = db.transaction(() => {
    stmts.detachTasksFromProject.run(now, id);
    stmts.projectDelete.run(id);
  });
  tx.immediate();
}

function insertActivity(entry) {
  stmts.activityInsert.run(activityToRow(entry));
  stmts.activityTrim.run(ACTIVITY_LIMIT);
}

function clearActivity() {
  stmts.activityClear.run();
}

function upsertSetting(key, value) {
  stmts.settingUpsert.run(key, JSON.stringify(value));
}

/** Full replace — used by JSON import, backup restore and reset. */
function replaceAll({ tasks, projects, activity, settings }) {
  const tx = db.transaction(() => {
    stmts.wipeTasks.run();
    stmts.wipeProjects.run();
    stmts.wipeActivity.run();
    stmts.wipeSettings.run();

    // Callers pass arrays already in display order (index 0 shown first),
    // so positions map straight onto indices.
    projects.forEach((p, i) => stmts.projectInsert.run(projectToRow(p, i)));
    tasks.forEach((t, i) => stmts.taskInsert.run(taskToRow(t, i)));

    const orderedActivity = [...activity].sort((a, b) => a.at - b.at);
    for (const entry of orderedActivity) stmts.activityInsert.run(activityToRow(entry));
    stmts.activityTrim.run(ACTIVITY_LIMIT);

    for (const [key, value] of Object.entries(settings)) {
      stmts.settingUpsert.run(key, JSON.stringify(value));
    }
  });
  tx.immediate();
}

/* ------------------------------ paths ------------------------------ */

function backupsDir(dataDir) {
  return path.join(dataDir, "backups");
}

module.exports = {
  open,
  close,
  isOpen,
  checkpoint,
  backupToFile,
  getMeta: (key) => getMeta(key),
  setMeta,
  getAllTasks,
  getAllProjects,
  getAllActivity,
  getAllSettings,
  insertTask,
  updateTask,
  deleteTaskById,
  duplicateTaskPositionAware,
  restoreTaskAt,
  insertProject,
  updateProject,
  deleteProjectCascade,
  insertActivity,
  clearActivity,
  upsertSetting,
  replaceAll,
  backupsDir,
  ACTIVITY_LIMIT,
};
