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
