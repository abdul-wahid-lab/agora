import { useState } from "react";

// "Open" launches the file with whatever the OS has registered for its
// type (same as double-clicking it in Explorer); "Save a copy…" is the
// WhatsApp-style "let me put this wherever I actually want it" action -
// Agora always downloads into its own per-device folder first (the accept/
// resume flow needs one predictable write target), so this just copies the
// already-downloaded file out to wherever the user picks. Renders nothing
// outside Electron (no window.electronAPI in a plain browser dev tab).
export default function FileOpenActions({ file }) {
  const [error, setError] = useState("");
  if (!window.electronAPI?.openFile) return null;

  async function handleOpen() {
    setError("");
    const result = await window.electronAPI.openFile(file.saved_path);
    if (result) setError("Couldn't open that file");
  }

  async function handleSaveAs() {
    setError("");
    try {
      await window.electronAPI.saveFileAs(file.saved_path, file.filename);
    } catch {
      setError("Couldn't save a copy");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleOpen} style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: "var(--accent)", border: "none", color: "#fff8f2", fontSize: 12.5, fontWeight: 700 }}>
          Open
        </button>
        <button onClick={handleSaveAs} style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600 }}>
          Save a copy…
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}
