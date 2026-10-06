const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

export function isImageFile(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return IMAGE_EXTS.has(ext);
}

const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "webm", "avi"]);

export function isVideoFile(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return VIDEO_EXTS.has(ext);
}

// A voice note recorded via MediaRecorder is, on Chromium (and therefore
// Electron), always a .webm container regardless of whether the stream is
// audio-only - the exact same extension VIDEO_EXTS above already claims
// for real video files. Rather than guessing from the container, every
// voice note this app sends uses this one exact, fixed filename (see
// api.py's send_voice_message), checked before isVideoFile anywhere a
// message bubble decides how to render a file - a deliberate choice over
// adding a real "kind" column to the files table just to disambiguate one
// feature's own output.
export const VOICE_MESSAGE_FILENAME = "Voice message.webm";

export function isVoiceMessage(filename) {
  return filename === VOICE_MESSAGE_FILENAME;
}

export const EXECUTABLE_EXTS = new Set(["apk", "exe", "msi", "bat", "cmd", "com", "sh", "jar", "appimage", "ps1"]);

export function isExecutableFile(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return EXECUTABLE_EXTS.has(ext);
}

const EXT_STYLE = {
  pdf: { bg: "#f3e8dd", text: "#c2562a" },
  apk: { bg: "#e8eee4", text: "#4c6b43" },
  zip: { bg: "#fbe9d7", text: "#b07a2a" },
  mov: { bg: "#f6dcc7", text: "#b04a1f" },
  mp4: { bg: "#f6dcc7", text: "#b04a1f" },
  doc: { bg: "#f5efe7", text: "#8a7f76" },
  docx: { bg: "#f5efe7", text: "#8a7f76" },
};

export function extStyle(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return EXT_STYLE[ext] || { bg: "#f5efe7", text: "#8a7f76" };
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
