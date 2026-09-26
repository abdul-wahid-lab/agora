import { paletteFor, initials } from "../lib/avatar";

// Matches design screens 10.2/10.7 exactly: serif "Nearby" heading + Rescan
// pill, a (visual-only for now) search field, an "ON THIS NETWORK · N"
// section label, and rows with an animated presence ring on the avatar.
export default function PeerList({ peers, selected, onSelect, onRescan, scanning = false, title = "Nearby", emptyText = "Nobody has announced themselves on this network yet." }) {
  return (
    <div style={{ width: 300, flex: "0 0 auto", borderRight: "1px solid var(--divider)", background: "var(--panel)", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "0 0 auto", padding: "18px 18px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div className="serif" style={{ fontSize: 27, lineHeight: 1 }}>
            {title}
          </div>
          {onRescan && (
            <button
              onClick={onRescan}
              disabled={scanning}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 99, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text-strong)", opacity: scanning ? 0.7 : 1 }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ animation: scanning ? "agSpin 0.7s linear infinite" : "none" }}>
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.89" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M13.5 2.5v3.2h-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {scanning ? "Scanning…" : "Rescan"}
            </button>
          )}
        </div>
        <div style={{ height: 36, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9, padding: "0 12px" }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, border: "2px solid var(--icon-muted)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>Search people and files…</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "4px 6px" }}>
          ON THIS NETWORK · {peers.length}
        </div>

        {peers.length === 0 && (
          <div style={{ padding: "12px 13px", borderRadius: 14, background: "var(--surface-2)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, margin: "0 4px" }}>
            {emptyText}
          </div>
        )}

        {peers.map((p) => {
          const { bg, text } = paletteFor(p.peer_id);
          const isSelected = selected === p.peer_id;
          return (
            <button
              key={p.peer_id}
              onClick={() => onSelect(p.peer_id)}
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
              <span style={{ position: "relative", width: 38, height: 38, flexShrink: 0 }}>
                <span
                  style={{
                    position: "absolute",
                    inset: -3,
                    borderRadius: 99,
                    border: "2px solid var(--accent)",
                    animation: "agRing 2.6s ease-out infinite",
                  }}
                />
                <span
                  style={{
                    width: 38,
                    height: 38,
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
                  {initials(p.name)}
                </span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  {p.address}:{p.port} · via {p.source}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
