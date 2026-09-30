import { useEffect, useState } from "react";
import { connectEvents } from "../api";

// A peer_id the backend already had a trust-on-first-use key recorded for
// just showed up with a *different* key (see messaging.py's get_shared_key
// and crypto_identity.py) - either a real reinstall on their end, or
// someone else now claiming that identity. Real enough to interrupt
// whatever screen is open, not tucked away in a menu somewhere, but not a
// blocking modal either - it's dismissible, since there's no automatic
// "correct" action here for the app to take on the user's behalf.
export function useIdentityWarnings() {
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    const stop = connectEvents((evt) => {
      if (evt.type === "peer_identity_changed") {
        setWarnings((prev) => [...prev, { peerId: evt.peer_id, name: evt.name, id: `${evt.peer_id}-${Date.now()}` }]);
      }
    });
    return stop;
  }, []);

  function dismiss(id) {
    setWarnings((prev) => prev.filter((w) => w.id !== id));
  }

  return { warnings, dismiss };
}
