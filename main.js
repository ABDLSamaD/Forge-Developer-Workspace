"use strict";

const { app, BrowserWindow, Menu, session, shell } = require("electron");
const path = require("path");
const store = require("./store");
const { registerIpc } = require("./ipc");

let mainWindow = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Force sandbox mode for all renderers before app is ready
app.enableSandbox();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 700,
    minWidth: 760,
    minHeight: 540,
    center: true,
    title: "Forge — Developer Workspace",
    backgroundColor: "#16171b",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });

  const contents = mainWindow.webContents;

  // Block any window.open / popups; send http(s) links to the system browser
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Block navigation away from bundled files
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Surface renderer-side errors in the terminal during development
  if (!app.isPackaged) {
    contents.on("console-message", (_e, level, message, line, source) => {
      if (level >= 2) {
        console.error(`[renderer] ${message} (${source}:${line})`);
      }
    });
    contents.on("preload-error", (_e, preloadPath, error) => {
      console.error(`[preload] ${preloadPath}: ${error.message}`);
    });
    contents.on("render-process-gone", (_e, details) => {
      console.error(`[renderer-gone] ${details.reason}`);
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function configureMenu() {
  if (process.platform === "darwin") {
    // macOS needs an Edit menu for copy/paste shortcuts to work in inputs
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "windowMenu" },
      ])
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
  ses.setPermissionCheckHandler(() => false);
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  hardenSession();
  configureMenu();
  store.load();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  store.flush();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
