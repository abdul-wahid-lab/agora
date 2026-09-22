// Electron main process - Step 6 of the desktop build-out (see BUILD_LOG.md).
//
// Responsibilities:
//   1. Spawn the existing Python backend (app.api, the same FastAPI service
//      the dev workflow already runs by hand) as a background child process,
//      writing its data (SQLite db, downloaded files) to this OS's proper
//      per-user app-data directory instead of the repo folder.
//   2. Open a frameless BrowserWindow loading the React frontend - frameless
//      because the app already draws its own custom titlebar (traffic
//      lights + menu bar, matching the design file exactly); a native OS
//      frame on top of that would be double chrome.
//   3. Wire real window controls (minimize/maximize/close) to the decorative
//      traffic-light buttons via a preload-exposed IPC bridge, since a
//      frameless window has no native ones.
//   4. Kill the backend child process on quit - otherwise it would keep
//      running as an orphan after the window closes.
//
// Known limitation (see BUILD_LOG): this spawns the *dev* venv's
// interpreter at a path relative to the repo. That's correct for running
// the packaged app on this development machine, but a venv's python.exe
// depends on the base Python install it was created from - copying the
// venv folder to a machine without that same Python install will not work.
// A truly distributable installer needs the backend frozen with PyInstaller
// (or bundled via Python's embeddable zip), which is a separate follow-up,
// not done here.

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

const { API_PORT, P2P_PORT } = require("./config.cjs");

const isDev = !app.isPackaged;

let backendProcess = null;
let mainWindow = null;

function backendDir() {
  // Dev: repo checkout, two levels up from frontend/electron.
  // Packaged: bundled alongside the app via electron-builder's extraResources.
  return isDev ? path.join(__dirname, "..", "..", "backend") : path.join(process.resourcesPath, "backend");
}

function pythonExePath() {
  return path.join(backendDir(), "agora", "Scripts", "python.exe");
}

function startBackend() {
  const userData = app.getPath("userData");
  const downloadsDir = path.join(userData, "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });

  const python = pythonExePath();
  if (!fs.existsSync(python)) {
    console.error(`[electron] backend Python interpreter not found at ${python} - is the venv set up? See backend/requirements.txt.`);
    return;
  }

  backendProcess = spawn(python, ["-m", "uvicorn", "app.api:app", "--host", "127.0.0.1", "--port", String(API_PORT)], {
    cwd: backendDir(),
    env: {
      ...process.env,
      AGORA_NAME: os.userInfo().username || "agora-user",
      AGORA_PORT: String(P2P_PORT),
      AGORA_API_PORT: String(API_PORT),
      AGORA_DB: path.join(userData, "agora.db"),
      AGORA_DOWNLOADS: downloadsDir,
    },
    windowsHide: true,
  });

  backendProcess.stdout.on("data", (d) => console.log(`[backend] ${d}`.trimEnd()));
  backendProcess.stderr.on("data", (d) => console.error(`[backend] ${d}`.trimEnd()));
  backendProcess.on("exit", (code) => {
    console.log(`[electron] backend exited with code ${code}`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, width - 80),
    height: Math.min(800, height - 80),
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: "#fbf7f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(process.env.AGORA_DEV_SERVER_URL || "http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startBackend();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    stopBackend();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", stopBackend);
}
