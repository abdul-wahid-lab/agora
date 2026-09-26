import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";

// Shared by ChatsListPanel (the list itself) and App (which needs a
// conversation's saved name/peer_id to open it even when that peer isn't
// currently live in usePeers - see App.jsx's `selectedPeer` fallback).
export function useConversations() {
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.conversations();
        if (!cancelled) setConversations(list);
      } catch {
        // ignore - next poll/event retries
      }
    }
    load();
    const interval = setInterval(load, 3000);
    const stop = connectEvents((evt) => {
      if (evt.type === "message") load();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      stop();
    };
  }, []);

  return conversations;
}
