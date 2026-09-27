import { useEffect, useRef, useState } from "react";

// WhatsApp-style inline thumbnail + tap-to-view, for a file that's already
// downloaded (saved_path exists). Reads the bytes through main.cjs's
// file:readImageDataUrl IPC handler as a data: URI - not a raw file://
// src, Chromium's default webSecurity (on, not disabled anywhere in this
// app) blocks a renderer loading file:// resources directly. Renders
// nothing (parent falls back to the generic extension-badge icon) when
// there's no electronAPI (plain browser dev mode) or the read fails/is
// too large, real absence over a broken image icon.
const hasReader = Boolean(window.electronAPI?.readImageDataUrl);

export default function ImagePreview({ filePath, filename, onFail }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [failed, setFailed] = useState(!hasReader);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!hasReader) return;
    let cancelled = false;
    window.electronAPI
      .readImageDataUrl(filePath)
      .then((url) => {
        if (cancelled) return;
        if (url) setDataUrl(url);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Lets the parent (FileBubble) fall back to the generic icon row instead
  // of leaving a blank gap where the thumbnail should be - a real read
  // failure (oversized file, unreadable path) shouldn't look like a
  // missing image, it should just look like every other file type. A ref
  // (rather than listing onFail as a dependency) avoids re-firing this on
  // every render just because the parent passes a fresh inline callback.
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  useEffect(() => {
    if (failed) onFailRef.current?.();
  }, [failed]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e) => e.key === "Escape" && setLightboxOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  if (failed || !dataUrl) return null;

  return (
    <>
      <img
        src={dataUrl}
        alt={filename}
        onClick={() => setLightboxOpen(true)}
        style={{ display: "block", maxWidth: 260, maxHeight: 260, borderRadius: 12, cursor: "zoom-in", objectFit: "cover" }}
      />
      {lightboxOpen && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(20,14,10,0.86)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
        >
          <img src={dataUrl} alt={filename} style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, boxShadow: "0 30px 70px rgba(0,0,0,0.5)" }} />
          <button
            onClick={() => setLightboxOpen(false)}
            style={{ position: "absolute", top: 22, right: 26, width: 38, height: 38, borderRadius: 99, background: "rgba(255,255,255,0.12)", border: "none", color: "#fff8f2", fontSize: 18 }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
