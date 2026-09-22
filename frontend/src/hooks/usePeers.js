import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";

export function usePeers() {
  const [peers, setPeers] = useState([]);

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

  return peers;
}
