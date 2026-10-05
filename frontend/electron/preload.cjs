// Exposes only the three window-control actions the custom titlebar needs -
// nothing else from Node/Electron is reachable from the renderer.
//
// Deliberately does NOT require("./config.cjs") even though main.cjs does -
// Electron's default sandboxed preload environment only allows Node
// built-ins and Electron's own APIs, not arbitrary local file requires, and
// a preload script that throws on load fails *silently* from the
// renderer's point of view (window.electronAPI just never appears, no
// console error) - cost real debugging time to track down. API_PORT is
// duplicated from config.cjs as a plain literal instead; keep both in sync
// if it ever changes.
const { contextBridge, ipcRenderer } = require("electron");
const API_PORT = 5321;

contextBridge.exposeInMainWorld("electronAPI", {
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  maximizeWindow: () => ipcRenderer.send("window:maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  notifyIncomingCall: () => ipcRenderer.send("call:incoming"),
  pickFile: (category) => ipcRenderer.invoke("dialog:pickFile", category),
  setDeviceName: (name) => ipcRenderer.invoke("device:setName", name),
  openFile: (filePath) => ipcRenderer.invoke("file:open", filePath),
  showFileInFolder: (filePath) => ipcRenderer.invoke("file:showInFolder", filePath),
  saveFileAs: (sourcePath, suggestedName) => ipcRenderer.invoke("file:saveAs", { sourcePath, suggestedName }),
  readImageDataUrl: (filePath) => ipcRenderer.invoke("file:readImageDataUrl", filePath),
  getAvatarPhoto: () => ipcRenderer.invoke("profile:getAvatarPhoto"),
  setAvatarPhoto: (filePath) => ipcRenderer.invoke("profile:setAvatarPhoto", filePath),
  clearAvatarPhoto: () => ipcRenderer.invoke("profile:clearAvatarPhoto"),
  openDownloadsFolder: () => ipcRenderer.invoke("app:openDownloadsFolder"),
  saveTextFile: (content, suggestedName, filters) => ipcRenderer.invoke("file:saveText", { content, suggestedName, filters }),
  readTextFile: (filters) => ipcRenderer.invoke("file:readText", filters),
  zoomIn: () => ipcRenderer.invoke("app:zoomIn"),
  zoomOut: () => ipcRenderer.invoke("app:zoomOut"),
  zoomReset: () => ipcRenderer.invoke("app:zoomReset"),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("app:setAlwaysOnTop", value),
  getAlwaysOnTop: () => ipcRenderer.invoke("app:getAlwaysOnTop"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  getScreenSources: () => ipcRenderer.invoke("screen:getSources"),
  chooseScreenSource: (sourceId) => ipcRenderer.send("screen:choose", sourceId),
  downloadUpdate: (url, filename) => ipcRenderer.invoke("update:download", { url, filename }),
  installUpdate: (filePath) => ipcRenderer.invoke("update:install", filePath),
  pickUpdateFolder: () => ipcRenderer.invoke("update:pickFolder"),
  scanUpdateFolder: (folderPath) => ipcRenderer.invoke("update:scanFolder", folderPath),
});

// Tells api.js which port main.cjs actually spawned the backend on, so the
// renderer never has to guess or rely on a build-time env var matching a
// run-time decision - same value works whether this is a dev run or a
// packaged install.
contextBridge.exposeInMainWorld("AGORA_API_BASE", `http://127.0.0.1:${API_PORT}`);
