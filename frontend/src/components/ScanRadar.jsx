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
export default function ScanRadar({ peers = [], onRescan, scanning = false, onOpenDiagnostics }) {
  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--ground)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        padding: "26px 0",
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

      <p className="serif" style={{ fontSize: 20, color: "var(--text-3)", animation: peers.length === 0 ? "agFade 1.8s ease-in-out infinite" : "none", textAlign: "center" }}>
        {peers.length === 0 ? "Scanning for people nearby…" : "Pick someone to start talking to"}
      </p>

      {/* Matches design screen 10.2's empty state: real, actionable
          troubleshooting rather than just "keep waiting" - the three
          things actually worth checking when discovery finds no one,
          in the order they're most likely to be the real cause. Router
          AP/client isolation specifically is a confirmed real-world
          cause, not a hypothetical - see BUILD_LOG's own live two-device
          testing notes. */}
      {peers.length === 0 && (
        <div style={{ width: "min(90vw, 480px)", display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              "Same network, same band — guest WiFi and 2.4/5 GHz splits are often isolated.",
              "Router device isolation — look for “AP isolation” in your WiFi settings.",
              "Firewall — your OS may be blocking Agora's local port.",
            ].map((tip, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 13px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border-soft)" }}>
                <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 99, background: "var(--accent-soft)", color: "var(--accent-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                <span style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{tip}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {onRescan && (
              <button onClick={onRescan} disabled={scanning} style={{ padding: "10px 18px", borderRadius: 12, background: "var(--accent)", color: "#fff8f2", border: "none", fontSize: 13, fontWeight: 600, opacity: scanning ? 0.7 : 1 }}>
                {scanning ? "Scanning…" : "Rescan network"}
              </button>
            )}
            {onOpenDiagnostics && (
              <button onClick={onOpenDiagnostics} style={{ padding: "10px 18px", borderRadius: 12, background: "var(--surface)", color: "var(--text-strong)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
                Open diagnostics
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
