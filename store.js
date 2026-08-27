"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, dialog } = require("electron");
const db = require("./db");
const backupService = require("./backup");

/* ------------------------------------------------------------------ *
 * Forge data layer (schema v3) — backed by SQLite
 * State: { version, tasks, projects, activity, settings }
 *
 * The in-memory state remains the read model the renderer sees;
 * every mutation is mirrored into SQLite immediately (WAL mode).
 * The legacy forge-data.json / todos.json files are migrated once,
 * automatically, and are never modified or deleted.
 * ------------------------------------------------------------------ */

const SCHEMA_VERSION = 3;
const MAX_TASKS = 2000;
const MAX_PROJECTS = 100;
const MAX_ACTIVITY = db.ACTIVITY_LIMIT;
const MAX_TITLE = 300;
const MAX_TEXT = 4000;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 24;
const DELETE_WINDOW_MS = 6000; // soft-delete undo window

const STATUSES = [
  "backlog",
  "planned",
  "in-progress",
  "blocked",
  "review",
  "testing",
  "completed",
  "cancelled",
];
const PRIORITIES = ["critical", "high", "medium", "low"];
const TYPES = [
  "feature",
  "bug",
  "commit",
  "improvement",
  "research",
  "refactor",
  "documentation",
  "testing",
  "deployment",
  "maintenance",
  "meeting",
  "personal",
  "other",
];
const EFFORTS = ["small", "medium", "large"];
const PROJECT_STATUSES = ["active", "on-hold", "completed"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let state = null;
let rev = 0; // bumped on every mutation so the renderer can dedupe push updates
/** id -> { task, index, timer } during the undo window */
const pendingDeletes = new Map();

/* ---------------------------- sanitizing --------------------------- */

function generateId() {
  return crypto.randomUUID();
}

function cleanString(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function cleanDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(value + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : value;
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const tag of value) {
    if (typeof tag !== "string") continue;
    const t = tag.trim().slice(0, MAX_TAG_LEN).toLowerCase();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function cleanTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitizeTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = cleanString(raw.title ?? raw.text, MAX_TITLE);
  if (!title) return null;

  const completed =
    raw.completed === true || pickEnum(raw.status, STATUSES, "planned") === "completed";
  const status = pickEnum(raw.status, STATUSES, completed ? "completed" : "planned");
  const createdAt = cleanTimestamp(raw.createdAt) ?? Date.now();

  return {
    id: typeof raw.id === "string" && raw.id.length <= 64 ? raw.id : generateId(),
    title,
    description: cleanString(raw.description, MAX_TEXT),
    status,
    priority: pickEnum(raw.priority, PRIORITIES, "medium"),
    type: pickEnum(raw.type, TYPES, "other"),
    projectId:
      typeof raw.projectId === "string" && raw.projectId.length <= 64
        ? raw.projectId
        : null,
    tags: cleanTags(raw.tags),
    notes: cleanString(raw.notes, MAX_TEXT),
    effort: pickEnum(raw.effort, EFFORTS, "medium"),
    startDate: cleanDate(raw.startDate),
    dueDate: cleanDate(raw.dueDate),
    fileName: cleanString(raw.fileName, MAX_TITLE),
    filePath: cleanString(raw.filePath, MAX_TEXT),
    commitId: cleanString(raw.commitId, 120),
    extraDetails: cleanString(raw.extraDetails, MAX_TEXT),
    completedAt: status === "completed" ? cleanTimestamp(raw.completedAt) ?? Date.now() : null,
    archived: Boolean(raw.archived),
    pinned: Boolean(raw.pinned),
    createdAt,
    updatedAt: cleanTimestamp(raw.updatedAt) ?? createdAt,
  };
}

function sanitizeProject(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = cleanString(raw.name, MAX_TITLE);
  if (!name) return null;
  const createdAt = cleanTimestamp(raw.createdAt) ?? Date.now();

  return {
    id: typeof raw.id === "string" && raw.id.length <= 64 ? raw.id : generateId(),
    name,
    description: cleanString(raw.description, MAX_TEXT),
    status: pickEnum(raw.status, PROJECT_STATUSES, "active"),
    priority: pickEnum(raw.priority, PRIORITIES, "medium"),
    color: /^#[0-9a-fA-F]{6}$/.test(String(raw.color)) ? raw.color : null,
    startDate: cleanDate(raw.startDate),
    targetDate: cleanDate(raw.targetDate),
    tags: cleanTags(raw.tags),
    repoUrl: cleanString(raw.repoUrl, MAX_TEXT),
    rootPath: cleanString(raw.rootPath, MAX_TEXT),
    extraNotes: cleanString(raw.extraNotes, MAX_TEXT),
    createdAt,
    updatedAt: cleanTimestamp(raw.updatedAt) ?? createdAt,
  };
}

function isValidActivity(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    typeof entry.action === "string" &&
    typeof entry.at === "number"
  );
}

function sanitizeActivity(entry) {
  if (!isValidActivity(entry)) return null;
  return {
    id: typeof entry.id === "string" && entry.id.length <= 64 ? entry.id : generateId(),
    entity: pickEnum(entry.entity, ["task", "project", "system"], "task"),
    entityId: typeof entry.entityId === "string" && entry.entityId.length <= 64 ? entry.entityId : null,
    action: String(entry.action).slice(0, 40),
    title: cleanString(entry.title, MAX_TITLE),
    details: cleanString(entry.details, 500) || null,
    at: entry.at,
  };
}

function defaultSettings() {
  return { confirmDelete: true, lastView: "dashboard" };
}

function sanitizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  return {
    confirmDelete: typeof raw.confirmDelete === "boolean" ? raw.confirmDelete : base.confirmDelete,
    lastView:
      typeof raw.lastView === "string" && raw.lastView.length <= 32
        ? raw.lastView
        : base.lastView,
  };
}

function freshState() {
  return {
    version: SCHEMA_VERSION,
    tasks: [],
    projects: [],
    activity: [],
    settings: defaultSettings(),
  };
}

function sanitizeState(parsed) {
  const next = freshState();
  if (!parsed || typeof parsed !== "object") return next;

  next.tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks.map(sanitizeTask).filter(Boolean).slice(0, MAX_TASKS)
    : Array.isArray(parsed.todos)
      ? parsed.todos.map(sanitizeTask).filter(Boolean).slice(0, MAX_TASKS)
      : [];

  next.projects = Array.isArray(parsed.projects)
    ? parsed.projects.map(sanitizeProject).filter(Boolean).slice(0, MAX_PROJECTS)
    : [];

  next.activity = Array.isArray(parsed.activity)
    ? parsed.activity.map(sanitizeActivity).filter(Boolean).slice(0, MAX_ACTIVITY)
    : [];

  // Tasks referencing missing projects are detached gracefully.
  const projectIds = new Set(next.projects.map((p) => p.id));
  for (const task of next.tasks) {
    if (task.projectId && !projectIds.has(task.projectId)) task.projectId = null;
  }

  next.settings = sanitizeSettings(parsed.settings);
  return next;
}

/* ----------------------------- activity ---------------------------- */

function logActivity({ entity, entityId, action, title, details }) {
  const entry = {
    id: generateId(),
    entity,
    entityId: entityId ?? null,
    action,
    title: title ?? "",
    details: details ?? null,
    at: Date.now(),
  };
  state.activity.unshift(entry);
  if (state.activity.length > MAX_ACTIVITY) state.activity.length = MAX_ACTIVITY;
  db.insertActivity(entry);
}

/* --------------------------- persistence --------------------------- */

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

const ok = () => ({ ok: true, state: snapshot(), rev });
const fail = (error) => ({ ok: false, error });

/** Every successful mutation bumps rev; SQLite writes are already durable. */
function scheduleSave() {
  rev++;
}

function flush() {
  db.checkpoint();
}

function close() {
  for (const entry of pendingDeletes.values()) clearTimeout(entry.timer);
  pendingDeletes.clear();
  db.close();
}

/* --------------------- legacy JSON -> SQLite import ---------------- */

function tryMigrateLegacyJson() {
  if (db.getMeta("json_migrated_at")) return false;

  let source = null;
  let sourceName = null;

  // Current-format JSON first, then the pre-Forge todos.json array.
  const jsonPath = path.join(app.getPath("userData"), "forge-data.json");
  const legacyPath = path.join(app.getPath("userData"), "todos.json");
  try {
    source = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    sourceName = "forge-data.json";
  } catch {
    try {
      source = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
      sourceName = "todos.json";
    } catch {
      /* nothing to migrate */
    }
  }

  if (!source) {
    // Mark as handled so we don't rescan on every launch.
    db.setMeta("json_migrated_at", String(Date.now()));
    return false;
  }
  if (Array.isArray(source)) source = { todos: source };

  const migrated = sanitizeState(source);
  db.replaceAll(migrated);
  db.setMeta("json_migrated_at", String(Date.now()));

  console.log(
    `[store] migrated ${migrated.tasks.length} task(s) and ` +
      `${migrated.projects.length} project(s) from ${sourceName}`
  );
  return true;
}

function load() {
  const dataDir = app.getPath("userData");
  backupService.init(dataDir);
  db.open(dataDir);

  const migratedFrom = tryMigrateLegacyJson();

  state = {
    version: SCHEMA_VERSION,
    tasks: db.getAllTasks(),
    projects: db.getAllProjects(),
    activity: db.getAllActivity(MAX_ACTIVITY),
    settings: sanitizeSettings(db.getAllSettings()),
  };

  if (migratedFrom) {
    logActivity({
      entity: "system",
      action: "migrated",
      title: "Workspace migrated to SQLite",
      details:
        `${state.tasks.length} work item(s), ${state.projects.length} project(s). ` +
        `The original JSON file was kept untouched.`,
    });
  }
  rev++;
  return snapshot();
}

/* ------------------------------ queries ---------------------------- */

function projectById(id) {
  return state.projects.find((p) => p.id === id) || null;
}

function projectName(id) {
  const p = projectById(id);
  return p ? p.name : null;
}

/* ------------------------------- tasks ----------------------------- */

function createTask(payload) {
  const task = sanitizeTask({ ...payload, id: undefined });
  if (!task) return fail("A title is required");
  if (state.tasks.length >= MAX_TASKS) return fail("Workspace is full");

  if (task.projectId && !projectById(task.projectId)) task.projectId = null;

  task.createdAt = Date.now();
  task.updatedAt = Date.now();
  if (task.status === "completed") task.completedAt = Date.now();

  state.tasks.unshift(task);
  db.insertTask(task);
  logActivity({
    entity: "task",
    entityId: task.id,
    action: "created",
    title: task.title,
  });
  scheduleSave();
  return ok();
}

const FIELD_LABELS = {
  title: "Title",
  description: "Description",
  notes: "Notes",
  startDate: "Start date",
  dueDate: "Due date",
  effort: "Estimate",
  type: "Type",
  fileName: "File name",
  filePath: "File path",
  commitId: "Commit ID",
  extraDetails: "Extra details",
};

function updateTask(id, patch) {
  if (typeof id !== "string" || !id) return fail("Invalid id");
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return fail("Work item not found");
  if (!patch || typeof patch !== "object") return ok();

  const before = { ...task };

  // Scalar text fields
  for (const key of ["title", "description", "notes"]) {
    if (typeof patch[key] === "string") {
      const clean = cleanString(patch[key], key === "title" ? MAX_TITLE : MAX_TEXT);
      if (key !== "title" || clean) task[key] = clean;
    }
  }

  if ("status" in patch) task.status = pickEnum(patch.status, STATUSES, task.status);
  if ("priority" in patch) task.priority = pickEnum(patch.priority, PRIORITIES, task.priority);
  if ("type" in patch) task.type = pickEnum(patch.type, TYPES, task.type);
  if ("effort" in patch) task.effort = pickEnum(patch.effort, EFFORTS, task.effort);
  if ("startDate" in patch) task.startDate = cleanDate(patch.startDate);
  if ("dueDate" in patch) task.dueDate = cleanDate(patch.dueDate);
  if ("tags" in patch) task.tags = cleanTags(patch.tags);
  if ("archived" in patch) task.archived = Boolean(patch.archived);
  if ("pinned" in patch) task.pinned = Boolean(patch.pinned);
  if ("fileName" in patch) task.fileName = cleanString(patch.fileName, MAX_TITLE);
  if ("filePath" in patch) task.filePath = cleanString(patch.filePath, MAX_TEXT);
  if ("commitId" in patch) task.commitId = cleanString(patch.commitId, 120);
  if ("extraDetails" in patch) task.extraDetails = cleanString(patch.extraDetails, MAX_TEXT);

  if ("projectId" in patch) {
    task.projectId =
      patch.projectId && projectById(patch.projectId) ? patch.projectId : null;
  }

  // Completion bookkeeping
  if (task.status === "completed" && before.status !== "completed") {
    task.completedAt = Date.now();
  } else if (task.status !== "completed" && before.status === "completed") {
    task.completedAt = null;
  }

  let changed = false;

  if (task.status !== before.status) {
    logActivity({
      entity: "task",
      entityId: task.id,
      action:
        task.status === "completed"
          ? "completed"
          : before.status === "completed"
            ? "reopened"
            : "status-changed",
      title: task.title,
      details: `${statusLabel(before.status)} \u2192 ${statusLabel(task.status)}`,
    });
    changed = true;
  }

  if (task.priority !== before.priority) {
    logActivity({
      entity: "task",
      entityId: task.id,
      action: "priority-changed",
      title: task.title,
      details: `${cap(before.priority)} \u2192 ${cap(task.priority)}`,
    });
    changed = true;
  }

  if (task.projectId !== before.projectId) {
    logActivity({
      entity: "task",
      entityId: task.id,
      action: "project-changed",
      title: task.title,
      details: `${projectName(before.projectId) ?? "No project"} \u2192 ${
        projectName(task.projectId) ?? "No project"
      }`,
    });
    changed = true;
  }

  if (task.archived !== before.archived) {
    logActivity({
      entity: "task",
      entityId: task.id,
      action: task.archived ? "archived" : "unarchived",
      title: task.title,
    });
    changed = true;
  }

  if (task.pinned !== before.pinned) {
    logActivity({
      entity: "task",
      entityId: task.id,
      action: task.pinned ? "pinned" : "unpinned",
      title: task.title,
    });
    changed = true;
  }

  for (const key of Object.keys(FIELD_LABELS)) {
    if (JSON.stringify(task[key]) !== JSON.stringify(before[key])) {
      logActivity({
        entity: "task",
        entityId: task.id,
        action: "updated",
        title: task.title,
        details:
          key === "tags"
            ? task.tags.length
              ? `Tags: ${task.tags.join(", ")}`
              : "Tags cleared"
            : `${FIELD_LABELS[key]} updated`,
      });
      changed = true;
    }
  }

  if (!changed) return ok();

  task.updatedAt = Date.now();
  db.updateTask(task);
  scheduleSave();
  return ok();
}

function deleteTask(id) {
  if (typeof id !== "string" || !id) return fail("Invalid id");
  const index = state.tasks.findIndex((t) => t.id === id);
  if (index === -1) return fail("Work item not found");

  const [task] = state.tasks.splice(index, 1);
  db.deleteTaskById(id);

  // Soft-delete: keep in memory for the undo window.
  if (pendingDeletes.has(id)) clearTimeout(pendingDeletes.get(id).timer);
  const timer = setTimeout(() => pendingDeletes.delete(id), DELETE_WINDOW_MS);
  pendingDeletes.set(id, { task, index, timer });

  logActivity({
    entity: "task",
    entityId: id,
    action: "deleted",
    title: task.title,
  });
  scheduleSave();
  return ok();
}

function undeleteTask(id) {
  const entry = pendingDeletes.get(id);
  if (!entry) return fail("The undo window has expired");

  clearTimeout(entry.timer);
  pendingDeletes.delete(id);

  // The project may have been removed during the undo window — the
  // foreign key requires the reference to be gone too.
  if (entry.task.projectId && !projectById(entry.task.projectId)) {
    entry.task.projectId = null;
  }

  const pos = Math.min(entry.index, state.tasks.length);
  state.tasks.splice(pos, 0, entry.task);
  db.restoreTaskAt(entry.task, pos);

  logActivity({
    entity: "task",
    entityId: id,
    action: "restored",
    title: entry.task.title,
  });
  scheduleSave();
  return ok();
}

function duplicateTask(id) {
  if (typeof id !== "string" || !id) return fail("Invalid id");
  const sourceIndex = state.tasks.findIndex((t) => t.id === id);
  if (sourceIndex === -1) return fail("Work item not found");
  if (state.tasks.length >= MAX_TASKS) return fail("Workspace is full");

  const source = state.tasks[sourceIndex];
  const copy = sanitizeTask({
    ...JSON.parse(JSON.stringify(source)),
    id: undefined,
    title: source.title + " (copy)",
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  state.tasks.splice(sourceIndex + 1, 0, copy);
  db.duplicateTaskPositionAware(source.id, copy);
  logActivity({
    entity: "task",
    entityId: copy.id,
    action: "created",
    title: copy.title,
    details: `Duplicated from \u201c${source.title}\u201d`,
  });
  scheduleSave();
  return ok();
}

/* ----------------------------- projects ---------------------------- */

function createProject(payload) {
  const project = sanitizeProject({ ...payload, id: undefined });
  if (!project) return fail("A project name is required");
  if (state.projects.length >= MAX_PROJECTS) return fail("Too many projects");

  project.createdAt = Date.now();
  project.updatedAt = Date.now();
  state.projects.unshift(project);
  db.insertProject(project);

  logActivity({
    entity: "project",
    entityId: project.id,
    action: "created",
    title: project.name,
  });
  scheduleSave();
  return ok();
}

const PROJECT_FIELD_LABELS = {
  name: "Name",
  description: "Description",
  targetDate: "Target date",
  startDate: "Start date",
  repoUrl: "Repo URL",
  rootPath: "Root path",
  extraNotes: "Extra notes",
};

function updateProject(id, patch) {
  if (typeof id !== "string" || !id) return fail("Invalid id");
  const project = projectById(id);
  if (!project) return fail("Project not found");
  if (!patch || typeof patch !== "object") return ok();

  const before = { ...project };

  for (const key of ["name", "description"]) {
    if (typeof patch[key] === "string") {
      const clean = cleanString(patch[key], key === "name" ? MAX_TITLE : MAX_TEXT);
      if (key !== "name" || clean) project[key] = clean;
    }
  }
  if ("status" in patch) project.status = pickEnum(patch.status, PROJECT_STATUSES, project.status);
  if ("priority" in patch) project.priority = pickEnum(patch.priority, PRIORITIES, project.priority);
  if ("startDate" in patch) project.startDate = cleanDate(patch.startDate);
  if ("targetDate" in patch) project.targetDate = cleanDate(patch.targetDate);
  if ("tags" in patch) project.tags = cleanTags(patch.tags);
  if ("color" in patch && /^#[0-9a-fA-F]{6}$/.test(String(patch.color))) {
    project.color = patch.color;
  }
  if ("repoUrl" in patch) project.repoUrl = cleanString(patch.repoUrl, MAX_TEXT);
  if ("rootPath" in patch) project.rootPath = cleanString(patch.rootPath, MAX_TEXT);
  if ("extraNotes" in patch) project.extraNotes = cleanString(patch.extraNotes, MAX_TEXT);

  let changed = false;

  if (project.status !== before.status) {
    logActivity({
      entity: "project",
      entityId: project.id,
      action: "updated",
      title: project.name,
      details: `Status: ${cap(before.status)} \u2192 ${cap(project.status)}`,
    });
    changed = true;
  }

  if (project.priority !== before.priority) {
    logActivity({
      entity: "project",
      entityId: project.id,
      action: "priority-changed",
      title: project.name,
      details: `${cap(before.priority)} \u2192 ${cap(project.priority)}`,
    });
    changed = true;
  }

  for (const key of Object.keys(PROJECT_FIELD_LABELS)) {
    if (JSON.stringify(project[key]) !== JSON.stringify(before[key])) {
      logActivity({
        entity: "project",
        entityId: project.id,
        action: "updated",
        title: project.name,
        details: `${PROJECT_FIELD_LABELS[key]} updated`,
      });
      changed = true;
    }
  }

  if (!changed) return ok();

  project.updatedAt = Date.now();
  db.updateProject(project);
  scheduleSave();
  return ok();
}

function deleteProject(id) {
  if (typeof id !== "string" || !id) return fail("Invalid id");
  const index = state.projects.findIndex((p) => p.id === id);
  if (index === -1) return fail("Project not found");

  const [project] = state.projects.splice(index, 1);

  let detached = 0;
  const now = Date.now();
  for (const task of state.tasks) {
    if (task.projectId === id) {
      task.projectId = null;
      task.updatedAt = now;
      detached++;
    }
  }
  // Same detach + delete, atomically, in SQLite.
  db.deleteProjectCascade(id, now);

  logActivity({
    entity: "project",
    entityId: id,
    action: "deleted",
    title: project.name,
    details: detached ? `${detached} work item(s) detached` : null,
  });
  scheduleSave();
  return ok();
}

/* ------------------------- settings / system ----------------------- */

function updateSettings(patch) {
  if (!patch || typeof patch !== "object") return ok();
  const before = state.settings;
  state.settings = sanitizeSettings({ ...state.settings, ...patch });
  for (const key of Object.keys(state.settings)) {
    if (before[key] !== state.settings[key]) {
      db.upsertSetting(key, state.settings[key]);
    }
  }
  scheduleSave();
  return ok();
}

function clearActivity() {
  state.activity = [];
  db.clearActivity();
  scheduleSave();
  return ok();
}

function resetAll() {
  db.replaceAll(freshState());
  state = freshState();
  logActivity({ entity: "system", action: "reset", title: "Workspace reset" });
  flush();
  return ok();
}

async function exportToFile() {
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog({
    title: "Export Forge backup",
    defaultPath: path.join(app.getPath("documents"), `forge-backup-${stamp}.json`),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { ok: true, canceled: true };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(state, null, 2), "utf-8");
    return { ok: true, savedTo: result.filePath };
  } catch (err) {
    return fail(`Export failed: ${err.message}`);
  }
}

async function importFromFile() {
  const result = await dialog.showOpenDialog({
    title: "Import Forge backup",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true };
  try {
    const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], "utf-8"));
    const candidate = sanitizeState(parsed);
    if (!Array.isArray(candidate.tasks) || !Array.isArray(candidate.projects)) {
      return fail("This file doesn't look like a Forge backup.");
    }
    state = candidate;
    // Persist the whole imported workspace (including its history) as
    // one atomic transaction, then record the import itself on top.
    db.replaceAll(state);
    logActivity({
      entity: "system",
      action: "imported",
      title: "Backup imported",
      details: `${state.tasks.length} work item(s), ${state.projects.length} project(s)`,
    });
    flush();
    return ok();
  } catch (err) {
    return fail(`Import failed: ${err.message}`);
  }
}

/* ----------------------------- helpers ----------------------------- */

const STATUS_LABELS = {
  backlog: "Backlog",
  planned: "Planned",
  "in-progress": "In Progress",
  blocked: "Blocked",
  review: "Review",
  testing: "Testing",
  completed: "Completed",
  cancelled: "Cancelled",
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function cap(text) {
  return typeof text === "string" && text
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : "";
}

module.exports = {
  load,
  flush,
  close,
  getState: ok,
  createTask,
  updateTask,
  deleteTask,
  undeleteTask,
  duplicateTask,
  createProject,
  updateProject,
  deleteProject,
  updateSettings,
  clearActivity,
  resetAll,
  exportToFile,
  importFromFile,
  info() {
    return {
      userData: app.getPath("userData"),
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
    };
  },
};
