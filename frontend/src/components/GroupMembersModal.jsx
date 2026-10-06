import { paletteFor, initials } from "../lib/avatar";

// Design screen 10.3's "Members" button opens this - the group header
// previously had no way to see who's actually in a group at all, beyond
// the member-count text already in the header subtitle.
export default function GroupMembersModal({ group, livePeers, selfPeerId, onClose }) {
  // This device never discovers itself via mDNS, so it's never in
  // livePeers for its own peer_id - without this it would always show as
  // "Off network" to its own owner, which is simply wrong, not a real
  // status.
  const isOnline = (peerId) => peerId === selfPeerId || livePeers.some((p) => p.peer_id === peerId);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(20,14,10,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: "72vh", display: "flex", flexDirection: "column", borderRadius: 18, background: "var(--surface)", boxShadow: "0 22px 50px rgba(20,14,10,0.42)" }}>
        <div style={{ flex: "0 0 auto", padding: "18px 20px", borderBottom: "1px solid var(--divider)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="serif" style={{ fontSize: 19 }}>
            {group.name} · {group.members.length} members
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 99, background: "var(--surface-2)", border: "none", fontSize: 14, color: "var(--text-muted)" }}>
            ×
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px" }}>
          {group.members.map((m) => {
            const { bg, text } = paletteFor(m.peer_id);
            const online = isOnline(m.peer_id);
            return (
              <div key={m.peer_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 10px" }}>
                <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 99, background: bg, color: text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
                  {initials(m.name)}
                </span>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name}
                  {m.peer_id === selfPeerId && <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> (you)</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: online ? "var(--accent)" : "var(--text-3)" }} />
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{online ? "On this network" : "Off network"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
