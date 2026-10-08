import { paletteAt, SELF_AVATAR_INDEX_KEY } from "../lib/avatar";
import { useSelfAvatarPhoto } from "../hooks/useSelfAvatarPhoto";

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
  transfers: (active) => (
    <span
      style={{
        width: 18,
        height: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: `9px solid ${active ? "var(--accent)" : "var(--icon-muted)"}`,
          transform: "rotate(180deg)",
        }}
      />
    </span>
  ),
};

const NAV = [
  { id: "nearby", label: "Nearby" },
  { id: "chats", label: "Chats" },
  { id: "calls", label: "Calls" },
  { id: "files", label: "Files" },
  { id: "transfers", label: "Transfers" },
];

export default function IconRail({ active, onSelect, selfInitial }) {
  // Only overrides the color for people who onboarded after "Shuffle
  // avatar" was wired up (i.e. the key actually exists) - anyone who
  // onboarded before this keeps the original fixed tan color unchanged,
  // since they were never given a choice to save.
  const storedAvatarIndex = localStorage.getItem(SELF_AVATAR_INDEX_KEY);
  const selfAvatar = storedAvatarIndex !== null ? paletteAt(Number(storedAvatarIndex)) : { bg: "var(--avatar-self)", text: "var(--accent-strong)" };
  const { photo: selfPhoto } = useSelfAvatarPhoto();
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
      <button
        onClick={() => onSelect("settings")}
        title="Settings"
        style={{
          marginTop: "auto",
          width: 40,
          height: 40,
          borderRadius: 99,
          overflow: "hidden",
          background: selfPhoto ? "var(--surface-2)" : selfAvatar.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Instrument Serif, serif",
          fontSize: 18,
          color: selfAvatar.text,
          border: active === "settings" ? "2px solid var(--accent)" : "2px solid transparent",
          padding: 0,
        }}
      >
        {selfPhoto ? <img src={selfPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : selfInitial || "?"}
      </button>
    </aside>
  );
}
