import { useState } from "react";
import { api } from "../api";
import { initials } from "../lib/avatar";

// Tries a peer's real avatar photo first, falling back to the existing
// initials-circle look on any failure - no photo set, the peer isn't
// reachable and nothing is cached yet, a malformed response - never a
// broken-image icon. See backend/app/photos.py for how a photo is actually
// fetched and cached; this component doesn't know or care whether what
// comes back was a cache hit or a fresh network fetch, that's the whole
// point of the caching living server-side.
//
// `failed` is keyed by peer_id so switching to a different peer always
// tries that peer's own photo fresh, rather than carrying over a previous
// peer's failure.
export default function PeerAvatar({ peerId, name, size = 38, bg, text, fontSize = 13, fontFamily, fontWeight = 600 }) {
  const [failedFor, setFailedFor] = useState(null);
  const failed = failedFor === peerId;

  const circleStyle = { width: size, height: size, borderRadius: 99, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" };

  if (failed || !peerId) {
    return (
      <span style={{ ...circleStyle, background: bg, color: text, fontSize, fontWeight, fontFamily }}>{initials(name || "?")}</span>
    );
  }

  return (
    <img
      key={peerId}
      src={api.peerPhotoUrl(peerId)}
      alt={name}
      onError={() => setFailedFor(peerId)}
      style={{ ...circleStyle, objectFit: "cover", background: bg }}
    />
  );
}
