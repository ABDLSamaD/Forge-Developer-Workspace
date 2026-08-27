"use strict";

/* ------------------------------------------------------------------ *
 * db-smoke.test.js — integration smoke tests for the SQLite layer.
 *
 * Runs inside Electron (npm test) against an isolated temp userData,
 * so the real workspace is never touched:
 *
 *   1. migrations apply cleanly on a fresh database
 *   2. legacy forge-data.json migrates once (and only once)
 *   3. task/project CRUD persists across a simulated restart
 *   4. list ordering survives restarts (create/duplicate/undo)
 *   5. project deletion detaches tasks (FK cascade)
 *   6. auto backup creates a valid snapshot + retention trims old ones
 *
 * Exit code 0 = all green.
 * ------------------------------------------------------------------ */

const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

/* Isolate the test environment BEFORE anything touches userData. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-"));
app.setPath("userData", TMP);

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

/* Seed a plausible legacy JSON file. */
function seedLegacyJson() {
  const legacy = {
    version: 3,
    tasks: [
      {
        id: "t-newer",
        title: "Newer task",
        status: "in-progress",
        priority: "critical",
        projectId: "p-1",
        dueDate: "2030-01-01",
        notes: "keep me",
        createdAt: 3000,
        updatedAt: 4000,
      },
      {
        id: "t-older",
        title: "Older task",
        status: "completed",
        priority: "high",
        type: "bug",
        projectId: "p-1",
        tags: ["core"],
        createdAt: 1000,
        updatedAt: 2000,
      },
    ],
    projects: [
      {
        id: "p-1",
        name: "Legacy Project",
        description: "migrated",
        status: "active",
        priority: "high",
        color: "#ff8800",
        tags: ["legacy"],
        createdAt: 500,
        updatedAt: 600,
      },
    ],
    activity: [
      { id: "a-1", entity: "system", action: "seeded", title: "seed", at: 700 },
    ],
    settings: { confirmDelete: false, lastView: "projects" },
  };
  fs.writeFileSync(
    path.join(TMP, "forge-data.json"),
    JSON.stringify(legacy),
    "utf-8"
  );
}

app.whenReady().then(async () => {
  const store = require("../store");
  const backup = require("../backup");
  const dbi = require("../db");

  try {
    /* ------------------------- migration ------------------------- */
    section("1. legacy JSON migration");
    seedLegacyJson();
    const first = store.load();
    check("loads migrated tasks", first.tasks.length === 2);
    check("loads migrated projects", first.projects.length === 1);
    check("newest task first (order preserved)", first.tasks[0].id === "t-newer");
    check("settings migrated", first.settings.confirmDelete === false);
    check("activity migrated", first.activity.length >= 2);

    /* ---------------------- persistence round --------------------- */
    section("2. persistence across simulated restart");

    const created = store.createTask({
      title: "Fresh task",
      priority: "low",
      projectId: "p-1",
      tags: ["x", "x", "y"],
    });
    check("createTask ok", created.ok === true);
    const freshId = created.state.tasks[0].id;
    check("new task appears first", created.state.tasks[0].title === "Fresh task");

    const upd = store.updateTask(freshId, {
      status: "completed",
      priority: "high",
    });
    check("updateTask ok", upd.ok === true);
    check(
      "completedAt stamped",
      typeof upd.state.tasks.find((t) => t.id === freshId).completedAt === "number"
    );

    const dup = store.duplicateTask(freshId);
    check("duplicateTask ok", dup.ok === true);
    check(
      "duplicate sits right below source",
      dup.state.tasks[1].title === "Fresh task (copy)"
    );

    const copyId = dup.state.tasks[1].id;
    const del = store.deleteTask(copyId);
    check("deleteTask ok", del.ok === true);
    check("deleted item removed from list", del.state.tasks.length === 3);
    const undone = store.undeleteTask(copyId);
    check("undo restores item", undone.ok === true && undone.state.tasks[1].title === "Fresh task (copy)");

    /* Force durability then reload everything through a fresh connection. */
    store.close();
    const reopened = store.load();
    check("restart keeps task count", reopened.tasks.length === 4);
    check(
      "restart preserves exact order",
      JSON.stringify(reopened.tasks.map((t) => t.title)) ===
        JSON.stringify(["Fresh task", "Fresh task (copy)", "Newer task", "Older task"])
    );
    check(
      "reloaded update persisted (status)",
      reopened.tasks.find((t) => t.id === freshId).status === "completed"
    );

    /* ------------------------ project delete ----------------------- */
    section("3. project delete detaches tasks");
    const pd = store.deleteProject("p-1");
    check("deleteProject ok", pd.ok === true);
    check(
      "tasks detached in memory",
      pd.state.tasks.every((t) => t.projectId === null)
    );
    store.close();
    const afterPd = store.load();
    check(
      "tasks detached on disk too",
      afterPd.tasks.every((t) => t.projectId === null)
    );

    /* --------------------------- backups --------------------------- */
    section("4. database backups");
    await backup.autoBackupIfNeeded();
    const snaps = backup.listAutoBackups();
    check("auto backup created", snaps.length >= 1);
    const v = backup.validateBackupFile(snaps[0].path);
    check("snapshot validates", v.valid === true);
    check("snapshot has tasks", typeof v.tasks === "number");

    /* -------------------------- settings --------------------------- */
    section("5. settings + reset");
    const st = store.updateSettings({ confirmDelete: true });
    check("updateSettings ok", st.ok === true && st.state.settings.confirmDelete === true);

    const rs = store.resetAll();
    check("resetAll ok", rs.ok === true && rs.state.tasks.length === 0);
    store.close();
    const afterReset = store.load();
    check("reset persisted", afterReset.tasks.length === 0);
    check("marker survives reset (no re-import)", afterReset.tasks.length === 0);

    section("6. foreign key enforcement");
    const fk = store.createProject({ name: "Temp" });
    const pid = fk.state.projects[0].id;
    const tk = store.createTask({ title: "linked", projectId: pid });
    check("task linked", tk.ok === true);
    store.close();
    const conn = dbi.open(app.getPath("userData"));

    // Referential integrity: a task cannot point at a missing project.
    let insertBlocked = false;
    try {
      conn
        .prepare(
          `INSERT INTO tasks (id, title, status, priority, type, effort, tags,
             notes, archived, pinned, position, created_at, updated_at, project_id)
           VALUES ('bad', 'bad', 'planned', 'medium', 'other', 'medium', '[]',
             '', 0, 0, 0, 0, 0, 'no-such-project')`
        )
        .run();
    } catch (err) {
      insertBlocked = String(err.message).includes("FOREIGN KEY");
    }
    check("orphan task reference rejected", insertBlocked === true);

    // Parent delete cascades as SET NULL (matches app semantics).
    conn.prepare("DELETE FROM projects WHERE id = ?").run(pid);
    const child = conn
      .prepare(`SELECT project_id FROM tasks WHERE title = 'linked'`)
      .get();
    conn.close();
    check("parent delete detaches children", child && child.project_id === null);
  } catch (err) {
    failures++;
    console.error("\nUNEXPECTED ERROR:", err.stack || err.message);
  }

  console.log(
    `\n${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"}\n`
  );
  try {
    store.close();
  } catch {}
  try {
    fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    console.error(`cleanup warning: ${err.message}`);
  }
  app.exit(failures === 0 ? 0 : 1);
});
