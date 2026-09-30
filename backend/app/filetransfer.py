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
connects to it): each chunk is encrypted with the same per-peer shared key
messaging.py derives (see crypto_identity.py), framed as a 4-byte
big-endian length prefix followed by that many encrypted bytes, starting
at whatever byte offset the receiver asked to resume from. This isn't just
confidentiality: this raw socket has no identity check of its own (whoever
connects to the ephemeral listener port gets read), so the AEAD auth tag
on every chunk is what actually stops a third party on the LAN from
injecting bytes into a transfer they were never part of - without the
right shared key, nothing they send will ever decrypt.

Nothing here auto-saves or auto-opens anything. A file only starts
transferring after accept() is called (a human decision), and an
executable/installable file (see EXECUTABLE_EXTS) is flagged so the
caller can show a distinctly stronger warning before that decision is
made - this module never decides that on its own.
"""

from __future__ import annotations

import asyncio
import hashlib
import struct
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from app import crypto_identity
from app.discovery import PeerDiscovery
from app.messaging import MessagingService
from app.storage import FileRecord, MessageStore

CHUNK_SIZE = 256 * 1024
LENGTH_PREFIX = struct.Struct(">I")  # 4-byte big-endian length of the encrypted blob that follows
# A real chunk is at most CHUNK_SIZE plaintext bytes + 12-byte nonce +
# 16-byte AEAD tag. Anything claiming to be bigger than that is either a
# protocol bug or someone connected to this listener claiming an absurd
# length (found via testing: with no cap, a length prefix of ~4GB and then
# silence left the receive loop blocked in readexactly() forever, with no
# way out - a real, confirmed slow-loris-style hang, not theoretical).
MAX_ENCRYPTED_CHUNK_LEN = CHUNK_SIZE + 64
# Generous safety net, not a UX-facing countdown - same philosophy as the
# offer-response wait's own timeout below: a real chunk should never
# realistically take this long even on a slow LAN, this exists purely to
# stop a stalled/malicious sender from tying up this task and its open
# socket indefinitely.
CHUNK_READ_TIMEOUT_SECONDS = 60
EXECUTABLE_EXTS = {".apk", ".exe", ".msi", ".bat", ".cmd", ".com", ".sh", ".jar", ".appimage", ".ps1"}

# Bandwidth-sharing throttle (see _stream_to_peer's is_call_active branch).
# BASE_THROTTLE_SLEEP is a flat policy floor: whenever a call is active,
# back off by at least this much per chunk, regardless of anything
# measured, so call quality always gets *some* deliberate headroom. On top
# of that floor, ADAPTIVE_FACTOR scales in a real measured signal: how long
# this same TCP socket's write+drain just took. writer.drain() only returns
# once the OS is ready to accept more data, so an elevated drain time is a
# genuine (not fabricated) sign that something, the call's own media
# traffic included, is actually competing for the link right now - the
# transfer backs off further under real observed contention instead of
# pausing the same fixed amount whether the link is lightly or heavily
# loaded. This is still not a real bandwidth allocator (no traffic shaping,
# no per-flow guarantee, and this process never sees the call's own RTP
# stream directly, since WebRTC media flows browser-to-browser and never
# through this backend), it's a proxy signal from this device's own send
# path, not a literal measurement of the call's bandwidth. MAX_EXTRA
# caps the top-up so one unusually slow chunk can't stall a transfer
# indefinitely.
BASE_THROTTLE_SLEEP = 0.2
ADAPTIVE_FACTOR = 4.0
MAX_EXTRA_THROTTLE_SLEEP = 1.0


def throttle_sleep_seconds(write_elapsed: float) -> float:
    return BASE_THROTTLE_SLEEP + min(MAX_EXTRA_THROTTLE_SLEEP, write_elapsed * ADAPTIVE_FACTOR)


@dataclass
class IncomingFileOffer:
    transfer_id: str
    peer_id: str
    filename: str
    size: int
    is_executable: bool
    group_id: Optional[str] = None


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
        self._flush_task: Optional[asyncio.Task] = None

        messaging.add_control_handler(self._on_control)

    async def start(self) -> None:
        self._flush_task = asyncio.create_task(self._flush_pending_loop())

    async def stop(self) -> None:
        if self._flush_task:
            self._flush_task.cancel()

    # -- sending -------------------------------------------------------

    async def send_file(self, peer_id: str, file_path: str, group_id: Optional[str] = None) -> str:
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
            group_id=group_id,
        )
        self._outgoing_paths[transfer_id] = str(path)
        return await self._offer_and_stream(transfer_id, peer_id, str(path), path.name, size, digest, executable, group_id)

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
        return await self._offer_and_stream(transfer_id, record.peer_id, path, record.filename, record.size, record.sha256, record.is_executable, record.group_id)

    async def _flush_pending_loop(self) -> None:
        """Mirrors messaging.py's own _flush_pending_loop: whenever a peer
        we have a failed outgoing transfer for becomes visible again,
        retry it automatically via resend(), the same mechanism the manual
        "Retry send" button already uses. Deliberately scoped to status
        'failed' only (set when the initial offer couldn't reach the peer
        at all), not the 'offered' status a mid-stream drop is reset to -
        that status is ambiguous with a transfer still legitimately
        awaiting its first accept/decline response, and resend()-ing one of
        those would stomp on a real in-flight offer_future. Same existing
        limitation as the manual button: only works while this same
        backend process is still the one that originally sent it, since
        _outgoing_paths doesn't survive a restart."""
        while True:
            await asyncio.sleep(2)
            visible_ids = {p.peer_id for p in self.discovery.registry.list()}
            for transfer_id in list(self._outgoing_paths.keys()):
                record = await self.store.get_file(transfer_id)
                if record is None or record.status != "failed" or record.peer_id not in visible_ids:
                    continue
                try:
                    await self.resend(transfer_id)
                except (ConnectionError, ValueError):
                    pass  # still not reachable, or path already gone - next tick tries again

    async def _offer_and_stream(self, transfer_id: str, peer_id: str, path: str, filename: str, size: int, digest: str, executable: bool, group_id: Optional[str] = None) -> str:
        loop = asyncio.get_event_loop()
        offer_future: asyncio.Future = loop.create_future()
        self._offer_waiters[transfer_id] = offer_future

        offer = {"type": "file_offer", "transfer_id": transfer_id, "filename": filename, "size": size, "sha256": digest, "is_executable": executable}
        if group_id:
            offer["group_id"] = group_id
        sent = await self.messaging.send_control(peer_id, offer)
        if not sent:
            self._offer_waiters.pop(transfer_id, None)
            await self.store.update_file_status(transfer_id, "failed")
            raise ConnectionError(f"peer {peer_id} not reachable")

        try:
            # A generous safety-net timeout, not a UX-facing "offer expired"
            # countdown - a real human can take as long as they want to
            # accept/decline, this exists only to catch the case where the
            # peer's own connection gets torn down between "hello" and this
            # offer actually being processed on their side (found via
            # testing blocking: send_control() above can report success
            # because the bytes reached the OS socket buffer, even though
            # the receiving end already closed the connection right after
            # "hello" and never got to read this frame at all - with no
            # timeout, offer_future would then wait forever for a response
            # that was never going to come).
            response = await asyncio.wait_for(offer_future, timeout=60)
        except asyncio.TimeoutError:
            self._offer_waiters.pop(transfer_id, None)
            await self.store.update_file_status(transfer_id, "failed")
            raise ConnectionError(f"peer {peer_id} never responded to the file offer")
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

        # send_key, not a single shared key - see crypto_identity's
        # directional-key comments for why (a reflection attack was
        # confirmed with a single symmetric key: a captured chunk sent
        # here could otherwise be replayed back to this device and decrypt
        # successfully as if it were an incoming chunk from the peer).
        send_key = await self.messaging.get_send_key(peer_id)
        if send_key is None:
            await self.store.update_file_status(transfer_id, "failed")
            raise ConnectionError(f"peer {peer_id}'s key isn't resolved - can't encrypt this transfer")

        try:
            await self._stream_to_peer(peer.address, response["port"], path, response.get("resume_at", 0), transfer_id, size, send_key)
        except OSError:
            # Dropped mid-stream (WiFi hiccup, peer closed). Leave it
            # 'offered' rather than 'failed' - resend() picks up from here.
            self._result_waiters.pop(transfer_id, None)
            await self.store.update_file_status(transfer_id, "offered")
            raise

        result = await result_future
        await self.store.update_file_status(transfer_id, result["status"])
        return transfer_id

    async def _stream_to_peer(self, host: str, port: int, file_path: str, resume_at: int, transfer_id: str, total_size: int, shared_key: bytes) -> None:
        _, writer = await asyncio.open_connection(host, port)
        try:
            with open(file_path, "rb") as f:
                f.seek(resume_at)
                sent = resume_at
                while True:
                    chunk = f.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    blob = crypto_identity.encrypt(shared_key, chunk)
                    write_start = time.monotonic()
                    writer.write(LENGTH_PREFIX.pack(len(blob)))
                    writer.write(blob)
                    await writer.drain()
                    write_elapsed = time.monotonic() - write_start
                    sent += len(chunk)
                    if self.on_progress:
                        self.on_progress(transfer_id, sent, total_size)
                    if self.is_call_active():
                        # Throttle, don't stop - a call in progress means the
                        # LAN link matters more for voice/video than transfer
                        # speed. See throttle_sleep_seconds's own comment for
                        # why write_elapsed is a real, not fabricated, signal.
                        await asyncio.sleep(throttle_sleep_seconds(write_elapsed))
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
        group_id = msg.get("group_id")
        await self.store.save_file(
            transfer_id=transfer_id,
            peer_id=peer_id,
            direction="received",
            filename=msg["filename"],
            size=msg["size"],
            sha256=msg["sha256"],
            is_executable=msg.get("is_executable", False),
            status="awaiting_accept",
            group_id=group_id,
        )
        if self.on_offer:
            self.on_offer(IncomingFileOffer(transfer_id, peer_id, msg["filename"], msg["size"], msg.get("is_executable", False), group_id))

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

        # recv_key, not a single shared key - see the matching comment in
        # _offer_and_stream and crypto_identity.derive_directional_keys.
        recv_key = await self.messaging.get_recv_key(record.peer_id)
        if recv_key is None:
            await self.store.update_file_status(transfer_id, "failed")
            raise ConnectionError(f"peer {record.peer_id}'s key isn't resolved - can't decrypt this transfer")

        async def _on_client(reader, writer):
            await self._receive(reader, writer, transfer_id, record, part_path, resume_at, recv_key)

        server = await asyncio.start_server(_on_client, "0.0.0.0", 0)
        self._listeners[transfer_id] = server
        port = server.sockets[0].getsockname()[1]

        await self.store.update_file_status(transfer_id, "accepted")
        await self.messaging.send_control(
            record.peer_id,
            {"type": "file_offer_response", "transfer_id": transfer_id, "accept": True, "port": port, "resume_at": resume_at},
        )

    async def _receive(self, reader, writer, transfer_id: str, record: FileRecord, part_path: Path, resume_at: int, shared_key: bytes) -> None:
        server = self._listeners.pop(transfer_id, None)
        try:
            mode = "ab" if resume_at else "wb"
            received = resume_at
            # Set when the stream itself is untrustworthy (oversized length
            # claim, or a chunk that fails to authenticate) - checked right
            # after the file handle below is closed, since deleting a file
            # that's still open raises PermissionError on Windows (found by
            # testing the oversized-length-claim fix itself: the ONLY thing
            # broken by that fix was trying to unlink() from inside this
            # same `with open(...)` block).
            untrusted_stream = False
            with open(part_path, mode) as f:
                while True:
                    try:
                        prefix = await asyncio.wait_for(reader.readexactly(LENGTH_PREFIX.size), timeout=CHUNK_READ_TIMEOUT_SECONDS)
                        (blob_len,) = LENGTH_PREFIX.unpack(prefix)
                        if blob_len > MAX_ENCRYPTED_CHUNK_LEN:
                            # Not a real chunk from real Agora code - abort
                            # rather than trying to read however many bytes
                            # were claimed.
                            untrusted_stream = True
                            break
                        blob = await asyncio.wait_for(reader.readexactly(blob_len), timeout=CHUNK_READ_TIMEOUT_SECONDS)
                    except asyncio.IncompleteReadError:
                        # Clean end of stream (sender finished, or the
                        # connection dropped mid-chunk) - either way, the
                        # size check right below already tells the caller
                        # whether the whole file actually arrived.
                        break
                    except asyncio.TimeoutError:
                        # A connected peer went silent mid-chunk for far
                        # longer than any real transfer ever should -
                        # treat exactly like a mid-stream drop.
                        break
                    try:
                        chunk = crypto_identity.decrypt(shared_key, blob)
                    except crypto_identity.DecryptionError:
                        # A third party connected to this listener without
                        # the real shared key, or the stream desynced -
                        # either way, nothing after this can be trusted.
                        untrusted_stream = True
                        break
                    f.write(chunk)
                    received += len(chunk)
                    if self.on_progress:
                        self.on_progress(transfer_id, received, record.size)

            if untrusted_stream:
                part_path.unlink(missing_ok=True)
                await self.store.update_file_status(transfer_id, "failed")
                if self.on_received:
                    self.on_received(transfer_id, "failed", None)
                return

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
