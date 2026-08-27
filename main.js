"use strict";

const { app, BrowserWindow, Menu, session, shell } = require("electron");
const path = require("path");
const store = require("./store");
const backup = require("./backup");
const processService = require("./process-service");
const { registerIpc } = require("./ipc");

let mainWindow = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Force sandbox mode for all renderers before app is ready
app.enableSandbox();

// Taskbar grouping + notifications use this id (matches build.appId)
app.setAppUserModelId("com.forge.workspace");

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
    icon: path.join(__dirname, "build", "icon.png"),
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

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Surface renderer-side errors in the terminal during development
  if (!app.isPackaged) {
    const contents = mainWindow.webContents;
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

/* Defense-in-depth: apply popup/navigation rules to every webContents
 * this app ever creates, not just the main window. Navigation is
 * restricted to the bundled renderer directory; http(s) links open in
 * the system browser; everything else is blocked. */
app.on("web-contents-created", (_event, contents) => {
  const allowedBase = path.dirname(path.join(__dirname, "renderer", "index.html"));
  const { pathToFileURL } = require("url");
  const allowedBaseUrl = pathToFileURL(allowedBase).href;

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    const isBundled = url.startsWith("file:") && url.startsWith(allowedBaseUrl);
    if (!isBundled) event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Block permission requests from any renderer.
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );
});

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
  store.load(); // opens SQLite, migrates legacy JSON once
  registerIpc();
  createWindow();

  // Daily snapshot — never blocks startup on failure.
  backup.autoBackupIfNeeded().catch((err) =>
    console.error("[backup] failed:", err.message)
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  try {
    processService.closeAllSessions();
    store.close(); // checkpoint WAL + release the database file
  } catch (err) {
    console.error("[shutdown] close failed:", err.message);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
