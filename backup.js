"use strict";

/* ------------------------------------------------------------------ *
 * backup.js — SQLite backup / restore / retention (main process only)
 *
 * - Auto-backup at most once every AUTO_BACKUP_INTERVAL_MS, using
 *   better-sqlite3's online `db.backup()` which produces a consistent,
 *   self-contained copy even while WAL is active.
 * - Retention: keep the newest KEEP_AUTO_BACKUPS auto backups.
 * - Manual "Backup Now": user picks the destination via native dialog.
 * - Restore: validates the chosen file, swaps it in atomically-ish and
 *   relaunches the app so a fresh connection is opened.
 * ------------------------------------------------------------------ */

const path = require("path");
const fs = require("fs");
const { app, dialog, shell } = require("electron");
const db = require("./db");

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const KEEP_AUTO_BACKUPS = 10;
const AUTO_PREFIX = "forge-auto-";

let dataDir = null;
let lastAutoBackupAt = 0;

/* ------------------------------ paths ------------------------------ */

function init(dir) {
  dataDir = dir;
}

function backupsPath() {
  return db.backupsDir(dataDir);
}

function databasePath() {
  return path.join(dataDir, "forge.db");
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/* --------------------------- auto backup --------------------------- */

async function autoBackupIfNeeded() {
  if (!dataDir) return;
  try {
    const last = Number(db.getMeta("last_auto_backup")) || 0;
    if (Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return;

    const target = path.join(backupsPath(), `${AUTO_PREFIX}${stamp()}.db`);
    await backupTo(target);
    db.setMeta("last_auto_backup", String(Date.now()));
    lastAutoBackupAt = Date.now();
    applyRetention();
    console.log(`[backup] auto-backup created: ${path.basename(target)}`);
  } catch (err) {
    // Never let backup problems block normal startup.
    console.error("[backup] auto-backup failed:", err.message);
  }
}

function applyRetention() {
  try {
    const files = listAutoBackups();
    for (const old of files.slice(KEEP_AUTO_BACKUPS)) {
      fs.rmSync(old.path, { force: true });
    }
  } catch (err) {
    console.error("[backup] retention failed:", err.message);
  }
}

function listAutoBackups() {
  const dir = backupsPath();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(AUTO_PREFIX) && f.endsWith(".db"))
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime); // newest first
}

/* -------------------------- manual backup -------------------------- */

async function createBackupManual() {
  const result = await dialog.showSaveDialog({
    title: "Save Forge database backup",
    defaultPath: path.join(app.getPath("documents"), `forge-backup-${stamp()}.db`),
    filters: [{ name: "Forge database", extensions: ["db"] }],
  });
  if (result.canceled || !result.filePath) return { ok: true, canceled: true };
  try {
    await backupTo(result.filePath);
    return { ok: true, savedTo: result.filePath };
  } catch (err) {
    return { ok: false, error: `Backup failed: ${err.message}` };
  }
}

async function backupTo(destination) {
  // Online backup API — consistent snapshot regardless of WAL state.
  await db.backupToFile(destination);
}

/* ------------------------------ restore ---------------------------- */

function validateBackupFile(filePath) {
  let check;
  try {
    const Database = require("better-sqlite3");
    check = new Database(filePath, { readonly: true, fileMustExist: true });
    const row = check
      .prepare(
        `SELECT count(*) AS n FROM sqlite_master
         WHERE type='table' AND name IN ('tasks','projects','activity_log','settings')`
      )
      .get();
    if (row.n < 4) throw new Error("Missing required tables");
    const tasks = check.prepare("SELECT count(*) AS n FROM tasks").get();
    return { valid: true, tasks: tasks.n };
  } catch (err) {
    return { valid: false, error: err.message };
  } finally {
    try {
      if (check) check.close();
    } catch {}
  }
}

async function restoreFromBackup() {
  const result = await dialog.showOpenDialog({
    title: "Choose a Forge database backup to restore",
    properties: ["openFile"],
    filters: [{ name: "Forge database", extensions: ["db"] }],
  });
  if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true };

  const selected = result.filePaths[0];
  const validation = validateBackupFile(selected);
  if (!validation.valid) {
    return { ok: false, error: `Not a valid Forge database: ${validation.error}` };
  }

  try {
    const live = databasePath();

    // Close the active connection so Windows releases its file locks.
    db.close();

    const tmp = `${live}.restoring`;
    fs.rmSync(tmp, { force: true });
    fs.copyFileSync(selected, tmp);

    // Keep the current database around until the swap succeeds.
    const prev = `${live}.pre-restore`;
    fs.rmSync(prev, { force: true });
    let rolledBack = false;
    if (fs.existsSync(live)) {
      try {
        fs.renameSync(live, prev);
      } catch (err) {
        throw new Error(`could not stage current database: ${err.message}`);
      }
    }
    try {
      fs.renameSync(tmp, live);
    } catch (err) {
      if (fs.existsSync(prev)) {
        fs.renameSync(prev, live); // put the original back
        rolledBack = true;
      }
      throw new Error(`could not install restored database: ${err.message}${rolledBack ? " (original recovered)" : ""}`);
    }
    fs.rmSync(prev, { force: true });

    setImmediate(() => {
      app.relaunch();
      app.exit(0);
    });
    return { ok: true, restoring: true, tasks: validation.tasks };
  } catch (err) {
    // Try to recover a usable connection before giving up.
    try {
      if (!db.isOpen()) db.open(dataDir);
    } catch {}
    return { ok: false, error: `Restore failed: ${err.message}` };
  }
}

/* ------------------------------ info ------------------------------- */

function info() {
  const last = Number(db.getMeta("last_auto_backup")) || 0;
  return {
    databasePath: databasePath(),
    backupsDir: backupsPath(),
    lastAutoBackup: last || null,
    autoBackupCount: listAutoBackups().length,
  };
}

function openBackupsFolder() {
  shell.openPath(backupsPath());
  return { ok: true };
}

module.exports = {
  init,
  autoBackupIfNeeded,
  createBackupManual,
  restoreFromBackup,
  openBackupsFolder,
  info,
  validateBackupFile,
  listAutoBackups,
};
