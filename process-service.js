"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const sessions = new Map();
let nextSessionId = 1;

function normalizePath(p) {
  if (typeof p !== "string" || !p.trim()) return null;
  try {
    return path.resolve(p);
  } catch {
    return null;
  }
}

function isWithinRoot(target, root) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function validateCwd(cwd, allowedRoots = []) {
  const resolved = normalizePath(cwd);
  if (!resolved) return null;
  if (!fs.existsSync(resolved)) return null;
  if (!fs.statSync(resolved).isDirectory()) return null;
  if (allowedRoots.length === 0) return resolved;
  return allowedRoots.some((root) => isWithinRoot(resolved, normalizePath(root) || ""))
    ? resolved
    : null;
}

function shellCommand() {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/sh";
}

function createTerminalSession({ cwd, allowedRoots = [] } = {}) {
  const safeCwd = validateCwd(cwd || process.cwd(), allowedRoots);
  if (!safeCwd) return { ok: false, error: "Invalid project root" };

  const child = spawn(shellCommand(), [], {
    cwd: safeCwd,
    stdio: "pipe",
    windowsHide: true,
  });

  const id = String(nextSessionId++);
  sessions.set(id, { child, cwd: safeCwd, buffer: "", exited: false, exitCode: null });

  child.stdout.on("data", (chunk) => {
    const session = sessions.get(id);
    if (session) session.buffer += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    const session = sessions.get(id);
    if (session) session.buffer += chunk.toString("utf8");
  });
  child.on("exit", (code) => {
    const session = sessions.get(id);
    if (session) {
      session.exited = true;
      session.exitCode = code;
    }
  });

  return { ok: true, session: { id, cwd: safeCwd } };
}

function writeTerminalSession(id, input) {
  const session = sessions.get(String(id));
  if (!session) return { ok: false, error: "Unknown session" };
  if (!session.child || session.exited) return { ok: false, error: "Session closed" };
  if (typeof input !== "string") return { ok: false, error: "Invalid input" };
  session.child.stdin.write(input);
  return { ok: true };
}

function resizeTerminalSession(id, cols, rows) {
  const session = sessions.get(String(id));
  if (!session || session.exited) return { ok: false, error: "Session closed" };
  const c = Number(cols);
  const r = Number(rows);
  if (!Number.isFinite(c) || !Number.isFinite(r) || c <= 0 || r <= 0) {
    return { ok: false, error: "Invalid size" };
  }
  if (typeof session.child.resize === "function") session.child.resize(c, r);
  return { ok: true };
}

function killTerminalSession(id) {
  const session = sessions.get(String(id));
  if (!session) return { ok: false, error: "Unknown session" };
  try {
    session.child.kill();
  } catch {}
  sessions.delete(String(id));
  return { ok: true };
}

function closeAllSessions() {
  for (const [id, session] of sessions.entries()) {
    try {
      if (session.child && !session.exited) session.child.kill();
    } catch {}
    sessions.delete(id);
  }
}

function readTerminalOutput(id) {
  const session = sessions.get(String(id));
  if (!session) return { ok: false, error: "Unknown session" };
  const output = session.buffer;
  session.buffer = "";
  return { ok: true, output, exited: session.exited, exitCode: session.exitCode };
}

function gitStatus(root) {
  const cwd = validateCwd(root || process.cwd());
  if (!cwd) return { ok: false, error: "Invalid project root" };
  const result = spawnSyncGit(["status", "--short", "--branch"], cwd);
  return result;
}

function gitLog(root) {
  const cwd = validateCwd(root || process.cwd());
  if (!cwd) return { ok: false, error: "Invalid project root" };
  const result = spawnSyncGit(["log", "--oneline", "-n", "12"], cwd);
  return result;
}

function spawnSyncGit(args, cwd) {
  const { spawnSync } = require("child_process");
  const child = spawnSync("git", args, { cwd, windowsHide: true, encoding: "utf8" });
  if (child.error) return { ok: false, error: child.error.message };
  if (child.status !== 0 && !child.stdout && !child.stderr) {
    return { ok: false, error: "Git command failed" };
  }
  return {
    ok: true,
    cwd,
    output: (child.stdout || child.stderr || "").trim(),
    code: child.status,
  };
}

module.exports = {
  createTerminalSession,
  writeTerminalSession,
  resizeTerminalSession,
  killTerminalSession,
  closeAllSessions,
  readTerminalOutput,
  gitStatus,
  gitLog,
};
