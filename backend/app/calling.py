"""
Phase 3 - Calling.

This module does NOT implement WebRTC itself. The actual RTCPeerConnection,
SDP offer/answer, and media all happen in the browser/Electron frontend,
which already has native WebRTC support - and since both peers are on the
same subnet, ICE only ever needs local host candidates, so no STUN/TURN
server is needed anywhere in this design (per spec).

This module's only job is to relay signaling between two peers over the
existing WebSocket control channel (the same channel filetransfer.py
already rides for file offers - see MessagingService.add_control_handler),
track call state, and resolve call collision (both peers calling each
other at the same instant).

Wire protocol (control messages, JSON):
    {"type": "call_offer",  "call_id": ..., "sdp": {...}, "media": "audio"|"video"}
    {"type": "call_answer", "call_id": ..., "sdp": {...}}
    {"type": "call_ice",    "call_id": ..., "candidate": {...}}
    {"type": "call_end",    "call_id": ..., "reason": "declined"|"ended"|"dropped"|"busy"|"collision"}

Call states: ringing -> in_call -> ended (or ringing -> ended, for a
decline/collision/no-answer).

Collision rule (per spec): if both peers have an outstanding, unanswered
outgoing call to each other at the same time, the lexicographically
smaller peer_id wins and its call proceeds; the other side cancels its
own outgoing call and treats the winner's offer as a fresh incoming call.
Both sides resolve this independently from the same two peer_ids - no
extra negotiation message needed.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from app.discovery import PeerDiscovery
from app.messaging import MessagingService
from app.storage import MessageStore


@dataclass
class CallState:
    call_id: str
    peer_id: str
    direction: str  # "outgoing" | "incoming"
    media: str  # "audio" | "video"
    status: str  # "ringing" | "in_call" | "ended"
    started_at: float = field(default_factory=time.time)
    connected_at: Optional[float] = None  # set the moment both sides reach in_call
    end_reason: Optional[str] = None


def _final_status(state: CallState, reason: str) -> str:
    """Maps a raw end reason to the status stored in call history. A call
    that actually connected keeps that distinction even in how it ended -
    'dropped' (the connection itself failed) reads very differently from
    'completed' (someone just hung up) in a history list, even though both
    only happen after connecting. A call that never connected is recorded by
    its specific reason where one exists, or 'missed' otherwise (covers a
    cancelled/unanswered outgoing call and a plain "ended" with no more
    specific reason)."""
    if state.connected_at is not None:
        return "dropped" if reason == "dropped" else "completed"
    if reason in ("declined", "busy", "collision", "failed"):
        return reason
    return "missed"


class CallService:
    def __init__(
        self,
        discovery: PeerDiscovery,
        messaging: MessagingService,
        store: MessageStore,
        on_incoming_call: Optional[Callable[[CallState, dict], None]] = None,  # state, sdp
        on_call_answered: Optional[Callable[[str, dict], None]] = None,  # call_id, sdp
        on_ice_candidate: Optional[Callable[[str, dict], None]] = None,  # call_id, candidate
        on_call_ended: Optional[Callable[[str, str], None]] = None,  # call_id, reason
        on_collision_yield: Optional[Callable[[str], None]] = None,  # our own call_id that got cancelled
    ) -> None:
        self.discovery = discovery
        self.messaging = messaging
        self.store = store
        self.on_incoming_call = on_incoming_call
        self.on_call_answered = on_call_answered
        self.on_ice_candidate = on_ice_candidate
        self.on_call_ended = on_call_ended
        self.on_collision_yield = on_collision_yield

        self._calls: dict[str, CallState] = {}
        # one call per peer at a time - a second offer to/from a peer that
        # already has an active entry here is either a collision (both
        # ringing) or simply invalid (already in a call with them).
        self._active_for_peer: dict[str, str] = {}

        messaging.add_control_handler(self._on_control)

    async def _finalize(self, state: CallState, reason: str) -> None:
        state.status = "ended"
        state.end_reason = reason
        self._active_for_peer.pop(state.peer_id, None)
        duration = (time.time() - state.connected_at) if state.connected_at is not None else None
        await self.store.update_call_end(state.call_id, _final_status(state, reason), duration=duration)

    # -- queries -----------------------------------------------------------

    def get(self, call_id: str) -> Optional[CallState]:
        return self._calls.get(call_id)

    # -- originating a call --------------------------------------------------

    async def start_call(self, peer_id: str, sdp: dict, media: str) -> str:
        if peer_id in self._active_for_peer:
            raise ValueError(f"already have an active call with {peer_id}")

        call_id = str(uuid.uuid4())
        state = CallState(call_id=call_id, peer_id=peer_id, direction="outgoing", media=media, status="ringing")
        self._calls[call_id] = state
        self._active_for_peer[peer_id] = call_id
        await self.store.save_call_start(call_id, peer_id, "outgoing", media, started_at=state.started_at)

        sent = await self.messaging.send_control(peer_id, {"type": "call_offer", "call_id": call_id, "sdp": sdp, "media": media})
        if not sent:
            await self._finalize(state, "failed")
            raise ConnectionError(f"peer {peer_id} not reachable")
        return call_id

    # -- answering / declining / hanging up ----------------------------------

    async def answer_call(self, call_id: str, sdp: dict) -> None:
        state = self._calls.get(call_id)
        if state is None:
            raise ValueError(f"no such call {call_id}")
        state.status = "in_call"
        state.connected_at = time.time()
        await self.messaging.send_control(state.peer_id, {"type": "call_answer", "call_id": call_id, "sdp": sdp})

    async def send_ice_candidate(self, call_id: str, candidate: dict) -> None:
        state = self._calls.get(call_id)
        if state is None:
            return
        await self.messaging.send_control(state.peer_id, {"type": "call_ice", "call_id": call_id, "candidate": candidate})

    async def end_call(self, call_id: str, reason: str = "ended") -> None:
        state = self._calls.get(call_id)
        if state is None:
            return
        await self._finalize(state, reason)
        await self.messaging.send_control(state.peer_id, {"type": "call_end", "call_id": call_id, "reason": reason})

    # -- inbound control messages -------------------------------------------

    async def _on_control(self, mtype: str, peer_id: str, msg: dict) -> None:
        if mtype == "call_offer":
            await self._handle_offer(peer_id, msg)
        elif mtype == "call_answer":
            state = self._calls.get(msg["call_id"])
            if state:
                state.status = "in_call"
                state.connected_at = time.time()
            if self.on_call_answered:
                self.on_call_answered(msg["call_id"], msg["sdp"])
        elif mtype == "call_ice":
            if self.on_ice_candidate:
                self.on_ice_candidate(msg["call_id"], msg["candidate"])
        elif mtype == "call_end":
            state = self._calls.get(msg["call_id"])
            reason = msg.get("reason", "ended")
            if state:
                await self._finalize(state, reason)
            if self.on_call_ended:
                self.on_call_ended(msg["call_id"], reason)

    async def _handle_offer(self, peer_id: str, msg: dict) -> None:
        call_id = msg["call_id"]
        existing_id = self._active_for_peer.get(peer_id)

        if existing_id is not None:
            existing = self._calls.get(existing_id)
            # Collision: we already have our own unanswered outgoing call to
            # this exact peer. Resolve deterministically by peer_id - both
            # sides run this same comparison independently.
            if existing and existing.direction == "outgoing" and existing.status == "ringing":
                if self.discovery.peer_id < peer_id:
                    # We win - our own offer proceeds, silently ignore theirs.
                    return
                else:
                    # We lose - cancel our own outgoing call, accept theirs instead.
                    await self._finalize(existing, "collision")
                    if self.on_collision_yield:
                        self.on_collision_yield(existing_id)
            else:
                # Already got a call with this peer that isn't a clean
                # collision (e.g. already in_call) - reject the new offer
                # as busy rather than silently dropping it.
                await self.messaging.send_control(peer_id, {"type": "call_end", "call_id": call_id, "reason": "busy"})
                return

        state = CallState(call_id=call_id, peer_id=peer_id, direction="incoming", media=msg.get("media", "audio"), status="ringing")
        self._calls[call_id] = state
        self._active_for_peer[peer_id] = call_id
        await self.store.save_call_start(call_id, peer_id, "incoming", state.media, started_at=state.started_at)
        if self.on_incoming_call:
            self.on_incoming_call(state, msg["sdp"])
