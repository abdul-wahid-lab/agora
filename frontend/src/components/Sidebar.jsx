const NAV = [
  { id: "nearby", label: "Nearby" },
  { id: "chats", label: "Chats" },
  { id: "calls", label: "Calls" },
  { id: "files", label: "Files" },
];

export default function Sidebar({ active, onSelect }) {
  return (
    <aside
      style={{
        width: 84,
        flexShrink: 0,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        paddingTop: 20,
      }}
    >
      {NAV.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            style={{
              width: 60,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: "8px 0",
              border: "none",
              background: "none",
              color: isActive ? "var(--accent-strong)" : "var(--text-3)",
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: `1.5px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                background: isActive ? "var(--accent-soft)" : "transparent",
              }}
            />
            <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 500 }}>{item.label}</span>
          </button>
        );
      })}
    </aside>
  );
}
