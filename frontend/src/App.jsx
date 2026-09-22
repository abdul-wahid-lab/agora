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
import { api } from "./api";
import { useCall } from "./hooks/useCall";
import { usePeers } from "./hooks/usePeers";

const ONBOARDING_KEY = "agora.onboarded";

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDING_KEY) === "1");
  const [active, setActive] = useState("nearby");
  const [selectedPeerId, setSelectedPeerId] = useState(null);
  const [me, setMe] = useState(null);
  const [peerCount, setPeerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const peers = usePeers();
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

  function finishOnboarding(chosenName) {
    // NOTE: this doesn't actually rename the device on the network yet -
    // device_name is fixed at backend startup via an env var, there's no
    // PUT /me endpoint. Stored here so the UI has *something* to show;
    // see BUILD_LOG.md's Step 2 known limitations.
    localStorage.setItem("agora.chosenName", chosenName);
    localStorage.setItem(ONBOARDING_KEY, "1");
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

  const selectedPeer = peers.find((p) => p.peer_id === selectedPeerId) || null;

  function handleSelectTab(tab) {
    setActive(tab);
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
            <PeerList peers={peers} selected={selectedPeerId} onSelect={setSelectedPeerId} onRescan={() => {}} />
            <ConversationPane peer={selectedPeer} onOpenCall={handleOpenCall} />
            <InfoSidebar peer={selectedPeer} />
          </>
        )}

        {active === "chats" && (
          <>
            <ChatsListPanel peers={peers} selected={selectedPeerId} onSelect={setSelectedPeerId} />
            <ConversationPane peer={selectedPeer} onOpenCall={handleOpenCall} />
            <InfoSidebar peer={selectedPeer} />
          </>
        )}

        {active === "calls" && <CallsScreen onPlaceCall={placeCall} />}

        {active === "files" && <FilesScreen />}
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
    </div>
  );
}
