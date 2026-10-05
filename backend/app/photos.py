"""
Avatar photo sync: a peer's photo only ever needs to cross the network once
per actual change, not once per sighting.

Deliberately does NOT touch the signed discovery announcement or
crypto_identity.py's verification path at all - that path is adversarially
tested (see BUILD_LOG.md's Steps 25-26) and casually extending it with a
new field is a real way to introduce a subtle bug in something security-
critical. Instead, a peer's current photo is asked for lazily, over the
same encrypted control-message channel every other peer-to-peer exchange
(file transfer, calling) already rides, the same request/response-with-a-
Future pattern filetransfer.py's offer/response uses. PhotoStore caches
the result to disk so a later sighting with the same content costs nothing;
GET /peers/{peer_id}/photo (see api.py) serves a cached copy immediately
when one exists and refreshes it in the background if the peer is live,
rather than making every view wait on a network round trip.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
from pathlib import Path
from typing import Optional


class PhotoStore:
    """Plain file-cache layer: this device's own photo (served to peers on
    request) plus whatever photos have actually been fetched from peers so
    far. No database table for the bytes themselves - a file on disk is the
    simplest thing that works for what's fundamentally a small blob cache."""

    def __init__(self, data_dir: str):
        self.dir = Path(data_dir) / "photos"
        self.peers_dir = self.dir / "peers"
        self.peers_dir.mkdir(parents=True, exist_ok=True)
        self.self_path = self.dir / "self.jpg"

    def set_self_photo(self, data: bytes) -> str:
        self.self_path.write_bytes(data)
        return hashlib.sha256(data).hexdigest()

    def clear_self_photo(self) -> None:
        self.self_path.unlink(missing_ok=True)

    def get_self_photo(self) -> Optional[bytes]:
        return self.self_path.read_bytes() if self.self_path.exists() else None

    def _peer_path(self, peer_id: str) -> Path:
        # peer_id is this app's own opaque generated identifier (see
        # crypto_identity.py) - never attacker-chosen text that could
        # escape this directory via a path-traversal filename.
        return self.peers_dir / f"{peer_id}.jpg"

    def get_peer_photo(self, peer_id: str) -> Optional[bytes]:
        path = self._peer_path(peer_id)
        return path.read_bytes() if path.exists() else None

    def set_peer_photo(self, peer_id: str, data: bytes) -> str:
        self._peer_path(peer_id).write_bytes(data)
        return hashlib.sha256(data).hexdigest()

    def clear_peer_photo(self, peer_id: str) -> None:
        self._peer_path(peer_id).unlink(missing_ok=True)


class PhotoExchange:
    """The request/response half, registered as a messaging.py control
    handler exactly like filetransfer.py and calling.py already are."""

    def __init__(self, messaging, store: PhotoStore):
        self.messaging = messaging
        self.store = store
        self._waiters: dict[str, asyncio.Future] = {}
        messaging.add_control_handler(self._on_control)

    async def _on_control(self, mtype: str, peer_id: str, msg: dict) -> None:
        if mtype == "photo_request":
            data = self.store.get_self_photo()
            payload = {"type": "photo_response", "photo_b64": base64.b64encode(data).decode() if data else None}
            await self.messaging.send_control(peer_id, payload)
        elif mtype == "photo_response":
            fut = self._waiters.pop(peer_id, None)
            if fut and not fut.done():
                fut.set_result(msg.get("photo_b64"))

    async def fetch(self, peer_id: str, timeout: float = 5.0) -> Optional[bytes]:
        """Asks peer_id for their current photo right now. Returns the raw
        bytes, or None if they genuinely have no photo set. Raises
        ConnectionError if they're not reachable at all, or TimeoutError if
        they don't answer in time - either way the caller treats "couldn't
        get a fresh one" the same regardless of which."""
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        self._waiters[peer_id] = fut
        sent = await self.messaging.send_control(peer_id, {"type": "photo_request"})
        if not sent:
            self._waiters.pop(peer_id, None)
            raise ConnectionError(f"peer {peer_id} not reachable")
        try:
            b64 = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._waiters.pop(peer_id, None)
            raise
        return base64.b64decode(b64) if b64 else None
