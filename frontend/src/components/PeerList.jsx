import { useState } from "react";
import { paletteFor, initials } from "../lib/avatar";
import PeerAvatar from "./PeerAvatar";

// Matches design screens 10.2/10.7 exactly: serif "Nearby" heading + Rescan
// pill, a real search field (filters the visible peer list by name), an
// "ON THIS NETWORK · N" section label, and rows with an animated presence
// ring on the avatar.
export default function PeerList({ peers, selected, onSelect, onRescan, onOpenQr, scanning = false, title = "Nearby", emptyText = "Nobody has announced themselves on this network yet." }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  // Only ever filters by name: this list only ever has peer data to search
  // through, unlike Files' own search box (FilesScreen.jsx) which searches
  // real filenames. "and files" in the placeholder below used to overclaim
  // a cross-screen search that was never built.
  const filteredPeers = query ? peers.filter((p) => p.name.toLowerCase().includes(query)) : peers;

  return (
    <div style={{ width: 300, flex: "0 0 auto", borderRight: "1px solid var(--divider)", background: "var(--panel)", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "0 0 auto", padding: "18px 18px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div className="serif" style={{ fontSize: 27, lineHeight: 1 }}>
            {title}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {onOpenQr && (
              <button
                onClick={onOpenQr}
                title="Add by QR code"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 99, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-strong)" }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="9.5" y="9.5" width="2" height="2" fill="currentColor" />
                  <rect x="12.5" y="9.5" width="2" height="2" fill="currentColor" />
                  <rect x="9.5" y="12.5" width="2" height="2" fill="currentColor" />
                  <rect x="12.5" y="12.5" width="2" height="2" fill="currentColor" />
                </svg>
              </button>
            )}
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
        </div>
        <div style={{ height: 36, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9, padding: "0 12px" }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, border: "2px solid var(--icon-muted)", flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: 13, color: "var(--text)" }}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "4px 6px" }}>
          ON THIS NETWORK · {filteredPeers.length}
        </div>

        {filteredPeers.length === 0 && (
          <div style={{ padding: "12px 13px", borderRadius: 14, background: "var(--surface-2)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, margin: "0 4px" }}>
            {query ? `No one named "${search.trim()}" is on this network right now.` : emptyText}
          </div>
        )}

        {filteredPeers.map((p) => {
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
                <PeerAvatar peerId={p.peer_id} name={p.name} size={38} bg={bg} text={text} fontSize={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
