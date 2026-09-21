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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # loopback-only server; the Electron renderer is the only real client
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


messaging = MessagingService(discovery, store, on_message=_on_message)
file_transfer = FileTransferService(discovery, messaging, store, downloads_dir=DOWNLOADS_DIR, on_offer=_on_offer, on_received=_on_received)

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


@app.get("/files/{peer_id}")
async def get_files(peer_id: str):
    records = await store.list_files(peer_id)
    return [
        {
            "transfer_id": r.transfer_id,
            "direction": r.direction,
            "filename": r.filename,
            "size": r.size,
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
