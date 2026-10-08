import { useEffect, useState } from "react";
import { api } from "../api";
import { paletteAt, initials, SELF_AVATAR_INDEX_KEY } from "../lib/avatar";
import { useConversations } from "../hooks/useConversations";
import { useSelfAvatarPhoto } from "../hooks/useSelfAvatarPhoto";
import { getTranscribeEnabled, setTranscribeEnabled, getDefaultSpeed, setDefaultSpeed } from "../lib/voiceSettings";
import { formatFileSize } from "../lib/fileTypes";

// Matches design screens 6.1/6.3/6.4/6.5, but NOT verbatim where the design
// would make this screen lie: real transport encryption shipped in Step 25
// (see README's own Security posture section and this file's own Privacy
// banner below), so that part of the design's copy is accurate rather than
// aspirational now - just not copied verbatim, since the actual wording
// here needs to stay honest as this app's real capabilities keep changing,
// not frozen at whatever the original design mockup happened to say. Every
// toggle below is either wired to something real or honestly disabled with
// a reason, not a decorative switch.
export default function SettingsScreen({ me }) {
  const [view, setView] = useState("home");
  const avatarIndex = Number(localStorage.getItem(SELF_AVATAR_INDEX_KEY)) || 0;
  const avatar = paletteAt(avatarIndex);
  const { photo, setPhoto, hasElectron } = useSelfAvatarPhoto();

  if (view === "privacy") return <PrivacyView onBack={() => setView("home")} />;
  if (view === "notifications") return <NotificationsView onBack={() => setView("home")} />;
  if (view === "voiceMessages") return <VoiceMessagesView onBack={() => setView("home")} />;
  if (view === "preferences") return <PreferencesView onBack={() => setView("home")} />;
  if (view === "about") return <AboutView onBack={() => setView("home")} />;

  async function handleChoosePhoto() {
    if (hasElectron) {
      const path = await window.electronAPI.pickFile("photo");
      if (!path) return;
      const dataUrl = await window.electronAPI.setAvatarPhoto(path);
      if (!dataUrl) {
        window.alert("Couldn't use that image (too large, or not a supported photo format).");
        return;
      }
      setPhoto(dataUrl);
      api.setMyPhoto(dataUrl).catch(() => {});
      return;
    }
    // Plain-browser fallback - this used to just be disabled outright with
    // "Only available in the desktop app," which blocked testing the real
    // peer-photo-sync feature (photos.py) from a plain browser tab, the
    // actual dev/test workflow this app explicitly supports. A real <input
    // type="file"> plus FileReader produces the identical data: URL shape
    // Electron's own path already returns, so setPhoto/api.setMyPhoto below
    // don't need to know or care which source it came from. Doesn't persist
    // to disk the way the Electron path does - there's no main process here
    // to own that - just for the life of this tab, which is the right
    // tradeoff for a dev/test fallback, not a silent limitation to hide.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        setPhoto(dataUrl);
        api.setMyPhoto(dataUrl).catch(() => {});
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function handleRemovePhoto() {
    if (hasElectron) await window.electronAPI.clearAvatarPhoto();
    setPhoto(null);
    api.clearMyPhoto().catch(() => {});
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
            title={hasElectron ? undefined : "Works here too, but won't be saved after this tab closes - only the desktop app keeps it permanently"}
            style={{ padding: "7px 12px", borderRadius: 10, background: "var(--surface-2)", border: "none", fontSize: 12, fontWeight: 600, color: "var(--text-strong)", cursor: "pointer" }}
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
        <NavRow label="Voice messages" onClick={() => setView("voiceMessages")} />
        <NavRow label="Preferences" onClick={() => setView("preferences")} />
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
  const [blocked, setBlocked] = useState([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.blockedPeers().then((list) => !cancelled && setBlocked(list)).catch(() => {});
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleClearAll() {
    if (conversations.length === 0) return;
    if (!window.confirm(`Clear chat history with all ${conversations.length} people you've talked to on this device? This can't be undone.`)) return;
    setClearing(true);
    await Promise.all(conversations.map((c) => api.clearConversation(c.peer_id).catch(() => {})));
    setClearing(false);
  }

  async function handleUnblock(peerId) {
    await api.unblockPeer(peerId).catch(() => {});
    setBlocked((prev) => prev.filter((p) => p.peer_id !== peerId));
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 18, overflowY: "auto" }}>
      <SubHeader title="Privacy & security" onBack={onBack} />

      {/* Matches README's own Security posture section - kept honest in both
          directions: this said "not encrypted yet" before real transport
          encryption shipped, and left saying that afterward until this was
          caught, which is exactly the kind of overclaim-by-omission this
          section exists to avoid. */}
      <div style={{ padding: 18, borderRadius: 18, background: "var(--surface-2)", border: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="serif" style={{ fontSize: 21, lineHeight: 1.15, color: "var(--text)" }}>Encrypted on this network</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>
          Messages, files, and call signaling are end-to-end encrypted between devices (ChaCha20-Poly1305, a separate key for each direction) from the moment two devices first meet, and call audio/video is always encrypted by WebRTC regardless. The one honest limit: trust is established the first time you meet a peer, the same model SSH uses, so a brand-new contact on a genuinely hostile network still can't be verified out-of-band.
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
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "0 2px" }}>
          BLOCKED PEERS{blocked.length ? ` · ${blocked.length}` : ""}
        </div>
        {/* Blocking itself happens from the Conversation menu on an open
            chat - this is the real management view for what's already
            blocked, matching "clear all history" above rather than a place
            to block someone new. */}
        {blocked.length === 0 ? (
          <div style={{ padding: 16, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)", fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>
            Nobody is blocked. Open a conversation with someone and use Conversation → Block Peer from the top menu to block them.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
            {blocked.map((p, i) => (
              <div key={p.peer_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottom: i < blocked.length - 1 ? "1px solid var(--divider)" : "none" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>blocked {new Date(p.blocked_at * 1000).toLocaleDateString()}</div>
                </div>
                <button
                  onClick={() => handleUnblock(p.peer_id)}
                  style={{ padding: "7px 13px", borderRadius: 10, background: "var(--surface-2)", border: "none", color: "var(--text-strong)", fontSize: 12.5, fontWeight: 700 }}
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
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

function VoiceMessagesView({ onBack }) {
  const [transcribeEnabled, setTranscribeEnabledState] = useState(getTranscribeEnabled);
  const [defaultSpeed, setDefaultSpeedState] = useState(getDefaultSpeed);

  function handleToggleTranscribe() {
    const next = !transcribeEnabled;
    setTranscribeEnabled(next);
    setTranscribeEnabledState(next);
  }

  function handlePickSpeed(speed) {
    setDefaultSpeed(speed);
    setDefaultSpeedState(speed);
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 18, overflowY: "auto" }}>
      <SubHeader title="Voice messages" onBack={onBack} />

      <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
        <button
          onClick={handleToggleTranscribe}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "transparent", border: "none", borderBottom: "1px solid var(--divider)" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3, textAlign: "left" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)" }}>On-device transcription</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              Shows a "Transcribe" button on voice bubbles. Runs fully on this device, nothing is ever uploaded.
            </div>
          </div>
          <Toggle on={transcribeEnabled} />
        </button>

        <div style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)" }}>Default playback speed</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 1.5, 2].map((s) => (
              <button
                key={s}
                onClick={() => handlePickSpeed(s)}
                className="mono"
                style={{
                  padding: "6px 11px",
                  borderRadius: 10,
                  border: `1px solid ${defaultSpeed === s ? "var(--accent)" : "var(--border)"}`,
                  background: defaultSpeed === s ? "var(--accent-soft)" : "transparent",
                  color: defaultSpeed === s ? "var(--accent-strong)" : "var(--text-muted)",
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "0 2px" }}>RECORDING QUALITY</div>
        <div style={{ padding: 16, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)", fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          Voice notes record through the browser's own microphone encoder (WebM/Opus, variable bitrate) - there's no quality picker, since that encoder doesn't expose one to choose from. "Raise to listen" (hold the device to your ear to play a note back) is a phone gesture with no desktop equivalent, so it isn't part of this screen.
        </div>
      </div>
    </div>
  );
}

const STORAGE_CATEGORIES = {
  Images: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]),
  Video: new Set(["mov", "mp4", "avi", "mkv"]),
  "Voice notes": new Set(["webm"]),
  Docs: new Set(["pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "ppt", "pptx"]),
  Archives: new Set(["zip", "rar", "7z", "tar", "gz"]),
  Apps: new Set(["apk", "exe", "msi", "appimage"]),
};

function categoryFor(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  for (const [name, exts] of Object.entries(STORAGE_CATEGORIES)) {
    if (exts.has(ext)) return name;
  }
  return "Other";
}

const DISCOVERY_MODES = [
  { value: "auto", label: "Automatic", description: "mDNS and UDP broadcast both, whichever finds a peer first" },
  { value: "mdns", label: "mDNS only", description: "Skip UDP broadcast entirely" },
  { value: "udp", label: "UDP broadcast only", description: "Skip mDNS entirely - useful on networks that filter it" },
];

function PreferencesView({ onBack }) {
  const hasElectron = Boolean(window.electronAPI);
  const [launchAtLogin, setLaunchAtLoginState] = useState(false);
  const [discoveryMode, setDiscoveryModeState] = useState("auto");
  const [savingMode, setSavingMode] = useState(false);
  const [files, setFiles] = useState([]);
  const [clearingReceived, setClearingReceived] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (hasElectron) window.electronAPI.getLaunchAtLogin().then(setLaunchAtLoginState).catch(() => {});
    api.allFiles().then(setFiles).catch(() => {});
    function loadDiagnostics() {
      api.diagnostics().then((d) => {
        setDiagnostics(d);
        setDiscoveryModeState(d.discovery_mode);
      }).catch(() => {});
    }
    loadDiagnostics();
    const interval = setInterval(loadDiagnostics, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleLaunchAtLogin() {
    const next = await window.electronAPI.setLaunchAtLogin(!launchAtLogin);
    setLaunchAtLoginState(next);
  }

  async function handlePickDiscoveryMode(mode) {
    if (mode === discoveryMode || savingMode) return;
    setSavingMode(true);
    setDiscoveryModeState(mode);
    // Takes effect on the restart setDiscoveryMode itself triggers (the
    // backend only reads AGORA_DISCOVERY_MODE once, at startup) - same
    // restart this screen's own device-name editing already causes
    // elsewhere, not a new kind of disruption.
    await window.electronAPI.setDiscoveryMode(mode).catch(() => {});
    setSavingMode(false);
  }

  // Only files that genuinely still occupy space on this device - a plain
  // sent file's bytes are never kept locally after sending (saved_path
  // stays null, see filetransfer.py's send_file), so counting every
  // "completed" row regardless of direction would overstate real local
  // storage use with transfer history that isn't actually sitting on disk
  // here. The one exception already baked into saved_path itself: a
  // sent voice note does keep a local copy (keep_sender_copy), which is
  // exactly why checking saved_path, not direction, is the honest signal.
  const byCategory = {};
  let totalBytes = 0;
  for (const f of files) {
    if (f.status !== "completed" || !f.saved_path) continue;
    const cat = categoryFor(f.filename);
    byCategory[cat] = (byCategory[cat] || 0) + f.size;
    totalBytes += f.size;
  }
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const receivedCount = files.filter((f) => f.direction === "received" && f.status === "completed").length;

  async function handleClearReceived() {
    const received = files.filter((f) => f.direction === "received" && f.status === "completed");
    if (received.length === 0) return;
    if (!window.confirm(`Delete ${received.length} received file${received.length === 1 ? "" : "s"} from this device? This can't be undone.`)) return;
    setClearingReceived(true);
    await Promise.all(received.map((f) => api.deleteFile(f.transfer_id).catch(() => {})));
    api.allFiles().then(setFiles).catch(() => {});
    setClearingReceived(false);
  }

  function handleCopyDiagnostics() {
    if (!diagnostics) return;
    const keyRate = diagnostics.reachable_peer_count > 0 ? Math.round((diagnostics.key_resolved_count / diagnostics.reachable_peer_count) * 100) : null;
    const text = [
      `Agora diagnostics`,
      `device id: ${diagnostics.device_id}`,
      `device name: ${diagnostics.device_name}`,
      `discovery mode: ${diagnostics.discovery_mode}`,
      `reachable peers: ${diagnostics.reachable_peer_count}`,
      `key-resolved rate: ${keyRate != null ? `${keyRate}%` : "n/a (no peers nearby)"}`,
      `peak throughput: ${diagnostics.peak_throughput_bps ? formatFileSize(diagnostics.peak_throughput_bps) + "/s" : "none observed yet"}`,
      `uptime: ${Math.floor(diagnostics.uptime_sec / 60)}m ${diagnostics.uptime_sec % 60}s`,
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "22px 26px", gap: 18, overflowY: "auto" }}>
      <SubHeader title="Preferences" onBack={onBack} />

      <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
        <button
          onClick={hasElectron ? handleToggleLaunchAtLogin : undefined}
          disabled={!hasElectron}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "transparent", border: "none" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3, textAlign: "left" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)" }}>Start Agora at login</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {hasElectron ? "Launches quietly in the background when you sign in" : "Only available in the desktop app"}
            </div>
          </div>
          <Toggle on={launchAtLogin} disabled={!hasElectron} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "0 2px" }}>DISCOVERY METHOD</div>
        <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
          {DISCOVERY_MODES.map((m, i) => (
            <button
              key={m.value}
              onClick={() => hasElectron && handlePickDiscoveryMode(m.value)}
              disabled={!hasElectron || savingMode}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, background: "transparent", border: "none", borderBottom: i < DISCOVERY_MODES.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 3, textAlign: "left" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{m.label}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.description}</div>
              </div>
              <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 99, border: `2px solid ${discoveryMode === m.value ? "var(--accent)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {discoveryMode === m.value && <span style={{ width: 9, height: 9, borderRadius: 99, background: "var(--accent)" }} />}
              </span>
            </button>
          ))}
        </div>
        {!hasElectron && <div style={{ fontSize: 11.5, color: "var(--text-3)", padding: "0 2px" }}>Only available in the desktop app.</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "0 2px" }}>STORAGE · {formatFileSize(totalBytes)}</div>
        <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 18, overflow: "hidden" }}>
          {categories.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: "var(--text-3)" }}>Nothing saved yet.</div>
          )}
          {categories.map(([name, bytes], i) => (
            <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: i < categories.length - 1 ? "1px solid var(--divider)" : "none" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{name}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatFileSize(bytes)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => window.electronAPI?.openDownloadsFolder?.()}
            disabled={!hasElectron}
            style={{ flex: 1, padding: "10px 0", borderRadius: 12, background: "var(--surface-2)", border: "none", fontSize: 12.5, fontWeight: 600, color: hasElectron ? "var(--text-strong)" : "var(--text-3)" }}
          >
            Reveal folder
          </button>
          <button
            onClick={handleClearReceived}
            disabled={clearingReceived || receivedCount === 0}
            style={{ flex: 1, padding: "10px 0", borderRadius: 12, background: "transparent", border: "1px solid var(--border)", fontSize: 12.5, fontWeight: 600, color: receivedCount === 0 ? "var(--text-3)" : "var(--danger)" }}
          >
            {clearingReceived ? "Clearing…" : `Clear received files${receivedCount ? ` (${receivedCount})` : ""}`}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ font: '600 10.5px/1 "IBM Plex Mono", monospace', letterSpacing: "0.1em", color: "var(--text-3)", padding: "0 2px" }}>DIAGNOSTICS</div>
        <div style={{ padding: 16, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 10 }}>
          {diagnostics ? (
            <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.9, color: "var(--text-2)" }}>
              device id &nbsp;{diagnostics.device_id.slice(0, 13)}…
              <br />
              reachable peers &nbsp;{diagnostics.reachable_peer_count}
              <br />
              key-resolved rate &nbsp;
              {diagnostics.reachable_peer_count > 0 ? `${Math.round((diagnostics.key_resolved_count / diagnostics.reachable_peer_count) * 100)}%` : "n/a, no peers nearby"}
              <br />
              throughput peak &nbsp;{diagnostics.peak_throughput_bps ? `${formatFileSize(diagnostics.peak_throughput_bps)}/s` : "none observed yet"}
              <br />
              uptime &nbsp;{Math.floor(diagnostics.uptime_sec / 60)}m {diagnostics.uptime_sec % 60}s
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>Loading…</div>
          )}
          <button
            onClick={handleCopyDiagnostics}
            disabled={!diagnostics}
            style={{ alignSelf: "flex-start", padding: "7px 13px", borderRadius: 10, background: "var(--surface-2)", border: "none", fontSize: 12, fontWeight: 600, color: "var(--text-strong)" }}
          >
            {copied ? "Copied" : "Copy diagnostics"}
          </button>
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
