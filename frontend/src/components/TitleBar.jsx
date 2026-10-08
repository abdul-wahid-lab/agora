import { useEffect, useState } from "react";
import { api } from "../api";
import { paletteAt, SELF_AVATAR_INDEX_KEY } from "../lib/avatar";
import { isPeerMuted, setPeerMuted } from "../lib/mute";
import { isAutoCheckDue, setLastCheckedAt, getUpdateRepo, getAutoInstallEnabled } from "../lib/updateSettings";
import { useIsPeerBlocked } from "../hooks/useIsPeerBlocked";
import DropdownMenu from "./DropdownMenu";
import UpdatesModal from "./UpdatesModal";
import {
  SendFileModal,
  ContactsModal,
  DeviceInfoModal,
  KnownPeersModal,
  DiagnosticsModal,
  ShortcutsModal,
  ModalOverlay,
  MediaLinksDocsModal,
  DisappearingMessagesModal,
  ChatThemeModal,
} from "./TitleBarModals";

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
  leftPanelVisible = true,
  onToggleLeftPanel,
  onToggleFocus,
}) {
  const electron = typeof window !== "undefined" ? window.electronAPI : null;
  const [modal, setModal] = useState(null); // "sendFile" | "contacts" | "deviceInfo" | "knownPeers" | "diagnostics" | "shortcuts" | "updates" | null
  const [knownPeersData, setKnownPeersData] = useState([]);
  const [muteVersion, setMuteVersion] = useState(0);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [blockVersion, setBlockVersion] = useState(0);
  const isPeerBlocked = useIsPeerBlocked(selectedPeer?.peer_id, blockVersion);

  useEffect(() => {
    electron?.getAlwaysOnTop?.().then((v) => setAlwaysOnTop(Boolean(v)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [autoInstallStatus, setAutoInstallStatus] = useState(null); // "downloading" | "installing" | null

  // Opt-in only (see UpdatesModal's own settings section) - off by default,
  // same as every other place in this app that could reach the internet.
  // Re-evaluates hourly against the persisted last-checked timestamp rather
  // than keeping its own long-lived timer, so the right thing happens
  // whether the app's been open five minutes or five days.
  useEffect(() => {
    async function maybeAutoCheck() {
      const repo = getUpdateRepo();
      if (!repo || !isAutoCheckDue()) return;
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
        setLastCheckedAt(Date.now());
        if (!res.ok) return;
        const data = await res.json();
        const latest = (data.tag_name || "").replace(/^v/, "");
        const current = typeof __AGORA_VERSION__ !== "undefined" ? __AGORA_VERSION__ : "dev";
        if (!latest || latest === current) return;

        // Automatically check is one thing; automatically install and
        // restart the app with no click at all is a meaningfully bigger
        // thing to opt into, so it's a second, separate setting - off even
        // when auto-check is on, unless explicitly turned on too.
        const asset = electron?.downloadUpdate && getAutoInstallEnabled()
          ? data.assets?.find((a) => /setup/i.test(a.name) && a.name.endsWith(".exe")) || data.assets?.find((a) => a.name.endsWith(".exe"))
          : null;
        if (!asset) {
          setModal("updates");
          return;
        }
        setAutoInstallStatus("downloading");
        const downloadedPath = await electron.downloadUpdate(asset.browser_download_url, asset.name);
        setAutoInstallStatus("installing");
        // A brief, real pause rather than installing the instant the
        // download finishes - this is still fully automatic (no click
        // anywhere in this path), just not so abrupt that the window
        // vanishes the same instant a progress indicator would have
        // appeared, since the install step quits the app itself.
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await electron.installUpdate(downloadedPath);
      } catch {
        // silent - a background check never surfaces errors, only real news
        setAutoInstallStatus(null);
      }
    }
    maybeAutoCheck();
    const interval = setInterval(maybeAutoCheck, 60 * 60 * 1000);
    return () => clearInterval(interval);
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

  // The real enforcement lives entirely in messaging.py (the one choke
  // point every peer-to-peer channel rides through) - this just records the
  // decision and refreshes the menu's own checked state.
  async function handleToggleBlock() {
    if (!selectedPeer) return;
    if (isPeerBlocked) {
      await api.unblockPeer(selectedPeer.peer_id).catch(() => {});
    } else {
      if (!window.confirm(`Block ${selectedPeer.name}? They won't be able to message, call, or send you files until you unblock them.`)) return;
      await api.blockPeer(selectedPeer.peer_id, selectedPeer.name).catch(() => {});
    }
    setBlockVersion((v) => v + 1);
  }

  async function handleToggleAlwaysOnTop() {
    const next = !alwaysOnTop;
    await electron?.setAlwaysOnTop?.(next);
    setAlwaysOnTop(next);
  }

  function handleCheckUpdates() {
    setModal("updates");
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
    {
      label: "Exit",
      // A real quit, not closeWindow() - that one now hides to the tray
      // icon instead of exiting (see main.cjs's createTray()), so "File >
      // Exit" needs its own distinct path to actually quit the app.
      onClick: () => electron?.quitApp?.(),
      disabled: !electron,
      disabledReason: "Only available in the desktop app",
    },
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
    {
      label: "Media, Links, and Docs",
      onClick: () => setModal("mediaLinksDocs"),
      disabled: !selectedPeer,
      disabledReason: isGroup ? "Not available for groups yet" : "No conversation open",
    },
    {
      label: "Disappearing Messages...",
      onClick: () => setModal("disappearing"),
      disabled: !selectedPeer,
      disabledReason: isGroup ? "Not available for groups yet" : "No conversation open",
    },
    {
      label: "Chat Theme...",
      onClick: () => setModal("chatTheme"),
      disabled: !selectedPeer,
      disabledReason: isGroup ? "Not available for groups yet" : "No conversation open",
    },
    "divider",
    {
      label: isPeerBlocked ? "Unblock Peer" : "Block Peer",
      onClick: handleToggleBlock,
      danger: !isPeerBlocked,
      disabled: !selectedPeer,
      disabledReason: isGroup ? "Block an individual member instead of a whole group" : "No conversation open",
    },
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
    { label: "Toggle Left Panel", onClick: onToggleLeftPanel, checked: leftPanelVisible },
    { label: "Toggle Sidebar", onClick: onToggleSidebar, checked: sidebarVisible },
    { label: "Focus Mode (hide both panels)", onClick: onToggleFocus, checked: !leftPanelVisible && !sidebarVisible },
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

      <RightCluster
        electron={electron}
        showStatus={showStatus}
        connected={connected}
        peerCount={peerCount}
        leftPanelVisible={leftPanelVisible}
        onToggleLeftPanel={onToggleLeftPanel}
        sidebarVisible={sidebarVisible}
        onToggleFocus={onToggleFocus}
        onToggleSidebar={onToggleSidebar}
        // Nearby/Chats are the only tabs that actually have a left list
        // panel or a right InfoSidebar at all - Calls/Files/Settings are
        // single-pane screens with nothing for these to show or hide. The
        // right panel further depends on a real 1:1 conversation actually
        // being open: a group conversation never gets an InfoSidebar (see
        // App.jsx's own render), and neither does Nearby with nothing
        // selected yet (just the radar).
        hasLeftPanel={active === "nearby" || active === "chats"}
        hasRightPanel={(active === "nearby" || active === "chats") && Boolean(selectedPeer) && !selectedGroup}
      />

      {modal === "sendFile" && <SendFileModal candidates={sendFileCandidates} onClose={() => setModal(null)} />}
      {modal === "contacts" && <ContactsModal onClose={() => setModal(null)} />}
      {modal === "deviceInfo" && <DeviceInfoModal me={me} avatar={selfAvatar} onClose={() => setModal(null)} />}
      {modal === "knownPeers" && <KnownPeersModal knownPeers={knownPeersData} onClose={() => setModal(null)} />}
      {modal === "diagnostics" && <DiagnosticsModal peers={peers} onClose={() => setModal(null)} />}
      {modal === "shortcuts" && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === "mediaLinksDocs" && selectedPeer && <MediaLinksDocsModal peerId={selectedPeer.peer_id} peerName={selectedPeer.name} onClose={() => setModal(null)} />}
      {modal === "disappearing" && selectedPeer && <DisappearingMessagesModal peerId={selectedPeer.peer_id} peerName={selectedPeer.name} onClose={() => setModal(null)} />}
      {modal === "chatTheme" && selectedPeer && <ChatThemeModal peerId={selectedPeer.peer_id} onClose={() => setModal(null)} />}
      {modal === "updates" && <UpdatesModal onClose={() => setModal(null)} />}

      {/* Fully-automatic install in progress (see maybeAutoCheck above) -
          not a click-through dialog, just real visibility into something
          that's about to close the app out from under whoever's using it. */}
      {autoInstallStatus && (
        <div
          style={{
            position: "fixed",
            top: 48,
            right: 16,
            zIndex: 1300,
            padding: "10px 16px",
            borderRadius: 12,
            background: "#2a2320",
            color: "#f9f1e8",
            fontSize: 12.5,
            fontWeight: 600,
            boxShadow: "0 18px 40px rgba(20,14,10,0.35)",
            WebkitAppRegion: "no-drag",
          }}
        >
          {autoInstallStatus === "downloading" ? "Downloading an update…" : "Installing update - Agora will restart shortly…"}
        </div>
      )}
    </div>
  );
}

function RightCluster({ electron, showStatus, connected, peerCount, leftPanelVisible, onToggleLeftPanel, sidebarVisible, onToggleFocus, onToggleSidebar, hasLeftPanel = false, hasRightPanel = false }) {
  const bothHidden = !leftPanelVisible && !sidebarVisible;
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
      {/* Layout switcher: left list panel, a centered focus view with both
          panels hidden, right info sidebar - same three-way idea VS Code's
          own panel-toggle icons use. Only rendered when actually relevant -
          Calls/Files/Settings are single-pane screens with no panel to
          toggle at all, and the right sidebar specifically only ever
          exists for a real 1:1 conversation. onToggleFocus itself hides
          both if either is currently visible, and restores both if both
          are already hidden, so it's a real toggle rather than a one-way
          action with no way back except re-showing each side individually. */}
      {(hasLeftPanel || hasRightPanel) && (
        <div style={{ display: "flex", alignItems: "center", gap: 2, WebkitAppRegion: "no-drag" }}>
          {hasLeftPanel && (
            <LayoutToggleButton title="Toggle left panel" active={leftPanelVisible} onClick={onToggleLeftPanel}>
              <PanelIcon side="left" active={leftPanelVisible} />
            </LayoutToggleButton>
          )}
          {hasLeftPanel && hasRightPanel && (
            <LayoutToggleButton title="Focus mode (hide both panels)" active={bothHidden} onClick={onToggleFocus}>
              <FocusIcon active={bothHidden} />
            </LayoutToggleButton>
          )}
          {hasRightPanel && (
            <LayoutToggleButton title="Toggle info sidebar" active={sidebarVisible} onClick={onToggleSidebar}>
              <PanelIcon side="right" active={sidebarVisible} />
            </LayoutToggleButton>
          )}
        </div>
      )}
      <WindowControls electron={electron} />
    </div>
  );
}

function LayoutToggleButton({ title, active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        border: "none",
        background: active ? "var(--surface-2)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function PanelIcon({ side, active }) {
  const color = active ? "var(--text-strong)" : "var(--icon-muted)";
  // A rounded outer frame with a vertical divider roughly a third of the
  // way in, the shaded side filled to show which panel this button
  // represents - left-shaded for the left list panel, right-shaded (just
  // the same icon mirrored) for the right info sidebar.
  const dividerX = side === "left" ? 6.5 : 11.5;
  const fillRectX = side === "left" ? 2 : dividerX;
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2.5" stroke={color} strokeWidth="1.4" />
      <rect x={fillRectX} y="3.7" width={dividerX - 2} height="10.6" rx="1" fill={color} opacity={0.35} />
      <line x1={dividerX} y1="3" x2={dividerX} y2="15" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

function FocusIcon({ active }) {
  const color = active ? "var(--text-strong)" : "var(--icon-muted)";
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2.5" stroke={color} strokeWidth="1.4" />
      <rect x="5.5" y="6.2" width="7" height="5.6" rx="1" fill={color} />
    </svg>
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
