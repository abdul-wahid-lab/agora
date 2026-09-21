// Thin client for the local backend API (backend/app/api.py).
// Talks to 127.0.0.1 only - see api.py's own docstring for why.

const BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:5001";

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
  sendMessage: (peerId, body) =>
    request("/messages", { method: "POST", body: JSON.stringify({ peer_id: peerId, body }) }),
  files: (peerId) => request(`/files/${peerId}`),
  sendFile: (peerId, path) =>
    request("/files/send", { method: "POST", body: JSON.stringify({ peer_id: peerId, path }) }),
  acceptFile: (transferId) => request(`/files/${transferId}/accept`, { method: "POST" }),
  declineFile: (transferId) => request(`/files/${transferId}/decline`, { method: "POST" }),
  resendFile: (transferId) => request(`/files/${transferId}/resend`, { method: "POST" }),
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
