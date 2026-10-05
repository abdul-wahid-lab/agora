import { useRef, useEffect } from "react";
import { api } from "../api";

// Inline playback for a video that's already downloaded (saved_path
// exists), the video equivalent of ImagePreview's inline photo. Different
// mechanism on purpose: ImagePreview reads the whole file through Electron
// IPC into one data: URI, which is fine for a photo (capped at 15MB there)
// but would mean base64-inflating and holding an entire video in memory at
// once, no real seeking until the whole thing finishes loading. A <video>
// element pointed straight at the local API's own GET /files/{id}/raw
// (backend/app/api.py) gets real HTTP Range support for free - Chromium's
// native media loader streams and seeks it like any other video URL,
// nothing this app has to implement itself.
export default function VideoPreview({ transferId, filename, onFail }) {
  const videoRef = useRef(null);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    function handleError() {
      onFailRef.current?.();
    }
    el.addEventListener("error", handleError);
    return () => el.removeEventListener("error", handleError);
  }, []);

  return (
    <video
      ref={videoRef}
      controls
      preload="metadata"
      src={api.fileRawUrl(transferId)}
      aria-label={filename}
      style={{ display: "block", maxWidth: 280, maxHeight: 280, borderRadius: 12, background: "#1c1512" }}
    />
  );
}
