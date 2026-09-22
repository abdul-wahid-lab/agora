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
});

// Tells api.js which port main.cjs actually spawned the backend on, so the
// renderer never has to guess or rely on a build-time env var matching a
// run-time decision - same value works whether this is a dev run or a
// packaged install.
contextBridge.exposeInMainWorld("AGORA_API_BASE", `http://127.0.0.1:${API_PORT}`);
