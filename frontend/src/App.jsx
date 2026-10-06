import { useEffect, useRef, useState } from "react";
import TitleBar from "./components/TitleBar";
import IconRail from "./components/IconRail";
import StatusBar from "./components/StatusBar";
import PeerList from "./components/PeerList";
import ChatsListPanel from "./components/ChatsListPanel";
import ConversationPane from "./components/ConversationPane";
import InfoSidebar from "./components/InfoSidebar";
import CallsScreen from "./components/CallsScreen";
import CallOverlay from "./components/CallOverlay";
import FilesScreen from "./components/FilesScreen";
import Onboarding from "./components/Onboarding";
import ScanRadar from "./components/ScanRadar";
import SettingsScreen from "./components/SettingsScreen";
import GroupConversationPane from "./components/GroupConversationPane";
import GroupCallOverlay from "./components/GroupCallOverlay";
import IdentityWarningBanner from "./components/IdentityWarningBanner";
import QrPairingModal from "./components/QrPairingModal";
import { api } from "./api";
import { useCall } from "./hooks/useCall";
import { usePeers } from "./hooks/usePeers";
import { useConversations } from "./hooks/useConversations";
import { useGroups } from "./hooks/useGroups";
import { useGroupCall } from "./hooks/useGroupCall";
import { useIdentityWarnings } from "./hooks/useIdentityWarnings";

const ONBOARDING_KEY = "agora.onboarded";

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDING_KEY) === "1");
  const [active, setActive] = useState("nearby");
  const [selectedPeerId, setSelectedPeerId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  // Nearby's own view state, deliberately separate from selectedPeerId
  // (which Chats also reads, so a peer selected there stays selected if you
  // switch tabs and back) - pressing the Nearby nav icon always resets to
  // the radar view, regardless of whatever peer was last viewed there.
  const [nearbyShowingRadar, setNearbyShowingRadar] = useState(true);
  const [scanOverlayOpen, setScanOverlayOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [peerCount, setPeerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  // Menu-bar-driven state: New Group.../Search in Conversation.../View Call
  // History with this Peer / Toggle Sidebar all need to reach into a screen
  // that isn't necessarily mounted from the menu bar itself.
  const [groupCreationOpen, setGroupCreationOpen] = useState(false);
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [callsPeerFilter, setCallsPeerFilter] = useState(null);
  const [filesPeerFilter, setFilesPeerFilter] = useState(null);
  function handleOpenFilesForPeer(peerId) {
    setFilesPeerFilter(peerId);
    setActive("files");
  }
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // The left list panel (PeerList in Nearby, ChatsListPanel in Chats) - same
  // show/hide idea as the existing right InfoSidebar toggle, just the other
  // side. A third "focus" action hides both at once for a distraction-free
  // view of just the open conversation, and un-hides both again if either
  // was already hidden - a real toggle, not a one-way action.
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  // Real bug, found from a live screenshot at a narrow window width: with
  // PeerList/ChatsListPanel fixed at 300px and InfoSidebar fixed at 248px,
  // a narrow enough window leaves the center conversation column only a
  // few pixels wide - not just cramped, but bad enough that message text
  // wraps one character per line and the layout is actually unusable, not
  // just ugly. The manual panel-toggle buttons already existed for
  // deliberately freeing up space, but nothing made that happen
  // automatically, so a window narrowed by simply dragging its edge (no
  // deliberate toggle click involved) broke outright.
  //
  // Thresholds leave enough room for the center pane to stay genuinely
  // usable at each step: below 1000px there isn't room for both side
  // panels plus a comfortable center column, so the right info sidebar
  // (less essential than the conversation itself) goes first; below
  // 700px even just the left list panel alongside the nav rail doesn't
  // leave enough, so that goes too, down to just the rail and the
  // conversation.
  //
  // Only ever auto-hides a panel that's currently visible, and only ever
  // auto-restores one *this same logic* hid - a manual toggle-button
  // click (still available at any width) marks its ref false, so this
  // never fights a deliberate manual hide by restoring it again, and
  // never fights a manual show by immediately re-hiding it on the next
  // resize tick.
  const autoHiddenSidebarRef = useRef(false);
  const autoHiddenLeftRef = useRef(false);

  useEffect(() => {
    function applyForWidth() {
      const w = window.innerWidth;
      setSidebarVisible((prev) => {
        if (w < 1000 && prev) {
          autoHiddenSidebarRef.current = true;
          return false;
        }
        if (w >= 1000 && !prev && autoHiddenSidebarRef.current) {
          autoHiddenSidebarRef.current = false;
          return true;
        }
        return prev;
      });
      setLeftPanelVisible((prev) => {
        if (w < 700 && prev) {
          autoHiddenLeftRef.current = true;
          return false;
        }
        if (w >= 700 && !prev && autoHiddenLeftRef.current) {
          autoHiddenLeftRef.current = false;
          return true;
        }
        return prev;
      });
    }
    applyForWidth();
    window.addEventListener("resize", applyForWidth);
    return () => window.removeEventListener("resize", applyForWidth);
  }, []);

  function handleToggleFocus() {
    const bothVisible = leftPanelVisible && sidebarVisible;
    autoHiddenSidebarRef.current = false;
    autoHiddenLeftRef.current = false;
    setLeftPanelVisible(!bothVisible);
    setSidebarVisible(!bothVisible);
  }
  const { peers, refreshing: rescanning, refresh: rescan } = usePeers();
  const conversations = useConversations();
  const groups = useGroups();
  const {
    groupCall,
    incomingGroupCall,
    muted: groupMuted,
    cameraOff: groupCameraOff,
    sharingScreen: groupSharingScreen,
    startGroupCall,
    joinIncomingGroupCall,
    declineIncomingGroupCall,
    hangUpGroupCall,
    toggleMute: toggleGroupMute,
    toggleCamera: toggleGroupCamera,
    startGroupScreenShare,
    stopGroupScreenShare,
    registerVideoRef,
  } = useGroupCall(me?.peer_id);
  const {
    call,
    error: callError,
    elapsed,
    muted,
    cameraOff,
    sharingScreen,
    remoteSharingScreen,
    awaitingShareAccept,
    incomingShareRequest,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    remoteScreenVideoRef,
    placeCall,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    toggleCamera,
    startScreenShare,
    cancelScreenShareRequest,
    acceptScreenShareRequest,
    declineScreenShareRequest,
    stopScreenShare,
  } = useCall();
  const { warnings: identityWarnings, dismiss: dismissIdentityWarning } = useIdentityWarnings();

  async function finishOnboarding(chosenName) {
    localStorage.setItem("agora.chosenName", chosenName);
    localStorage.setItem(ONBOARDING_KEY, "1");
    // Persists the name and restarts the backend under it (see main.cjs's
    // device:setName) so peers actually see the name just typed here,
    // instead of the OS username the backend started with by default. A
    // no-op in a plain browser tab (no window.electronAPI there).
    await window.electronAPI?.setDeviceName?.(chosenName);
    setOnboarded(true);
  }

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [meData, peers] = await Promise.all([api.me(), api.peers()]);
        if (cancelled) return;
        setMe(meData);
        setPeerCount(peers.length);
        setConnected(true);
      } catch {
        if (!cancelled) setConnected(false);
      }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // View menu's real keybindings (Ctrl+1..4 tab switching, Ctrl+=/-/0 zoom).
  // Defined with the raw state setters rather than calling handleSelectTab
  // (declared further down, after the onboarding early-return) so this can
  // stay a plain top-level hook, same rule every other hook here follows.
  useEffect(() => {
    function handleKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "1") {
        e.preventDefault();
        setActive("nearby");
        setNearbyShowingRadar(true);
      } else if (e.key === "2") {
        e.preventDefault();
        setActive("chats");
      } else if (e.key === "3") {
        e.preventDefault();
        setActive("calls");
      } else if (e.key === "4") {
        e.preventDefault();
        setActive("files");
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        window.electronAPI?.zoomIn?.();
      } else if (e.key === "-") {
        e.preventDefault();
        window.electronAPI?.zoomOut?.();
      } else if (e.key === "0") {
        e.preventDefault();
        window.electronAPI?.zoomReset?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!onboarded) {
    return <Onboarding onComplete={finishOnboarding} />;
  }

  // A peer with chat history isn't necessarily online right now - discovery's
  // live list (`peers`) forgets someone the instant they drop off the LAN,
  // but their conversation and its history are still sitting in local
  // storage and should stay openable. Fall back to a synthetic peer object
  // (built from the conversation's own persisted name, see storage.py's
  // known_peers table) so ConversationPane always has something to render
  // instead of silently refusing to open at all.
  const livePeer = peers.find((p) => p.peer_id === selectedPeerId) || null;
  const offlineConversation = !livePeer && selectedPeerId ? conversations.find((c) => c.peer_id === selectedPeerId) : null;
  const selectedPeer = livePeer || (offlineConversation ? { peer_id: selectedPeerId, name: offlineConversation.name || "Unknown" } : null);
  const selectedPeerOnline = Boolean(livePeer);
  const selectedGroup = groups.find((g) => g.group_id === selectedGroupId) || null;
  const selectedGroupOnlineCount = selectedGroup ? selectedGroup.members.filter((m) => peers.some((p) => p.peer_id === m.peer_id)).length : null;

  function handleSelectTab(tab) {
    setActive(tab);
    if (tab === "nearby") setNearbyShowingRadar(true);
    if (tab !== "calls") setCallsPeerFilter(null);
  }

  function handleSelectPeer(peerId) {
    setSelectedGroupId(null);
    setSelectedPeerId(peerId);
    setNearbyShowingRadar(false);
    setConversationSearchOpen(false);
  }

  // The real rescan (usePeers().refresh, a real GET /peers call) drives the
  // overlay's lifetime directly - it opens right before the request starts
  // and closes the instant the promise resolves, never a fixed timer, so
  // the radar stays up for exactly as long as the real work actually takes.
  async function handleRescan() {
    setScanOverlayOpen(true);
    await rescan();
    setScanOverlayOpen(false);
  }

  function handleSelectGroup(groupId) {
    setSelectedPeerId(null);
    setSelectedGroupId(groupId);
    setConversationSearchOpen(false);
  }

  function handleOpenCall(peerId, media) {
    placeCall(peerId, media);
  }

  // Design screen 10.4's incoming-call quick replies ("Can't talk now",
  // "Two minutes") - decline the call the same way the Decline button
  // already does, then send the canned text as a perfectly ordinary chat
  // message, same reasoning as the voice-message review screen's "Add a
  // note" from BUILD_LOG Step 41: there's no real "reply to a call" wire
  // concept to build, a regular message sent right after declining reads
  // the same way in the timeline.
  function handleCallQuickReply(text) {
    const peerId = call?.peerId;
    declineCall();
    if (peerId) api.sendMessage(peerId, text).catch(() => {});
  }

  // The reference's third quick action, "Message" - decline, then just
  // open that conversation so the caller can type their own reply,
  // instead of a canned line.
  function handleCallDeclineToMessage() {
    const peerId = call?.peerId;
    declineCall();
    if (peerId) {
      setActive("chats");
      handleSelectPeer(peerId);
    }
  }

  // Conversation menu's "Export Conversation..." - fetches the real, current
  // history directly rather than reaching into ConversationPane/
  // GroupConversationPane's own local state, so it always matches what the
  // backend actually has regardless of what's currently rendered on screen.
  async function handleExportConversation() {
    let content, suggestedName;
    if (selectedGroup) {
      const msgs = await api.groupHistory(selectedGroup.group_id).catch(() => []);
      content = msgs.map((m) => `[${new Date(m.ts * 1000).toLocaleString()}] ${m.sender_name}: ${m.body}`).join("\n");
      suggestedName = `${selectedGroup.name}.txt`;
    } else if (selectedPeer) {
      const msgs = await api.history(selectedPeer.peer_id).catch(() => []);
      content = msgs.map((m) => `[${new Date(m.ts * 1000).toLocaleString()}] ${m.direction === "sent" ? "You" : selectedPeer.name}: ${m.body}`).join("\n");
      suggestedName = `${selectedPeer.name}.txt`;
    } else {
      return;
    }
    await window.electronAPI?.saveTextFile?.(content, suggestedName, [{ name: "Text File", extensions: ["txt"] }]);
  }

  function handleFilterCallsByPeer(peerId) {
    setCallsPeerFilter(peerId);
    setActive("calls");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <TitleBar
        connected={connected}
        peerCount={peerCount}
        me={me}
        peers={peers}
        conversations={conversations}
        active={active}
        onSelectTab={handleSelectTab}
        selectedPeer={selectedPeer}
        selectedGroup={selectedGroup}
        onRescan={handleRescan}
        onNewGroup={() => setGroupCreationOpen(true)}
        onToggleConversationSearch={() => setConversationSearchOpen((v) => !v)}
        onExportConversation={handleExportConversation}
        onFilterCallsByPeer={handleFilterCallsByPeer}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => {
          autoHiddenSidebarRef.current = false;
          setSidebarVisible((v) => !v);
        }}
        leftPanelVisible={leftPanelVisible}
        onToggleLeftPanel={() => {
          autoHiddenLeftRef.current = false;
          setLeftPanelVisible((v) => !v);
        }}
        onToggleFocus={handleToggleFocus}
      />

      <IdentityWarningBanner warnings={identityWarnings} onDismiss={dismissIdentityWarning} />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <IconRail active={active} onSelect={handleSelectTab} selfInitial={me?.device_name?.[0]?.toUpperCase()} />

        {active === "nearby" && (
          <>
            {leftPanelVisible && (
              <PeerList peers={peers} selected={selectedPeerId} onSelect={handleSelectPeer} onRescan={handleRescan} onOpenQr={() => setQrModalOpen(true)} scanning={rescanning} />
            )}
            {nearbyShowingRadar ? (
              <ScanRadar peers={peers} onRescan={handleRescan} scanning={rescanning} onOpenDiagnostics={() => setActive("settings")} />
            ) : (
              <>
                <ConversationPane
                  peer={selectedPeer}
                  online={selectedPeerOnline}
                  onOpenCall={handleOpenCall}
                  onOpenFiles={handleOpenFilesForPeer}
                  onOpenSearch={() => setConversationSearchOpen(true)}
                  onExportConversation={handleExportConversation}
                  emptyState={<ScanRadar peers={peers} onRescan={handleRescan} scanning={rescanning} onOpenDiagnostics={() => setActive("settings")} />}
                  searchOpen={conversationSearchOpen}
                  onCloseSearch={() => setConversationSearchOpen(false)}
                />
                {sidebarVisible && <InfoSidebar peer={selectedPeer} online={selectedPeerOnline} />}
              </>
            )}
          </>
        )}

        {active === "chats" && (
          <>
            {leftPanelVisible && (
              <ChatsListPanel
                conversations={conversations}
                groups={groups}
                selected={selectedPeerId}
                onSelect={handleSelectPeer}
                selectedGroupId={selectedGroupId}
                onSelectGroup={handleSelectGroup}
                creatingOverride={groupCreationOpen}
                onCreatingOverrideChange={setGroupCreationOpen}
              />
            )}
            {selectedGroupId ? (
              <GroupConversationPane
                group={selectedGroup}
                onlineCount={selectedGroupOnlineCount}
                onStartCall={(media) => selectedGroup && startGroupCall(selectedGroup, media)}
                me={me}
                livePeers={peers}
                conversations={conversations}
                otherGroups={groups.filter((g) => g.group_id !== selectedGroupId)}
                searchOpen={conversationSearchOpen}
                onCloseSearch={() => setConversationSearchOpen(false)}
                onOpenSearch={() => setConversationSearchOpen(true)}
                onExportConversation={handleExportConversation}
              />
            ) : (
              <>
                <ConversationPane
                  peer={selectedPeer}
                  online={selectedPeerOnline}
                  onOpenCall={handleOpenCall}
                  onOpenFiles={handleOpenFilesForPeer}
                  onOpenSearch={() => setConversationSearchOpen(true)}
                  onExportConversation={handleExportConversation}
                  searchOpen={conversationSearchOpen}
                  onCloseSearch={() => setConversationSearchOpen(false)}
                />
                {sidebarVisible && <InfoSidebar peer={selectedPeer} online={selectedPeerOnline} />}
              </>
            )}
          </>
        )}

        {active === "calls" && <CallsScreen onPlaceCall={placeCall} filterPeerId={callsPeerFilter} onClearPeerFilter={() => setCallsPeerFilter(null)} />}

        {active === "files" && <FilesScreen initialPeerFilter={filesPeerFilter} onConsumeInitialPeerFilter={() => setFilesPeerFilter(null)} />}

        {active === "settings" && <SettingsScreen me={me} />}
      </div>

      <StatusBar connected={connected} right={callError || (me ? `peer_id ${me.peer_id.slice(0, 8)}` : "")} />

      <CallOverlay
        call={call}
        peerName={peers.find((p) => p.peer_id === call?.peerId)?.name || "Unknown"}
        elapsed={elapsed}
        muted={muted}
        cameraOff={cameraOff}
        sharingScreen={sharingScreen}
        remoteSharingScreen={remoteSharingScreen}
        awaitingShareAccept={awaitingShareAccept}
        incomingShareRequest={incomingShareRequest}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        remoteAudioRef={remoteAudioRef}
        remoteScreenVideoRef={remoteScreenVideoRef}
        onAccept={acceptCall}
        onDecline={declineCall}
        onQuickReply={handleCallQuickReply}
        onDeclineToMessage={handleCallDeclineToMessage}
        onHangUp={() => hangUp()}
        onCancel={() => hangUp()}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onStartScreenShare={startScreenShare}
        onCancelScreenShareRequest={cancelScreenShareRequest}
        onAcceptScreenShareRequest={acceptScreenShareRequest}
        onDeclineScreenShareRequest={declineScreenShareRequest}
        onStopScreenShare={stopScreenShare}
      />

      <GroupCallOverlay
        groupCall={groupCall}
        incomingGroupCall={incomingGroupCall}
        muted={groupMuted}
        cameraOff={groupCameraOff}
        sharingScreen={groupSharingScreen}
        onToggleMute={toggleGroupMute}
        onToggleCamera={toggleGroupCamera}
        onHangUp={hangUpGroupCall}
        onJoin={joinIncomingGroupCall}
        onDecline={declineIncomingGroupCall}
        onStartScreenShare={startGroupScreenShare}
        onStopScreenShare={stopGroupScreenShare}
        registerVideoRef={registerVideoRef}
      />

      {scanOverlayOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex" }}>
          <ScanRadar peers={peers} onRescan={handleRescan} scanning={rescanning} onOpenDiagnostics={() => setActive("settings")} />
        </div>
      )}

      {qrModalOpen && <QrPairingModal onClose={() => setQrModalOpen(false)} />}
    </div>
  );
}
