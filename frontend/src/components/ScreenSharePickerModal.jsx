import { useEffect, useState } from "react";

// Electron has no built-in screen-share source picker on Windows the way
// some platforms do - this is that picker, real thumbnails included, not a
// stub that just grabs "the screen" silently. Shown above the call overlay
// itself (which is already zIndex 1000), so this sits higher.
//
// If there's only one capturable screen (the common case - most machines
// have exactly one monitor), this skips the visible picker entirely and
// auto-chooses it - a dialog asking "which of your 1 screens?" would be
// friction with no real decision behind it.
export default function ScreenSharePickerModal({ onChoose, onCancel }) {
  const [sources, setSources] = useState(null); // null = still loading
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!window.electronAPI?.getScreenSources) {
      // No Electron bridge at all (a plain browser context, e.g. running
      // the dev server directly) - there's no custom picker to show, and
      // none is needed: the browser's own native getDisplayMedia picker
      // handles source selection entirely on its own. Get out of the way
      // rather than showing a broken/empty dialog.
      onChoose(null);
      return;
    }
    window.electronAPI
      .getScreenSources()
      .then((list) => {
        if (cancelled) return;
        if (!list || list.length === 0) {
          setError("No screen available to share.");
          return;
        }
        if (list.length === 1) {
          onChoose(list[0].id);
          return;
        }
        setSources(list);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't list available screens.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <Overlay onCancel={onCancel}>
        <div style={{ fontSize: 13.5, color: "var(--text)" }}>{error}</div>
        <button onClick={onCancel} style={closeBtnStyle}>
          Close
        </button>
      </Overlay>
    );
  }

  if (!sources) return null; // auto-choosing, or still loading - no flash of empty UI

  return (
    <Overlay onCancel={onCancel}>
      <div className="serif" style={{ fontSize: 18, color: "var(--text)" }}>
        Share your screen
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, maxHeight: "50vh", overflowY: "auto" }}>
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => onChoose(s.id)}
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--divider)", cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ width: "100%", aspectRatio: "16/10", borderRadius: 8, overflow: "hidden", background: "#1c1512", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {s.thumbnail ? <img src={s.thumbnail} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "#a3948a" }}>No preview</span>}
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
          </button>
        ))}
      </div>
      <button onClick={onCancel} style={closeBtnStyle}>
        Cancel
      </button>
    </Overlay>
  );
}

function Overlay({ onCancel, children }) {
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(20,14,10,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "90vw", borderRadius: 18, background: "var(--surface)", boxShadow: "0 22px 50px rgba(20,14,10,0.42)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

const closeBtnStyle = { alignSelf: "flex-end", padding: "8px 14px", borderRadius: 10, background: "var(--surface-2)", border: "none", fontSize: 12.5, fontWeight: 600, color: "var(--text)" };
