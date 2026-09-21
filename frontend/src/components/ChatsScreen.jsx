import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { colorFor, initials } from "../lib/avatar";

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusGlyph(status) {
  if (status === "delivered" || status === "received") return "✓✓";
  if (status === "failed") return "!";
  if (status === "sent") return "✓";
  return "…"; // pending
}

export default function ChatsScreen() {
  const [peers, setPeers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef(null);
  const selectedRef = useRef(null);
  selectedRef.current = selected;

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
    async function loadHistory() {
      try {
        const history = await api.history(selected);
        if (!cancelled) setMessages(history);
      } catch {
        // ignore - next poll will retry
      }
    }
    loadHistory();
    const interval = setInterval(loadHistory, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected]);

  useEffect(() => {
    const stop = connectEvents((evt) => {
      if (evt.type === "message" && evt.peer_id === selectedRef.current) {
        setMessages((prev) => [...prev, { msg_id: `live-${evt.ts}`, direction: "received", body: evt.body, status: "received", ts: evt.ts }]);
      }
    });
    return stop;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || !selected) return;
    setDraft("");
    const optimistic = { msg_id: `pending-${Date.now()}`, direction: "sent", body: text, status: "pending", ts: Date.now() / 1000 };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await api.sendMessage(selected, text);
    } catch {
      setMessages((prev) => prev.map((m) => (m.msg_id === optimistic.msg_id ? { ...m, status: "failed" } : m)));
    }
  }

  const selectedPeer = peers.find((p) => p.peer_id === selected);

  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
      <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto", padding: "20px 12px" }}>
        <h1 className="serif" style={{ fontSize: 26, margin: "0 12px 16px" }}>
          Chats
        </h1>
        {peers.length === 0 && (
          <p style={{ padding: "0 12px", color: "var(--text-3)", fontSize: 13.5 }}>No one nearby to chat with yet.</p>
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
              Pick someone nearby to start chatting
            </p>
          </div>
        )}

        {selected && (
          <>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
              {selectedPeer?.name || "Unknown"}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
              {messages.map((m) => (
                <div key={m.msg_id} style={{ display: "flex", justifyContent: m.direction === "sent" ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      maxWidth: "60%",
                      padding: "10px 14px",
                      borderRadius: 16,
                      background: m.direction === "sent" ? "var(--accent)" : "var(--surface)",
                      color: m.direction === "sent" ? "#fff8f2" : "var(--text)",
                      border: m.direction === "sent" ? "none" : "1px solid var(--border)",
                    }}
                  >
                    <div style={{ fontSize: 14.5, wordBreak: "break-word" }}>{m.body}</div>
                    <div className="mono" style={{ fontSize: 10.5, opacity: 0.7, marginTop: 4, textAlign: "right" }}>
                      {formatTime(m.ts)} {m.direction === "sent" && statusGlyph(m.status)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder="Type a message"
                style={{ flex: 1, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", fontSize: 14.5 }}
              />
              <button
                onClick={handleSend}
                disabled={!draft.trim()}
                style={{
                  padding: "0 22px",
                  borderRadius: 12,
                  border: "none",
                  background: draft.trim() ? "var(--accent)" : "var(--border)",
                  color: draft.trim() ? "#fff8f2" : "var(--text-3)",
                  fontWeight: 700,
                }}
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
