import { useState } from "react";
import TitleBar from "./TitleBar";

// Matches design screen 10.1 exactly: a single split-panel window, not a
// multi-step wizard. Left panel is static messaging (hero line, 3-step
// list); right panel is the actual profile-setup form, with the network
// permission note + Continue button inline at the bottom - there's no
// separate "Permissions" screen for desktop the way the mobile flow has one.
export default function Onboarding({ onComplete }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const deviceSlug = (trimmed || "device").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <TitleBar title="Welcome to Agora" showStatus={false} />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ width: 520, flex: "0 0 auto", background: "var(--accent)", display: "flex", flexDirection: "column", justifyContent: "center", gap: 28, padding: "0 60px" }}>
          <div style={{ position: "relative", width: 104, height: 104, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: 99, border: "2px solid #fbf7f2", animation: "agRing 2.6s ease-out infinite" }} />
            <span style={{ position: "absolute", inset: 0, borderRadius: 99, border: "2px solid #fbf7f2", animation: "agRing 2.6s ease-out 0.9s infinite" }} />
            <div style={{ width: 58, height: 58, borderRadius: 99, background: "#fbf7f2" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="serif" style={{ fontSize: 56, color: "#fff8f2", lineHeight: 0.98 }}>
              Talk to who's around you.
            </div>
            <div style={{ fontSize: 16, color: "#fde8da", lineHeight: 1.6, maxWidth: 360 }}>
              Agora runs on the WiFi you're already on. No account, no servers, no upload step — your messages, calls and files go straight between devices.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {["Pick a name people nearby will see", "Allow local network access", "See who's here"].map((step, i) => (
              <div key={step} style={{ display: "flex", gap: 11, alignItems: "center" }}>
                <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 99, background: "rgba(255,248,242,0.22)", color: "#fff8f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                  {i + 1}
                </div>
                <div style={{ fontSize: 14.5, color: "#fde8da" }}>{step}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 64px", gap: 26 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="serif" style={{ fontSize: 36, lineHeight: 1.05 }}>
              Who should we say you are?
            </div>
            <div style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.5 }}>Visible only to people on the same network. Change it any time.</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ width: 96, height: 96, flexShrink: 0, borderRadius: 99, background: "var(--avatar-self)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Instrument Serif, serif", fontSize: 38, color: "var(--accent-strong)" }}>
              {trimmed[0]?.toUpperCase() || "?"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <button style={{ padding: "9px 15px", borderRadius: 11, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--text-strong)", width: "fit-content" }}>
                Choose photo…
              </button>
              <button style={{ padding: "9px 15px", borderRadius: 11, background: "#2a2320", color: "var(--surface)", fontSize: 13, fontWeight: 600, width: "fit-content", border: "none" }}>
                Shuffle avatar
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)" }}>DISPLAY NAME</div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmed) onComplete(trimmed);
              }}
              placeholder="Your name"
              style={{ height: 50, borderRadius: 14, background: "var(--surface)", border: "1.5px solid var(--accent)", padding: "0 16px", fontSize: 16, fontWeight: 500, maxWidth: 420 }}
            />
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              This device will announce itself as <span className="mono" style={{ fontSize: 11.5 }}>{deviceSlug}</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 14, background: "var(--surface-2)", maxWidth: 520 }}>
            <div style={{ fontSize: 13, color: "#6b5c50", lineHeight: 1.5, maxWidth: 330 }}>Agora needs local network access to find people. Your OS will ask once.</div>
            <button
              disabled={!trimmed}
              onClick={() => onComplete(trimmed)}
              style={{ padding: "9px 16px", borderRadius: 11, background: trimmed ? "var(--accent)" : "var(--border)", color: trimmed ? "#fff8f2" : "var(--text-3)", fontSize: 13.5, fontWeight: 600, border: "none", flexShrink: 0 }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
