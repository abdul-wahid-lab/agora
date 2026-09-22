"""
Phase 2B - File Sharing.

Any file type can be sent to a discovered peer. The offer/accept
handshake rides the existing chat WebSocket (via MessagingService's
send_control/on_control) - but once accepted, the actual bytes move over
a *separate* raw TCP connection opened just for that one transfer. Large
files (game files/ROMs/APKs can be hundreds of MB to a few GB) stream
straight to disk this way instead of being buffered in memory or
squeezed through the chat connection.

Wire protocol (control messages, JSON, over the existing WebSocket):
    file_offer          {transfer_id, filename, size, sha256, is_executable}
    file_offer_response {transfer_id, accept, port, resume_at}
    file_complete       {transfer_id}
    file_failed         {transfer_id, reason}

Data channel (raw TCP, listener opened by the receiver on accept, sender
connects to it): just the file bytes, starting at whatever byte offset
the receiver asked to resume from.

Nothing here auto-saves or auto-opens anything. A file only starts
transferring after accept() is called (a human decision), and an
executable/installable file (see EXECUTABLE_EXTS) is flagged so the
caller can show a distinctly stronger warning before that decision is
made - this module never decides that on its own.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from app.discovery import PeerDiscovery
from app.messaging import MessagingService
from app.storage import FileRecord, MessageStore

CHUNK_SIZE = 256 * 1024
EXECUTABLE_EXTS = {".apk", ".exe", ".msi", ".bat", ".cmd", ".com", ".sh", ".jar", ".appimage", ".ps1"}


@dataclass
class IncomingFileOffer:
    transfer_id: str
    peer_id: str
    filename: str
    size: int
    is_executable: bool


def is_executable_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in EXECUTABLE_EXTS


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


class FileTransferService:
    def __init__(
        self,
        discovery: PeerDiscovery,
        messaging: MessagingService,
        store: MessageStore,
        downloads_dir: str,
        on_offer: Optional[Callable[[IncomingFileOffer], None]] = None,
        on_progress: Optional[Callable[[str, int, int], None]] = None,  # transfer_id, bytes_so_far, total
        on_received: Optional[Callable[[str, str, Optional[str]], None]] = None,  # transfer_id, status, saved_path
        is_call_active: Optional[Callable[[], bool]] = None,
    ):
        self.discovery = discovery
        self.messaging = messaging
        self.store = store
        self.downloads_dir = Path(downloads_dir)
        self.incoming_dir = self.downloads_dir / ".incoming"
        self.downloads_dir.mkdir(parents=True, exist_ok=True)
        self.incoming_dir.mkdir(parents=True, exist_ok=True)
        self.on_offer = on_offer
        self.on_progress = on_progress
        self.on_received = on_received
        # Lets the caller (api.py) tell this service whether a call is
        # currently connected, without file transfer needing to import or
        # know anything about CallService. Per spec: a large transfer
        # shouldn't be free to saturate the LAN link while a call is live.
        self.is_call_active = is_call_active or (lambda: False)

        self._offer_waiters: dict[str, asyncio.Future] = {}
        self._result_waiters: dict[str, asyncio.Future] = {}
        # Remembers local source paths for outgoing transfers so `resend()`
        # can retry without asking the caller to supply the path again.
        # Only lives for this process's lifetime - see Known limitations.
        self._outgoing_paths: dict[str, str] = {}
        self._listeners: dict[str, asyncio.AbstractServer] = {}

        messaging.add_control_handler(self._on_control)

    # -- sending -------------------------------------------------------

    async def send_file(self, peer_id: str, file_path: str) -> str:
        path = Path(file_path)
        if not path.is_file():
            raise FileNotFoundError(file_path)

        transfer_id = str(uuid.uuid4())
        size = path.stat().st_size
        digest = await asyncio.to_thread(sha256_file, str(path))
        executable = is_executable_file(path.name)

        await self.store.save_file(
            transfer_id=transfer_id,
            peer_id=peer_id,
            direction="sent",
            filename=path.name,
            size=size,
            sha256=digest,
            is_executable=executable,
            status="offered",
        )
        self._outgoing_paths[transfer_id] = str(path)
        return await self._offer_and_stream(transfer_id, peer_id, str(path), path.name, size, digest, executable)

    async def resend(self, transfer_id: str) -> str:
        """Retry a transfer that stalled (peer dropped mid-stream). Reuses
        the same transfer_id, so the receiver's already-partial file (if
        any) resumes from its actual byte offset instead of restarting."""
        record = await self.store.get_file(transfer_id)
        if record is None or record.direction != "sent":
            raise ValueError(f"no outgoing transfer {transfer_id}")
        path = self._outgoing_paths.get(transfer_id)
        if not path:
            raise ValueError("original file path isn't available to resend (process may have restarted)")
        return await self._offer_and_stream(transfer_id, record.peer_id, path, record.filename, record.size, record.sha256, record.is_executable)

    async def _offer_and_stream(self, transfer_id: str, peer_id: str, path: str, filename: str, size: int, digest: str, executable: bool) -> str:
        loop = asyncio.get_event_loop()
        offer_future: asyncio.Future = loop.create_future()
        self._offer_waiters[transfer_id] = offer_future

        sent = await self.messaging.send_control(
            peer_id,
            {"type": "file_offer", "transfer_id": transfer_id, "filename": filename, "size": size, "sha256": digest, "is_executable": executable},
        )
        if not sent:
            self._offer_waiters.pop(transfer_id, None)
            await self.store.update_file_status(transfer_id, "failed")
            raise ConnectionError(f"peer {peer_id} not reachable")

        response = await offer_future
        if not response.get("accept"):
            await self.store.update_file_status(transfer_id, "declined")
            return transfer_id

        peer = next((p for p in self.discovery.registry.list() if p.peer_id == peer_id), None)
        if peer is None:
            await self.store.update_file_status(transfer_id, "failed")
            raise ConnectionError(f"peer {peer_id} no longer visible")

        result_future: asyncio.Future = loop.create_future()
        self._result_waiters[transfer_id] = result_future
        await self.store.update_file_status(transfer_id, "transferring")

        try:
            await self._stream_to_peer(peer.address, response["port"], path, response.get("resume_at", 0), transfer_id, size)
        except OSError:
            # Dropped mid-stream (WiFi hiccup, peer closed). Leave it
            # 'offered' rather than 'failed' - resend() picks up from here.
            self._result_waiters.pop(transfer_id, None)
            await self.store.update_file_status(transfer_id, "offered")
            raise

        result = await result_future
        await self.store.update_file_status(transfer_id, result["status"])
        return transfer_id

    async def _stream_to_peer(self, host: str, port: int, file_path: str, resume_at: int, transfer_id: str, total_size: int) -> None:
        _, writer = await asyncio.open_connection(host, port)
        try:
            with open(file_path, "rb") as f:
                f.seek(resume_at)
                sent = resume_at
                while True:
                    chunk = f.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    writer.write(chunk)
                    await writer.drain()
                    sent += len(chunk)
                    if self.on_progress:
                        self.on_progress(transfer_id, sent, total_size)
                    if self.is_call_active():
                        # Throttle, don't stop - a call in progress means the
                        # LAN link matters more for voice/video than transfer
                        # speed. This isn't a real bandwidth allocator (no
                        # traffic shaping, no per-flow guarantee), just a
                        # deliberate pause between chunks so a large transfer
                        # backs off and leaves more of the link to the call.
                        await asyncio.sleep(0.2)
        finally:
            writer.close()
            await writer.wait_closed()

    # -- receiving -------------------------------------------------------

    async def _on_control(self, mtype: str, peer_id: str, msg: dict) -> None:
        if mtype == "file_offer":
            await self._handle_offer(peer_id, msg)
        elif mtype == "file_offer_response":
            fut = self._offer_waiters.pop(msg["transfer_id"], None)
            if fut and not fut.done():
                fut.set_result(msg)
        elif mtype in ("file_complete", "file_failed"):
            fut = self._result_waiters.pop(msg["transfer_id"], None)
            if fut and not fut.done():
                fut.set_result({"status": "completed" if mtype == "file_complete" else "failed", "reason": msg.get("reason")})

    async def _handle_offer(self, peer_id: str, msg: dict) -> None:
        transfer_id = msg["transfer_id"]
        await self.store.save_file(
            transfer_id=transfer_id,
            peer_id=peer_id,
            direction="received",
            filename=msg["filename"],
            size=msg["size"],
            sha256=msg["sha256"],
            is_executable=msg.get("is_executable", False),
            status="awaiting_accept",
        )
        if self.on_offer:
            self.on_offer(IncomingFileOffer(transfer_id, peer_id, msg["filename"], msg["size"], msg.get("is_executable", False)))

    async def decline(self, transfer_id: str) -> None:
        record = await self.store.get_file(transfer_id)
        if record is None:
            return
        await self.store.update_file_status(transfer_id, "declined")
        await self.messaging.send_control(record.peer_id, {"type": "file_offer_response", "transfer_id": transfer_id, "accept": False})

    async def accept(self, transfer_id: str) -> None:
        """Explicit human decision required before this is ever called -
        nothing here auto-accepts. Opens a fresh TCP listener just for this
        transfer and tells the sender which port to connect to."""
        record = await self.store.get_file(transfer_id)
        if record is None:
            raise ValueError(f"no such transfer {transfer_id}")

        part_path = self.incoming_dir / f"{transfer_id}.part"
        resume_at = part_path.stat().st_size if part_path.exists() else 0

        async def _on_client(reader, writer):
            await self._receive(reader, writer, transfer_id, record, part_path, resume_at)

        server = await asyncio.start_server(_on_client, "0.0.0.0", 0)
        self._listeners[transfer_id] = server
        port = server.sockets[0].getsockname()[1]

        await self.store.update_file_status(transfer_id, "accepted")
        await self.messaging.send_control(
            record.peer_id,
            {"type": "file_offer_response", "transfer_id": transfer_id, "accept": True, "port": port, "resume_at": resume_at},
        )

    async def _receive(self, reader, writer, transfer_id: str, record: FileRecord, part_path: Path, resume_at: int) -> None:
        server = self._listeners.pop(transfer_id, None)
        try:
            mode = "ab" if resume_at else "wb"
            received = resume_at
            with open(part_path, mode) as f:
                while True:
                    chunk = await reader.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    f.write(chunk)
                    received += len(chunk)
                    if self.on_progress:
                        self.on_progress(transfer_id, received, record.size)

            if received != record.size:
                # Dropped before the full file arrived. Leave the .part file
                # exactly as-is - its size on disk is the real resume point
                # next time accept() (or the sender's resend()) runs, not
                # whatever this loop thought it had received in memory.
                await self.store.update_file_status(transfer_id, "awaiting_accept")
                return

            digest = await asyncio.to_thread(sha256_file, str(part_path))
            if digest != record.sha256:
                part_path.unlink(missing_ok=True)
                await self.store.update_file_status(transfer_id, "failed")
                await self.messaging.send_control(record.peer_id, {"type": "file_failed", "transfer_id": transfer_id, "reason": "hash_mismatch"})
                if self.on_received:
                    self.on_received(transfer_id, "failed", None)
                return

            dest_dir = self.downloads_dir / record.peer_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_path = dest_dir / record.filename
            part_path.replace(dest_path)

            await self.store.update_file_status(transfer_id, "completed", saved_path=str(dest_path))
            await self.messaging.send_control(record.peer_id, {"type": "file_complete", "transfer_id": transfer_id})
            if self.on_received:
                self.on_received(transfer_id, "completed", str(dest_path))
        finally:
            if server:
                server.close()
            writer.close()
