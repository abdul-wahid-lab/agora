"""
Disappearing messages.

A per-conversation setting: messages older than a chosen duration get
deleted automatically. Deliberately **local-only**, the same honest scoping
already used for mute/avatar-color/chat-theme choices in this app: this
device sweeps its own copy of the conversation, nothing is sent to the peer
telling them to do the same. Real "both sides vanish together" disappearing
messages would need a new wire message announcing the setting, the peer's
own device enforcing it independently, and a real answer for what happens
to a setting change mid-conversation - deliberately out of scope for a
first version, and the UI says "on this device" plainly rather than
implying a guarantee this doesn't provide.

No new wire protocol, no new socket: this is a lightweight periodic sweep
against `storage.py`'s own `messages` table, the exact same
"start()/stop()/background-loop-on-a-timer" shape `messaging.py`'s
`_flush_pending_loop` and `deletion.py`'s own loop already use.
"""

from __future__ import annotations

import asyncio
import time
from typing import Callable, Optional

from app.storage import MessageStore

SWEEP_INTERVAL_SECONDS = 30


class DisappearingMessagesService:
    def __init__(self, store: MessageStore, on_swept: Optional[Callable[[str, int], None]] = None):
        self.store = store
        # peer_id, count deleted - lets the UI drop an already-open
        # conversation's expired bubbles live instead of waiting for the
        # next history poll.
        self.on_swept = on_swept
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._sweep_loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _sweep_loop(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
            for setting in await self.store.list_disappearing_settings():
                cutoff = time.time() - setting["duration_seconds"]
                deleted = await self.store.delete_expired_messages(setting["peer_id"], cutoff)
                if deleted and self.on_swept:
                    self.on_swept(setting["peer_id"], deleted)
