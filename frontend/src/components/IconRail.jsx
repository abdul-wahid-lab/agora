// Exact icon shapes from the design (10.7 etc.) - each nav item is drawn
// with plain divs, not an icon font/SVG library, matching the source.
const ICONS = {
  nearby: (active) => (
    <span
      style={{
        width: 20,
        height: 20,
        borderRadius: 99,
        border: `2.5px solid ${active ? "var(--accent)" : "var(--icon-muted)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: active ? "var(--accent)" : "var(--icon-muted)" }} />
    </span>
  ),
  chats: (active) => (
    <span style={{ width: 20, height: 18, borderRadius: 6, border: `2.5px solid ${active ? "var(--accent)" : "var(--icon-muted)"}` }} />
  ),
  calls: (active) => (
    <span
      style={{
        width: 19,
        height: 19,
        borderRadius: "6px 6px 6px 2px",
        border: `2.5px solid ${active ? "var(--accent)" : "var(--icon-muted)"}`,
        transform: "rotate(-8deg)",
        display: "inline-block",
      }}
    />
  ),
  files: (active) => (
    <span style={{ width: 19, height: 19, borderRadius: 5, border: `2.5px solid ${active ? "var(--accent)" : "var(--icon-muted)"}` }} />
  ),
};

const NAV = [
  { id: "nearby", label: "Nearby" },
  { id: "chats", label: "Chats" },
  { id: "calls", label: "Calls" },
  { id: "files", label: "Files" },
];

export default function IconRail({ active, onSelect, selfInitial }) {
  return (
    <aside
      style={{
        width: 88,
        flex: "0 0 auto",
        background: "var(--rail)",
        borderRight: "1px solid var(--divider)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "18px 0",
        gap: 8,
      }}
    >
      {NAV.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            style={{
              width: 56,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: "10px 0",
              borderRadius: 14,
              border: isActive ? "1px solid var(--border-soft)" : "1px solid transparent",
              background: isActive ? "var(--surface)" : "transparent",
            }}
          >
            {ICONS[item.id](isActive)}
            <span style={{ fontSize: 10.5, fontWeight: isActive ? 700 : 600, color: isActive ? "var(--accent-strong)" : "var(--text-3)" }}>
              {item.label}
            </span>
          </button>
        );
      })}
      <div
        style={{
          marginTop: "auto",
          width: 40,
          height: 40,
          borderRadius: 99,
          background: "var(--avatar-self)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Instrument Serif, serif",
          fontSize: 18,
          color: "var(--accent-strong)",
        }}
      >
        {selfInitial || "?"}
      </div>
    </aside>
  );
}
