import { useState } from "react";
import { api } from "../api";

// Shared modal chrome for every File/Network-menu dialog below - a real
// centered dialog (not a fake inline placeholder), closes on backdrop click
// or the explicit close button.
export function ModalOverlay({ title, onClose, width = 460, children }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(42,35,32,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width, maxWidth: "90vw", maxHeight: "80vh", overflowY: "auto", borderRadius: 18, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 22, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="serif" style={{ fontSize: 20 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface-2)", border: "none", fontSize: 13, color: "var(--text-muted)" }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// -- File > Send File... -----------------------------------------------------
// Sending works the same regardless of whether the target is online right
// now, same reasoning as forwarding: filetransfer.py's own flush loop
// auto-retries a failed offer once the peer reconnects.
export function SendFileModal({ candidates, onClose }) {
  const [target, setTarget] = useState(null);

  async function pickAndSend(peerId) {
    const path = await window.electronAPI?.pickFile?.("any");
    if (!path) return;
    await api.sendFile(peerId, path).catch(() => {});
    onClose();
  }

  return (
    <ModalOverlay title="Send File" onClose={onClose}>
      {candidates.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>Nobody to send to yet - start a conversation first.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {candidates.map((c) => (
            <button
              key={c.peer_id}
              onClick={() => pickAndSend(c.peer_id)}
              style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, background: "transparent", border: "none", fontSize: 13.5, fontWeight: 600, color: "var(--text-strong)" }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {!window.electronAPI?.pickFile && <div style={{ fontSize: 12, color: "var(--text-3)" }}>Only available in the desktop app.</div>}
    </ModalOverlay>
  );
}

// -- File > Import/Export Contacts... ----------------------------------------
// known_peers already persists this data (see storage.py) - export just
// dumps it, import re-seeds it. Real limitation stated plainly: importing a
// name doesn't make that peer reachable, it only pre-labels a peer_id for
// when it's next actually discovered on a real network.
export function ContactsModal({ onClose }) {
  const [status, setStatus] = useState("");

  async function handleExport() {
    setStatus("Exporting...");
    try {
      const contacts = await api.knownPeers();
      const content = JSON.stringify({ exported_at: Date.now() / 1000, contacts }, null, 2);
      const saved = await window.electronAPI?.saveTextFile?.(content, "agora-contacts.json", [{ name: "Agora Contacts", extensions: ["json"] }]);
      setStatus(saved ? `Exported ${contacts.length} contact(s).` : "");
    } catch {
      setStatus("Export failed.");
    }
  }

  async function handleImport() {
    setStatus("Importing...");
    try {
      const text = await window.electronAPI?.readTextFile?.([{ name: "Agora Contacts", extensions: ["json"] }]);
      if (!text) {
        setStatus("");
        return;
      }
      const parsed = JSON.parse(text);
      const contacts = Array.isArray(parsed) ? parsed : parsed.contacts;
      const res = await api.importContacts(contacts || []);
      setStatus(`Imported ${res.imported} contact(s). They'll show a real name once actually seen on a network again.`);
    } catch {
      setStatus("Import failed - not a valid Agora contacts file.");
    }
  }

  return (
    <ModalOverlay title="Import / Export Contacts" onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
        Contacts are just remembered names for peer IDs you've seen before. Importing a name doesn't make that device reachable - it only shows their name once they're actually found on a network again, same as any conversation with someone currently offline.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={handleExport} disabled={!window.electronAPI?.saveTextFile} style={btnStyle}>
          Export...
        </button>
        <button onClick={handleImport} disabled={!window.electronAPI?.readTextFile} style={btnStyle}>
          Import...
        </button>
      </div>
      {status && <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{status}</div>}
      {!window.electronAPI?.saveTextFile && <div style={{ fontSize: 12, color: "var(--text-3)" }}>Only available in the desktop app.</div>}
    </ModalOverlay>
  );
}

// -- Network > My Device Info -------------------------------------------------
export function DeviceInfoModal({ me, avatar, onClose }) {
  return (
    <ModalOverlay title="My Device Info" onClose={onClose} width={380}>
      <Row label="Name" value={me?.device_name || "-"} />
      <Row label="Peer ID" value={me?.peer_id || "-"} mono />
      <Row label="Avatar color" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ width: 14, height: 14, borderRadius: 99, background: avatar?.bg, display: "inline-block" }} />{avatar?.bg}</span>} />
    </ModalOverlay>
  );
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--divider)" }}>
      <span style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>{label}</span>
      <span className={mono ? "mono" : undefined} style={{ fontSize: mono ? 12 : 13.5, fontWeight: 600, textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

// -- Network > Known Peers ----------------------------------------------------
export function KnownPeersModal({ knownPeers, onClose }) {
  return (
    <ModalOverlay title="Known Peers" onClose={onClose}>
      {knownPeers.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>No peers seen yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {knownPeers.map((p) => (
            <div key={p.peer_id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", borderBottom: "1px solid var(--divider)" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{new Date(p.last_seen * 1000).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </ModalOverlay>
  );
}

// -- Network > Network Diagnostics... ----------------------------------------
// Real data (peers[].source is already "mdns" or "udp"), no fabricated
// health checks - deliberately doesn't try to guess *why* someone isn't
// showing up, that detection genuinely doesn't exist yet (see TASK_QUEUE.md).
export function DiagnosticsModal({ peers, onClose }) {
  const mdns = peers.filter((p) => p.source === "mdns").length;
  const udp = peers.filter((p) => p.source === "udp").length;
  return (
    <ModalOverlay title="Network Diagnostics" onClose={onClose}>
      <Row label="Peers found via mDNS" value={mdns} />
      <Row label="Peers found via UDP broadcast" value={udp} />
      <Row label="Total peers visible" value={peers.length} />
      {peers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
          {peers.map((p) => (
            <div key={p.peer_id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 4px", fontSize: 12.5 }}>
              <span>{p.name}</span>
              <span className="mono" style={{ color: "var(--text-3)" }}>{p.source}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
        If someone isn't showing up here at all, they may be on a network that blocks both mDNS and UDP broadcast (some public/corporate WiFi does this) - there's no automatic detection for that yet.
      </div>
    </ModalOverlay>
  );
}

// -- Help > Keyboard Shortcuts... --------------------------------------------
export function ShortcutsModal({ onClose }) {
  const shortcuts = [
    ["Ctrl+1", "Nearby"],
    ["Ctrl+2", "Chats"],
    ["Ctrl+3", "Calls"],
    ["Ctrl+4", "Files"],
    ["Ctrl+=", "Zoom in"],
    ["Ctrl+-", "Zoom out"],
    ["Ctrl+0", "Reset zoom"],
    ["Esc", "Close a menu or dialog"],
  ];
  return (
    <ModalOverlay title="Keyboard Shortcuts" onClose={onClose} width={340}>
      {shortcuts.map(([key, desc]) => (
        <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--divider)" }}>
          <span style={{ fontSize: 13 }}>{desc}</span>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{key}</span>
        </div>
      ))}
    </ModalOverlay>
  );
}

const btnStyle = {
  padding: "9px 15px",
  borderRadius: 11,
  background: "var(--surface-2)",
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-strong)",
};
