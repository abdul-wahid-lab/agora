import { useEffect, useState } from "react";
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
import { api } from "./api";
import { useCall } from "./hooks/useCall";
import { usePeers } from "./hooks/usePeers";
import { useConversations } from "./hooks/useConversations";
import { useGroups } from "./hooks/useGroups";
import { useGroupCall } from "./hooks/useGroupCall";

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
  const [me, setMe] = useState(null);
  const [peerCount, setPeerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const { peers, refreshing: rescanning, refresh: rescan } = usePeers();
  const conversations = useConversations();
  const groups = useGroups();
  const {
    groupCall,
    incomingGroupCall,
    muted: groupMuted,
    cameraOff: groupCameraOff,
    startGroupCall,
    joinIncomingGroupCall,
    declineIncomingGroupCall,
    hangUpGroupCall,
    toggleMute: toggleGroupMute,
    toggleCamera: toggleGroupCamera,
    registerVideoRef,
  } = useGroupCall(me?.peer_id);
  const {
    call,
    error: callError,
    elapsed,
    muted,
    cameraOff,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    placeCall,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    toggleCamera,
  } = useCall();

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
  }

  function handleSelectPeer(peerId) {
    setSelectedGroupId(null);
    setSelectedPeerId(peerId);
    setNearbyShowingRadar(false);
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
  }

  function handleOpenCall(peerId, media) {
    placeCall(peerId, media);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <TitleBar connected={connected} peerCount={peerCount} />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <IconRail active={active} onSelect={handleSelectTab} selfInitial={me?.device_name?.[0]?.toUpperCase()} />

        {active === "nearby" && (
          <>
            <PeerList peers={peers} selected={selectedPeerId} onSelect={handleSelectPeer} onRescan={handleRescan} scanning={rescanning} />
            {nearbyShowingRadar ? (
              <ScanRadar peers={peers} />
            ) : (
              <>
                <ConversationPane peer={selectedPeer} online={selectedPeerOnline} onOpenCall={handleOpenCall} emptyState={<ScanRadar peers={peers} />} />
                <InfoSidebar peer={selectedPeer} online={selectedPeerOnline} />
              </>
            )}
          </>
        )}

        {active === "chats" && (
          <>
            <ChatsListPanel
              conversations={conversations}
              groups={groups}
              selected={selectedPeerId}
              onSelect={handleSelectPeer}
              selectedGroupId={selectedGroupId}
              onSelectGroup={handleSelectGroup}
            />
            {selectedGroupId ? (
              <GroupConversationPane
                group={selectedGroup}
                onlineCount={selectedGroupOnlineCount}
                onStartCall={(media) => selectedGroup && startGroupCall(selectedGroup, media)}
                me={me}
                livePeers={peers}
                conversations={conversations}
                otherGroups={groups.filter((g) => g.group_id !== selectedGroupId)}
              />
            ) : (
              <>
                <ConversationPane peer={selectedPeer} online={selectedPeerOnline} onOpenCall={handleOpenCall} />
                <InfoSidebar peer={selectedPeer} online={selectedPeerOnline} />
              </>
            )}
          </>
        )}

        {active === "calls" && <CallsScreen onPlaceCall={placeCall} />}

        {active === "files" && <FilesScreen />}

        {active === "settings" && <SettingsScreen me={me} />}
      </div>

      <StatusBar connected={connected} right={callError || (me ? `peer_id ${me.peer_id.slice(0, 8)}` : "")} />

      <CallOverlay
        call={call}
        peerName={peers.find((p) => p.peer_id === call?.peerId)?.name || "Unknown"}
        elapsed={elapsed}
        muted={muted}
        cameraOff={cameraOff}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        remoteAudioRef={remoteAudioRef}
        onAccept={acceptCall}
        onDecline={declineCall}
        onHangUp={() => hangUp()}
        onCancel={() => hangUp()}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
      />

      <GroupCallOverlay
        groupCall={groupCall}
        incomingGroupCall={incomingGroupCall}
        muted={groupMuted}
        cameraOff={groupCameraOff}
        onToggleMute={toggleGroupMute}
        onToggleCamera={toggleGroupCamera}
        onHangUp={hangUpGroupCall}
        onJoin={joinIncomingGroupCall}
        onDecline={declineIncomingGroupCall}
        registerVideoRef={registerVideoRef}
      />

      {scanOverlayOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex" }}>
          <ScanRadar peers={peers} />
        </div>
      )}
    </div>
  );
}
