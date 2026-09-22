import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";
import { paletteFor, initials } from "../lib/avatar";

function fmtPreview(body, direction) {
  const text = body.length > 40 ? body.slice(0, 40) + "…" : body;
  return direction === "sent" ? `You: ${text}` : text;
}

// Matches design screen 10.3: real conversations (not live presence),
// sorted by recency, each row showing the last message. The "+" button is
// a stub for now - group creation needs backend support that doesn't exist
// yet (see BUILD_LOG).
export default function ChatsListPanel({ peers, selected, onSelect }) {
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.conversations();
        if (!cancelled) setConversations(list);
      } catch {
        // ignore - next poll/event retries
      }
    }
    load();
    const interval = setInterval(load, 3000);
    const stop = connectEvents((evt) => {
      if (evt.type === "message") load();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      stop();
    };
  }, []);

  const peerName = (peerId) => peers.find((p) => p.peer_id === peerId)?.name || "Unknown";

  return (
    <div style={{ width: 300, flex: "0 0 auto", borderRight: "1px solid var(--divider)", background: "var(--panel)", display: "flex", flexDirection: "column", padding: "18px 14px", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 4px" }}>
        <div className="serif" style={{ fontSize: 27, lineHeight: 1 }}>
          Chats
        </div>
        <button
          title="New conversation (coming soon - group chat needs backend support)"
          disabled
          style={{ width: 30, height: 30, borderRadius: 10, background: "var(--border)", color: "var(--surface)", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 2 }}
        >
          +
        </button>
      </div>

      {conversations.length === 0 && (
        <div style={{ padding: "12px 13px", borderRadius: 14, background: "var(--surface-2)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, margin: "0 4px" }}>
          No conversations yet - message someone from Nearby to start one.
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {conversations.map((c) => {
          const { bg, text } = paletteFor(c.peer_id);
          const isSelected = selected === c.peer_id;
          return (
            <button
              key={c.peer_id}
              onClick={() => onSelect(c.peer_id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "10px 11px",
                borderRadius: 14,
                background: isSelected ? "var(--surface-2)" : "transparent",
                border: isSelected ? "1px solid var(--border-soft)" : "1px solid transparent",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: 99,
                  background: bg,
                  color: text,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {initials(peerName(c.peer_id))}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{peerName(c.peer_id)}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fmtPreview(c.last_body, c.last_direction)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
