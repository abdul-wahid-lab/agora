// Freezes the Python backend into a standalone agora-backend.exe via
// PyInstaller, so the packaged Electron app never depends on this dev
// machine's venv (a venv's python.exe needs the base Python install that
// created it - it isn't portable by copying alone). Run before
// electron-builder as part of npm run electron:build/electron:pack.
//
// A plain shell string in package.json's "scripts" broke here: npm runs
// scripts through cmd.exe on Windows, and cmd.exe doesn't resolve a bare
// relative path like "agora/Scripts/python.exe" as a runnable command the
// way a POSIX shell does. Doing this in Node with path.join sidesteps that
// entirely.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const backendDir = path.join(__dirname, "..", "..", "backend");
const python = path.join(backendDir, "agora", "Scripts", "python.exe");

if (!fs.existsSync(python)) {
  console.error(`[build-backend] Python venv not found at ${python} - set up backend/agora first (see backend/requirements.txt).`);
  process.exit(1);
}

const args = [
  "-m", "PyInstaller",
  "--name", "agora-backend",
  "--onedir",
  "--console",
  "--clean",
  "--noconfirm",
  "--collect-all", "uvicorn",
  "--collect-all", "zeroconf",
  "--collect-all", "websockets",
  "--collect-all", "httptools",
  "--collect-all", "h11",
  "--collect-all", "starlette",
  "--collect-all", "fastapi",
  "--collect-all", "anyio",
  "--collect-all", "pydantic",
  "--collect-all", "pydantic_core",
  "run_server.py",
];

const result = spawnSync(python, args, { cwd: backendDir, stdio: "inherit" });
process.exit(result.status ?? 1);
