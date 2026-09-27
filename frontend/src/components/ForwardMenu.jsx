import { useState } from "react";

// Shared by ConversationPane and GroupConversationPane's message/file
// bubbles. Only ever offered for a message (any direction) or a completed,
// received file - see each call site's own comments for why a sent file
// isn't included. Deliberately doesn't list a currently-offline peer:
// unlike a normal send from the composer, there'd be no visible
// confirmation that a forward silently queued, which would just look like
// it went nowhere.
//
// candidates: [{ id, name, kind: "peer" | "group" }] - kind is only used to
// label group entries so a forward menu that mixes peers and groups (as
// GroupConversationPane's does) doesn't read as ambiguous.
export default function ForwardMenu({ candidates, onPick, align = "right" }) {
  const [open, setOpen] = useState(false);
  const disabled = candidates.length === 0;
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={disabled ? "No one else on this network to forward to" : "Forward"}
        style={{ ...glyphStyle, opacity: disabled ? 0.22 : 0.45, cursor: disabled ? "default" : "pointer" }}
      >
        ↪
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 24,
            [align]: 0,
            zIndex: 20,
            minWidth: 180,
            maxHeight: 220,
            overflowY: "auto",
            borderRadius: 12,
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            boxShadow: "var(--shadow)",
            padding: 6,
          }}
        >
          <div style={{ padding: "4px 10px 6px", font: '600 10px/1 "IBM Plex Mono", monospace', letterSpacing: "0.08em", color: "var(--text-3)" }}>
            FORWARD TO
          </div>
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setOpen(false);
                onPick(c);
              }}
              style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, background: "transparent", border: "none", fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)", display: "flex", alignItems: "center", gap: 6 }}
            >
              {c.name}
              {c.kind === "group" && (
                <span style={{ font: '600 9px/1 "IBM Plex Mono", monospace', letterSpacing: "0.04em", color: "var(--text-3)" }}>GROUP</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const glyphStyle = {
  flexShrink: 0,
  width: 22,
  height: 22,
  borderRadius: 8,
  background: "transparent",
  border: "none",
  fontSize: 11,
  opacity: 0.45,
  color: "var(--text-3)",
};
