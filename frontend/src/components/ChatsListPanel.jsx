import { useState } from "react";
import { paletteFor, initials } from "../lib/avatar";
import { api } from "../api";
import { usePeers } from "../hooks/usePeers";

function fmtPreview(body, direction) {
  const text = body.length > 40 ? body.slice(0, 40) + "…" : body;
  return direction === "sent" ? `You: ${text}` : text;
}

// Matches design screen 10.3: real conversations (not live presence),
// sorted by recency, each row showing the last message, plus a Groups
// section now that group chat has real backend support (groups.py).
//
// `conversations` carries its own persisted `name` per peer (from the
// backend's known_peers table - see storage.py), rather than looking one up
// in the live `peers` list, so a conversation still shows a real name after
// that peer goes offline instead of falling back to "Unknown".
export default function ChatsListPanel({ conversations, groups, selected, onSelect, selectedGroupId, onSelectGroup }) {
  const [creating, setCreating] = useState(false);

  return (
    <div style={{ width: 300, flex: "0 0 auto", borderRight: "1px solid var(--divider)", background: "var(--panel)", display: "flex", flexDirection: "column", padding: "18px 14px", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 4px" }}>
        <div className="serif" style={{ fontSize: 27, lineHeight: 1 }}>
          Chats
        </div>
        <button
          title="New group"
          onClick={() => setCreating(true)}
          style={{ width: 30, height: 30, borderRadius: 10, background: "var(--accent)", color: "#fff8f2", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 2, border: "none" }}
        >
          +
        </button>
      </div>

      {groups.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "2px 8px 4px" }}>GROUPS</div>
          {groups.map((g) => (
            <button
              key={g.group_id}
              onClick={() => onSelectGroup(g.group_id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "10px 11px",
                borderRadius: 14,
                background: selectedGroupId === g.group_id ? "var(--surface-2)" : "transparent",
                border: selectedGroupId === g.group_id ? "1px solid var(--border-soft)" : "1px solid transparent",
                textAlign: "left",
              }}
            >
              <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 12, background: "var(--avatar-self)", color: "var(--accent-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600 }}>
                {initials(g.name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{g.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{g.members.length} people</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {conversations.length === 0 && groups.length === 0 && (
        <div style={{ padding: "12px 13px", borderRadius: 14, background: "var(--surface-2)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, margin: "0 4px" }}>
          No conversations yet - message someone from Nearby to start one.
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {conversations.length > 0 && groups.length > 0 && (
          <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "2px 8px 4px" }}>PEOPLE</div>
        )}
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
                {initials(c.name || "Unknown")}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name || "Unknown"}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fmtPreview(c.last_body, c.last_direction)}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {creating && (
        <NewGroupModal
          onClose={() => setCreating(false)}
          onCreated={(groupId) => {
            setCreating(false);
            onSelectGroup(groupId);
          }}
        />
      )}
    </div>
  );
}

function NewGroupModal({ onClose, onCreated }) {
  const { peers } = usePeers();
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(() => new Set());
  const [creating, setCreating] = useState(false);

  function toggle(peerId) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) next.delete(peerId);
      else next.add(peerId);
      return next;
    });
  }

  async function handleCreate() {
    if (!name.trim() || checked.size === 0) return;
    setCreating(true);
    const members = peers.filter((p) => checked.has(p.peer_id)).map((p) => ({ peer_id: p.peer_id, name: p.name }));
    try {
      const group = await api.createGroup(name.trim(), members);
      onCreated(group.group_id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(20,14,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 340, background: "var(--surface)", borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 14, boxShadow: "var(--shadow-window)" }}>
        <div className="serif" style={{ fontSize: 22 }}>New group</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          style={{ height: 40, borderRadius: 12, border: "1px solid var(--border)", padding: "0 13px", fontSize: 14 }}
        />
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)" }}>
          ADD PEOPLE {peers.length === 0 ? "(nobody on this network yet)" : ""}
        </div>
        <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {peers.map((p) => (
            <label key={p.peer_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 9px", borderRadius: 10, background: checked.has(p.peer_id) ? "var(--surface-2)" : "transparent", cursor: "pointer" }}>
              <input type="checkbox" checked={checked.has(p.peer_id)} onChange={() => toggle(p.peer_id)} />
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 15px", borderRadius: 11, background: "transparent", border: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || checked.size === 0 || creating}
            style={{ padding: "9px 16px", borderRadius: 11, background: "var(--accent)", border: "none", color: "#fff8f2", fontSize: 13, fontWeight: 600, opacity: !name.trim() || checked.size === 0 ? 0.5 : 1 }}
          >
            {creating ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}
