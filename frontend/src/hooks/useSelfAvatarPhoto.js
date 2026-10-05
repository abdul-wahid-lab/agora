import { useEffect, useState } from "react";
import { api } from "../api";

// The self-avatar photo (if any) lives on disk in Electron's userData
// directory, managed entirely by main.cjs's profile:getAvatarPhoto/
// setAvatarPhoto/clearAvatarPhoto - not localStorage, a real photo can
// easily exceed localStorage's ~5-10MB per-origin quota. Every screen that
// shows your own avatar (Onboarding, IconRail, SettingsScreen) uses this
// same hook so they all agree on the current photo without each doing its
// own IPC round-trip, and `setPhoto` lets a caller update local state
// immediately after picking/removing one instead of waiting on a second
// fetch.
export function useSelfAvatarPhoto() {
  const [photo, setPhoto] = useState(null);
  const hasElectron = Boolean(window.electronAPI?.getAvatarPhoto);

  useEffect(() => {
    if (!hasElectron) return;
    let cancelled = false;
    window.electronAPI.getAvatarPhoto().then((dataUrl) => {
      if (cancelled) return;
      setPhoto(dataUrl);
      // One-time bootstrap for an install that already had a photo set
      // before the backend ever learned to serve one to peers (see
      // backend/app/photos.py) - harmless, idempotent to repeat on every
      // launch otherwise, since the backend just overwrites its own copy
      // with the same bytes.
      if (dataUrl) api.setMyPhoto(dataUrl).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [hasElectron]);

  return { photo, setPhoto, hasElectron };
}
