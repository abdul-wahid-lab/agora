import { useEffect, useState } from "react";
import { api } from "../api";
import { paletteAt, SELF_AVATAR_INDEX_KEY } from "../lib/avatar";
import { isPeerMuted, setPeerMuted } from "../lib/mute";
import DropdownMenu from "./DropdownMenu";
import { SendFileModal, ContactsModal, DeviceInfoModal, KnownPeersModal, DiagnosticsModal, ShortcutsModal, ModalOverlay } from "./TitleBarModals";

function WindowControls({ electron }) {
  const [hover, setHover] = useState(null);

  const btnStyle = (key, closeVariant) => ({
    width: 46,
    height: 40,
    border: "none",
    background: hover === key ? (closeVariant ? "#c2352a" : "rgba(0,0,0,0.06)") : "transparent",
    color: hover === key && closeVariant ? "#fff" : "var(--text-strong)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    lineHeight: 1,
    flexShrink: 0,
  });

  return (
    <div style={{ display: "flex", alignSelf: "stretch", WebkitAppRegion: "no-drag" }}>
      <button
        onClick={() => electron?.minimizeWindow()}
        onMouseEnter={() => setHover("min")}
        onMouseLeave={() => setHover(null)}
        title="Minimize"
        style={btnStyle("min")}
      >
        −
      </button>
      <button
        onClick={() => electron?.maximizeWindow()}
        onMouseEnter={() => setHover("max")}
        onMouseLeave={() => setHover(null)}
        title="Maximize"
        style={btnStyle("max")}
      >
        □
      </button>
      <button
        onClick={() => electron?.closeWindow()}
        onMouseEnter={() => setHover("close")}
        onMouseLeave={() => setHover(null)}
        title="Close"
        style={btnStyle("close", true)}
      >
        ×
      </button>
    </div>
  );
}

// Real menu bar: File/Conversation/Network/View/Help, each wired to either
// an already-existing app feature (just given a new entry point here) or a
// small genuinely-new-but-real action - see TASK_QUEUE.md's own menu-bar
// entry for the full real-vs-new breakdown this was built from. Disabled
// items always carry a real reason via `disabledReason`, never a silent
// no-op.
export default function TitleBar({
  title,
  connected,
  peerCount,
  showStatus = true,
  me,
  peers = [],
  conversations = [],
  active,
  onSelectTab,
  selectedPeer,
  selectedGroup,
  onRescan,
  onNewGroup,
  onToggleConversationSearch,
  onExportConversation,
  onFilterCallsByPeer,
  sidebarVisible = true,
  onToggleSidebar,
}) {
  const electron = typeof window !== "undefined" ? window.electronAPI : null;
  const [modal, setModal] = useState(null); // "sendFile" | "contacts" | "deviceInfo" | "knownPeers" | "diagnostics" | "shortcuts" | "updates" | null
  const [knownPeersData, setKnownPeersData] = useState([]);
  const [muteVersion, setMuteVersion] = useState(0);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");

  useEffect(() => {
    electron?.getAlwaysOnTop?.().then((v) => setAlwaysOnTop(Boolean(v)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (title) {
    return (
      <div style={titleBarBaseStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
        <RightCluster electron={electron} showStatus={showStatus} connected={connected} peerCount={peerCount} />
      </div>
    );
  }

  const hasConversation = Boolean(selectedPeer || selectedGroup);
  const isGroup = Boolean(selectedGroup) && !selectedPeer;
  const peerMuted = selectedPeer ? isPeerMuted(selectedPeer.peer_id) : false;

  // Same forward-candidate merge ConversationPane/GroupConversationPane use:
  // anyone with real conversation history, plus anyone currently live,
  // deduped, since sending already queues for an offline target the same
  // way a normal composer send does.
  const sendFileCandidates = (() => {
    const map = new Map();
    for (const c of conversations) map.set(c.peer_id, { peer_id: c.peer_id, name: c.name || "Unknown" });
    for (const p of peers) map.set(p.peer_id, { peer_id: p.peer_id, name: p.name });
    return [...map.values()];
  })();

  async function handleClearAllHistory() {
    if (!window.confirm("Clear all local chat history across every conversation? This can't be undone.")) return;
    const list = await api.conversations().catch(() => []);
    await Promise.all(list.map((c) => api.clearConversation(c.peer_id).catch(() => {})));
  }

  async function handleClearChat() {
    if (!selectedPeer) return;
    if (!window.confirm(`Clear your entire chat history with ${selectedPeer.name}? This only clears it on this device, it can't be undone.`)) return;
    await api.clearConversation(selectedPeer.peer_id).catch(() => {});
  }

  function handleToggleMute() {
    if (!selectedPeer) return;
    setPeerMuted(selectedPeer.peer_id, !peerMuted);
    setMuteVersion((v) => v + 1);
  }

  async function handleToggleAlwaysOnTop() {
    const next = !alwaysOnTop;
    await electron?.setAlwaysOnTop?.(next);
    setAlwaysOnTop(next);
  }

  async function handleCheckUpdates() {
    setModal("updates");
    setUpdateStatus("Checking...");
    try {
      const res = await fetch("https://api.github.com/repos/abdul-wahid-lab/agora/releases/latest");
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      const latest = (data.tag_name || "").replace(/^v/, "");
      const current = typeof __AGORA_VERSION__ !== "undefined" ? __AGORA_VERSION__ : "dev";
      if (latest && latest !== current) {
        setUpdateStatus(`A newer version (${latest}) is available. You're on ${current}. Visit the GitHub releases page to download it.`);
      } else {
        setUpdateStatus(`You're on the latest version (${current}).`);
      }
    } catch {
      setUpdateStatus("Couldn't check for updates right now (no internet, or GitHub is unreachable). Agora works fully offline either way.");
    }
  }

  const avatarIndex = Number(localStorage.getItem(SELF_AVATAR_INDEX_KEY)) || 0;
  const selfAvatar = paletteAt(avatarIndex);

  const fileItems = [
    { label: "New Group...", onClick: () => { onSelectTab("chats"); onNewGroup?.(); } },
    { label: "Send File...", onClick: () => setModal("sendFile") },
    "divider",
    {
      label: "Open Received Files Folder",
      onClick: () => electron?.openDownloadsFolder?.(),
      disabled: !electron?.openDownloadsFolder,
      disabledReason: "Only available in the desktop app",
    },
    { label: "Import/Export Contacts...", onClick: () => setModal("contacts") },
    "divider",
    { label: "Preferences...", onClick: () => onSelectTab("settings") },
    { label: "Clear All History", onClick: handleClearAllHistory, danger: true },
    "divider",
    { label: "Exit", onClick: () => electron?.closeWindow?.(), disabled: !electron, disabledReason: "Only available in the desktop app" },
  ];

  const conversationItems = [
    { label: "Search in Conversation...", onClick: onToggleConversationSearch, disabled: !hasConversation, disabledReason: "No conversation open" },
    {
      label: "Clear Chat History",
      onClick: handleClearChat,
      danger: true,
      disabled: !selectedPeer,
      disabledReason: isGroup ? "Not available for groups yet" : "No conversation open",
    },
    { label: "Export Conversation...", onClick: onExportConversation, disabled: !hasConversation, disabledReason: "No conversation open" },
    "divider",
    {
      label: "Mute Notifications for this Conversation",
      onClick: handleToggleMute,
      checked: peerMuted,
      disabled: !selectedPeer,
      disabledReason: isGroup ? "Not available for groups yet" : "No conversation open",
    },
    {
      label: "View Call History with this Peer",
      onClick: () => onFilterCallsByPeer(selectedPeer.peer_id),
      disabled: !selectedPeer,
      disabledReason: isGroup ? "Calls aren't tracked per group" : "No conversation open",
    },
    "divider",
    { label: "Block Peer", disabled: true, disabledReason: "Not built yet - queued for later, see TASK_QUEUE.md" },
  ];

  const networkItems = [
    { label: "Rescan for Peers", onClick: () => { onSelectTab("nearby"); onRescan?.(); } },
    { label: "My Device Info", onClick: () => setModal("deviceInfo") },
    {
      label: "Known Peers",
      onClick: async () => {
        const kp = await api.knownPeers().catch(() => []);
        setKnownPeersData(kp);
        setModal("knownPeers");
      },
    },
    { label: "Change Display Name / Avatar", onClick: () => onSelectTab("settings") },
    { label: "Network Diagnostics...", onClick: () => setModal("diagnostics") },
  ];

  const viewItems = [
    { label: "Nearby", onClick: () => onSelectTab("nearby"), shortcut: "Ctrl+1", checked: active === "nearby" },
    { label: "Chats", onClick: () => onSelectTab("chats"), shortcut: "Ctrl+2", checked: active === "chats" },
    { label: "Calls", onClick: () => onSelectTab("calls"), shortcut: "Ctrl+3", checked: active === "calls" },
    { label: "Files", onClick: () => onSelectTab("files"), shortcut: "Ctrl+4", checked: active === "files" },
    "divider",
    { label: "Toggle Sidebar", onClick: onToggleSidebar, checked: sidebarVisible },
    "divider",
    { label: "Zoom In", onClick: () => electron?.zoomIn?.(), shortcut: "Ctrl+=", disabled: !electron, disabledReason: "Only available in the desktop app" },
    { label: "Zoom Out", onClick: () => electron?.zoomOut?.(), shortcut: "Ctrl+-", disabled: !electron, disabledReason: "Only available in the desktop app" },
    { label: "Reset Zoom", onClick: () => electron?.zoomReset?.(), shortcut: "Ctrl+0", disabled: !electron, disabledReason: "Only available in the desktop app" },
    "divider",
    { label: "Always on Top", onClick: handleToggleAlwaysOnTop, checked: alwaysOnTop, disabled: !electron, disabledReason: "Only available in the desktop app" },
  ];

  const helpItems = [
    { label: "About Agora", onClick: () => onSelectTab("settings") },
    { label: "View on GitHub", onClick: () => (electron?.openExternal ? electron.openExternal("https://github.com/abdul-wahid-lab/agora") : window.open("https://github.com/abdul-wahid-lab/agora", "_blank")) },
    { label: "Report an Issue", onClick: () => (electron?.openExternal ? electron.openExternal("https://github.com/abdul-wahid-lab/agora/issues") : window.open("https://github.com/abdul-wahid-lab/agora/issues", "_blank")) },
    "divider",
    { label: "Keyboard Shortcuts...", onClick: () => setModal("shortcuts") },
    { label: "Check for Updates...", onClick: handleCheckUpdates },
  ];

  return (
    <div style={titleBarBaseStyle}>
      {/* Relative path, not "/logo.png" - the packaged app loads index.html
          via file://, where an absolute root path resolves to the real
          filesystem root, not this app's own dist folder. Matches
          vite.config.js's own base: "./" already used for JS/CSS assets. */}
      <img src="./logo.png" alt="Agora" style={{ height: 22, width: 22, objectFit: "contain", flexShrink: 0, marginRight: 4 }} />
      <div style={{ display: "flex", gap: 18, fontSize: 13, color: "var(--text-strong)", fontWeight: 500 }}>
        <DropdownMenu label="File" items={fileItems} />
        <DropdownMenu label="Conversation" items={conversationItems} />
        <DropdownMenu label="Network" items={networkItems} />
        <DropdownMenu label="View" items={viewItems} />
        <DropdownMenu label="Help" items={helpItems} />
      </div>

      <RightCluster electron={electron} showStatus={showStatus} connected={connected} peerCount={peerCount} />

      {modal === "sendFile" && <SendFileModal candidates={sendFileCandidates} onClose={() => setModal(null)} />}
      {modal === "contacts" && <ContactsModal onClose={() => setModal(null)} />}
      {modal === "deviceInfo" && <DeviceInfoModal me={me} avatar={selfAvatar} onClose={() => setModal(null)} />}
      {modal === "knownPeers" && <KnownPeersModal knownPeers={knownPeersData} onClose={() => setModal(null)} />}
      {modal === "diagnostics" && <DiagnosticsModal peers={peers} onClose={() => setModal(null)} />}
      {modal === "shortcuts" && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === "updates" && (
        <ModalOverlay title="Check for Updates" onClose={() => setModal(null)} width={380}>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{updateStatus}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>This is the only thing in Agora that ever talks to the internet, and only when you click this yourself - never automatic, never in the background.</div>
        </ModalOverlay>
      )}
    </div>
  );
}

function RightCluster({ electron, showStatus, connected, peerCount }) {
  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, alignSelf: "stretch" }}>
      {showStatus && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "5px 11px",
            borderRadius: 99,
            background: connected ? "var(--surface)" : "#f7e9e4",
            border: `1px solid ${connected ? "var(--border)" : "#efd7cf"}`,
            WebkitAppRegion: "no-drag",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: connected ? "var(--accent)" : "var(--danger)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: connected ? "var(--text-strong)" : "#7a4034" }}>
            {connected ? `${peerCount} ${peerCount === 1 ? "peer" : "peers"}` : "backend unreachable"}
          </span>
        </div>
      )}
      <WindowControls electron={electron} />
    </div>
  );
}

const titleBarBaseStyle = {
  flex: "0 0 auto",
  height: 40,
  background: "var(--chrome)",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  padding: "0 0 0 14px",
  WebkitAppRegion: "drag",
  gap: 18,
};
