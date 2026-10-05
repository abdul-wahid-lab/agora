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

const { app, BrowserWindow, ipcMain, screen, dialog, shell, desktopCapturer, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const https = require("node:https");

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

// Hoisted to module scope (not just local to startBackend) so the
// app:openDownloadsFolder handler below can reach the real path without
// re-deriving it or waiting on the backend to report it back.
let downloadsDirPath = null;

function startBackend() {
  const userData = app.getPath("userData");
  const downloadsDir = path.join(userData, "downloads");
  downloadsDirPath = downloadsDir;
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
  // Deliberately narrower than "media": no video extensions, and restricted
  // to exactly what IMAGE_MIME_BY_EXT below can actually encode as a data
  // URI for display - a self-avatar photo, unlike a chat attachment, is
  // never just handed to the OS to open, it always needs to be re-rendered
  // as an <img> src.
  photo: [{ name: "Photos", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
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

// Image thumbnails/previews in chat: reads a downloaded image and returns
// it as a data: URI. Deliberately not a raw file:// src or a custom
// registered protocol - Chromium's default webSecurity (left on, not
// disabled anywhere in this app) blocks a plain http(s)/file-origin
// renderer from loading file:// resources directly, and a custom protocol
// would need its own careful path-traversal handling for what's really
// just "show me this one already-known-safe path." A data: URI sidesteps
// both problems and needs nothing registered up front. Capped at 15MB so a
// giant image doesn't get read/base64'd/held in memory just to render a
// thumbnail; the real file is still fully accessible via the existing
// "Open"/"Save a copy..." actions regardless of this cap.
const IMAGE_MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;

async function readImageAsDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) return null;
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_PREVIEW_BYTES) return null;
    const buf = await fs.promises.readFile(filePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

ipcMain.handle("file:readImageDataUrl", (_e, filePath) => readImageAsDataUrl(filePath));

// Self-avatar photo: a real user choice (per TASK_QUEUE.md, previously just
// a disabled "coming soon" button), stored as an actual copied file in
// userData rather than a data: URI in localStorage - a real photo can
// easily exceed localStorage's ~5-10MB origin quota, a file on disk has no
// such ceiling. identity.json (already used for peer_id/name) also tracks
// which filename is current, since the extension varies by what was picked.
// Deliberately local-only, same as the existing avatar-color choice: this
// never travels to other peers, who still only ever see your name + a
// color they derive themselves from your peer_id.
ipcMain.handle("profile:getAvatarPhoto", async () => {
  const identity = loadOrCreateIdentity();
  if (!identity.avatarFile) return null;
  return readImageAsDataUrl(path.join(app.getPath("userData"), identity.avatarFile));
});

ipcMain.handle("profile:setAvatarPhoto", async (_e, sourcePath) => {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!IMAGE_MIME_BY_EXT[ext]) return null;
  try {
    const stat = await fs.promises.stat(sourcePath);
    if (stat.size > MAX_PREVIEW_BYTES) return null;
  } catch {
    return null;
  }

  const identity = loadOrCreateIdentity();
  // Clean up a previous photo with a different extension (png -> jpg, say)
  // so switching photos doesn't leave stale files behind forever.
  if (identity.avatarFile) {
    try {
      fs.unlinkSync(path.join(app.getPath("userData"), identity.avatarFile));
    } catch {
      // fine if it's already gone
    }
  }

  const destName = `avatar${ext}`;
  const destPath = path.join(app.getPath("userData"), destName);
  try {
    await fs.promises.copyFile(sourcePath, destPath);
  } catch (e) {
    logToFile(`failed to copy avatar photo: ${e.stack || e}`);
    return null;
  }
  identity.avatarFile = destName;
  saveIdentity(identity);
  return readImageAsDataUrl(destPath);
});

ipcMain.handle("profile:clearAvatarPhoto", async () => {
  const identity = loadOrCreateIdentity();
  if (identity.avatarFile) {
    try {
      fs.unlinkSync(path.join(app.getPath("userData"), identity.avatarFile));
    } catch {
      // fine if it's already gone
    }
    delete identity.avatarFile;
    saveIdentity(identity);
  }
  return true;
});

// Menu-bar support (File/Conversation/Network/View menus) - each of these
// wraps one real, already-standard Electron/Node capability, no new
// concepts invented just to fill a menu.

// "Open Received Files Folder" - shell.openPath opens a directory in the
// OS file manager just as well as it opens a single file with its default
// app (used elsewhere for "Open" on a received file).
ipcMain.handle("app:openDownloadsFolder", () => {
  if (!downloadsDirPath) return "no downloads folder yet";
  return shell.openPath(downloadsDirPath);
});

// Generic text file save/read, for Export/Import Contacts (JSON) and Export
// Conversation (.txt) - the existing file:saveAs handler only ever copies
// an existing file on disk, it can't write fresh text content.
ipcMain.handle("file:saveText", async (_e, { content, suggestedName, filters }) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters: filters || [{ name: "All Files", extensions: ["*"] }] });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, content, "utf8");
  return result.filePath;
});

ipcMain.handle("file:readText", async (_e, filters) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: filters || [{ name: "All Files", extensions: ["*"] }] });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    return await fs.promises.readFile(result.filePaths[0], "utf8");
  } catch (e) {
    logToFile(`failed to read text file: ${e.stack || e}`);
    return null;
  }
});

// View menu: zoom and always-on-top are both real, standard BrowserWindow
// capabilities - webContents.getZoomLevel()/setZoomLevel() and
// win.setAlwaysOnTop(), nothing app-specific to build underneath them.
const ZOOM_STEP = 0.5;
const ZOOM_MIN = -4; // roughly 50% - Electron's zoom levels are not linear percentages
const ZOOM_MAX = 6; // roughly 300%

ipcMain.handle("app:zoomIn", () => {
  if (!mainWindow) return null;
  const level = Math.min(ZOOM_MAX, mainWindow.webContents.getZoomLevel() + ZOOM_STEP);
  mainWindow.webContents.setZoomLevel(level);
  return level;
});

ipcMain.handle("app:zoomOut", () => {
  if (!mainWindow) return null;
  const level = Math.max(ZOOM_MIN, mainWindow.webContents.getZoomLevel() - ZOOM_STEP);
  mainWindow.webContents.setZoomLevel(level);
  return level;
});

ipcMain.handle("app:zoomReset", () => {
  if (!mainWindow) return null;
  mainWindow.webContents.setZoomLevel(0);
  return 0;
});

ipcMain.handle("app:setAlwaysOnTop", (_e, value) => {
  mainWindow?.setAlwaysOnTop(Boolean(value));
  return Boolean(value);
});

ipcMain.handle("app:getAlwaysOnTop", () => Boolean(mainWindow?.isAlwaysOnTop()));

// Help menu's GitHub links - shell.openExternal opens the real default
// browser, never inside the app's own window (which has no address bar or
// way back anyway).
ipcMain.handle("shell:openExternal", (_e, url) => {
  if (typeof url !== "string" || !/^https:\/\/github\.com\//.test(url)) return false;
  shell.openExternal(url);
  return true;
});

// Screen sharing during a call. Electron has no built-in source picker (on
// Windows, unlike macOS, there's no OS-native one Chromium can hand off to)
// - this is the standard pattern instead: the renderer asks for the real
// list of capturable screens first (via getSources below), shows its own
// picker UI, and tells the main process which one was chosen (via
// screen:choose) *before* it ever calls navigator.mediaDevices.
// getDisplayMedia(). That call is what actually triggers
// setDisplayMediaRequestHandler below, which just looks up whatever was
// chosen moments earlier and hands it back - Electron's side of a real
// screen-share, not a stub.
let pendingScreenSourceId = null;

ipcMain.handle("screen:getSources", async () => {
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 320, height: 200 } });
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }));
});

ipcMain.on("screen:choose", (_e, sourceId) => {
  pendingScreenSourceId = sourceId;
});

// Manual "Check for Updates..." -> real download + install, not just a link
// to the releases page. Only ever asked to fetch a GitHub release asset
// (the renderer builds this URL from the GitHub API's own
// browser_download_url, never from arbitrary user input), but the host is
// still re-checked here, at the one place that actually touches the
// filesystem and the network from a privileged process - the renderer
// can't be trusted to have validated it correctly on its own. A download
// redirects at least once in practice (github.com -> a signed
// objects.githubusercontent.com URL); each hop's host must also be on the
// allowlist, or the download is aborted rather than silently followed
// somewhere else.
const UPDATE_HOST_ALLOWLIST = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

function downloadToFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      reject(new Error("invalid URL"));
      return;
    }
    if (!UPDATE_HOST_ALLOWLIST.has(host)) {
      reject(new Error(`refusing to download from untrusted host: ${host}`));
      return;
    }
    https
      .get(url, { headers: { "User-Agent": "Agora-desktop" } }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          downloadToFile(res.headers.location, destPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`download failed: HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(destPath)));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

ipcMain.handle("update:download", async (_e, { url, filename }) => {
  const destPath = path.join(os.tmpdir(), filename);
  await downloadToFile(url, destPath);
  return destPath;
});

// Launches the downloaded installer, detached from this process, then
// quits - the installer needs this app fully exited to replace its files
// (an installed NSIS build) or to install fresh (if currently running
// portable, which has nothing in Program Files for it to replace).
ipcMain.handle("update:install", (_e, filePath) => {
  const child = spawn(filePath, [], { detached: true, stdio: "ignore" });
  child.unref();
  app.quit();
});

// A second, fully offline update source: a local folder (a USB drive, a
// shared network folder, anything reachable with zero internet) that
// already has an installer sitting in it. No manifest file needed - the
// version is read straight out of the filename, the same convention
// electron-builder's own NSIS output already uses ("Agora Setup
// 0.1.0.exe"). Real tradeoff worth being honest about: the GitHub path
// gets its integrity from HTTPS plus the host allowlist above; a local
// file has neither - the only trust here is that the user picked this
// folder and this file themselves, same as trusting any program they'd
// double-click directly.
ipcMain.handle("update:pickFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("update:scanFolder", async (_e, folderPath) => {
  let entries;
  try {
    entries = fs.readdirSync(folderPath);
  } catch {
    return { found: false };
  }
  const exeFiles = entries.filter((f) => /\.exe$/i.test(f) && /agora/i.test(f));
  if (exeFiles.length === 0) return { found: false };
  const preferred = exeFiles.find((f) => /setup/i.test(f)) || exeFiles[0];
  const versionMatch = preferred.match(/(\d+\.\d+\.\d+)/);
  if (!versionMatch) return { found: false };
  return { found: true, version: versionMatch[1], fileName: preferred, filePath: path.join(folderPath, preferred) };
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

    // Without this, navigator.mediaDevices.getDisplayMedia() in the
    // renderer just rejects outright under Electron - there's no default
    // behavior to fall back to the way a regular browser has one.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        const chosen = sources.find((s) => s.id === pendingScreenSourceId) || sources[0];
        pendingScreenSourceId = null;
        if (!chosen) {
          callback({});
          return;
        }
        // Video only, deliberately - getScreenStream() in lib/webrtc.js
        // requests audio:false, and system-audio capture is a real,
        // separate privacy decision (sharing your screen doesn't imply
        // sharing whatever your speakers are playing) not bundled in here.
        callback({ video: chosen });
      } catch (e) {
        logToFile(`setDisplayMediaRequestHandler failed: ${e.stack || e}`);
        callback({});
      }
    });

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
