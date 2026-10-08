"""
Per-peer latency and connection-quality, the Round 2 design-audit item.
Real round-trip measurement, not a decoration: a "ping"/"pong" control
message pair rides the same live WebSocket connection messaging.py already
keeps open per peer for chat/file-transfer/calling, so the number shown is
the actual time a real frame takes to reach that peer and come back right
now - not a synthetic or cached value.

"Signal strength" has no real meaning here the way WiFi RSSI would - this
is a LAN software connection, not a radio link - so rather than faking a
signal-bars icon with nothing real behind it, quality is approximated from
the measured round-trip time and whether the last attempt even succeeded.
"""

import asyncio
import time
import uuid
from typing import Optional

from app.discovery import PeerDiscovery
from app.messaging import MessagingService

PING_INTERVAL_SEC = 5.0
PING_TIMEOUT_SEC = 3.0


def quality_for_rtt(rtt_ms: Optional[float]) -> str:
    if rtt_ms is None:
        return "unreachable"
    if rtt_ms <= 30:
        return "excellent"
    if rtt_ms <= 80:
        return "good"
    if rtt_ms <= 200:
        return "fair"
    return "weak"


class LatencyService:
    def __init__(self, discovery: PeerDiscovery, messaging: MessagingService):
        self.discovery = discovery
        self.messaging = messaging
        self.latest: dict[str, dict] = {}  # peer_id -> {rtt_ms, quality, measured_at}
        self._waiters: dict[str, asyncio.Future] = {}
        self._loop_task: Optional[asyncio.Task] = None
        messaging.add_control_handler(self._on_control)

    async def start(self) -> None:
        self._loop_task = asyncio.create_task(self._ping_loop())

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()

    async def _on_control(self, mtype: str, peer_id: str, msg: dict) -> None:
        if mtype == "ping":
            await self.messaging.send_control(peer_id, {"type": "pong", "nonce": msg["nonce"], "echoed_sent_at": msg["sent_at"]})
        elif mtype == "pong":
            fut = self._waiters.pop(msg["nonce"], None)
            if fut and not fut.done():
                fut.set_result(msg["echoed_sent_at"])

    async def ping(self, peer_id: str) -> Optional[float]:
        """One real round trip to peer_id, in milliseconds - None if it
        timed out or couldn't even be sent (peer not currently reachable)."""
        nonce = uuid.uuid4().hex
        sent_at = time.time()
        waiter: asyncio.Future = asyncio.get_event_loop().create_future()
        self._waiters[nonce] = waiter
        ok = await self.messaging.send_control(peer_id, {"type": "ping", "nonce": nonce, "sent_at": sent_at})
        if not ok:
            self._waiters.pop(nonce, None)
            return None
        try:
            await asyncio.wait_for(waiter, timeout=PING_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            self._waiters.pop(nonce, None)
            return None
        return (time.time() - sent_at) * 1000

    async def _ping_loop(self) -> None:
        while True:
            for peer in self.discovery.registry.list():
                rtt_ms = await self.ping(peer.peer_id)
                self.latest[peer.peer_id] = {
                    "rtt_ms": round(rtt_ms, 1) if rtt_ms is not None else None,
                    "quality": quality_for_rtt(rtt_ms),
                    "measured_at": time.time(),
                }
            await asyncio.sleep(PING_INTERVAL_SEC)
