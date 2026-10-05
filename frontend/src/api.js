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
  myQr: () => request("/me/qr"),
  addScannedPeer: (payload) => request("/peers/add-scanned", { method: "POST", body: JSON.stringify(payload) }),
  peers: () => request("/peers"),
  knownPeers: () => request("/peers/known"),
  importContacts: (contacts) => request("/peers/known/import", { method: "POST", body: JSON.stringify({ contacts }) }),
  blockPeer: (peerId, name) => request(`/peers/${peerId}/block`, { method: "POST", body: JSON.stringify({ name }) }),
  unblockPeer: (peerId) => request(`/peers/${peerId}/unblock`, { method: "POST" }),
  blockedPeers: () => request("/peers/blocked"),
  getDisappearing: (peerId) => request(`/conversations/${peerId}/disappearing`),
  setDisappearing: (peerId, seconds) => request(`/conversations/${peerId}/disappearing`, { method: "PUT", body: JSON.stringify({ seconds }) }),
  history: (peerId) => request(`/messages/${peerId}`),
  conversations: () => request("/conversations"),
  sendMessage: (peerId, body) =>
    request("/messages", { method: "POST", body: JSON.stringify({ peer_id: peerId, body }) }),
  deleteMessage: (msgId, { everyone = false, peerId } = {}) =>
    request(`/messages/${msgId}?everyone=${everyone}${peerId ? `&peer_id=${peerId}` : ""}`, { method: "DELETE" }),
  clearConversation: (peerId) => request(`/conversations/${peerId}`, { method: "DELETE" }),
  files: (peerId) => request(`/files/${peerId}`),
  allFiles: () => request("/files"),
  sendFile: (peerId, path) =>
    request("/files/send", { method: "POST", body: JSON.stringify({ peer_id: peerId, path }) }),
  acceptFile: (transferId) => request(`/files/${transferId}/accept`, { method: "POST" }),
  declineFile: (transferId) => request(`/files/${transferId}/decline`, { method: "POST" }),
  resendFile: (transferId) => request(`/files/${transferId}/resend`, { method: "POST" }),
  deleteFile: (transferId) => request(`/files/${transferId}`, { method: "DELETE" }),
  // Not a JSON request/response like everything else here - this is a
  // direct URL for a <video>/<audio>/<img> element's own src, so the
  // browser's native media loader handles Range requests (seeking) itself
  // rather than this app reading the whole file into memory first. Safe to
  // hand to the renderer same as any other local-API URL: the backend only
  // ever resolves it against the real saved_path on record for this exact
  // transfer_id, never a path the frontend supplies.
  fileRawUrl: (transferId) => `${BASE}/files/${transferId}/raw`,
  // Pushes this device's own avatar photo to the backend so it can actually
  // be served to a peer that asks for it (see backend/app/photos.py) - a
  // second copy alongside the existing Electron-local one `useSelfAvatarPhoto`
  // already manages for the UI's own fast display. Raw bytes over the wire,
  // not JSON: `fetch()` on a data: URL (what Electron's setAvatarPhoto IPC
  // already returns) is a real, simple way to get a Blob back out of it
  // without hand-rolling base64 decoding here.
  setMyPhoto: async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const res = await fetch(`${BASE}/me/photo`, { method: "PUT", body: blob });
    if (!res.ok) throw new Error(`PUT /me/photo failed: ${res.status}`);
  },
  clearMyPhoto: () => fetch(`${BASE}/me/photo`, { method: "DELETE" }),
  peerPhotoUrl: (peerId) => `${BASE}/peers/${peerId}/photo`,
  callOffer: (peerId, sdp, media, groupCallId) =>
    request("/calls/offer", { method: "POST", body: JSON.stringify({ peer_id: peerId, sdp, media, group_call_id: groupCallId }) }),
  callAnswer: (callId, sdp) => request(`/calls/${callId}/answer`, { method: "POST", body: JSON.stringify({ sdp }) }),
  callIce: (callId, candidate) => request(`/calls/${callId}/ice`, { method: "POST", body: JSON.stringify({ candidate }) }),
  callEnd: (callId, reason = "ended") => request(`/calls/${callId}/end`, { method: "POST", body: JSON.stringify({ reason }) }),
  callHistory: (peerId) => request(`/calls/history/${peerId}`),
  allCallHistory: (limit = 50) => request(`/calls/history?limit=${limit}`),
  clearCallHistory: () => request("/calls/history", { method: "DELETE" }),
  createGroup: (name, members) => request("/groups", { method: "POST", body: JSON.stringify({ name, members }) }),
  listGroups: () => request("/groups"),
  sendGroupMessage: (groupId, body) => request(`/groups/${groupId}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  groupHistory: (groupId) => request(`/groups/${groupId}/messages`),
  startGroupCall: (groupId, media, groupCallId) =>
    request(`/groups/${groupId}/call`, { method: "POST", body: JSON.stringify({ media, group_call_id: groupCallId }) }),
  sendGroupFile: (groupId, path) => request(`/groups/${groupId}/files`, { method: "POST", body: JSON.stringify({ path }) }),
  groupFiles: (groupId) => request(`/groups/${groupId}/files`),
  deleteGroupMessage: (groupId, msgId, { everyone = false } = {}) =>
    request(`/groups/${groupId}/messages/${msgId}?everyone=${everyone}`, { method: "DELETE" }),
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
