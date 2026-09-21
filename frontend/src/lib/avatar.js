const AVATAR_COLORS = ["#c8dcc4", "#e3cfe8", "#f0d9b5", "#c9dce8", "#e8c9c9"];

export function colorFor(peerId) {
  let hash = 0;
  for (const ch of peerId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(name) {
  const parts = name.trim().split(/[\s-]+/);
  return (parts[0]?.[0] || "?" + (parts[1]?.[0] || "")).slice(0, 2).toUpperCase();
}
