import { useState } from "react";
import { initials } from "../lib/avatar";
import ScreenSharePickerModal from "./ScreenSharePickerModal";

const STATUS_LABEL = {
  connecting: "Connecting…",
  connected: "",
  unreachable: "Couldn't reach them",
  left: "Left the call",
};

// Matches CallOverlay.jsx's own floating-toast incoming-call design (same
// ring animation, same Accept/Decline layout) - a group call rings and
// waits for a real decision the same way a 1:1 call always has, it isn't a
// different, lesser kind of call just because more than one other person
// is on it.
function IncomingGroupCallToast({ incoming, onJoin, onDecline }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        right: 20,
        width: 330,
        borderRadius: 18,
        background: "#2a2320",
        boxShadow: "0 22px 50px rgba(20,14,10,0.42)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        zIndex: 1000,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
          <span style={{ position: "absolute", inset: -4, borderRadius: 99, border: "2px solid var(--accent)", animation: "agRing 1.9s ease-out infinite" }} />
          <span style={{ width: 48, height: 48, borderRadius: 99, background: "var(--avatar-self)", color: "var(--accent-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 600 }}>
            {initials(incoming.groupName)}
          </span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#f9f1e8" }}>{incoming.groupName}</div>
          <div style={{ fontSize: 12.5, color: "#a3948a" }}>Incoming group {incoming.media} call</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onJoin} style={{ flex: 1, padding: 10, borderRadius: 12, background: "#4d7a4a", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
          Join
        </button>
        <button onClick={onDecline} style={{ flex: 1, padding: 10, borderRadius: 12, background: "#c2352a", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
          Decline
        </button>
      </div>
    </div>
  );
}

// Grid of tiles, one per mesh participant plus self - deliberately not a
// dominant-speaker/spotlight layout (that needs audio-level detection this
// first version doesn't have), just an even grid, matching how a small
// group call actually looks with 2-5 people.
export default function GroupCallOverlay({ groupCall, incomingGroupCall, muted, cameraOff, sharingScreen, onToggleMute, onToggleCamera, onHangUp, onJoin, onDecline, onStartScreenShare, onStopScreenShare, registerVideoRef }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (incomingGroupCall) {
    return <IncomingGroupCallToast incoming={incomingGroupCall} onJoin={onJoin} onDecline={onDecline} />;
  }
  if (!groupCall) return null;
  const { groupName, media, participants } = groupCall;
  const entries = Object.entries(participants);
  const sharingPeers = entries.filter(([, p]) => p.sharingScreen);
  // Screen tiles count toward the grid too, so sharing to a 3-person mesh
  // doesn't cram a screen into the same cramped space as a face - it's
  // real content someone specifically wants seen clearly.
  const tileCount = entries.length + 1 + sharingPeers.length;
  const cols = tileCount <= 2 ? 1 : tileCount <= 4 ? 2 : 3;

  function handleChooseSource(sourceId) {
    window.electronAPI?.chooseScreenSource?.(sourceId);
    setPickerOpen(false);
    onStartScreenShare();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "#1c1512", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "0 0 auto", padding: "18px 26px", color: "#fde8da", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div className="serif" style={{ fontSize: 20 }}>{groupName}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{entries.length + 1} in the call</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, padding: "0 26px 20px", overflow: "auto" }}>
        <Tile
          label="You"
          videoEnabled={media === "video" && !cameraOff}
          videoRef={(el) => registerVideoRef("local", el)}
          muted
        />
        {entries.map(([peerId, p]) => (
          <Tile
            key={peerId}
            label={p.name}
            status={STATUS_LABEL[p.status]}
            videoEnabled={media === "video" && p.status === "connected"}
            videoRef={(el) => registerVideoRef(peerId, el)}
            faded={p.status === "unreachable" || p.status === "left"}
          />
        ))}
        {sharingPeers.map(([peerId, p]) => (
          <Tile key={`${peerId}:screen`} label={`${p.name}'s screen`} videoEnabled isScreen videoRef={(el) => registerVideoRef(`${peerId}:screen`, el)} />
        ))}
      </div>

      <div style={{ flex: "0 0 auto", padding: "18px 26px 26px", display: "flex", justifyContent: "center", gap: 14 }}>
        <button onClick={onToggleMute} style={ctrlBtnStyle(muted)}>
          {muted ? "Unmute" : "Mute"}
        </button>
        {media === "video" && (
          <button onClick={onToggleCamera} style={ctrlBtnStyle(cameraOff)}>
            {cameraOff ? "Camera on" : "Camera off"}
          </button>
        )}
        {/* Not gated on media === "video" - works from an audio group call too. */}
        <button onClick={sharingScreen ? onStopScreenShare : () => setPickerOpen(true)} style={ctrlBtnStyle(sharingScreen)}>
          {sharingScreen ? "Stop sharing" : "Share screen"}
        </button>
        <button onClick={onHangUp} style={{ ...ctrlBtnStyle(false), background: "var(--danger)", color: "#fff" }}>
          Leave call
        </button>
      </div>

      {pickerOpen && <ScreenSharePickerModal onChoose={handleChooseSource} onCancel={() => setPickerOpen(false)} />}
    </div>
  );
}

function Tile({ label, status, videoEnabled, videoRef, muted, faded, isScreen }) {
  return (
    <div style={{ position: "relative", borderRadius: 18, background: "#2a201b", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", opacity: faded ? 0.45 : 1, minHeight: 160, gridColumn: isScreen ? "span 2" : undefined }}>
      {videoEnabled ? (
        // A screen tile uses contain, not cover - cropping someone's real
        // screen content is worse than the letterboxing this trades for.
        <video ref={videoRef} autoPlay playsInline muted={muted} style={{ width: "100%", height: "100%", objectFit: isScreen ? "contain" : "cover", background: isScreen ? "#000" : undefined }} />
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted={muted} style={{ display: "none" }} />
          <span style={{ width: 64, height: 64, borderRadius: 99, background: "#3a2d26", color: "#fde8da", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Instrument Serif, serif", fontSize: 24 }}>
            {initials(label)}
          </span>
        </>
      )}
      <div style={{ position: "absolute", bottom: 10, left: 12, color: "#fde8da", fontSize: 12.5, fontWeight: 600, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>
        {label}
        {status ? ` · ${status}` : ""}
      </div>
    </div>
  );
}

function ctrlBtnStyle(active) {
  return {
    padding: "10px 18px",
    borderRadius: 14,
    background: active ? "#fde8da" : "rgba(255,255,255,0.12)",
    border: "none",
    color: active ? "#1c1512" : "#fde8da",
    fontSize: 13,
    fontWeight: 600,
  };
}
