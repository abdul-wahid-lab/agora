export default function StatusBar({ connected, right }) {
  return (
    <div
      style={{
        flex: "0 0 auto",
        height: 30,
        background: "var(--chrome)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 14px",
        font: '500 11px/1 "IBM Plex Mono", monospace',
        color: "var(--text-muted)",
      }}
    >
      <span style={{ color: connected ? "var(--accent-strong)" : "var(--danger)" }}>
        {connected ? "● LAN-only" : "● no peers"}
      </span>
      <span>mDNS</span>
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}
