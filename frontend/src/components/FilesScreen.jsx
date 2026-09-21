import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";
import { colorFor, initials } from "../lib/avatar";

const EXECUTABLE_EXTS = new Set(["apk", "exe", "msi", "bat", "cmd", "com", "sh", "jar", "appimage", "ps1"]);

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status) {
  return (
    {
      offered: "Awaiting response",
      awaiting_accept: "Awaiting response",
      accepted: "Starting…",
      transferring: "Transferring…",
      completed: "Completed",
      declined: "Declined",
      failed: "Failed",
    }[status] || status
  );
}

function statusColor(status) {
  if (status === "completed") return "var(--accent-strong)";
  if (status === "declined" || status === "failed") return "var(--danger)";
  return "var(--text-2)";
}

export default function FilesScreen() {
  const [peers, setPeers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [filePath, setFilePath] = useState("");
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function pollPeers() {
      try {
        const list = await api.peers();
        if (!cancelled) setPeers(list);
      } catch {
        // backend not reachable yet - keep retrying silently
      }
    }
    pollPeers();
    const interval = setInterval(pollPeers, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function loadFiles() {
      try {
        const list = await api.files(selected);
        if (!cancelled) setFiles(list);
      } catch {
        // ignore - next poll will retry
      }
    }
    loadFiles();
    const interval = setInterval(loadFiles, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected]);

  useEffect(() => {
    const stop = connectEvents((evt) => {
      if (!selected) return;
      // file_status carries no peer_id (backend only knows transfer_id there),
      // so on that event we just refetch whatever peer is currently open -
      // harmless extra fetch if it wasn't for this peer.
      if (evt.type === "file_offer" && evt.peer_id === selected) {
        api.files(selected).then(setFiles).catch(() => {});
      }
      if (evt.type === "file_status") {
        api.files(selected).then(setFiles).catch(() => {});
      }
    });
    return stop;
  }, [selected]);

  async function handleSend() {
    const path = filePath.trim();
    if (!path || !selected) return;
    setSendError("");
    try {
      await api.sendFile(selected, path);
      setFilePath("");
      setTimeout(() => api.files(selected).then(setFiles).catch(() => {}), 500);
    } catch {
      setSendError("Couldn't start the transfer - check the path is correct and exists on this machine.");
    }
  }

  const selectedPeer = peers.find((p) => p.peer_id === selected);
  const isExecutableName = (name) => EXECUTABLE_EXTS.has((name.split(".").pop() || "").toLowerCase());

  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
      <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto", padding: "20px 12px" }}>
        <h1 className="serif" style={{ fontSize: 26, margin: "0 12px 16px" }}>
          Files
        </h1>
        {peers.length === 0 && (
          <p style={{ padding: "0 12px", color: "var(--text-3)", fontSize: 13.5 }}>No one nearby to share files with yet.</p>
        )}
        {peers.map((p) => (
          <button
            key={p.peer_id}
            onClick={() => setSelected(p.peer_id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "none",
              background: selected === p.peer_id ? "var(--accent-soft)" : "transparent",
              textAlign: "left",
              cursor: "pointer",
              marginBottom: 4,
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: colorFor(p.peer_id),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: 12,
                flexShrink: 0,
              }}
            >
              {initials(p.name)}
            </span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {!selected && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>
            <p className="serif" style={{ fontSize: 22 }}>
              Pick someone nearby to share files with
            </p>
          </div>
        )}

        {selected && (
          <>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
              {selectedPeer?.name || "Unknown"}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              {files.length === 0 && <p style={{ color: "var(--text-3)", fontSize: 13.5 }}>No files sent or received with this peer yet.</p>}

              {files.map((f) => (
                <div
                  key={f.transfer_id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: "var(--surface)",
                    border: f.is_executable ? "1.5px solid var(--danger)" : "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5, wordBreak: "break-word" }}>{f.filename}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                        {f.direction === "sent" ? "sent to" : "received from"} {selectedPeer?.name} · {formatSize(f.size)} · {formatTime(f.ts)}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: statusColor(f.status), flexShrink: 0 }}>
                      {statusLabel(f.status)}
                    </span>
                  </div>

                  {f.is_executable && f.status === "awaiting_accept" && f.direction === "received" && (
                    <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--danger)", fontWeight: 600 }}>
                      This is an installable/executable file - only accept it if you trust {selectedPeer?.name}.
                    </div>
                  )}

                  {f.status === "completed" && f.saved_path && (
                    <div className="mono" style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-3)", wordBreak: "break-all" }}>
                      saved to {f.saved_path}
                    </div>
                  )}

                  {f.direction === "received" && f.status === "awaiting_accept" && (
                    <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                      <button
                        onClick={() => api.acceptFile(f.transfer_id).then(() => api.files(selected).then(setFiles))}
                        style={{
                          padding: "7px 16px",
                          borderRadius: 100,
                          border: "none",
                          background: "var(--accent)",
                          color: "#fff8f2",
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => api.declineFile(f.transfer_id).then(() => api.files(selected).then(setFiles))}
                        style={{
                          padding: "7px 16px",
                          borderRadius: 100,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text-2)",
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {f.direction === "sent" && f.status === "failed" && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        onClick={() => api.resendFile(f.transfer_id).then(() => api.files(selected).then(setFiles))}
                        style={{
                          padding: "7px 16px",
                          borderRadius: 100,
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text-2)",
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)" }}>
              {sendError && <div style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 8 }}>{sendError}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSend();
                  }}
                  placeholder="Full path to a file on this machine"
                  style={{ flex: 1, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", fontSize: 14, fontFamily: "IBM Plex Mono, monospace" }}
                />
                <button
                  onClick={handleSend}
                  disabled={!filePath.trim()}
                  style={{
                    padding: "0 22px",
                    borderRadius: 12,
                    border: "none",
                    background: filePath.trim() ? "var(--accent)" : "var(--border)",
                    color: filePath.trim() ? "#fff8f2" : "var(--text-3)",
                    fontWeight: 700,
                  }}
                >
                  Send
                </button>
              </div>
              {isExecutableName(filePath) && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>
                  Heads up: this looks like an installable/executable file - {selectedPeer?.name} will see a strong warning before accepting it.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
