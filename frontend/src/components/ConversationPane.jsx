import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { paletteFor, initials } from "../lib/avatar";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusGlyph(status) {
  if (status === "delivered" || status === "received") return "✓✓";
  if (status === "failed") return "!";
  if (status === "sent") return "✓";
  return "…";
}

function dayLabel(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return isToday ? `TODAY · ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

const EXT_STYLE = {
  pdf: { bg: "#f3e8dd", text: "#c2562a" },
  apk: { bg: "#e8eee4", text: "#4c6b43" },
  zip: { bg: "#fbe9d7", text: "#b07a2a" },
  mov: { bg: "#f6dcc7", text: "#b04a1f" },
  mp4: { bg: "#f6dcc7", text: "#b04a1f" },
  doc: { bg: "#f5efe7", text: "#8a7f76" },
  docx: { bg: "#f5efe7", text: "#8a7f76" },
};
function extStyle(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return EXT_STYLE[ext] || { bg: "#f5efe7", text: "#8a7f76" };
}

const EXECUTABLE_EXTS = new Set(["apk", "exe", "msi", "bat", "cmd", "com", "sh", "jar", "appimage", "ps1"]);

// Matches design screen 10.7's conversation pane exactly: header with
// presence-ring avatar + Call/Video/Files actions, a merged thread of text
// and file bubbles (received = white bordered, sent = accent filled), and a
// composer bar. Text and file "messages" come from two different backend
// stores (see storage.py) but read as one timeline here, sorted by time -
// that interleaving is what the design shows, even though the underlying
// APIs stay separate.
export default function ConversationPane({ peer, onOpenCall }) {
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [progressByTransfer, setProgressByTransfer] = useState({});
  const [draft, setDraft] = useState("");
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePath, setFilePath] = useState("");
  const bottomRef = useRef(null);
  const peerIdRef = useRef(peer?.peer_id);
  peerIdRef.current = peer?.peer_id;

  useEffect(() => {
    if (!peer) return;
    let cancelled = false;
    async function load() {
      try {
        const [msgs, fls] = await Promise.all([api.history(peer.peer_id), api.files(peer.peer_id)]);
        if (!cancelled) {
          setMessages(msgs);
          setFiles(fls);
        }
      } catch {
        // ignore - next poll retries
      }
    }
    load();
    const interval = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [peer?.peer_id]);

  useEffect(() => {
    const stop = connectEvents((evt) => {
      const current = peerIdRef.current;
      if (evt.type === "message" && evt.peer_id === current) {
        setMessages((prev) => [...prev, { msg_id: `live-${evt.ts}`, direction: "received", body: evt.body, status: "received", ts: evt.ts }]);
      }
      if (evt.type === "file_progress") {
        setProgressByTransfer((prev) => ({ ...prev, [evt.transfer_id]: evt.bytes_sent / evt.total }));
      }
      if ((evt.type === "file_offer" || evt.type === "file_status") && current) {
        api.files(current).then(setFiles).catch(() => {});
      }
    });
    return stop;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, files]);

  if (!peer) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>
        <p className="serif" style={{ fontSize: 22 }}>
          Pick someone to start talking to
        </p>
      </div>
    );
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const optimistic = { msg_id: `pending-${Date.now()}`, direction: "sent", body: text, status: "pending", ts: Date.now() / 1000 };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await api.sendMessage(peer.peer_id, text);
    } catch {
      setMessages((prev) => prev.map((m) => (m.msg_id === optimistic.msg_id ? { ...m, status: "failed" } : m)));
    }
  }

  async function handleSendFile() {
    const path = filePath.trim();
    if (!path) return;
    setFilePickerOpen(false);
    setFilePath("");
    try {
      await api.sendFile(peer.peer_id, path);
      setTimeout(() => api.files(peer.peer_id).then(setFiles).catch(() => {}), 400);
    } catch {
      // the composer's own error surface is intentionally minimal here;
      // FilesScreen has the fuller accept/decline/executable-warning flow
    }
  }

  const { bg, text } = paletteFor(peer.peer_id);
  const timeline = [
    ...messages.map((m) => ({ kind: "message", ts: m.ts, data: m })),
    ...files.map((f) => ({ kind: "file", ts: f.ts, data: f })),
  ].sort((a, b) => a.ts - b.ts);

  let lastDay = null;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--ground)" }}>
      <div style={{ flex: "0 0 auto", height: 62, borderBottom: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 13, padding: "0 20px" }}>
        <span style={{ position: "relative", width: 38, height: 38, flexShrink: 0 }}>
          <span style={{ position: "absolute", inset: -3, borderRadius: 99, border: "2px solid var(--accent)", animation: "agRing 2.6s ease-out infinite" }} />
          <span style={{ width: 38, height: 38, borderRadius: 99, background: bg, color: text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>
            {initials(peer.name)}
          </span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15.5 }}>{peer.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--accent)" }} />
            {/* NOT "encrypted" - the P2P WebSocket is plain ws://, no
                transport encryption exists yet (see BUILD_LOG's Security
                posture section). Don't claim a protection that isn't real. */}
            <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>On this network · direct, device-to-device</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onOpenCall(peer.peer_id, "audio")} style={pillButtonStyle}>
            Call
          </button>
          <button onClick={() => onOpenCall(peer.peer_id, "video")} style={pillButtonStyle}>
            Video
          </button>
          <button style={{ width: 34, height: 34, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "var(--text-muted)" }}>
            ⋯
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 11 }}>
        {timeline.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 14 }}>
            No messages yet - say hello.
          </div>
        )}
        {timeline.map((item) => {
          const day = dayLabel(item.ts);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={item.kind === "message" ? item.data.msg_id : item.data.transfer_id} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {showDay && (
                <div style={{ alignSelf: "center", font: '500 10.5px/1 "IBM Plex Mono", monospace', color: "var(--text-3)", padding: "5px 11px", borderRadius: 99, background: "var(--surface-2)" }}>
                  {day}
                </div>
              )}
              {item.kind === "message" ? (
                <MessageBubble msg={item.data} />
              ) : (
                <FileBubble file={item.data} progress={progressByTransfer[item.data.transfer_id]} />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {filePickerOpen && (
        <div style={{ padding: "0 20px 8px", display: "flex", gap: 8 }}>
          <input
            autoFocus
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendFile();
              if (e.key === "Escape") setFilePickerOpen(false);
            }}
            placeholder="Full path to a file on this machine"
            style={{ flex: 1, height: 38, borderRadius: 12, border: "1px solid var(--border)", padding: "0 13px", fontSize: 13.5, fontFamily: '"IBM Plex Mono", monospace' }}
          />
          <button onClick={handleSendFile} style={pillButtonStyle}>
            Send file
          </button>
        </div>
      )}

      <div style={{ flex: "0 0 auto", padding: "12px 20px 16px", borderTop: "1px solid var(--divider)", background: "var(--panel)", display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={() => setFilePickerOpen((v) => !v)}
          style={{ width: 38, height: 38, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--text-muted)" }}
        >
          +
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder={`Message ${peer.name} — or drop a file anywhere in this window`}
          style={{ flex: 1, height: 42, borderRadius: 14, border: "1px solid var(--border)", padding: "0 15px", fontSize: 14 }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim()}
          style={{ padding: "0 18px", height: 42, borderRadius: 14, border: "none", background: draft.trim() ? "var(--accent)" : "var(--border)", color: draft.trim() ? "#fff8f2" : "var(--text-3)", fontWeight: 600, fontSize: 14 }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

const pillButtonStyle = {
  padding: "8px 13px",
  borderRadius: 12,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--text-strong)",
};

function MessageBubble({ msg }) {
  const sent = msg.direction === "sent";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: sent ? "flex-end" : "flex-start", gap: 4, maxWidth: "58%", alignSelf: sent ? "flex-end" : "flex-start" }}>
      <div
        style={{
          padding: "11px 15px",
          borderRadius: sent ? "18px 18px 5px 18px" : "18px 18px 18px 5px",
          background: sent ? "var(--accent)" : "var(--surface)",
          border: sent ? "none" : "1px solid var(--border-soft)",
          color: sent ? "#fff8f2" : "var(--text)",
          fontSize: 14.5,
          lineHeight: 1.45,
          wordBreak: "break-word",
        }}
      >
        {msg.body}
      </div>
      {sent && (
        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>
          {statusGlyph(msg.status)} {msg.status === "delivered" ? "Seen" : ""}
        </div>
      )}
    </div>
  );
}

function FileBubble({ file, progress }) {
  const sent = file.direction === "sent";
  const { bg, text } = extStyle(file.filename);
  const isExecutable = EXECUTABLE_EXTS.has((file.filename.split(".").pop() || "").toLowerCase());
  const inProgress = file.status === "transferring" || file.status === "accepted";

  if (sent && inProgress) {
    const pct = Math.round((progress || 0) * 100);
    return (
      <div style={{ maxWidth: "58%", alignSelf: "flex-end", width: "58%" }}>
        <div style={{ padding: "11px 13px", borderRadius: "18px 18px 5px 18px", background: "var(--accent)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: "rgba(255,248,242,0.2)", display: "flex", alignItems: "center", justifyContent: "center", font: '600 9px/1 "IBM Plex Mono", monospace', color: "#fff8f2" }}>
              {(file.filename.split(".").pop() || "").slice(0, 3).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#fff8f2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.filename}</div>
              <div className="mono" style={{ fontSize: 11, color: "#fbdcc8" }}>{formatSize(file.size)}</div>
            </div>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: "rgba(255,248,242,0.28)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: 6, borderRadius: 99, background: "#fff8f2" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", font: '500 11px/1 "IBM Plex Mono", monospace', color: "#fbdcc8" }}>
            <span>{pct}% · sending</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "58%", alignSelf: sent ? "flex-end" : "flex-start" }}>
      <div
        style={{
          padding: "11px 13px",
          borderRadius: sent ? "18px 18px 5px 18px" : "18px 18px 18px 5px",
          background: "var(--surface)",
          border: isExecutable ? "1.5px solid var(--danger)" : "1px solid var(--border-soft)",
          display: "flex",
          alignItems: "center",
          gap: 11,
        }}
      >
        <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", font: '600 9.5px/1 "IBM Plex Mono", monospace', color: text }}>
          {(file.filename.split(".").pop() || "").slice(0, 3).toUpperCase()}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{file.filename}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {formatSize(file.size)} · {file.status}
          </div>
        </div>
      </div>
    </div>
  );
}
