import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import NearbyScreen from "./components/NearbyScreen";
import ChatsScreen from "./components/ChatsScreen";
import Onboarding from "./components/Onboarding";
import { api } from "./api";

const ONBOARDING_KEY = "agora.onboarded";

export default function App() {
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(ONBOARDING_KEY) === "1");
  const [active, setActive] = useState("nearby");
  const [me, setMe] = useState(null);
  const [peerCount, setPeerCount] = useState(0);
  const [connected, setConnected] = useState(false);

  function finishOnboarding(chosenName) {
    // NOTE: this doesn't actually rename the device on the network yet -
    // device_name is fixed at backend startup via an env var, there's no
    // PUT /me endpoint. Stored here so the UI has *something* to show;
    // see BUILD_LOG.md's Step 2 known limitations.
    localStorage.setItem("agora.chosenName", chosenName);
    localStorage.setItem(ONBOARDING_KEY, "1");
    setOnboarded(true);
  }

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [meData, peers] = await Promise.all([api.me(), api.peers()]);
        if (cancelled) return;
        setMe(meData);
        setPeerCount(peers.length);
        setConnected(true);
      } catch {
        if (!cancelled) setConnected(false);
      }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!onboarded) {
    return (
      <div style={{ display: "flex", height: "100vh", background: "var(--ground)" }}>
        <Onboarding onComplete={finishOnboarding} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar active={active} onSelect={setActive} />
        <main style={{ flex: 1, display: "flex", minWidth: 0, background: "var(--ground)" }}>
          {active === "nearby" && <NearbyScreen me={me} />}
          {active === "chats" && <ChatsScreen />}
          {active !== "nearby" && active !== "chats" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>
              <p className="serif" style={{ fontSize: 22 }}>
                {active[0].toUpperCase() + active.slice(1)} — coming next
              </p>
            </div>
          )}
        </main>
      </div>

      <div
        style={{
          flexShrink: 0,
          height: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface)",
          fontSize: 12,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: connected ? "var(--accent-strong)" : "var(--danger)" }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connected ? "var(--accent)" : "var(--danger)",
            }}
          />
          {connected ? "LAN-only" : "backend unreachable"}
        </span>
        <span className="mono" style={{ color: "var(--text-3)" }}>
          {peerCount} {peerCount === 1 ? "peer" : "peers"}
        </span>
      </div>
    </div>
  );
}
