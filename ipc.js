"use strict";

const { ipcMain } = require("electron");
const store = require("./store");

/* Channels whose success mutates workspace data — the fresh state is pushed
 * back to the renderer so the UI updates instantly, every time. */
const PUSH_CHANNELS = new Set([
  "task:create",
  "task:update",
  "task:delete",
  "task:undelete",
  "task:duplicate",
  "project:create",
  "project:update",
  "project:delete",
  "activity:clear",
  "data:reset",
  "data:import",
]);

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await fn(...args);
      if (result && result.ok && result.state && PUSH_CHANNELS.has(channel)) {
        event.sender.send("state:changed", { state: result.state, rev: result.rev });
      }
      return result;
    } catch (err) {
      console.error(`IPC ${channel} failed:`, err.message);
      return { ok: false, error: "Internal error" };
    }
  });
}

function registerIpc() {
  handle("data:get", () => ({ ...store.getState(), appVersion: store.info().appVersion }));
  handle("data:info", () => ({ ok: true, info: store.info() }));
  handle("data:reset", () => store.resetAll());
  handle("data:export", () => store.exportToFile());
  handle("data:import", () => store.importFromFile());

  handle("task:create", (payload) => store.createTask(payload));
  handle("task:update", (id, patch) => store.updateTask(id, patch));
  handle("task:delete", (id) => store.deleteTask(id));
  handle("task:undelete", (id) => store.undeleteTask(id));
  handle("task:duplicate", (id) => store.duplicateTask(id));

  handle("project:create", (payload) => store.createProject(payload));
  handle("project:update", (id, patch) => store.updateProject(id, patch));
  handle("project:delete", (id) => store.deleteProject(id));

  handle("settings:update", (patch) => store.updateSettings(patch));
  handle("activity:clear", () => store.clearActivity());
}

module.exports = { registerIpc };
