"""
Group chat and group calling.

No new server or relay of any kind, this rides the exact same
peer-to-peer building blocks every other feature here already uses. A
"group" is purely a locally-agreed-upon membership list, not a real
resource anywhere: each member's device independently stores its own copy
of who's in it (via group_invite), and there's no single owner who could
go offline and take the group down with them.

Wire protocol (control messages, over the existing per-peer WebSocket,
riding MessagingService.add_control_handler/send_control the same way
filetransfer.py and deletion.py do):
    group_invite     {group_id, name, members: [{peer_id, name}, ...]}
    group_message    {group_id, msg_id, sender_peer_id, sender_name, body, ts}
    group_call_start {group_id, group_call_id, media}

Group messaging: whoever sends a message fans the *same* group_message
control frame out to every other member individually, over each member's
own existing 1:1 connection. Deliberately no ack/retry/offline-queue for
group messages in this first version - a member who's offline at send time
just misses it, unlike 1:1 chat's _flush_pending_loop. Real, known
limitation, not an oversight, see TASK_QUEUE.md.

Group file/image sharing: not a new protocol at all, "sending a file to a
group" is just calling filetransfer.py's existing send_file() once per
other member, each a completely normal, independent 1:1 transfer (its own
transfer_id, its own accept/decline, its own resume-on-drop), just tagged
with this group's id so every member's own files table knows which group's
timeline to show it in. No group-specific wire message exists for this at
all - file_offer already had everything needed, it just gained an optional
group_id field.

Group calling (full mesh, no SFU/relay): calling.py stays a pure 1:1
signaling relay, completely unaware groups exist. A group call is really
just N ordinary 1:1 calls happening at once, tagged with a shared
group_call_id so the frontend can render them as one screen. Mesh
formation avoids every pair connecting twice (once from each side) with a
simple, deterministic rule applied identically on every member's device:
after a group_call_start, each member calls every *other* member whose
peer_id sorts after their own. For members [A, B, C] (already sorted): A
calls B and C; B calls only C; C calls no one, both connections reach it
from the other side. Same peer_id-ordering idea calling.py's own 1:1
collision resolution already uses, just applied to mesh formation instead
of a tie-break.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Callable, Optional

from app.filetransfer import FileTransferService
from app.messaging import MessagingService
from app.storage import Group, GroupMember, MessageStore

# Full mesh means every member connects directly to every other member -
# connections grow as N*(N-1)/2, and so does the encode/decode work every
# single device has to do simultaneously (see TASK_QUEUE.md's group-calling
# entry for the real numbers). Past a handful of people that gets rough on
# ordinary laptop hardware, and fixing it properly needs a real relay
# design (discussed and deliberately not built yet, see the queue). Capping
# group calls at this size, enforced here on the backend rather than only
# in the UI, keeps every group call within the mesh's actual comfort zone
# instead of quietly degrading as a group grows. Group *chat* has no such
# limit, fan-out messaging doesn't have this problem.
MAX_GROUP_CALL_MEMBERS = 4


@dataclass
class GroupMessageEvent:
    group_id: str
    msg_id: str
    sender_peer_id: str
    sender_name: str
    body: str
    ts: float


@dataclass
class GroupCallStartEvent:
    group_id: str
    group_call_id: str
    media: str
    members: list[GroupMember]
    group_name: str


class GroupService:
    def __init__(
        self,
        messaging: MessagingService,
        store: MessageStore,
        file_transfer: FileTransferService,
        self_peer_id: str,
        self_name: str,
        on_group_invite: Optional[Callable[[Group], None]] = None,
        on_group_message: Optional[Callable[[GroupMessageEvent], None]] = None,
        on_group_call_start: Optional[Callable[[GroupCallStartEvent], None]] = None,
    ):
        self.messaging = messaging
        self.store = store
        self.file_transfer = file_transfer
        self.self_peer_id = self_peer_id
        self.self_name = self_name
        self.on_group_invite = on_group_invite
        self.on_group_message = on_group_message
        self.on_group_call_start = on_group_call_start
        messaging.add_control_handler(self._on_control)

    async def create_group(self, name: str, member_peer_ids_and_names: list[tuple[str, str]]) -> Group:
        """member_peer_ids_and_names excludes the creator - self is always
        added automatically, so the caller only needs to pass who else is
        being invited."""
        group_id = str(uuid.uuid4())
        members = [GroupMember(self.self_peer_id, self.self_name)] + [GroupMember(pid, name_) for pid, name_ in member_peer_ids_and_names]
        await self.store.save_group(group_id, name, members)

        for pid, _ in member_peer_ids_and_names:
            await self.messaging.send_control(
                pid,
                {
                    "type": "group_invite",
                    "group_id": group_id,
                    "name": name,
                    "members": [{"peer_id": m.peer_id, "name": m.name} for m in members],
                },
            )
        return await self.store.get_group(group_id)

    async def send_group_message(self, group_id: str, body: str) -> str:
        group = await self.store.get_group(group_id)
        if group is None:
            raise ValueError(f"no such group {group_id}")
        msg_id = str(uuid.uuid4())
        ts = time.time()
        await self.store.save_group_message(msg_id, group_id, self.self_peer_id, self.self_name, body, ts)

        for m in group.members:
            if m.peer_id == self.self_peer_id:
                continue
            await self.messaging.send_control(
                m.peer_id,
                {"type": "group_message", "group_id": group_id, "msg_id": msg_id, "sender_peer_id": self.self_peer_id, "sender_name": self.self_name, "body": body, "ts": ts},
            )
        return msg_id

    async def send_group_file(self, group_id: str, file_path: str) -> list[str]:
        """Sends a file to every other member as its own completely normal
        1:1 transfer (own transfer_id, own accept/decline, own resume-on-
        drop, all of filetransfer.py's existing machinery untouched), just
        tagged with this group_id so it shows up in the group's timeline on
        every device. No group-aware retry here: if one member is offline
        right now, their copy simply fails like any 1:1 send to an
        unreachable peer would (auto-retried later by filetransfer.py's own
        _flush_pending_loop once they reappear, same as any other failed
        outgoing transfer - nothing group-specific needed for that part)."""
        group = await self.store.get_group(group_id)
        if group is None:
            raise ValueError(f"no such group {group_id}")
        transfer_ids = []
        for m in group.members:
            if m.peer_id == self.self_peer_id:
                continue
            try:
                transfer_ids.append(await self.file_transfer.send_file(m.peer_id, file_path, group_id=group_id))
            except ConnectionError:
                pass  # that member is unreachable right now - filetransfer.py's own flush loop will retry
        return transfer_ids

    async def start_group_call(self, group_id: str, media: str) -> GroupCallStartEvent:
        """Tells every other member a group call is starting. Doesn't place
        any actual calls itself - calling.py's real 1:1 signaling (SDP/ICE)
        only ever happens frontend-side, where the real RTCPeerConnections
        live. This just broadcasts the starting gun; every member's own
        frontend (including the initiator's, via the same event) decides
        who *it* needs to call using the peer_id-ordering mesh rule."""
        group = await self.store.get_group(group_id)
        if group is None:
            raise ValueError(f"no such group {group_id}")
        if len(group.members) > MAX_GROUP_CALL_MEMBERS:
            raise ValueError(f"group calling is limited to {MAX_GROUP_CALL_MEMBERS} people, this group has {len(group.members)}")
        group_call_id = str(uuid.uuid4())

        for m in group.members:
            if m.peer_id == self.self_peer_id:
                continue
            await self.messaging.send_control(m.peer_id, {"type": "group_call_start", "group_id": group_id, "group_call_id": group_call_id, "media": media, "group_name": group.name})

        return GroupCallStartEvent(group_id, group_call_id, media, group.members, group.name)

    async def _on_control(self, mtype: str, peer_id: str, msg: dict) -> None:
        if mtype == "group_invite":
            members = [GroupMember(m["peer_id"], m["name"]) for m in msg["members"]]
            await self.store.save_group(msg["group_id"], msg["name"], members)
            if self.on_group_invite:
                group = await self.store.get_group(msg["group_id"])
                self.on_group_invite(group)
        elif mtype == "group_message":
            await self.store.save_group_message(msg["msg_id"], msg["group_id"], msg["sender_peer_id"], msg["sender_name"], msg["body"], msg.get("ts", time.time()))
            if self.on_group_message:
                self.on_group_message(GroupMessageEvent(msg["group_id"], msg["msg_id"], msg["sender_peer_id"], msg["sender_name"], msg["body"], msg.get("ts", time.time())))
        elif mtype == "group_call_start":
            group = await self.store.get_group(msg["group_id"])
            if group is not None and self.on_group_call_start:
                self.on_group_call_start(GroupCallStartEvent(msg["group_id"], msg["group_call_id"], msg["media"], group.members, group.name))
