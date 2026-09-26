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

const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
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

// This device's identity - a peer_id generated once and reused forever
// (rather than a fresh random one every launch, which would make every
// restart look like a brand-new, historyless contact to every peer that's
// ever talked to this device), plus whatever display name onboarding set
// (falls back to the OS username until onboarding has actually run once).
function identityPath() {
  return path.join(app.getPath("userData"), "identity.json");
}

function loadOrCreateIdentity() {
  try {
    return JSON.parse(fs.readFileSync(identityPath(), "utf8"));
  } catch {
    const identity = { peerId: randomUUID(), name: null };
    saveIdentity(identity);
    return identity;
  }
}

function saveIdentity(identity) {
  try {
    fs.mkdirSync(path.dirname(identityPath()), { recursive: true });
    fs.writeFileSync(identityPath(), JSON.stringify(identity));
  } catch (e) {
    logToFile(`failed to save identity: ${e.stack || e}`);
  }
}

function startBackend() {
  const userData = app.getPath("userData");
  const downloadsDir = path.join(userData, "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });

  const identity = loadOrCreateIdentity();
  const env = {
    ...process.env,
    AGORA_NAME: identity.name || os.userInfo().username || "agora-user",
    AGORA_PEER_ID: identity.peerId,
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

  const proc = backendProcess;
  proc.stdout.on("data", (d) => console.log(`[backend] ${d}`.trimEnd()));
  proc.stderr.on("data", (d) => console.error(`[backend] ${d}`.trimEnd()));
  proc.on("exit", (code) => {
    console.log(`[electron] backend exited with code ${code}`);
    // Guard against a stale reference: if a rename (device:setName) already
    // replaced backendProcess with a newer instance by the time this old
    // one's exit event fires, don't null out that newer process.
    if (backendProcess === proc) backendProcess = null;
  });
}

// Returns a promise resolving once the backend has actually exited (not just
// been signaled to) - device:setName awaits this before respawning, since
// starting a new instance while the old one still holds the port would fail.
function stopBackend() {
  return new Promise((resolve) => {
    const proc = backendProcess;
    if (!proc) return resolve();
    proc.once("exit", () => resolve());
    proc.kill();
  });
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

// WhatsApp/Zoom-style behavior: an incoming call brings the app to the
// front on its own, rather than leaving it to a background OS notification
// the user might not notice - the in-app CallOverlay toast (with real
// Accept/Decline buttons) is only useful once the window is actually visible.
ipcMain.on("call:incoming", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// Category-filtered native file picker for the chat composer's "+" button -
// returns an absolute path (or null if cancelled) instead of requiring the
// user to type/paste one. See ConversationPane.jsx.
const FILE_PICKER_FILTERS = {
  media: [{ name: "Photos & Videos", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "mp4", "mov", "mkv", "avi"] }],
  document: [{ name: "Documents", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt"] }],
  any: [{ name: "All Files", extensions: ["*"] }],
};
// Onboarding calls this once a name is chosen. There's no live-rename path
// in the backend (the mDNS TXT record and UDP announce payload are both
// fixed at startup - see discovery.py), so this persists the name and
// restarts the backend rather than trying to mutate it while running.
ipcMain.handle("device:setName", async (_e, name) => {
  const identity = loadOrCreateIdentity();
  identity.name = name;
  saveIdentity(identity);
  await stopBackend();
  startBackend();
  return true;
});

ipcMain.handle("dialog:pickFile", async (_e, category) => {
  if (!mainWindow) return null;
  const filters = FILE_PICKER_FILTERS[category] || FILE_PICKER_FILTERS.any;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Opens a received file with whatever the OS has registered for its type -
// the same as double-clicking it in File Explorer. Returns "" on success or
// an error string (shell.openPath never rejects, it resolves with the error).
ipcMain.handle("file:open", async (_e, filePath) => shell.openPath(filePath));

// Reveals the file in File Explorer with it pre-selected, for when someone
// wants to see it in context (other files alongside it, etc.) rather than
// open it immediately.
ipcMain.handle("file:showInFolder", (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// WhatsApp-style "save a copy where I want it" - Agora always downloads
// received files into its own per-device folder first (so the accept/resume
// flow has one predictable place to write to), but the user shouldn't be
// stuck there; this copies the already-downloaded file out to wherever they
// pick instead of forcing them to dig through the app's own data folder.
ipcMain.handle("file:saveAs", async (_e, { sourcePath, suggestedName }) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.copyFile(sourcePath, result.filePath);
  return result.filePath;
});

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
