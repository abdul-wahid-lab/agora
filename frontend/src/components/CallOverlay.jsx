import { useEffect, useState } from "react";
import ScreenSharePickerModal from "./ScreenSharePickerModal";

// Rendered at the App level (not inside CallsScreen) so an incoming call is
// caught no matter which tab is open when it arrives - see BUILD_LOG's
// Phase 3 notes for the bug this fixes (a call_incoming WS event is only
// ever broadcast once; if nothing was listening yet, the call was lost).
//
// Matches design screens 10.4 (incoming call - a small floating toast, not
// a full-screen takeover) and 10.9's dark, checkerboard-pattern video tiles
// and floating control pill. The actual tile layout below is Google Meet-
// style, not a fixed "one big remote tile, one local PiP corner" the design
// mockup itself shows: both sides can share a screen at the same time now
// (see useCall.js), so there can genuinely be up to three real sources at
// once in a 1:1 call (their camera, their screen, your camera) - whichever
// one is "pinned" fills the frame, the rest sit as small clickable
// thumbnails, and clicking one pins it instead.
function fmtElapsed(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const stripePattern = (c1, c2) => `repeating-linear-gradient(135deg, ${c1} 0px, ${c1} 10px, ${c2} 10px, ${c2} 20px)`;

const quickReplyStyle = { flex: 1, padding: "7px 0", borderRadius: 10, background: "rgba(249,241,232,0.1)", color: "#d8cabf", fontSize: 11.5, fontWeight: 600, border: "none" };

export default function CallOverlay({
  call,
  peerName,
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
  onAccept,
  onDecline,
  onQuickReply,
  onDeclineToMessage,
  onHangUp,
  onCancel,
  onToggleMute,
  onToggleCamera,
  onStartScreenShare,
  onCancelScreenShareRequest,
  onAcceptScreenShareRequest,
  onDeclineScreenShareRequest,
  onStopScreenShare,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Google Meet-style tile picking: whichever tile is "pinned" fills the
  // main view, every other available tile (the other person's camera or
  // screen, your own camera) sits in a clickable thumbnail row - null means
  // "no explicit choice yet, use the sensible default" (see pinnedId below).
  const [explicitPin, setExplicitPin] = useState(null);

  // A screen share starting grabs focus automatically, same as Meet - but
  // only the moment it starts, not on every render, so clicking away to a
  // different tile afterward still sticks instead of being fought back to
  // the screen every time this component re-renders.
  useEffect(() => {
    if (remoteSharingScreen) setExplicitPin("remoteScreen");
  }, [remoteSharingScreen]);

  if (!call) return null;

  function handleChooseSource(sourceId) {
    window.electronAPI?.chooseScreenSource?.(sourceId);
    setPickerOpen(false);
    onStartScreenShare();
  }

  if (call.status === "ringing" && call.direction === "incoming") {
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
              {peerName[0]?.toUpperCase() || "?"}
            </span>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#f9f1e8" }}>{peerName}</div>
            <div style={{ fontSize: 12.5, color: "#a3948a" }}>Incoming {call.media} call · on this network</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onAccept} style={{ flex: 1, padding: 10, borderRadius: 12, background: "#4d7a4a", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
            Accept
          </button>
          <button onClick={onDecline} style={{ flex: 1, padding: 10, borderRadius: 12, background: "#c2352a", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
            Decline
          </button>
        </div>
        {/* Design screen 10.4's quick replies - decline with a reason
            instead of just going silent. "Can't talk now"/"Two minutes"
            send that exact line as a normal chat message right after
            declining; "Message" just opens the conversation so the caller
            can type their own reply instead of a canned one. */}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onQuickReply?.("Can't talk right now")} style={quickReplyStyle}>
            Can't talk now
          </button>
          <button onClick={() => onQuickReply?.("Can I call you back in two minutes?")} style={quickReplyStyle}>
            Two minutes
          </button>
          <button onClick={onDeclineToMessage} style={quickReplyStyle}>
            Message
          </button>
        </div>
      </div>
    );
  }

  // Outgoing-ringing and in_call both use the dark call window - the only
  // difference is whether the remote tile shows "Calling..." or a live tile.
  const isConnected = call.status === "in_call";

  // Every real source this call could possibly show right now, Meet-style -
  // not just "the" one shared screen chosen for you. Your own screen share
  // deliberately isn't one of these: watching your own screen played back
  // at you isn't a real thing Meet does either, "Stop sharing" already
  // being highlighted in the control pill is the real indicator that it's
  // live.
  const tiles = [
    {
      id: "remoteMain",
      label: isConnected ? peerName : `Calling ${peerName}…`,
      content:
        call.media === "video" && isConnected ? (
          <video autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} ref={remoteVideoRef} />
        ) : (
          <AvatarTile name={peerName} />
        ),
    },
  ];
  if (remoteSharingScreen) {
    tiles.push({
      id: "remoteScreen",
      label: `${peerName}'s screen`,
      content: <video autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#1c1512" }} ref={remoteScreenVideoRef} />,
    });
  }
  if (call.media === "video" && isConnected) {
    tiles.push({
      id: "localCamera",
      label: "You",
      content: <video autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} ref={localVideoRef} />,
    });
  }
  const pinnedId = tiles.some((t) => t.id === explicitPin) ? explicitPin : "remoteMain";
  const mainTile = tiles.find((t) => t.id === pinnedId);
  const thumbnailTiles = tiles.filter((t) => t.id !== pinnedId);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        background: stripePattern("#453a34", "#3e342e"),
      }}
    >
      <div style={{ flex: "0 0 auto", height: 40, background: "rgba(26,21,19,0.55)", display: "flex", alignItems: "center", gap: 14, padding: "0 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#f0e4d8" }}>Call · {peerName}</div>
        {isConnected && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9, padding: "5px 11px", borderRadius: 99, background: "rgba(249,241,232,0.12)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#f7e8dc" }}>Local connection · {call.media}</span>
          </div>
        )}
        <div style={{ padding: "5px 11px", borderRadius: 99, background: "rgba(249,241,232,0.12)", font: '500 12px/1 "IBM Plex Mono", monospace', color: "#f7e8dc", marginLeft: isConnected ? 0 : "auto" }}>
          {isConnected ? fmtElapsed(elapsed) : "ringing…"}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", padding: 16, gap: 14 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 18,
            background: stripePattern("#5a4d45", "#524540"),
            border: "1px solid rgba(249,241,232,0.12)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Every tile that currently exists renders here, always, at this
              same tree position - only its size/position style changes
              between "pinned" (fills the frame) and "thumbnail" (a small
              clickable box in the corner). Moving a tile to a *different*
              parent element on pin/unpin, instead of just restyling it in
              place like this, is exactly what caused the "stuck on last
              frame" bug: React would mount a brand-new <video> each time
              instead of reusing the one real element a stream was already
              attached to. */}
          {tiles.map((tile) => {
            const isPinned = tile.id === pinnedId;
            return (
              <div
                key={tile.id}
                onClick={() => !isPinned && setExplicitPin(tile.id)}
                style={
                  isPinned
                    ? { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }
                    : {
                        position: "absolute",
                        bottom: 14,
                        right: 14 + thumbnailTiles.indexOf(tile) * 154,
                        width: 140,
                        height: 100,
                        borderRadius: 12,
                        overflow: "hidden",
                        border: "2px solid rgba(249,241,232,0.3)",
                        background: "#2a2320",
                        cursor: "pointer",
                        zIndex: 5,
                      }
                }
              >
                {tile.content}
                {!isPinned && (
                  <div style={{ position: "absolute", left: 6, bottom: 4, font: '500 10px/1 "Hanken Grotesk", sans-serif', color: "#f7e8dc", textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>
                    {tile.label}
                  </div>
                )}
              </div>
            );
          })}

          <audio ref={remoteAudioRef} autoPlay hidden />

          {isConnected && (
            <div style={{ position: "absolute", left: 14, bottom: 14, display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 99, background: "rgba(26,21,19,0.6)", zIndex: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent)" }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f7e8dc" }}>{mainTile.label}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: "0 0 auto", padding: "0 16px 18px", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 22, background: "rgba(26,21,19,0.68)" }}>
          {isConnected && (
            <>
              <ControlButton label={muted ? "Unmute" : "Mute"} onClick={onToggleMute} />
              {call.media === "video" && <ControlButton label={cameraOff ? "Cam on" : "Camera"} onClick={onToggleCamera} />}
              {/* Deliberately not gated on call.media === "video" - screen
                  sharing works from an audio call just as well, that's the
                  whole point of this feature. */}
              {awaitingShareAccept ? (
                <ControlButton label="Waiting for them to accept…" onClick={onCancelScreenShareRequest} active />
              ) : (
                <ControlButton label={sharingScreen ? "Stop sharing" : "Share screen"} onClick={sharingScreen ? onStopScreenShare : () => setPickerOpen(true)} active={sharingScreen} />
              )}
            </>
          )}
          <button
            onClick={isConnected ? onHangUp : onCancel}
            style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 16px", borderRadius: 14, background: "#c2352a", border: "none", fontSize: 12.5, fontWeight: 700, color: "#fff" }}
          >
            {isConnected ? "Leave" : "Cancel"}
          </button>
        </div>
      </div>

      {/* Screen sharing needs the other person's explicit consent before any
          frame actually goes out - same floating-toast treatment as the
          incoming-call prompt above, just for a request arriving mid-call. */}
      {incomingShareRequest && (
        <div
          style={{
            position: "absolute",
            top: 56,
            right: 20,
            width: 300,
            borderRadius: 16,
            background: "#2a2320",
            boxShadow: "0 22px 50px rgba(20,14,10,0.42)",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            zIndex: 1010,
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#f9f1e8" }}>{peerName} wants to share their screen</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onAcceptScreenShareRequest} style={{ flex: 1, padding: 9, borderRadius: 11, background: "#4d7a4a", color: "#fff", fontSize: 12.5, fontWeight: 700, border: "none" }}>
              Accept
            </button>
            <button onClick={onDeclineScreenShareRequest} style={{ flex: 1, padding: 9, borderRadius: 11, background: "#c2352a", color: "#fff", fontSize: 12.5, fontWeight: 700, border: "none" }}>
              Decline
            </button>
          </div>
        </div>
      )}

      {pickerOpen && <ScreenSharePickerModal onChoose={handleChooseSource} onCancel={() => setPickerOpen(false)} />}
    </div>
  );
}

// The "no real video for this tile" fallback - an audio-only call, or a
// video call before the remote camera track has arrived yet. Fills
// whatever size its wrapper currently is, same as a real <video> would,
// so it looks right whether it's the pinned main tile or a small
// thumbnail.
function AvatarTile({ name }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#453a34" }}>
      <div style={{ width: 84, height: 84, borderRadius: 99, background: "var(--avatar-self)", color: "var(--accent-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Instrument Serif, serif", fontSize: 32 }}>
        {name[0]?.toUpperCase() || "?"}
      </div>
    </div>
  );
}

function ControlButton({ label, onClick, active }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 14px",
        borderRadius: 14,
        background: active ? "var(--accent)" : "rgba(249,241,232,0.14)",
        border: "none",
        fontSize: 12.5,
        fontWeight: 600,
        color: active ? "#fff8f2" : "#f9f1e8",
      }}
    >
      {label}
    </button>
  );
}
