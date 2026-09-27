// Exact bg/text pairs from the design file's peer avatars (screens 10.7,
// 1.4a) - each peer gets a background + a text color specifically tuned to
// sit on it, not just one hue with generic dark text.
const AVATAR_PALETTE = [
  { bg: "#d8e0d2", text: "#4c5a46" }, // green
  { bg: "#e6d6ea", text: "#5c4a63" }, // purple
  { bg: "#f0e2c8", text: "#6b5a34" }, // yellow/tan
  { bg: "#ead9c9", text: "#8a6a4a" }, // warm tan (also used for groups)
];

export function paletteFor(peerId) {
  let hash = 0;
  for (const ch of peerId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// Used for the *local* device's own self-avatar (onboarding preview,
// IconRail's bottom bubble), which - unlike paletteFor - isn't derived from
// an identity, it's a plain user choice. Note this can only ever change how
// you see your own avatar in your own app: other peers derive your color by
// calling paletteFor on your peer_id themselves, which this never touches.
export const AVATAR_PALETTE_SIZE = AVATAR_PALETTE.length;
export const SELF_AVATAR_INDEX_KEY = "agora.avatarIndex";
export function paletteAt(index) {
  return AVATAR_PALETTE[((index % AVATAR_PALETTE.length) + AVATAR_PALETTE.length) % AVATAR_PALETTE.length];
}

export function colorFor(peerId) {
  return paletteFor(peerId).bg;
}

export function initials(name) {
  const parts = name.trim().split(/[\s-]+/);
  return (parts[0]?.[0] || "?" + (parts[1]?.[0] || "")).slice(0, 2).toUpperCase();
}
