"""
Phase 2 - Messaging. Phase 5 - Transport encryption riding the same
connection (see crypto_identity.py for the full design).

Each device runs a WebSocket server on its discovery-advertised port.
Sending a message to a peer means opening (or reusing) a direct WebSocket
connection to that peer's discovered ip:port - no server in between.

Wire protocol:
    {"type": "hello", "peer_id": ..., "device_name": ...}  - sent first on
        any new connection, as a plaintext TEXT frame. Carries no secret -
        it's an identity announcement, and the "device_name" is already
        broadcast openly by discovery anyway. Nothing else is ever safe to
        learn about a connection before a shared key can be derived, so
        "hello" is the only frame type that is ever sent unencrypted.
    Every other frame ("chat", "ack", and every control-channel message
        file transfer/calling/groups/deletion send via send_control) is
        JSON-serialized, then encrypted with that peer's derived shared
        key, and sent as a BINARY frame. The `websockets` library already
        distinguishes text vs. binary frames on the wire (str vs. bytes),
        so that distinction alone is what tells a receiver "this is the
        one-time plaintext handshake" vs. "this needs decrypting" -  no
        extra wrapper field needed.

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

from app import crypto_identity
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
        on_identity_changed: Optional[Callable[[str, str], None]] = None,
    ):
        self.discovery = discovery
        self.store = store
        self.on_message = on_message
        # Fired (peer_id, name) when a peer_id we already have a
        # trust-on-first-use key recorded for shows up with a *different*
        # key - see get_directional_keys(). Real signal worth surfacing to a
        # human, not something to silently accept or silently block.
        self.on_identity_changed = on_identity_changed
        # Lets other services (file transfer, calling) ride this same
        # connection for their own message types without messaging.py
        # needing to know anything about them. Each handler is called as
        # handler(msg_type, peer_id, msg) for every control frame - it's the
        # handler's own job to ignore types it doesn't recognize.
        self._control_handlers: list[Callable[[str, str, dict], "asyncio.Future"]] = []

        self.peer_id = discovery.peer_id
        self.device_name = discovery.device_name
        self.port = discovery.service_port

        # This device's own long-lived X25519 keypair (generated once, on
        # first run - see storage.get_or_create_device_keys). Never leaves
        # this process; only the public half is ever broadcast, by
        # discovery.py, alongside peer_id/name.
        self._device_keys = store.get_or_create_device_keys()
        # peer_id -> (send_key, recv_key). An X25519 shared secret is
        # stable for the lifetime of both keypairs involved, so this is
        # computed once per peer per process and reused for every
        # connection to/from them after that - no per-connection handshake.
        # Two distinct directional keys, not one shared key reused both
        # ways - see crypto_identity.derive_directional_keys for why a
        # single symmetric key is a real, exploitable reflection attack
        # (confirmed directly, not theoretical).
        self._shared_keys: dict[str, tuple[bytes, bytes]] = {}

        # peer_id -> outbound websocket connection currently used for sending
        self._out_conns: dict[str, object] = {}
        self._lock = asyncio.Lock()
        self._server = None
        self._seen_peers: set[str] = set()
        self._flush_task: Optional[asyncio.Task] = None

    # -- encryption ---------------------------------------------------------

    async def get_directional_keys(self, peer_id: str) -> Optional[tuple[bytes, bytes]]:
        """The one place a per-peer (send_key, recv_key) pair is derived,
        cached, and checked against trust-on-first-use. Returns None if
        this peer's public key hasn't been resolved via discovery yet
        (nothing to derive from) - callers treat that as "can't talk to
        this peer yet", never as a reason to fall back to sending anything
        unencrypted.

        Known limitation: the trust-on-first-use check only runs the first
        time this process derives keys for a given peer_id - every later
        call for that same peer_id in this same process returns the cached
        keys straight away, without re-checking. So a key that genuinely
        changes mid-session (not just on this device's next restart) won't
        raise on_identity_changed until this device restarts - it'll just
        go quiet with that peer instead, since frames encrypted with the
        now-stale cached key will never decrypt on their new end either.
        Not a security hole (nothing decrypts wrong, communication just
        stops), but a real gap in how quickly the warning itself surfaces."""
        cached = self._shared_keys.get(peer_id)
        if cached is not None:
            return cached
        peer = next((p for p in self.discovery.registry.list() if p.peer_id == peer_id), None)
        if peer is None or not peer.public_key:
            return None
        old_key = await self.store.check_and_remember_peer_key(peer_id, peer.name, peer.public_key)
        if old_key is not None and self.on_identity_changed:
            self.on_identity_changed(peer_id, peer.name)
        keys = crypto_identity.derive_directional_keys(self._device_keys["private_key"], peer.public_key, self.peer_id, peer_id)
        self._shared_keys[peer_id] = keys
        return keys

    async def get_send_key(self, peer_id: str) -> Optional[bytes]:
        keys = await self.get_directional_keys(peer_id)
        return keys[0] if keys else None

    async def get_recv_key(self, peer_id: str) -> Optional[bytes]:
        keys = await self.get_directional_keys(peer_id)
        return keys[1] if keys else None

    async def _encrypt_for(self, peer_id: str, message: dict) -> Optional[bytes]:
        send_key = await self.get_send_key(peer_id)
        if send_key is None:
            return None
        return crypto_identity.encrypt(send_key, json.dumps(message).encode())

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
                if isinstance(raw, str):
                    # The one and only plaintext frame type - see the
                    # module docstring. Anything else arriving as a text
                    # frame isn't a message this protocol ever sends, so
                    # it's silently ignored rather than fed to json.loads.
                    msg = json.loads(raw)
                    if msg.get("type") == "hello":
                        remote_peer_id = msg["peer_id"]
                    continue

                # A binary frame - i.e. an encrypted real frame - arriving
                # before "hello" has told us who this is makes no sense
                # (nothing to derive a shared key with yet); drop it.
                if not remote_peer_id:
                    continue

                # Checked on every real frame, not just "hello" - a peer
                # already mid-connection when the block happens must not
                # keep riding that already-open socket. Every peer-to-peer
                # channel (chat, files, calls, group traffic) rides this
                # same connection, so refusing it right here is the one
                # real choke point that actually blocks all of them at
                # once, not just whichever message type happened to get a
                # check added to its own handler.
                if await self.store.is_peer_blocked(remote_peer_id):
                    await ws.close()
                    return

                recv_key = await self.get_recv_key(remote_peer_id)
                if recv_key is None:
                    continue  # this peer's public key isn't resolved yet
                try:
                    plaintext = crypto_identity.decrypt(recv_key, raw)
                except crypto_identity.DecryptionError:
                    continue  # tampered/corrupt/stale-key frame - drop, don't crash
                msg = json.loads(plaintext)
                mtype = msg.get("type")
                if mtype == "chat":
                    await self._on_chat_received(remote_peer_id, msg)
                    ack = await self._encrypt_for(remote_peer_id, {"type": "ack", "msg_id": msg["msg_id"]})
                    if ack is not None:
                        await ws.send(ack)
                elif mtype == "ack":
                    await self.store.update_status(msg["msg_id"], "delivered")
                else:
                    await self._dispatch_control(mtype, remote_peer_id, msg)
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
        # Blocking is bidirectional: unblock first if you actually want to
        # reach someone again. Checked before the cached-connection lookup
        # too, so an existing open connection from before the block can't
        # keep being reused to send through it.
        if await self.store.is_peer_blocked(peer_id):
            return None

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
                if isinstance(raw, str):
                    continue  # this side never expects a "hello" back
                recv_key = await self.get_recv_key(peer_id)
                if recv_key is None:
                    continue
                try:
                    plaintext = crypto_identity.decrypt(recv_key, raw)
                except crypto_identity.DecryptionError:
                    continue
                msg = json.loads(plaintext)
                mtype = msg.get("type")
                if mtype == "ack":
                    await self.store.update_status(msg["msg_id"], "delivered")
                else:
                    await self._dispatch_control(mtype, peer_id, msg)
        except websockets.ConnectionClosed:
            pass
        finally:
            await self._drop_connection(peer_id)

    # -- control message fan-out ------------------------------------------

    def add_control_handler(self, handler: Callable[[str, str, dict], "asyncio.Future"]) -> None:
        """Registers another service (file transfer, calling, ...) to receive
        every control-type frame this connection sees. Each handler decides
        for itself which message types it cares about."""
        self._control_handlers.append(handler)

    async def _dispatch_control(self, mtype: str, peer_id: str, msg: dict) -> None:
        for handler in self._control_handlers:
            await handler(mtype, peer_id, msg)

    async def _drop_connection(self, peer_id: str) -> None:
        async with self._lock:
            self._out_conns.pop(peer_id, None)

    async def send_control(self, peer_id: str, message: dict) -> bool:
        """Send an arbitrary JSON control message to a peer over the same
        connection chat uses - for file-transfer offers/responses/etc.
        Every real service in this app (file transfer, calling, groups,
        deletion) sends exclusively through this one method, so encrypting
        here covers all of them at once."""
        try:
            conn = await self._get_connection(peer_id)
            if conn is None:
                return False
            blob = await self._encrypt_for(peer_id, message)
            if blob is None:
                return False
            await conn.send(blob)
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
            blob = await self._encrypt_for(peer_id, {"type": "chat", "msg_id": msg_id, "body": body, "ts": ts})
            if blob is None:
                return False  # peer's public key not resolved yet - stays 'pending'
            await conn.send(blob)
            await self.store.update_status(msg_id, "sent")
            return True
        except (websockets.ConnectionClosed, OSError):
            await self._drop_connection(peer_id)
            return False

    # -- reconnect / flush -------------------------------------------------

    async def _flush_pending_loop(self) -> None:
        """Whenever a peer we have pending messages for becomes visible again,
        resend them in original order - no reordering, no silent drop.

        Note: this can race a concurrent direct send() for the same message,
        in the brief window between save_message(status="pending") and
        _try_deliver() actually marking it "sent" - if a flush tick lands
        exactly then, the same message can go out twice. Harmless (the
        receiving side's save is keyed by msg_id, so a real duplicate just
        overwrites itself with identical content), but worth knowing if
        you're ever asserting on exact send counts in a test - see
        _test_encryption.py's TEST 3 for a case that had to explicitly
        account for it."""
        while True:
            await asyncio.sleep(2)
            visible_ids = {p.peer_id for p in self.discovery.registry.list()}
            for peer_id in visible_ids:
                pending = await self.store.pending_for_peer(peer_id)
                for m in pending:
                    await self._try_deliver(m.peer_id, m.msg_id, m.body, m.ts)
