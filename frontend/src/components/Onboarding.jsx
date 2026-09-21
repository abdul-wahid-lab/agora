import { useState } from "react";

const PERMISSIONS = [
  { label: "Local network access", reason: "So Agora can find people near you. Required." },
  { label: "Microphone", reason: "For voice calls. Only on while you're in a call." },
  { label: "Camera", reason: "For video calls. Skip it and audio still works." },
  { label: "Notifications", reason: "So you know when someone nearby messages you." },
];

function Splash({ onDone }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--accent)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        color: "#fff8f2",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 96,
          height: 96,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid #fbf7f2", opacity: 0.5 }} />
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "#fbf7f2" }} />
      </div>
      <h1 className="serif" style={{ fontSize: 48, margin: 0 }}>
        Agora
      </h1>
      <p style={{ margin: 0, fontSize: 16 }}>Talk to who&apos;s around you.</p>
      <button
        onClick={onDone}
        style={{
          marginTop: 24,
          padding: "12px 28px",
          borderRadius: 100,
          border: "1.5px solid rgba(255,255,255,0.6)",
          background: "transparent",
          color: "#fff8f2",
          fontWeight: 600,
        }}
      >
        Continue
      </button>
    </div>
  );
}

function Permissions({ onDone }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "48px 56px", maxWidth: 560 }}>
      <h1 className="serif" style={{ fontSize: 34, margin: "0 0 8px" }}>
        A few things Agora needs
      </h1>
      <p style={{ margin: "0 0 24px", color: "var(--text-2)" }}>Nothing leaves this network. Here&apos;s exactly what each one is for.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
        {PERMISSIONS.map((p) => (
          <div
            key={p.label}
            style={{
              display: "flex",
              gap: 14,
              padding: 16,
              borderRadius: 16,
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                flexShrink: 0,
                borderRadius: 10,
                background: "var(--accent-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--accent)" }} />
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>{p.label}</div>
              <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>{p.reason}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          fontSize: 13,
          color: "var(--text-2)",
          background: "var(--surface-2)",
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 24,
        }}
      >
        Local network permission looks unusual because it is — it&apos;s what lets Agora work with no servers at all.
      </div>

      <button
        onClick={onDone}
        style={{
          padding: "14px 0",
          borderRadius: 14,
          border: "none",
          background: "var(--accent)",
          color: "#fff8f2",
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        Allow &amp; continue
      </button>
    </div>
  );
}

function ProfileSetup({ onDone }) {
  const [name, setName] = useState("");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "48px 56px", maxWidth: 480 }}>
      <h1 className="serif" style={{ fontSize: 34, margin: "0 0 8px" }}>
        Who should we say you are?
      </h1>
      <p style={{ margin: "0 0 28px", color: "var(--text-2)" }}>No account, no email, no password. This name is only visible to people on this network.</p>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <span
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--accent-soft)",
            color: "var(--accent-strong)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontFamily: "Instrument Serif, serif",
          }}
        >
          {name.trim()[0]?.toUpperCase() || "?"}
        </span>
        <button style={{ padding: "9px 16px", borderRadius: 100, border: "1px solid var(--border)", background: "var(--surface)" }}>
          Choose photo&hellip;
        </button>
      </div>

      <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 6 }}>
        DISPLAY NAME
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        style={{
          padding: "12px 14px",
          borderRadius: 12,
          border: "1.5px solid var(--accent)",
          fontSize: 15,
          marginBottom: 28,
        }}
      />

      <div
        style={{
          fontSize: 13,
          background: "var(--surface-2)",
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 24,
        }}
      >
        <strong>No sign-up needed.</strong> Agora works the moment you&apos;re on a network. Nothing to verify, nothing stored anywhere else.
      </div>

      <button
        disabled={!name.trim()}
        onClick={() => onDone(name.trim())}
        style={{
          padding: "14px 0",
          borderRadius: 14,
          border: "none",
          background: name.trim() ? "var(--accent)" : "var(--border)",
          color: name.trim() ? "#fff8f2" : "var(--text-3)",
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        Start looking around
      </button>
    </div>
  );
}

const STEPS = ["splash", "permissions", "profile"];

export default function Onboarding({ onComplete }) {
  const initialStep = Number(new URLSearchParams(window.location.search).get("step")) || 0;
  const [step, setStep] = useState(initialStep);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div style={{ flex: 1, display: "flex" }}>
      {STEPS[step] === "splash" && <Splash onDone={next} />}
      {STEPS[step] === "permissions" && <Permissions onDone={next} />}
      {STEPS[step] === "profile" && <ProfileSetup onDone={onComplete} />}
    </div>
  );
}
