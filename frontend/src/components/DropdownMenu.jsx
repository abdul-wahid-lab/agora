import { useEffect, useRef, useState } from "react";

// Generic top-menu-bar dropdown, shared by every menu in TitleBar.jsx (File,
// Conversation, Network, View, Help). One real item shape:
//   { label, onClick, disabled, disabledReason, danger, checked, shortcut }
// or the literal string "divider" for a plain separator line.
export default function DropdownMenu({ label, items, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", WebkitAppRegion: "no-drag" }}>
      <span
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.35 : 1,
          padding: "10px 0",
          userSelect: "none",
        }}
      >
        {label}
      </span>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 34,
            left: 0,
            zIndex: 200,
            minWidth: 250,
            maxHeight: 420,
            overflowY: "auto",
            borderRadius: 10,
            background: "var(--surface)",
            border: "1px solid var(--border-soft)",
            boxShadow: "var(--shadow)",
            padding: 6,
          }}
        >
          {items.map((item, i) =>
            item === "divider" ? (
              <div key={`divider-${i}`} style={{ height: 1, background: "var(--divider)", margin: "5px 4px" }} />
            ) : (
              <button
                key={item.label}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onClick?.();
                }}
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason : undefined}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 7,
                  background: "transparent",
                  border: "none",
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: item.disabled ? "var(--text-3)" : item.danger ? "var(--danger)" : "var(--text-strong)",
                  cursor: item.disabled ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {item.checked !== undefined && <span style={{ width: 14, display: "inline-block" }}>{item.checked ? "✓" : ""}</span>}
                  {item.label}
                </span>
                {item.shortcut && (
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", flexShrink: 0 }}>
                    {item.shortcut}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
