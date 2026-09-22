// Rendered at the App level (not inside CallsScreen) so an incoming call is
// caught no matter which tab is open when it arrives - see BUILD_LOG's
// Phase 3 notes for the bug this fixes (a call_incoming WS event is only
// ever broadcast once; if nothing was listening yet, the call was lost).
//
// Matches design screens 10.4 (incoming call - a small floating toast, not
// a full-screen takeover) and 10.9 (the call window itself - dark,
// checkerboard-pattern video tiles, a floating control pill). 10.9 shows a
// 4-person mesh call; this adapts the same visual language to the 1:1 case
// our backend actually supports - one remote tile, one local PiP corner -
// rather than porting group-call chrome (participant list, mesh topology
// info) that has nothing real behind it yet.
function fmtElapsed(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const stripePattern = (c1, c2) => `repeating-linear-gradient(135deg, ${c1} 0px, ${c1} 10px, ${c2} 10px, ${c2} 20px)`;

export default function CallOverlay({
  call,
  peerName,
  elapsed,
  muted,
  cameraOff,
  localVideoRef,
  remoteVideoRef,
  remoteAudioRef,
  onAccept,
  onDecline,
  onHangUp,
  onCancel,
  onToggleMute,
  onToggleCamera,
}) {
  if (!call) return null;

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
      </div>
    );
  }

  // Outgoing-ringing and in_call both use the dark call window - the only
  // difference is whether the remote tile shows "Calling..." or a live tile.
  const isConnected = call.status === "in_call";

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
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            position: "relative",
          }}
        >
          {call.media === "video" && isConnected ? (
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 18 }} />
          ) : (
            <>
              <div style={{ width: 84, height: 84, borderRadius: 99, background: "var(--avatar-self)", color: "var(--accent-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Instrument Serif, serif", fontSize: 32 }}>
                {peerName[0]?.toUpperCase() || "?"}
              </div>
              <div style={{ font: '500 13px/1 "Hanken Grotesk", sans-serif', color: "#e6d5c8", fontWeight: 600 }}>{isConnected ? peerName : `Calling ${peerName}…`}</div>
            </>
          )}
          <audio ref={remoteAudioRef} autoPlay hidden />

          {call.media === "video" && isConnected && (
            <div style={{ position: "absolute", left: 14, bottom: 14, display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 99, background: "rgba(26,21,19,0.6)" }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent)" }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f7e8dc" }}>{peerName}</span>
            </div>
          )}

          {call.media === "video" && isConnected && (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{ position: "absolute", bottom: 14, right: 14, width: 140, borderRadius: 12, border: "2px solid rgba(249,241,232,0.2)", background: "#2a2320" }}
            />
          )}
        </div>
      </div>

      <div style={{ flex: "0 0 auto", padding: "0 16px 18px", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 22, background: "rgba(26,21,19,0.68)" }}>
          {isConnected && (
            <>
              <ControlButton label={muted ? "Unmute" : "Mute"} onClick={onToggleMute} />
              {call.media === "video" && <ControlButton label={cameraOff ? "Cam on" : "Camera"} onClick={onToggleCamera} />}
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
    </div>
  );
}

function ControlButton({ label, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", borderRadius: 14, background: "rgba(249,241,232,0.14)", border: "none", fontSize: 12.5, fontWeight: 600, color: "#f9f1e8" }}>
      {label}
    </button>
  );
}
