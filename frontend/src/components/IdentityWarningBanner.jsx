// A real security warning, not a decorative one: this peer_id already had a
// trust-on-first-use key recorded, and it just showed up with a different
// one (see backend/app/crypto_identity.py). Shown app-wide, above whatever
// screen is open, since it isn't scoped to one conversation the way "you've
// blocked this peer" is - but it's dismissible, not a blocking modal, since
// there's no single correct action the app can take on the user's behalf.
export default function IdentityWarningBanner({ warnings, onDismiss }) {
  if (warnings.length === 0) return null;

  return (
    <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column" }}>
      {warnings.map((w) => (
        <div
          key={w.id}
          style={{
            padding: "10px 20px",
            background: "#7a2e2e",
            color: "#fff3f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
          }}
        >
          <span>
            <strong>Security warning:</strong> {w.name} ({w.peerId.slice(0, 8)}...) just connected with a different identity key than before.
            This could mean they reinstalled Agora - or it could mean someone else is now using that name. Messages from them are still real
            and encrypted, but this is worth checking with them directly before trusting anything sensitive.
          </span>
          <button
            onClick={() => onDismiss(w.id)}
            style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff3f0", fontSize: 12, fontWeight: 700, flexShrink: 0 }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
