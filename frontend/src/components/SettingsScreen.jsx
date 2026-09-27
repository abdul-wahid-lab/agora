import { useState } from "react";
import { api } from "../api";
import { paletteAt, initials, SELF_AVATAR_INDEX_KEY } from "../lib/avatar";
import { useConversations } from "../hooks/useConversations";
import { useSelfAvatarPhoto } from "../hooks/useSelfAvatarPhoto";

// Matches design screens 6.1/6.3/6.4/6.5, but NOT verbatim: the design's
// Privacy screen claims "Encrypted, even at home" with X25519/ChaCha20
// badges, and About claims messages travel "encrypted" - both false for
// this app today, transport encryption is real, planned Phase 5 work (see
// TASK_QUEUE.md), not built yet. Copying that copy here would make the app
// lie to whoever reads it. Every toggle below is either wired to something
// real or honestly disabled with a reason, not a decorative switch.
export default function SettingsScreen({ me }) {
  const [view, setView] = useState("home");
  const avatarIndex = Number(localStorage.getItem(SELF_AVATAR_INDEX_KEY)) || 0;
  const avatar = paletteAt(avatarIndex);
  const { photo, setPhoto, hasElectron } = useSelfAvatarPhoto();

  if (view === "privacy") return <PrivacyView onBack={() => setView("home")} />;
  if (view === "notifications") return <NotificationsView onBack={() => setView("home")} />;
  if (view === "about") return <AboutView onBack={() => setView("home")} />;

  async function handleChoosePhoto() {
    const path = await window.electronAPI.pickFile("photo");
    if (!path) return;
    const dataUrl = await window.electronAPI.setAvatarPhoto(path);
    if (!dataUrl) {
      window.alert("Couldn't use that image (too large, or not a supported photo format).");
      return;
    }
    setPhoto(dataUrl);
  }

  async function handleRemovePhoto() {
    await window.electronAPI.clearAvatarPhoto();
    setPhoto(null);
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 20, overflowY: "auto" }}>
      <div className="serif" style={{ fontSize: 30, lineHeight: 1 }}>
        Settings
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)" }}>
        <span style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 99, overflow: "hidden", background: photo ? "var(--surface-2)" : avatar.bg, color: avatar.text, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Instrument Serif, serif", fontSize: 22 }}>
          {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(me?.device_name || "?")}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16.5 }}>{me?.device_name || "This device"}</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            {me?.peer_id ? `${me.peer_id.slice(0, 8)} · this device` : "this device"}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={handleChoosePhoto}
            disabled={!hasElectron}
            title={hasElectron ? undefined : "Only available in the desktop app"}
            style={{ padding: "7px 12px", borderRadius: 10, background: "var(--surface-2)", border: "none", fontSize: 12, fontWeight: 600, color: hasElectron ? "var(--text-strong)" : "var(--text-3)", cursor: hasElectron ? "pointer" : "not-allowed" }}
          >
            {photo ? "Change photo" : "Choose photo"}
          </button>
          {photo && (
            <button onClick={handleRemovePhoto} style={{ padding: "7px 12px", borderRadius: 10, background: "transparent", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--danger)" }}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
        <NavRow label="Privacy & security" onClick={() => setView("privacy")} />
        <NavRow label="Notifications" onClick={() => setView("notifications")} />
        <NavRow label="About & help" onClick={() => setView("about")} last />
      </div>

      <div style={{ padding: 16, borderRadius: 16, background: "var(--surface-2)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text-strong)" }}>Running local-only</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
          Nothing in Agora leaves this network. There's no cloud sync mode, on purpose, that's not a missing feature, it's the whole design.
        </div>
      </div>
    </div>
  );
}

function NavRow({ label, onClick, last }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", background: "transparent", border: "none", borderBottom: last ? "none" : "1px solid var(--divider)", fontSize: 14.5, fontWeight: 600, color: "var(--text)" }}
    >
      {label}
      <span style={{ color: "var(--text-3)", fontSize: 16 }}>›</span>
    </button>
  );
}

function SubHeader({ title, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button onClick={onBack} style={{ width: 32, height: 32, borderRadius: 11, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "var(--text-strong)" }}>
        ‹
      </button>
      <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
    </div>
  );
}

function Toggle({ on, disabled }) {
  return (
    <div style={{ width: 42, height: 25, flexShrink: 0, borderRadius: 99, background: disabled ? "var(--border)" : on ? "var(--accent)" : "var(--border)", padding: 3, display: "flex", justifyContent: on ? "flex-end" : "flex-start", opacity: disabled ? 0.6 : 1 }}>
      <div style={{ width: 19, height: 19, borderRadius: 99, background: "#fff" }} />
    </div>
  );
}

function PrivacyView({ onBack }) {
  const conversations = useConversations();
  const [clearing, setClearing] = useState(false);

  async function handleClearAll() {
    if (conversations.length === 0) return;
    if (!window.confirm(`Clear chat history with all ${conversations.length} people you've talked to on this device? This can't be undone.`)) return;
    setClearing(true);
    await Promise.all(conversations.map((c) => api.clearConversation(c.peer_id).catch(() => {})));
    setClearing(false);
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 18, overflowY: "auto" }}>
      <SubHeader title="Privacy & security" onBack={onBack} />

      {/* Honest status, not the design's "Encrypted, even at home" claim -
          see README's own Security posture section for the same wording. */}
      <div style={{ padding: 18, borderRadius: 18, background: "var(--danger-soft)", border: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="serif" style={{ fontSize: 21, lineHeight: 1.15, color: "var(--danger)" }}>Not encrypted yet</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>
          Messages and files currently travel as plain text between devices on this network, anyone else actively watching this WiFi could read them. Call audio/video is the one exception: WebRTC always encrypts that part regardless. Real end-to-end encryption for everything else is planned, not built yet.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottom: "1px solid var(--divider)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-3)" }}>Show me in Nearby</div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>Not built yet, discovery can't be paused from the app</div>
          </div>
          <Toggle on disabled />
        </div>
        <button
          onClick={handleClearAll}
          disabled={clearing || conversations.length === 0}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "transparent", border: "none", fontSize: 14.5, fontWeight: 600, color: conversations.length === 0 ? "var(--text-3)" : "var(--danger)" }}
        >
          {clearing ? "Clearing…" : `Clear all local chat history${conversations.length ? ` (${conversations.length})` : ""}`}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "0 2px" }}>BLOCKING</div>
        <div style={{ padding: 16, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)", fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>
          Not built yet, there's no way to block a peer_id today. Anyone on this network can message or call you. Real feature, queued.
        </div>
      </div>
    </div>
  );
}

function NotificationsView({ onBack }) {
  const [permission, setPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");

  async function handleRequest() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 18, overflowY: "auto" }}>
      <SubHeader title="Notifications" onBack={onBack} />

      <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>OS notification permission</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {permission === "granted" && "Granted, background incoming-call alerts can show"}
              {permission === "denied" && "Denied in the OS, change it in system settings to allow"}
              {permission === "default" && "Not asked yet"}
              {permission === "unsupported" && "Not available in this environment"}
            </div>
          </div>
          {permission === "default" && (
            <button onClick={handleRequest} style={{ padding: "8px 14px", borderRadius: 11, background: "var(--accent)", border: "none", color: "#fff8f2", fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>
              Allow
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "0 2px" }}>WHAT ACTUALLY HAPPENS TODAY</div>
        <div style={{ padding: 16, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)", fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          An incoming call always rings and brings the window to the front while the app is open, that's not optional and doesn't need this permission. This permission only affects the extra OS-level toast Agora tries to show when the window isn't focused. There's no per-category (messages/calls) or per-conversation preference yet, that's real work not built, this screen won't pretend a toggle exists for it.
        </div>
      </div>
    </div>
  );
}

function AboutView({ onBack }) {
  const version = typeof __AGORA_VERSION__ !== "undefined" ? __AGORA_VERSION__ : "dev";
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 18, overflowY: "auto" }}>
      <SubHeader title="About & help" onBack={onBack} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "12px 0" }}>
        <span style={{ position: "relative", width: 66, height: 66, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: 99, border: "2px solid var(--accent)", animation: "agRing 2.6s ease-out infinite" }} />
          <span style={{ width: 42, height: 42, borderRadius: 99, background: "var(--accent)" }} />
        </span>
        <div className="serif" style={{ fontSize: 28 }}>Agora</div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>version {version}</div>
      </div>

      <div style={{ padding: 18, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="serif" style={{ fontSize: 20 }}>How Agora works</div>
        <Step n={1} text="Your device announces itself on the WiFi you're already on. No servers in the middle." />
        <Step n={2} text="Messages and files travel directly device-to-device, at local network speed, over plain WiFi (see Privacy & security for the current, honest state of encryption)." />
        <Step n={3} text="Your history stays on your device. There's no cloud sync, it's not a toggle you turn on, it doesn't exist by design." />
      </div>

      <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
        <a href="https://github.com/abdul-wahid-lab/agora" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottom: "1px solid var(--divider)", fontSize: 14.5, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
          Source code on GitHub
          <span style={{ color: "var(--text-3)", fontSize: 16 }}>›</span>
        </a>
        <a href="https://github.com/abdul-wahid-lab/agora#readme" target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, fontSize: 14.5, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
          Architecture & network troubleshooting
          <span style={{ color: "var(--text-3)", fontSize: 16 }}>›</span>
        </a>
      </div>
    </div>
  );
}

function Step({ n, text }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 99, background: "var(--surface-2)", color: "var(--accent-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
        {n}
      </span>
      <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}
