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
// Portability: a packaged build does NOT spawn the dev venv's python.exe -
// a venv depends on the base Python install that created it, which won't
// exist on a machine that only received the installer. Instead, `npm run
// electron:build` first freezes the backend with PyInstaller into a
// self-contained agora-backend.exe (see backend/run_server.py and
// package.json's "build:backend" script) and only *that* frozen exe gets
// bundled via extraResources - a real standalone binary, not a venv copy.
// Dev mode still uses the venv directly, since freezing on every code
// change would make local development painfully slow.

const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

const { API_PORT, P2P_PORT } = require("./config.cjs");

const isDev = !app.isPackaged;

// Direct file-based logging, bypassing console/stdio entirely - a packaged
// GUI-subsystem exe's stdout/stderr isn't reliably capturable by a parent
// process's redirection, so this is the only way to see what actually
// happened when the app exits before a window ever appears.
const logPath = path.join(app.getPath("userData"), "main.log");
function logToFile(msg) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // if even this fails, there's nothing more we can do to surface it
  }
}
process.on("uncaughtException", (err) => logToFile(`UNCAUGHT EXCEPTION: ${err.stack || err}`));
process.on("unhandledRejection", (err) => logToFile(`UNHANDLED REJECTION: ${err?.stack || err}`));
logToFile(`main.cjs starting, isPackaged=${app.isPackaged}, argv=${JSON.stringify(process.argv)}`);

let backendProcess = null;
let mainWindow = null;

function backendDir() {
  // Dev: repo checkout, two levels up from frontend/electron.
  // Packaged: the frozen agora-backend/ folder, bundled via extraResources.
  return isDev ? path.join(__dirname, "..", "..", "backend") : path.join(process.resourcesPath, "backend");
}

function pythonExePath() {
  return path.join(backendDir(), "agora", "Scripts", "python.exe");
}

function frozenBackendExePath() {
  return path.join(backendDir(), "agora-backend.exe");
}

function startBackend() {
  const userData = app.getPath("userData");
  const downloadsDir = path.join(userData, "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });

  const env = {
    ...process.env,
    AGORA_NAME: os.userInfo().username || "agora-user",
    AGORA_PORT: String(P2P_PORT),
    AGORA_API_PORT: String(API_PORT),
    AGORA_DB: path.join(userData, "agora.db"),
    AGORA_DOWNLOADS: downloadsDir,
  };

  if (isDev) {
    const python = pythonExePath();
    if (!fs.existsSync(python)) {
      console.error(`[electron] backend Python interpreter not found at ${python} - is the venv set up? See backend/requirements.txt.`);
      return;
    }
    backendProcess = spawn(python, ["-m", "uvicorn", "app.api:app", "--host", "127.0.0.1", "--port", String(API_PORT)], {
      cwd: backendDir(),
      env,
      windowsHide: true,
    });
  } else {
    const exe = frozenBackendExePath();
    if (!fs.existsSync(exe)) {
      console.error(`[electron] frozen backend not found at ${exe} - did "npm run build:backend" run before packaging?`);
      return;
    }
    backendProcess = spawn(exe, [], { env, windowsHide: true });
  }

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
  logToFile("createWindow() called");
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
  logToFile("BrowserWindow constructed");

  mainWindow.once("ready-to-show", () => {
    logToFile("ready-to-show - calling show()");
    mainWindow.show();
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => logToFile(`did-fail-load: code=${code} desc=${desc} url=${url}`));
  mainWindow.webContents.on("render-process-gone", (_e, details) => logToFile(`render-process-gone: ${JSON.stringify(details)}`));
  mainWindow.on("unresponsive", () => logToFile("window unresponsive"));

  if (isDev) {
    const url = process.env.AGORA_DEV_SERVER_URL || "http://localhost:5173";
    logToFile(`loading dev URL: ${url}`);
    mainWindow.loadURL(url);
  } else {
    const filePath = path.join(__dirname, "..", "dist", "index.html");
    logToFile(`loading packaged file: ${filePath} (exists=${fs.existsSync(filePath)})`);
    mainWindow.loadFile(filePath);
  }

  mainWindow.on("closed", () => {
    logToFile("window closed");
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
logToFile(`requestSingleInstanceLock() -> ${gotLock}`);
if (!gotLock) {
  logToFile("no lock - quitting (another instance is presumably holding it)");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    logToFile("app ready - starting backend and creating window");
    try {
      startBackend();
    } catch (e) {
      logToFile(`startBackend() threw: ${e.stack || e}`);
    }
    try {
      createWindow();
    } catch (e) {
      logToFile(`createWindow() threw: ${e.stack || e}`);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((e) => logToFile(`app.whenReady() rejected: ${e?.stack || e}`));

  app.on("window-all-closed", () => {
    logToFile("window-all-closed");
    stopBackend();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", stopBackend);
}
