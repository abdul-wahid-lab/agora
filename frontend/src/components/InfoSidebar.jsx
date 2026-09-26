import { useEffect, useState } from "react";
import { api } from "../api";
import { paletteFor, initials } from "../lib/avatar";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EXT_STYLE = {
  pdf: { bg: "#f3e8dd", text: "#c2562a" },
  apk: { bg: "#e8eee4", text: "#4c6b43" },
  zip: { bg: "#fbe9d7", text: "#b07a2a" },
  mov: { bg: "#f6dcc7", text: "#b04a1f" },
};

// Matches design screen 10.7's right-hand panel. The design's mockup shows
// fabricated network telemetry (latency/link/route); rather than invent
// numbers we don't measure, this shows what discovery genuinely knows about
// the connection (its transport and address) - real over fake.
export default function InfoSidebar({ peer, online = true }) {
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (!peer) return;
    let cancelled = false;
    async function load() {
      try {
        const list = await api.files(peer.peer_id);
        if (!cancelled) setFiles(list.filter((f) => f.status === "completed"));
      } catch {
        // ignore
      }
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [peer?.peer_id]);

  if (!peer) return null;
  const { bg, text } = paletteFor(peer.peer_id);

  return (
    <div style={{ width: 248, flex: "0 0 auto", borderLeft: "1px solid var(--divider)", background: "var(--panel)", display: "flex", flexDirection: "column", padding: "18px 16px", gap: 16, overflowY: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
        <span style={{ position: "relative", width: 70, height: 70 }}>
          <span style={{ position: "absolute", inset: -5, borderRadius: 99, border: "2px solid var(--accent)", animation: "agRing 2.6s ease-out infinite" }} />
          <span style={{ width: 70, height: 70, borderRadius: 99, background: bg, color: text, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Instrument Serif, serif", fontSize: 26 }}>
            {initials(peer.name)}
          </span>
        </span>
        <div className="serif" style={{ fontSize: 21, lineHeight: 1 }}>
          {peer.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 99, background: "var(--surface-2)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: online ? "var(--accent)" : "var(--text-3)" }} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-strong)" }}>{online ? peer.address : "Not on this network"}</span>
        </div>
      </div>

      <div style={{ padding: "13px 14px", borderRadius: 16, background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)" }}>CONNECTION</div>
        {online ? (
          <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.7, color: "var(--text-2)" }}>
            address &nbsp;{peer.address}:{peer.port}
            <br />
            via &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{peer.source}
            <br />
            route &nbsp;&nbsp;&nbsp;direct, no relay
          </div>
        ) : (
          <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.7, color: "var(--text-2)" }}>
            Not seen on this network right now. Showing saved chat history only.
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)" }}>SHARED FILES · {files.length}</div>
        </div>
        {files.length === 0 && <p style={{ fontSize: 11.5, color: "var(--text-3)" }}>None yet.</p>}
        {files.slice(0, 6).map((f) => {
          const ext = (f.filename.split(".").pop() || "").toLowerCase();
          const style = EXT_STYLE[ext] || { bg: "#f5efe7", text: "#8a7f76" };
          return (
            <div key={f.transfer_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 13, background: "var(--surface)", border: "1px solid var(--border-soft)" }}>
              <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 10, background: style.bg, display: "flex", alignItems: "center", justifyContent: "center", font: '600 8px/1 "IBM Plex Mono", monospace', color: style.text }}>
                {ext.slice(0, 3).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>{formatSize(f.size)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
