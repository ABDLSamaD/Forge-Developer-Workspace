"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("forge", {
  getState: () => invoke("data:get"),
  getInfo: () => invoke("data:info"),
  resetAll: () => invoke("data:reset"),
  exportData: () => invoke("data:export"),
  importData: () => invoke("data:import"),

  /** Subscribe to state pushes from the main process. Returns unsubscribe. */
  onStateChanged: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },

  createTask: (payload) => invoke("task:create", payload),
  updateTask: (id, patch) => invoke("task:update", id, patch),
  deleteTask: (id) => invoke("task:delete", id),
  undeleteTask: (id) => invoke("task:undelete", id),
  duplicateTask: (id) => invoke("task:duplicate", id),

  createProject: (payload) => invoke("project:create", payload),
  updateProject: (id, patch) => invoke("project:update", id, patch),
  deleteProject: (id) => invoke("project:delete", id),

  updateSettings: (patch) => invoke("settings:update", patch),
  clearActivity: () => invoke("activity:clear"),

  terminal: {
    createSession: (payload) => invoke("terminal:createSession", payload),
    write: (id, input) => invoke("terminal:write", id, input),
    resize: (id, cols, rows) => invoke("terminal:resize", id, cols, rows),
    kill: (id) => invoke("terminal:kill", id),
    read: (id) => invoke("terminal:read", id),
  },

  git: {
    status: (root) => invoke("git:status", root),
    log: (root) => invoke("git:log", root),
  },

  /* Database backups (native .db snapshots) */
  createBackup: () => invoke("backup:create"),
  restoreBackup: () => invoke("backup:restore"),
  openBackupsFolder: () => invoke("backup:openFolder"),
});
