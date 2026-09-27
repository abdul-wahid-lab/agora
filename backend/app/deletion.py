"""
"Delete for everyone."

Rides the same WebSocket control-message mechanism file transfer and calling
already use (MessagingService.add_control_handler / send_control) - no new
socket, no change to messaging.py's core chat/ack protocol.

Wire message: {"type": "delete", "msg_id": ...}

Offline handling deliberately mirrors messaging.py's own
_flush_pending_loop, the proven mechanism a normal chat message already
uses to survive a peer being briefly offline: if the peer isn't reachable
the moment you delete, the intent is remembered in the `pending_deletes`
table and a background loop retries it, in original order, the next time
that peer is visible to discovery - never silently dropped.

No time window (unlike WhatsApp's ~1 hour): this app's identity model
doesn't need that restriction, see TASK_QUEUE.md's reasoning. Deleting your
own local copy always happens immediately and unconditionally; only
notifying the peer is subject to the retry-until-delivered behavior above.
"""

from __future__ import annotations

import asyncio
from typing import Callable, Optional

from app.discovery import PeerDiscovery
from app.messaging import MessagingService
from app.storage import MessageStore


class DeleteService:
    def __init__(
        self,
        discovery: PeerDiscovery,
        messaging: MessagingService,
        store: MessageStore,
        on_remote_delete: Optional[Callable[[str, str], None]] = None,  # peer_id, msg_id
    ):
        self.discovery = discovery
        self.messaging = messaging
        self.store = store
        self.on_remote_delete = on_remote_delete
        messaging.add_control_handler(self._on_control)
        self._flush_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        self._flush_task = asyncio.create_task(self._flush_pending_loop())

    async def stop(self) -> None:
        if self._flush_task:
            self._flush_task.cancel()

    async def delete_for_everyone(self, peer_id: str, msg_id: str) -> None:
        """Deletes the local copy immediately (same effect as 'delete for
        me'), then best-effort notifies the peer. If they're not reachable
        right now, the notification is queued for automatic retry rather
        than lost."""
        await self.store.delete_message(msg_id)
        sent = await self.messaging.send_control(peer_id, {"type": "delete", "msg_id": msg_id})
        if not sent:
            await self.store.save_pending_delete(msg_id, peer_id)

    async def _on_control(self, mtype: str, peer_id: str, msg: dict) -> None:
        if mtype != "delete":
            return  # not ours - file transfer/calling's own handlers take the rest
        msg_id = msg["msg_id"]
        await self.store.delete_message(msg_id)
        if self.on_remote_delete:
            self.on_remote_delete(peer_id, msg_id)

    async def _flush_pending_loop(self) -> None:
        while True:
            await asyncio.sleep(2)
            visible_ids = {p.peer_id for p in self.discovery.registry.list()}
            for peer_id in visible_ids:
                for msg_id in await self.store.pending_deletes_for_peer(peer_id):
                    sent = await self.messaging.send_control(peer_id, {"type": "delete", "msg_id": msg_id})
                    if sent:
                        await self.store.remove_pending_delete(msg_id)
