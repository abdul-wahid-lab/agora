import { paletteFor } from "../lib/avatar";

// Deterministic placement (not random-per-render) so a peer's blip doesn't
// jump around every re-render: same peer_id always lands in the same spot
// for the life of this session.
function hashPeer(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function nodePosition(peerId) {
  const h = hashPeer(peerId);
  const angle = (h % 360) * (Math.PI / 180);
  const radiusPct = 16 + (Math.floor(h / 97) % 32); // stays inside the ring, off-center
  return {
    left: `${50 + radiusPct * Math.cos(angle)}%`,
    top: `${50 + radiusPct * Math.sin(angle)}%`,
  };
}

// The "Pick someone to start talking to" empty state, specifically for the
// Nearby tab: discovery (mDNS + UDP broadcast) runs continuously in the
// background regardless of whether this is on screen, so the sweep here
// isn't a fake loading spinner, it's an honest ambient view of that already
// happening. Every label is either always-true (transport, protocol) or
// live data (peer count, each peer's own avatar color as their blip) -
// nothing here is invented telemetry.
export default function ScanRadar({ peers = [] }) {
  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        background: "var(--ground)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.6,
          backgroundImage:
            "linear-gradient(rgba(226,112,58,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(226,112,58,.10) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          transform: "perspective(500px) rotateX(62deg) scale(1.8) translateY(20%)",
          transformOrigin: "center bottom",
        }}
      />

      <div style={{ position: "absolute", inset: 26, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 0, left: 0 }}>
          <div className="serif" style={{ fontSize: 15, color: "var(--text-2)" }}>Nearby scan</div>
          <div className="mono" style={{ marginTop: 6, fontSize: 10.5, letterSpacing: "0.1em", color: "var(--text-3)" }}>
            ● CONTINUOUS DISCOVERY
          </div>
        </div>
        <div className="mono" style={{ position: "absolute", top: 0, right: 0, textAlign: "right", lineHeight: 1.7 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "var(--text-3)" }}>mDNS + UDP BROADCAST</div>
          <div style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "var(--text-3)" }}>LAN ONLY · NO INTERNET</div>
        </div>
        <div className="mono" style={{ position: "absolute", bottom: 0, left: 0, fontSize: 10.5, letterSpacing: "0.1em", color: "var(--text-3)" }}>
          PEERS DETECTED · {peers.length}
        </div>
        <div className="mono" style={{ position: "absolute", bottom: 0, right: 0, fontSize: 10.5, letterSpacing: "0.1em", color: "var(--text-3)" }}>
          {peers.length > 0 ? "ACTIVE" : "IDLE, WAITING"}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          width: "min(58vh, 420px)",
          height: "min(58vh, 420px)",
          borderRadius: "50%",
          border: "1px solid rgba(226,112,58,.3)",
          boxShadow: "0 0 30px rgba(226,112,58,.10), inset 0 0 40px rgba(226,112,58,.06)",
          overflow: "hidden",
        }}
      >
        {[0.28, 0.56, 0.84].map((s) => (
          <span key={s} style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(226,112,58,.16)", transform: `scale(${s})` }} />
        ))}
        <span style={{ position: "absolute", top: "50%", left: 0, width: "100%", height: 1, background: "rgba(226,112,58,.14)" }} />
        <span style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(226,112,58,.14)" }} />

        <div style={{ position: "absolute", inset: 0, animation: "agSpin 4s linear infinite", transformOrigin: "50% 50%" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background:
                "conic-gradient(from 0deg, transparent 0deg, transparent 320deg, rgba(226,112,58,0.05) 330deg, rgba(226,112,58,0.16) 345deg, rgba(226,112,58,0.55) 359deg, rgba(226,112,58,0.7) 360deg)",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "50%",
              height: 2,
              top: "50%",
              left: "50%",
              transformOrigin: "left center",
              background: "linear-gradient(90deg, #fff8f2, var(--accent), transparent)",
              boxShadow: "0 0 8px rgba(226,112,58,.6), 0 0 20px rgba(226,112,58,.35)",
            }}
          />
        </div>

        <span
          style={{
            position: "absolute",
            width: 8,
            height: 8,
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            borderRadius: 99,
            background: "var(--accent-strong)",
            boxShadow: "0 0 8px var(--accent-strong), 0 0 20px rgba(226,112,58,.5)",
            zIndex: 10,
          }}
        />

        {peers.map((p) => {
          const pos = nodePosition(p.peer_id);
          const { text } = paletteFor(p.peer_id);
          return (
            <span key={p.peer_id} style={{ position: "absolute", left: pos.left, top: pos.top, transform: "translate(-50%, -50%)", zIndex: 5 }}>
              <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 22, height: 22, border: `1px solid ${text}`, borderRadius: 99, animation: "agPulse 2s ease-out infinite" }} />
              <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 40, height: 40, border: `1px solid ${text}`, borderRadius: 99, animation: "agPulse 2s ease-out infinite", animationDelay: "0.5s" }} />
              <span style={{ display: "block", width: 7, height: 7, borderRadius: 99, background: text, boxShadow: `0 0 6px ${text}` }} />
            </span>
          );
        })}
      </div>

      <p className="serif" style={{ fontSize: 20, color: "var(--text-3)", animation: "agFade 1.8s ease-in-out infinite", textAlign: "center" }}>
        {peers.length === 0 ? "Scanning for people nearby…" : "Pick someone to start talking to"}
      </p>
    </div>
  );
}
