import { useState } from "react";

// Custom titlebar for the frameless Electron window (Step 6) - real
// minimize/maximize/close controls, Windows-style at the top-right (not the
// design file's macOS-style traffic lights, which don't match Windows
// conventions or what a Windows user actually looks for). Wired via
// preload.cjs's window.electronAPI. In a plain browser tab (dev mode
// outside Electron) window.electronAPI doesn't exist, so the buttons render
// but do nothing - there's no window to control from inside a tab.
//
// Layout note: the window-control buttons must sit flush against the
// container's true right edge (zero padding, zero margin) the way every
// native Windows titlebar does - an earlier version used a stray negative
// margin to "pull" them there instead of just removing right padding, which
// left an ugly gap and buttons that weren't actually flush. Fixed by
// grouping the status pill + controls into one right-aligned cluster with
// no padding after the last button.
const MENU_ITEMS = ["Agora", "File", "Conversation", "Network", "View", "Help"];

function WindowControls({ electron }) {
  const [hover, setHover] = useState(null);

  const btnStyle = (key, closeVariant) => ({
    width: 46,
    height: 40,
    border: "none",
    background: hover === key ? (closeVariant ? "#c2352a" : "rgba(0,0,0,0.06)") : "transparent",
    color: hover === key && closeVariant ? "#fff" : "var(--text-strong)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
  });

  return (
    <div style={{ display: "flex", alignSelf: "stretch", WebkitAppRegion: "no-drag" }}>
      <button
        onClick={() => electron?.minimizeWindow()}
        onMouseEnter={() => setHover("min")}
        onMouseLeave={() => setHover(null)}
        title="Minimize"
        style={btnStyle("min")}
      >
        −
      </button>
      <button
        onClick={() => electron?.maximizeWindow()}
        onMouseEnter={() => setHover("max")}
        onMouseLeave={() => setHover(null)}
        title="Maximize"
        style={btnStyle("max")}
      >
        □
      </button>
      <button
        onClick={() => electron?.closeWindow()}
        onMouseEnter={() => setHover("close")}
        onMouseLeave={() => setHover(null)}
        title="Close"
        style={btnStyle("close", true)}
      >
        ×
      </button>
    </div>
  );
}

export default function TitleBar({ title, connected, peerCount, showStatus = true }) {
  const electron = typeof window !== "undefined" ? window.electronAPI : null;

  return (
    <div
      style={{
        flex: "0 0 auto",
        height: 40,
        background: "var(--chrome)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 0 0 14px",
        WebkitAppRegion: "drag",
      }}
    >
      {title ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
      ) : (
        <div style={{ display: "flex", gap: 18, fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>
          {MENU_ITEMS.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      )}

      {/* Right-aligned cluster: status pill (if any) + window controls,
          flush against the true right edge - no gap-causing siblings, no
          margin tricks on the controls themselves. */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, alignSelf: "stretch" }}>
        {showStatus && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "5px 11px",
              borderRadius: 99,
              background: connected ? "var(--surface)" : "#f7e9e4",
              border: `1px solid ${connected ? "var(--border)" : "#efd7cf"}`,
              WebkitAppRegion: "no-drag",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 99, background: connected ? "var(--accent)" : "var(--danger)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: connected ? "var(--text-strong)" : "#7a4034" }}>
              {connected ? `${peerCount} ${peerCount === 1 ? "peer" : "peers"}` : "backend unreachable"}
            </span>
          </div>
        )}
        <WindowControls electron={electron} />
      </div>
    </div>
  );
}
