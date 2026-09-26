import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";

export function usePeers() {
  const [peers, setPeers] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const list = await api.peers();
        if (!cancelled) setPeers(list);
      } catch {
        // backend not reachable yet - keep retrying silently
      }
    }

    poll();
    const interval = setInterval(poll, 2000);
    const stopEvents = connectEvents((evt) => {
      if (evt.type === "peer_joined" || evt.type === "peer_left") poll();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      stopEvents();
    };
  }, []);

  // Discovery itself is always continuously running in the background
  // (mDNS browser + UDP listener, both event-driven) - there's no distinct
  // "scan" operation to trigger backend-side. What "Rescan" can honestly do
  // is force an immediate re-read of the current peer list instead of
  // waiting for the next 2s poll tick. A minimum visible duration is
  // enforced so the button's spin animation is perceptible even though a
  // LAN fetch usually resolves in a few milliseconds - otherwise clicking it
  // would give no feedback at all that anything happened.
  async function refresh() {
    setRefreshing(true);
    const minDuration = new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const list = await api.peers();
      setPeers(list);
    } catch {
      // ignore - the regular poll interval will retry
    }
    await minDuration;
    setRefreshing(false);
  }

  return { peers, refreshing, refresh };
}
