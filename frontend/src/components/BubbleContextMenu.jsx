import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Right-click context menu for a message/file bubble, combining delete and
// forward into one place instead of two separate small hover icons.
// useContextMenu() below wires the open/close state up to a bubble's
// onContextMenu handler; BubbleContextMenu renders the actual menu at the
// click position once open.
export function useContextMenu() {
  const [position, setPosition] = useState(null);
  function openContextMenu(e) {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
  }
  function closeContextMenu() {
    setPosition(null);
  }
  return { menuPosition: position, openContextMenu, closeContextMenu };
}

// candidates: [{ id, name, kind: "peer" | "group" }] or null/undefined to
// omit the forward section entirely (nothing to forward, e.g. a file with
// no local saved_path). onDelete omitted entirely hides the delete section
// too (files have no delete feature at all, only messages do).
export default function BubbleContextMenu({ position, onClose, candidates, onForward, onDelete, canDeleteForEveryone }) {
  const ref = useRef(null);
  const [adjusted, setAdjusted] = useState(position);

  useEffect(() => {
    setAdjusted(position);
  }, [position]);

  // Clamp to the viewport after mount, so a right-click near the window's
  // right/bottom edge doesn't render the menu partly off-screen.
  useLayoutEffect(() => {
    if (!position || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    const x = Math.min(position.x, Math.max(8, maxX));
    const y = Math.min(position.y, Math.max(8, maxY));
    if (x !== position.x || y !== position.y) setAdjusted({ x, y });
  }, [position]);

  useEffect(() => {
    if (!position) return;
    function handlePointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [position, onClose]);

  if (!position || !adjusted) return null;

  const showDelete = Boolean(onDelete);
  const showForward = Boolean(candidates);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: adjusted.y,
        left: adjusted.x,
        zIndex: 100,
        minWidth: 200,
        maxHeight: 320,
        overflowY: "auto",
        borderRadius: 12,
        background: "var(--surface)",
        border: "1px solid var(--border-soft)",
        boxShadow: "var(--shadow)",
        padding: 6,
      }}
    >
      {showDelete && (
        <>
          <button
            onClick={() => {
              onDelete(false);
              onClose();
            }}
            style={menuItemStyle}
          >
            Delete for me
          </button>
          {/* Only ever offered on your own sent message - deleting someone
              else's message for everyone would mean telling them to delete
              something from their own device, not a real feature. */}
          {canDeleteForEveryone && (
            <button
              onClick={() => {
                onDelete(true);
                onClose();
              }}
              style={{ ...menuItemStyle, color: "var(--danger)" }}
            >
              Delete for everyone
            </button>
          )}
          {showForward && <div style={dividerStyle} />}
        </>
      )}
      {showForward && (
        <>
          <div style={{ padding: "4px 10px 6px", font: '600 10px/1 "IBM Plex Mono", monospace', letterSpacing: "0.08em", color: "var(--text-3)" }}>
            FORWARD TO
          </div>
          {candidates.length === 0 && <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--text-3)" }}>Nobody else to forward to yet</div>}
          {candidates.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onForward(c);
                onClose();
              }}
              style={{ ...menuItemStyle, display: "flex", alignItems: "center", gap: 6 }}
            >
              {c.name}
              {c.kind === "group" && (
                <span style={{ font: '600 9px/1 "IBM Plex Mono", monospace', letterSpacing: "0.04em", color: "var(--text-3)" }}>GROUP</span>
              )}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

const menuItemStyle = {
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: 8,
  background: "transparent",
  border: "none",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--text-strong)",
};

const dividerStyle = { height: 1, background: "var(--divider)", margin: "4px 0" };
