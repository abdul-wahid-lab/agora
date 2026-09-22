import { useEffect, useMemo, useState } from "react";
import { api, connectEvents } from "../api";
import { usePeers } from "../hooks/usePeers";

const EXECUTABLE_EXTS = new Set(["apk", "exe", "msi", "bat", "cmd", "com", "sh", "jar", "appimage", "ps1"]);
const TYPE_GROUPS = {
  Docs: new Set(["pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "ppt", "pptx"]),
  Images: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]),
  Video: new Set(["mov", "mp4", "avi", "mkv"]),
  Archives: new Set(["zip", "rar", "7z", "tar", "gz"]),
  Apps: new Set(["apk", "exe", "msi", "appimage"]),
};
const EXT_STYLE = {
  pdf: { bg: "#f3e8dd", text: "#c2562a" },
  apk: { bg: "#e8eee4", text: "#4c6b43" },
  zip: { bg: "#fbe9d7", text: "#b07a2a" },
  mov: { bg: "#f6dcc7", text: "#b04a1f" },
  mp4: { bg: "#f6dcc7", text: "#b04a1f" },
};
function extOf(filename) {
  return (filename.split(".").pop() || "").toLowerCase();
}
function extStyle(filename) {
  return EXT_STYLE[extOf(filename)] || { bg: "#f5efe7", text: "#8a7f76" };
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function formatWhen(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { weekday: "short" });
}

// Matches design screen 10.5: a category sidebar (all/received/sent + by
// person), a searchable/filterable table (not per-peer file bubbles - that
// view is ConversationPane's job), and a full security-gate modal for
// executable files that requires two acknowledgements plus a timed delay
// before it'll even reveal the file, matching the design's own copy and
// timing exactly.
export default function FilesScreen() {
  const peers = usePeers();
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("all"); // all | received | sent | peer:<id>
  const [typeFilter, setTypeFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [gateFile, setGateFile] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.allFiles();
        if (!cancelled) setFiles(list);
      } catch {
        // ignore - next poll retries
      }
    }
    load();
    const interval = setInterval(load, 3000);
    const stop = connectEvents((evt) => {
      if (evt.type === "file_offer" || evt.type === "file_status") load();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      stop();
    };
  }, []);

  const peerName = (peerId) => peers.find((p) => p.peer_id === peerId)?.name || "Unknown";

  const byPerson = useMemo(() => {
    const counts = {};
    for (const f of files) counts[f.peer_id] = (counts[f.peer_id] || 0) + 1;
    return Object.entries(counts).map(([peer_id, count]) => ({ peer_id, count }));
  }, [files]);

  const filtered = files.filter((f) => {
    if (category === "received" && f.direction !== "received") return false;
    if (category === "sent" && f.direction !== "sent") return false;
    if (category.startsWith("peer:") && f.peer_id !== category.slice(5)) return false;
    if (typeFilter !== "All" && !TYPE_GROUPS[typeFilter]?.has(extOf(f.filename))) return false;
    if (search.trim() && !f.filename.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  function handleRowClick(f) {
    if (f.direction === "received" && f.status === "awaiting_accept") {
      if (EXECUTABLE_EXTS.has(extOf(f.filename))) {
        setGateFile(f);
      } else {
        api.acceptFile(f.transfer_id).then(() => api.allFiles().then(setFiles));
      }
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", position: "relative" }}>
      <div style={{ width: 236, flex: "0 0 auto", borderRight: "1px solid var(--divider)", background: "var(--panel)", padding: "18px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="serif" style={{ fontSize: 24, lineHeight: 1, padding: "0 6px 8px" }}>
          Files
        </div>
        <CategoryRow active={category === "all"} onClick={() => setCategory("all")} label={`All files · ${files.length}`} accent />
        <CategoryRow active={category === "received"} onClick={() => setCategory("received")} label={`Received · ${files.filter((f) => f.direction === "received").length}`} />
        <CategoryRow active={category === "sent"} onClick={() => setCategory("sent")} label={`Sent · ${files.filter((f) => f.direction === "sent").length}`} />
        <div style={{ height: 1, background: "var(--divider)", margin: "8px 6px" }} />
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "4px 6px 6px" }}>BY PERSON</div>
        {byPerson.map(({ peer_id, count }) => (
          <button
            key={peer_id}
            onClick={() => setCategory(`peer:${peer_id}`)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 11, border: "none", background: category === `peer:${peer_id}` ? "var(--surface-2)" : "transparent", textAlign: "left" }}
          >
            <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "var(--text-strong)" }}>
              {peerName(peer_id).slice(0, 2).toUpperCase()}
            </span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
              {peerName(peer_id)} · {count}
            </span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "18px 22px", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, height: 38, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9, padding: "0 13px" }}>
            <span style={{ width: 13, height: 13, borderRadius: 99, border: "2px solid var(--icon-muted)", flexShrink: 0 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${files.length} files…`}
              style={{ border: "none", outline: "none", background: "transparent", fontSize: 13.5, flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {["All", "Docs", "Images", "Video", "Archives", "Apps"].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: typeFilter === t ? "#2a2320" : "var(--surface)",
                  border: typeFilter === t ? "none" : "1px solid var(--border)",
                  color: typeFilter === t ? "var(--surface)" : "var(--text-strong)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", background: "#f7f2eb", borderBottom: "1px solid var(--divider)", font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.09em", color: "var(--text-3)" }}>
            <div style={{ width: 32 }} />
            <div style={{ flex: 1 }}>NAME</div>
            <div style={{ width: 100 }}>SIZE</div>
            <div style={{ width: 140 }}>PERSON</div>
            <div style={{ width: 110 }}>WHEN</div>
          </div>

          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13.5 }}>No files match.</div>
          )}

          {filtered.map((f) => {
            const style = extStyle(f.filename);
            const isExecutable = EXECUTABLE_EXTS.has(extOf(f.filename));
            const pending = f.direction === "received" && f.status === "awaiting_accept";
            return (
              <button
                key={f.transfer_id}
                onClick={() => handleRowClick(f)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "11px 16px",
                  borderBottom: "1px solid var(--divider)",
                  background: pending ? "#fdf1e8" : "transparent",
                  border: "none",
                  borderBottomWidth: 1,
                  textAlign: "left",
                  cursor: pending ? "pointer" : "default",
                }}
              >
                <span style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, background: style.bg, display: "flex", alignItems: "center", justifyContent: "center", font: '600 8px/1 "IBM Plex Mono", monospace', color: style.text }}>
                  {extOf(f.filename).slice(0, 3).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</span>
                  {isExecutable && (
                    <span style={{ padding: "3px 8px", borderRadius: 99, background: "#f9e3de", font: '600 10px/1.3 "Hanken Grotesk", sans-serif', color: "#a83f30", flexShrink: 0 }}>Installable</span>
                  )}
                  {pending && <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent-strong)", flexShrink: 0 }}>Tap to review</span>}
                </div>
                <div className="mono" style={{ width: 100, fontSize: 12, color: "var(--text-muted)" }}>{formatSize(f.size)}</div>
                <div style={{ width: 140, fontSize: 12.5, color: "var(--text-2)" }}>{f.direction === "sent" ? `You → ${peerName(f.peer_id)}` : peerName(f.peer_id)}</div>
                <div style={{ width: 110, fontSize: 12.5, color: "var(--text-muted)" }}>{formatWhen(f.ts)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {gateFile && (
        <SecurityGate
          file={gateFile}
          peerName={peerName(gateFile.peer_id)}
          onClose={() => setGateFile(null)}
          onAccept={() => {
            api.acceptFile(gateFile.transfer_id).then(() => api.allFiles().then(setFiles));
            setGateFile(null);
          }}
          onDecline={() => {
            api.declineFile(gateFile.transfer_id).then(() => api.allFiles().then(setFiles));
            setGateFile(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryRow({ active, onClick, label, accent }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 12px",
        borderRadius: 11,
        border: active ? "1px solid var(--avatar-self)" : "none",
        background: active ? "var(--surface-2)" : "transparent",
        fontSize: 13.5,
        fontWeight: active ? 700 : 500,
        color: active && accent ? "var(--accent-strong)" : active ? "var(--text-strong)" : "var(--text-strong)",
        textAlign: "left",
      }}
    >
      {label}
    </button>
  );
}

// Matches design screen 10.5's dark security-gate modal exactly: two
// required acknowledgements plus a 3-second timer before the accept action
// unlocks - an installable file is a real security decision, not a routine
// download, and the UI is built to make that friction deliberate rather
// than a rubber-stamp dialog.
function SecurityGate({ file, peerName, onClose, onAccept, onDecline }) {
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
