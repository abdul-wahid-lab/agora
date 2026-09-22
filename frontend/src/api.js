// Thin client for the local backend API (backend/app/api.py).
// Talks to 127.0.0.1 only - see api.py's own docstring for why.
//
// Base URL resolution order:
//   1. window.AGORA_API_BASE - set by electron/preload.cjs to whatever port
//      main.cjs actually spawned the backend on. This is what real Electron
//      runs (dev and packaged) use, so the app never depends on a build-time
//      env var matching a run-time spawn decision.
//   2. VITE_API_BASE - the plain-browser dev workflow (two manually-started
//      backends on custom ports, `VITE_API_BASE=... npx vite`), unchanged.
//   3. Hardcoded fallback for the simplest possible manual setup.
const BASE = (typeof window !== "undefined" && window.AGORA_API_BASE) || import.meta.env.VITE_API_BASE || "http://127.0.0.1:5001";

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`${options?.method || "GET"} ${path} failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  me: () => request("/me"),
  peers: () => request("/peers"),
  history: (peerId) => request(`/messages/${peerId}`),
  conversations: () => request("/conversations"),
  sendMessage: (peerId, body) =>
    request("/messages", { method: "POST", body: JSON.stringify({ peer_id: peerId, body }) }),
  files: (peerId) => request(`/files/${peerId}`),
  allFiles: () => request("/files"),
  sendFile: (peerId, path) =>
    request("/files/send", { method: "POST", body: JSON.stringify({ peer_id: peerId, path }) }),
  acceptFile: (transferId) => request(`/files/${transferId}/accept`, { method: "POST" }),
  declineFile: (transferId) => request(`/files/${transferId}/decline`, { method: "POST" }),
  resendFile: (transferId) => request(`/files/${transferId}/resend`, { method: "POST" }),
  callOffer: (peerId, sdp, media) => request("/calls/offer", { method: "POST", body: JSON.stringify({ peer_id: peerId, sdp, media }) }),
  callAnswer: (callId, sdp) => request(`/calls/${callId}/answer`, { method: "POST", body: JSON.stringify({ sdp }) }),
  callIce: (callId, candidate) => request(`/calls/${callId}/ice`, { method: "POST", body: JSON.stringify({ candidate }) }),
  callEnd: (callId, reason = "ended") => request(`/calls/${callId}/end`, { method: "POST", body: JSON.stringify({ reason }) }),
  callHistory: (peerId) => request(`/calls/history/${peerId}`),
  allCallHistory: () => request("/calls/history"),
};

// Live event stream (message/peer_joined/peer_left/file_offer/file_status).
// Auto-reconnects with a short backoff if the backend restarts.
export function connectEvents(onEvent) {
  let ws;
  let closedByUs = false;
  let retryMs = 1000;

  function connect() {
    ws = new WebSocket(`${BASE.replace("http", "ws")}/events`);
    ws.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onopen = () => {
      retryMs = 1000;
    };
    ws.onclose = () => {
      if (closedByUs) return;
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 1.5, 10000);
    };
  }
  connect();

  return () => {
    closedByUs = true;
    ws?.close();
  };
}
