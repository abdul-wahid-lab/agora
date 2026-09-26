import { useEffect, useState } from "react";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function extOf(filename) {
  return (filename.split(".").pop() || "").toLowerCase();
}

// Matches design screen 10.5's dark security-gate modal exactly: two
// required acknowledgements plus a 3-second timer before the accept action
// unlocks - an installable file is a real security decision, not a routine
// download, and the UI is built to make that friction deliberate rather
// than a rubber-stamp dialog. Shared by FilesScreen (the global browser) and
// ConversationPane (the per-chat bubble) - both need identical behavior.
export default function SecurityGate({ file, peerName, onClose, onAccept, onDecline }) {
  const [ackKnown, setAckKnown] = useState(false);
  const [ackUnderstood, setAckUnderstood] = useState(false);
  const [unlockIn, setUnlockIn] = useState(3);

  useEffect(() => {
    if (unlockIn <= 0) return;
    const t = setTimeout(() => setUnlockIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [unlockIn]);

  const canProceed = ackKnown && ackUnderstood && unlockIn <= 0;

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(42,35,32,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
      <div style={{ position: "relative", width: 600, borderRadius: 20, background: "#2a2320", boxShadow: "0 34px 80px rgba(20,14,10,0.5)", padding: 26, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ width: 50, height: 50, flexShrink: 0, borderRadius: 16, background: "#c2352a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 27, fontWeight: 700, color: "#fff" }}>!</div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="serif" style={{ fontSize: 29, color: "#f9f1e8", lineHeight: 1.1 }}>This file can install software on your computer</div>
            <div style={{ fontSize: 14, color: "#b5a396", lineHeight: 1.55 }}>
              Agora delivered it exactly as sent, but it can't tell you what's inside. Only continue if you know the sender and expected this file.
            </div>
          </div>
        </div>

        <div style={{ padding: 15, borderRadius: 16, background: "rgba(249,241,232,0.07)", display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 13, background: "rgba(249,241,232,0.12)", display: "flex", alignItems: "center", justifyContent: "center", font: '600 9.5px/1 "IBM Plex Mono", monospace', color: "#f9f1e8" }}>
              {extOf(file.filename).slice(0, 3).toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "#f9f1e8" }}>{file.filename}</div>
              <div className="mono" style={{ fontSize: 11, color: "#a3948a" }}>{formatSize(file.size)}</div>
            </div>
          </div>
          <div style={{ height: 1, background: "rgba(249,241,232,0.1)" }} />
          <div className="mono" style={{ fontSize: 12, lineHeight: 1.7, color: "#a3948a" }}>
            sender &nbsp;&nbsp;{peerName}
            <br />
            sha256 &nbsp;&nbsp;{file.sha256 ? `${file.sha256.slice(0, 8)}…${file.sha256.slice(-4)}` : "unknown"}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", gap: 11, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={ackKnown} onChange={(e) => setAckKnown(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
            <span style={{ fontSize: 13.5, color: "#d7c8bb", lineHeight: 1.45 }}>I know {peerName} personally and expected this file.</span>
          </label>
          <label style={{ display: "flex", gap: 11, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={ackUnderstood} onChange={(e) => setAckUnderstood(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
            <span style={{ fontSize: 13.5, color: "#d7c8bb", lineHeight: 1.45 }}>I understand this package can run code on this computer.</span>
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontSize: 11.5, color: "#7f7166" }}>
            Both boxes must be ticked{unlockIn > 0 ? ` · unlocks in ${unlockIn}s` : ""}
          </div>
          <button onClick={onDecline} style={{ padding: "11px 18px", borderRadius: 12, background: "transparent", border: "1px solid var(--border)", color: "#d9a49d", fontSize: 13.5, fontWeight: 600 }}>
            Decline
          </button>
          <button
            disabled={!canProceed}
            onClick={onAccept}
            style={{ padding: "11px 20px", borderRadius: 12, background: canProceed ? "#f9f1e8" : "rgba(249,241,232,0.15)", color: canProceed ? "#2a2320" : "#7f7166", fontSize: 13.5, fontWeight: 700, border: "none" }}
          >
            Accept anyway
          </button>
        </div>
        <button onClick={onClose} style={{ position: "absolute", top: 18, right: 22, background: "none", border: "none", fontSize: 20, color: "#a3948a" }}>
          ×
        </button>
      </div>
    </div>
  );
}
