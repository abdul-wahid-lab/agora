import { useEffect, useState } from "react";
import { api } from "../api";

// Shared by TitleBar.jsx (the Conversation menu's Block/Unblock item) and
// ConversationPane.jsx (the blocked-state banner) so both agree on the same
// real GET /peers/blocked check without duplicating the fetch logic.
//
// Polls on a short interval rather than relying only on `version` - the two
// call sites are separate components with no shared state, so a block
// toggled from one (say, the top menu) needs to reach the other (the
// conversation banner) without either needing to know the other exists.
// Found this the hard way live-testing: blocking via the menu correctly hit
// the real backend, but the conversation's own banner never appeared since
// nothing had told it to re-check. `version` still lets the same component
// that just toggled it get the very next poll without waiting out the
// interval.
const POLL_INTERVAL_MS = 2000;

export function useIsPeerBlocked(peerId, version = 0) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!peerId) {
      setBlocked(false);
      return;
    }
    let cancelled = false;
    function load() {
      api
        .blockedPeers()
        .then((list) => {
          if (!cancelled) setBlocked(list.some((p) => p.peer_id === peerId));
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [peerId, version]);

  return blocked;
}
