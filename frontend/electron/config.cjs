// Shared between main.cjs (spawns the backend on this port) and preload.cjs
// (tells the renderer which port to talk to) - one source of truth instead
// of an env var that would need threading through the renderer process.
module.exports = {
  API_PORT: 5321,
  P2P_PORT: 8420,
};
