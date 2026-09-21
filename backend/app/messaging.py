"""
Phase 2 - Messaging.

Each device runs a WebSocket server on its discovery-advertised port.
Sending a message to a peer means opening (or reusing) a direct WebSocket
connection to that peer's discovered ip:port - no server in between.

Wire protocol (JSON text frames):
    {"type": "hello", "peer_id": ..., "device_name": ...}   - sent first on any new connection
    {"type": "chat", "msg_id": ..., "body": ..., "ts": ...} - a message
    {"type": "ack", "msg_id": ...}                          - delivery acknowledgment

Ordering: guaranteed by using a single persistent connection per peer for
sending (WebSocket/TCP preserves order within one connection). Messages
sent while a peer is unreachable are left as 'pending' in storage and
flushed, in original order, the next time that peer is seen again by
discovery - not reordered, not dropped.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Optional

import websockets
from websockets.asyncio.client import connect as ws_connect
from websockets.asyncio.server import serve as ws_serve

from app.discovery import PeerDiscovery
from app.storage import MessageStore


@dataclass
class IncomingMessage:
    peer_id: str
    body: str
    ts: float


class MessagingService:
    def __init__(
        self,
        discovery: PeerDiscovery,
        store: MessageStore,
        on_message: Optional[Callable[[IncomingMessage], None]] = None,
        on_control: Optional[Callable[[str, str, dict], "asyncio.Future"]] = None,
    ):
        self.discovery = discovery
        self.store = store
        self.on_message = on_message
        # Lets other services (file transfer) ride this same connection for
        # their own message types without messaging.py needing to know
        # anything about them. Called as on_control(msg_type, peer_id, msg).
        self.on_control = on_control

        self.peer_id = discovery.peer_id
        self.device_name = discovery.device_name
        self.port = discovery.service_port

        # peer_id -> outbound websocket connection currently used for sending
        self._out_conns: dict[str, object] = {}
        self._lock = asyncio.Lock()
        self._server = None
        self._seen_peers: set[str] = set()
        self._flush_task: Optional[asyncio.Task] = None

    # -- lifecycle -----------------------------------------------------

    async def start(self) -> None:
        self._server = await ws_serve(self._handle_inbound, "0.0.0.0", self.port)
        self._flush_task = asyncio.create_task(self._flush_pending_loop())

    async def stop(self) -> None:
        if self._flush_task:
            self._flush_task.cancel()
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        async with self._lock:
            for conn in self._out_conns.values():
                await conn.close()

    # -- inbound (server side) --------------------------------------------

    async def _handle_inbound(self, ws) -> None:
        remote_peer_id = None
        try:
            async for raw in ws:
                msg = json.loads(raw)
                mtype = msg.get("type")
                if mtype == "hello":
                    remote_peer_id = msg["peer_id"]
                elif mtype == "chat" and remote_peer_id:
                    await self._on_chat_received(remote_peer_id, msg)
                    await ws.send(json.dumps({"type": "ack", "msg_id": msg["msg_id"]}))
                elif mtype == "ack":
                    await self.store.update_status(msg["msg_id"], "delivered")
                elif remote_peer_id and self.on_control:
                    await self.on_control(mtype, remote_peer_id, msg)
        except websockets.ConnectionClosed:
            pass

    async def _on_chat_received(self, peer_id: str, msg: dict) -> None:
        await self.store.save_message(
            msg_id=msg["msg_id"], peer_id=peer_id, direction="received", body=msg["body"], status="received", ts=msg.get("ts", time.time())
        )
        if self.on_message:
            self.on_message(IncomingMessage(peer_id=peer_id, body=msg["body"], ts=msg.get("ts", time.time())))

    # -- outbound (client side) -------------------------------------------

    async def _get_connection(self, peer_id: str):
        async with self._lock:
            conn = self._out_conns.get(peer_id)
            if conn is not None:
                return conn

            peer = next((p for p in self.discovery.registry.list() if p.peer_id == peer_id), None)
            if peer is None:
                return None

            conn = await ws_connect(f"ws://{peer.address}:{peer.port}")
            await conn.send(json.dumps({"type": "hello", "peer_id": self.peer_id, "device_name": self.device_name}))
            self._out_conns[peer_id] = conn
            # Without this, nothing ever reads frames arriving on an outbound
            # connection - delivery acks would be sent by the peer but never
            # consumed, so status would never leave 'sent' and the pending-
            # flush loop below would keep resending the same message forever.
            asyncio.create_task(self._read_outbound(peer_id, conn))
            return conn

    async def _read_outbound(self, peer_id, conn) -> None:
        try:
            async for raw in conn:
                msg = json.loads(raw)
                mtype = msg.get("type")
                if mtype == "ack":
                    await self.store.update_status(msg["msg_id"], "delivered")
                elif self.on_control:
                    await self.on_control(mtype, peer_id, msg)
        except websockets.ConnectionClosed:
            pass
        finally:
            await self._drop_connection(peer_id)

    async def _drop_connection(self, peer_id: str) -> None:
        async with self._lock:
            self._out_conns.pop(peer_id, None)

    async def send_control(self, peer_id: str, message: dict) -> bool:
        """Send an arbitrary JSON control message to a peer over the same
        connection chat uses - for file-transfer offers/responses/etc."""
        try:
            conn = await self._get_connection(peer_id)
            if conn is None:
                return False
            await conn.send(json.dumps(message))
            return True
        except (websockets.ConnectionClosed, OSError):
            await self._drop_connection(peer_id)
            return False

    async def send(self, peer_id: str, body: str) -> str:
        """Queue+attempt a send. Returns the generated msg_id immediately."""
        msg_id = str(uuid.uuid4())
        ts = time.time()
        await self.store.save_message(msg_id=msg_id, peer_id=peer_id, direction="sent", body=body, status="pending", ts=ts)
        await self._try_deliver(peer_id, msg_id, body, ts)
        return msg_id

    async def _try_deliver(self, peer_id: str, msg_id: str, body: str, ts: float) -> bool:
        try:
            conn = await self._get_connection(peer_id)
            if conn is None:
                return False  # peer not currently discoverable - stays 'pending'
            await conn.send(json.dumps({"type": "chat", "msg_id": msg_id, "body": body, "ts": ts}))
            await self.store.update_status(msg_id, "sent")
            return True
        except (websockets.ConnectionClosed, OSError):
            await self._drop_connection(peer_id)
            return False

    # -- reconnect / flush -------------------------------------------------

    async def _flush_pending_loop(self) -> None:
        """Whenever a peer we have pending messages for becomes visible again,
        resend them in original order - no reordering, no silent drop."""
        while True:
            await asyncio.sleep(2)
            visible_ids = {p.peer_id for p in self.discovery.registry.list()}
            for peer_id in visible_ids:
                pending = await self.store.pending_for_peer(peer_id)
                for m in pending:
                    await self._try_deliver(m.peer_id, m.msg_id, m.body, m.ts)
