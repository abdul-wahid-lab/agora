import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";

// Mirrors useConversations.js's shape - a group is just another kind of
// "thing with a name and a message history" as far as the Chats list is
// concerned, backed by a completely separate table/API surface though
// (groups.py), since it's real N-way fan-out, not a 1:1 thread.
export function useGroups() {
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.listGroups();
        if (!cancelled) setGroups(list);
      } catch {
        // ignore - next poll/event retries
      }
    }
    load();
    const interval = setInterval(load, 3000);
    const stop = connectEvents((evt) => {
      if (evt.type === "group_invite") load();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      stop();
    };
  }, []);

  return groups;
}
