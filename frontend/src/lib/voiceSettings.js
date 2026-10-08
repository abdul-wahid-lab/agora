// Local-only voice-message preferences, same pattern as updateSettings.js -
// never synced anywhere, never sent to a peer.
const TRANSCRIBE_ENABLED_KEY = "agora.voiceTranscribeEnabled";
const DEFAULT_SPEED_KEY = "agora.voiceDefaultSpeed";

export function getTranscribeEnabled() {
  try {
    const v = localStorage.getItem(TRANSCRIBE_ENABLED_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setTranscribeEnabled(enabled) {
  try {
    localStorage.setItem(TRANSCRIBE_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // ignore - a preference, not worth crashing over
  }
}

export function getDefaultSpeed() {
  try {
    const v = Number(localStorage.getItem(DEFAULT_SPEED_KEY));
    return [1, 1.5, 2].includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function setDefaultSpeed(speed) {
  try {
    localStorage.setItem(DEFAULT_SPEED_KEY, String(speed));
  } catch {
    // ignore
  }
}
