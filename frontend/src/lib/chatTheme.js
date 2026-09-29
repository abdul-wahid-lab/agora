// Per-conversation color theme. Local-only, like mute/avatar-color: never
// synced to the peer, purely a "how this looks on my screen" choice.
const THEME_KEY_PREFIX = "agora.chatTheme.";

// Warm palette consistent with the app's own design language (terracotta
// default plus a handful of real, distinct alternatives) - not an arbitrary
// color wheel, matching the same restrained palette approach avatar.js uses.
export const CHAT_THEME_COLORS = [
  { id: "default", label: "Default", bg: "#e2703a", text: "#fff8f2" },
  { id: "forest", label: "Forest", bg: "#5c7a5a", text: "#f4f9f2" },
  { id: "plum", label: "Plum", bg: "#8a5c7a", text: "#faf2f7" },
  { id: "ocean", label: "Ocean", bg: "#3f6f82", text: "#f0f8fb" },
  { id: "amber", label: "Amber", bg: "#a67c2e", text: "#fdf6e8" },
];

export function getChatTheme(peerId) {
  try {
    const id = localStorage.getItem(THEME_KEY_PREFIX + peerId);
    return CHAT_THEME_COLORS.find((c) => c.id === id) || CHAT_THEME_COLORS[0];
  } catch {
    return CHAT_THEME_COLORS[0];
  }
}

export function setChatTheme(peerId, themeId) {
  try {
    if (themeId === "default") localStorage.removeItem(THEME_KEY_PREFIX + peerId);
    else localStorage.setItem(THEME_KEY_PREFIX + peerId, themeId);
  } catch {
    // convenience only, fine to no-op if storage is unavailable
  }
}
