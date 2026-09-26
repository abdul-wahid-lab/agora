"""
Local HTTP/WebSocket API - the door a real UI (the future Electron app)
knocks on. Wraps the already-working PeerDiscovery / MessagingService /
FileTransferService in FastAPI endpoints.

Important distinction: this server binds to 127.0.0.1 only. It is
*never* reachable from other peers on the LAN - it's purely how this
device's own UI talks to this device's own backend. The actual
peer-to-peer traffic (discovery, chat, file transfer) still happens on
the separate 0.0.0.0-bound ports set up by discovery.py/messaging.py,
completely independent of this API's port.

Run it directly for manual testing:
    AGORA_NAME=Alice AGORA_PORT=8001 AGORA_API_PORT=5001 \
        ./agora/Scripts/python.exe -m uvicorn app.api:app --host 127.0.0.1 --port 5001

(Two env vars matter: AGORA_PORT is the discovery/messaging port peers see
you on; AGORA_API_PORT is what this local API listens on for the UI -
they must be different, and API_PORT should also just match whatever
--port you pass to uvicorn.)
"""

from __future__ import annotations

import asyncio
import os
import socket
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.calling import CallService, CallState
from app.discovery import PeerDiscovery
from app.filetransfer import FileTransferService, IncomingFileOffer
from app.messaging import IncomingMessage, MessagingService
from app.storage import MessageStore

NAME = os.environ.get("AGORA_NAME", socket.gethostname())
PORT = int(os.environ.get("AGORA_PORT", "8001"))
DB_PATH = os.environ.get("AGORA_DB", f"{NAME.lower()}.db")
DOWNLOADS_DIR = os.environ.get("AGORA_DOWNLOADS", f"{NAME.lower()}_files")
PEER_ID = os.environ.get("AGORA_PEER_ID")  # optional - fixed identity across restarts

app = FastAPI(title="Agora local API")
# SECURITY: this used to be allow_origins=["*"]. Binding to 127.0.0.1 does
# NOT make that safe - any webpage open in ANY browser on this machine can
# fetch() a wildcard-CORS localhost API and read the response. Combined
# with no auth on these endpoints, that meant an arbitrary website could
# silently read this device's peer list and message history, and even
# trigger POST /files/send with a path of its choosing to exfiltrate a
# local file to a LAN peer. Restricting to the app's own real origins closes
# this off: a malicious page cannot forge the Origin header the browser
# sends, so it can never match "null" (Electron's packaged file:// pages)
# or http://localhost:<dev-port> (the Vite dev server) unless it genuinely
# *is* this app.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=r"http://localhost:\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

store = MessageStore(DB_PATH)
discovery = PeerDiscovery(device_name=NAME, service_port=PORT, peer_id=PEER_ID)

# UI clients connected to /events - pushed to as things happen, rather than
# making the frontend poll for messages/offers/transfer status.
_event_clients: set[WebSocket] = set()


async def _broadcast(event: dict) -> None:
    dead = []
    for ws in _event_clients:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _event_clients.discard(ws)


def _on_message(msg: IncomingMessage) -> None:
    asyncio.create_task(_broadcast({"type": "message", "peer_id": msg.peer_id, "body": msg.body, "ts": msg.ts, "direction": "received"}))


def _on_offer(offer: IncomingFileOffer) -> None:
    asyncio.create_task(
        _broadcast(
            {
                "type": "file_offer",
                "transfer_id": offer.transfer_id,
                "peer_id": offer.peer_id,
                "filename": offer.filename,
                "size": offer.size,
                "is_executable": offer.is_executable,
            }
        )
    )


def _on_received(transfer_id: str, status: str, saved_path: Optional[str]) -> None:
    asyncio.create_task(_broadcast({"type": "file_status", "transfer_id": transfer_id, "status": status, "saved_path": saved_path}))


def _on_progress(transfer_id: str, bytes_sent: int, total: int) -> None:
    asyncio.create_task(_broadcast({"type": "file_progress", "transfer_id": transfer_id, "bytes_sent": bytes_sent, "total": total}))


def _on_incoming_call(state: CallState, sdp: dict) -> None:
    asyncio.create_task(
        _broadcast({"type": "call_incoming", "call_id": state.call_id, "peer_id": state.peer_id, "media": state.media, "sdp": sdp})
    )


def _on_call_answered(call_id: str, sdp: dict) -> None:
    asyncio.create_task(_broadcast({"type": "call_answered", "call_id": call_id, "sdp": sdp}))


def _on_ice_candidate(call_id: str, candidate: dict) -> None:
    asyncio.create_task(_broadcast({"type": "call_ice", "call_id": call_id, "candidate": candidate}))


def _on_call_ended(call_id: str, reason: str) -> None:
    asyncio.create_task(_broadcast({"type": "call_ended", "call_id": call_id, "reason": reason}))


def _on_collision_yield(call_id: str) -> None:
    # Our own outgoing call lost the tie-break and was cancelled in favor of
    # the peer's incoming offer (which arrives separately as call_incoming).
    asyncio.create_task(_broadcast({"type": "call_ended", "call_id": call_id, "reason": "collision"}))


messaging = MessagingService(discovery, store, on_message=_on_message)
file_transfer = FileTransferService(
    discovery,
    messaging,
    store,
    downloads_dir=DOWNLOADS_DIR,
    on_offer=_on_offer,
    on_received=_on_received,
    on_progress=_on_progress,
    # `calling` isn't assigned yet at this line, but this lambda only reads
    # it at call time (well after module load finishes) - Python closures
    # resolve globals by name, not by value captured here.
    is_call_active=lambda: any(c.status == "in_call" for c in calling._calls.values()),
)
calling = CallService(
    discovery,
    messaging,
    store,
    on_incoming_call=_on_incoming_call,
    on_call_answered=_on_call_answered,
    on_ice_candidate=_on_ice_candidate,
    on_call_ended=_on_call_ended,
    on_collision_yield=_on_collision_yield,
)

_peer_watch_task: Optional[asyncio.Task] = None


async def _watch_peers() -> None:
    """Polls the (in-memory, already-live) peer registry and broadcasts
    join/leave diffs - lets the UI react to presence changes without
    having to poll GET /peers itself."""
    known: set[str] = set()
    while True:
        current = {p.peer_id: p for p in discovery.registry.list()}
        joined = current.keys() - known
        left = known - current.keys()
        for pid in joined:
            p = current[pid]
            await store.save_known_peer(p.peer_id, p.name)
            await _broadcast({"type": "peer_joined", "peer_id": p.peer_id, "name": p.name, "address": p.address, "port": p.port, "source": p.source})
        for pid in left:
            await _broadcast({"type": "peer_left", "peer_id": pid})
        known = set(current.keys())
        await asyncio.sleep(1.5)


@app.on_event("startup")
async def startup() -> None:
    global _peer_watch_task
    # See cli_chat.py for why this must run in a worker thread: zeroconf's
    # synchronous API detects this thread's already-running asyncio loop
    # and deadlocks trying to schedule its own coroutines on it.
    await asyncio.to_thread(discovery.start)
    await messaging.start()
    _peer_watch_task = asyncio.create_task(_watch_peers())


@app.on_event("shutdown")
async def shutdown() -> None:
    if _peer_watch_task:
        _peer_watch_task.cancel()
    await messaging.stop()
    discovery.stop()


# -- REST endpoints ---------------------------------------------------------


@app.get("/me")
async def get_me():
    return {"peer_id": discovery.peer_id, "device_name": discovery.device_name, "port": discovery.service_port}


@app.get("/peers")
async def get_peers():
    return [{"peer_id": p.peer_id, "name": p.name, "address": p.address, "port": p.port, "source": p.source} for p in discovery.registry.list()]


class SendMessageBody(BaseModel):
    peer_id: str
    body: str


@app.post("/messages")
async def send_message(body: SendMessageBody):
    msg_id = await messaging.send(body.peer_id, body.body)
    return {"msg_id": msg_id}


@app.get("/messages/{peer_id}")
async def get_history(peer_id: str, limit: int = 50):
    history = await store.history(peer_id, limit=limit)
    return [{"msg_id": m.msg_id, "direction": m.direction, "body": m.body, "status": m.status, "ts": m.ts} for m in history]


@app.get("/conversations")
async def get_conversations():
    """One row per peer with a message history, each carrying its own most
    recent message - what the Chats list shows (distinct from /peers, which
    is who's live on the network right now regardless of chat history)."""
    return await store.list_conversations()


class SendFileBody(BaseModel):
    peer_id: str
    path: str


@app.post("/files/send")
async def send_file(body: SendFileBody):
    # send_file() blocks until the peer responds accept/decline and the
    # whole transfer finishes - far too long for a single request/response.
    # Fire it in the background; the offer row appears in GET /files almost
    # immediately, and /events pushes every status change as it happens.
    asyncio.create_task(file_transfer.send_file(body.peer_id, body.path))
    return {"status": "offer_sending"}


@app.get("/files")
async def get_all_files():
    """Every transfer across every peer - the unified Files browser.
    GET /files/{peer_id} stays scoped to one conversation's file bubbles."""
    records = await store.list_all_files()
    return [
        {
            "transfer_id": r.transfer_id,
            "peer_id": r.peer_id,
            "direction": r.direction,
            "filename": r.filename,
            "size": r.size,
            "sha256": r.sha256,
            "is_executable": r.is_executable,
            "status": r.status,
            "saved_path": r.saved_path,
            "ts": r.ts,
        }
        for r in records
    ]


@app.get("/files/{peer_id}")
async def get_files(peer_id: str):
    records = await store.list_files(peer_id)
    return [
        {
            "transfer_id": r.transfer_id,
            "direction": r.direction,
            "filename": r.filename,
            "size": r.size,
            "sha256": r.sha256,
            "is_executable": r.is_executable,
            "status": r.status,
            "saved_path": r.saved_path,
            "ts": r.ts,
        }
        for r in records
    ]


@app.post("/files/{transfer_id}/accept")
async def accept_file(transfer_id: str):
    asyncio.create_task(file_transfer.accept(transfer_id))
    return {"status": "accepting"}


@app.post("/files/{transfer_id}/decline")
async def decline_file(transfer_id: str):
    await file_transfer.decline(transfer_id)
    return {"status": "declined"}


@app.post("/files/{transfer_id}/resend")
async def resend_file(transfer_id: str):
    asyncio.create_task(file_transfer.resend(transfer_id))
    return {"status": "resending"}


# -- calling -----------------------------------------------------------------
# No WebRTC happens in this process at all - the frontend's own RTCPeerConnection
# does SDP/ICE generation and all media; this is purely a signaling relay over
# the existing WebSocket control channel. See app/calling.py's module docstring.


class CallOfferBody(BaseModel):
    peer_id: str
    sdp: dict
    media: str = "audio"


@app.post("/calls/offer")
async def call_offer(body: CallOfferBody):
    try:
        call_id = await calling.start_call(body.peer_id, body.sdp, body.media)
    except (ValueError, ConnectionError) as e:
        return {"status": "failed", "reason": str(e)}
    return {"call_id": call_id, "status": "ringing"}


class CallAnswerBody(BaseModel):
    sdp: dict


@app.post("/calls/{call_id}/answer")
async def call_answer(call_id: str, body: CallAnswerBody):
    await calling.answer_call(call_id, body.sdp)
    return {"status": "in_call"}


class CallIceBody(BaseModel):
    candidate: dict


@app.post("/calls/{call_id}/ice")
async def call_ice(call_id: str, body: CallIceBody):
    await calling.send_ice_candidate(call_id, body.candidate)
    return {"status": "sent"}


class CallEndBody(BaseModel):
    reason: str = "ended"


@app.post("/calls/{call_id}/end")
async def call_end(call_id: str, body: CallEndBody = CallEndBody()):
    await calling.end_call(call_id, body.reason)
    return {"status": "ended"}


@app.get("/calls/history")
async def get_all_call_history(limit: int = 100):
    """Every call across every peer - the Calls tab's history list.
    GET /calls/history/{peer_id} stays scoped to one peer's calls."""
    records = await store.list_all_calls(limit=limit)
    return [
        {
            "call_id": r.call_id,
            "peer_id": r.peer_id,
            "direction": r.direction,
            "media": r.media,
            "status": r.status,
            "started_at": r.started_at,
            "ended_at": r.ended_at,
            "duration": r.duration,
        }
        for r in records
    ]


@app.get("/calls/history/{peer_id}")
async def get_call_history(peer_id: str, limit: int = 50):
    records = await store.list_calls(peer_id, limit=limit)
    return [
        {
            "call_id": r.call_id,
            "peer_id": r.peer_id,
            "direction": r.direction,
            "media": r.media,
            "status": r.status,
            "started_at": r.started_at,
            "ended_at": r.ended_at,
            "duration": r.duration,
        }
        for r in records
    ]


@app.get("/calls/{call_id}")
async def get_call(call_id: str):
    state = calling.get(call_id)
    if state is None:
        return {"status": "not_found"}
    return {"call_id": state.call_id, "peer_id": state.peer_id, "direction": state.direction, "media": state.media, "status": state.status, "end_reason": state.end_reason}


# -- live events -------------------------------------------------------------


@app.websocket("/events")
async def events(ws: WebSocket):
    await ws.accept()
    _event_clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # UI doesn't send anything meaningful here; just keeps the socket open
    except WebSocketDisconnect:
        pass
    finally:
        _event_clients.discard(ws)
