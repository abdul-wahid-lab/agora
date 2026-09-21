"""
Automated integration test for Phase 2B (file sharing).

Drives two full stacks (discovery + messaging + file transfer) in one
process, over real sockets on localhost, and checks:
  1. happy path - offer, accept, stream, hash-verify, save
  2. resume - a transfer that already has a partial file on the receiving
     end (simulating a prior drop mid-stream) picks up from that exact
     byte offset instead of restarting, and still ends up byte-identical
     to the original once resumed via resend()

Not a CLI tool - run directly:
    python -m app._test_filetransfer

(An interactive two-terminal CLI test also exists for Phase 1/2, but
reacting *mid-session* to a freshly-generated transfer_id requires
injecting commands into a running process's stdin after the fact. On
this Windows/MSYS setup, python.exe (a native build) can't read
sys.stdin when it's redirected from an MSYS-emulated FIFO - a platform
plumbing issue, not a bug in the file-transfer code - so this direct
in-process test is the reliable way to exercise the accept/resume paths
end-to-end.)
"""

from __future__ import annotations

import asyncio
import hashlib
import shutil
import tempfile
from pathlib import Path

from app.discovery import PeerDiscovery
from app.filetransfer import FileTransferService, IncomingFileOffer, sha256_file
from app.messaging import MessagingService
from app.storage import MessageStore


async def wait_mutual_discovery(a: PeerDiscovery, b: PeerDiscovery, timeout=10) -> None:
    for _ in range(timeout * 10):
        a_sees_b = any(p.peer_id == b.peer_id for p in a.registry.list())
        b_sees_a = any(p.peer_id == a.peer_id for p in b.registry.list())
        if a_sees_b and b_sees_a:
            return
        await asyncio.sleep(0.1)
    raise TimeoutError("peers never discovered each other")


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_ft_test_"))
    print(f"scratch dir: {tmp}")

    test_file = tmp / "photo.jpg"
    test_file.write_bytes(b"\x42" * 500_000 + b"not really a jpeg, just test bytes")
    original_hash = sha256_file(str(test_file))

    alice_disc = PeerDiscovery(device_name="Alice", service_port=8101, peer_id="alice-test")
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8102, peer_id="bob-test")
    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)

    bob_received = asyncio.get_event_loop().create_future()

    def bob_on_offer(offer: IncomingFileOffer) -> None:
        print(f"[Bob] offer received: {offer.filename} ({offer.size} bytes, executable={offer.is_executable})")
        asyncio.create_task(bob_ft.accept(offer.transfer_id))

    def bob_on_received(transfer_id, status, saved_path) -> None:
        print(f"[Bob] transfer {transfer_id[:8]} -> {status} ({saved_path})")
        if not bob_received.done():
            bob_received.set_result((transfer_id, status, saved_path))

    alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"))
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"), on_offer=bob_on_offer, on_received=bob_on_received)

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("mutual discovery OK")

        # -- test 1: happy path --------------------------------------------
        transfer_id = await alice_ft.send_file(bob_disc.peer_id, str(test_file))
        result = await asyncio.wait_for(bob_received, timeout=15)
        assert result[1] == "completed", f"expected completed, got {result}"
        saved_path = Path(result[2])
        assert saved_path.exists(), "saved file missing"
        assert sha256_file(str(saved_path)) == original_hash, "saved file hash mismatch"
        alice_record = await alice_store.get_file(transfer_id)
        assert alice_record.status == "completed", f"sender-side status should be completed, got {alice_record.status}"
        print("TEST 1 (happy path): PASS")

        # -- test 2: resume from a partial file -----------------------------
        # Simulate "dropped halfway through a previous attempt": seed a
        # receiver-side .part file with exactly the first half of the
        # bytes, plus matching DB rows on both sides, then resend() and
        # confirm it resumes from that offset rather than starting over.
        resume_id = "resume-test-1"
        full_bytes = test_file.read_bytes()
        half = len(full_bytes) // 2

        bob_received2 = asyncio.get_event_loop().create_future()

        def bob_on_received2(transfer_id, status, saved_path):
            bob_on_received(transfer_id, status, saved_path)
            if not bob_received2.done():
                bob_received2.set_result((transfer_id, status, saved_path))

        bob_ft.on_received = bob_on_received2

        bob_ft.incoming_dir.mkdir(parents=True, exist_ok=True)
        partial_path = bob_ft.incoming_dir / f"{resume_id}.part"
        partial_path.write_bytes(full_bytes[:half])

        await bob_store.save_file(
            transfer_id=resume_id, peer_id=alice_disc.peer_id, direction="received",
            filename="photo.jpg", size=len(full_bytes), sha256=original_hash, is_executable=False, status="awaiting_accept",
        )
        await alice_store.save_file(
            transfer_id=resume_id, peer_id=bob_disc.peer_id, direction="sent",
            filename="photo.jpg", size=len(full_bytes), sha256=original_hash, is_executable=False, status="offered",
        )
        alice_ft._outgoing_paths[resume_id] = str(test_file)

        bytes_seen_by_sender = []
        orig_stream = alice_ft._stream_to_peer

        async def spy_stream(host, port, path, resume_at, tid, total):
            bytes_seen_by_sender.append(resume_at)
            await orig_stream(host, port, path, resume_at, tid, total)

        alice_ft._stream_to_peer = spy_stream

        await alice_ft.resend(resume_id)
        result2 = await asyncio.wait_for(bob_received2, timeout=15)

        assert bytes_seen_by_sender[0] == half, f"expected resume to start at byte {half}, sender actually started at {bytes_seen_by_sender[0]}"
        assert result2[1] == "completed", f"expected completed, got {result2}"
        resumed_path = Path(result2[2])
        assert sha256_file(str(resumed_path)) == original_hash, "resumed file hash mismatch - resume corrupted the file"
        print(f"TEST 2 (resume from byte {half}/{len(full_bytes)}): PASS")

        # -- test 3: decline --------------------------------------------------
        # Bob explicitly declines - nothing should transfer, and the sender
        # should see 'declined', not hang or silently time out.
        bob_ft.on_offer = lambda offer: asyncio.create_task(bob_ft.decline(offer.transfer_id))
        decline_id = await alice_ft.send_file(bob_disc.peer_id, str(test_file))
        alice_record = await alice_store.get_file(decline_id)
        assert alice_record.status == "declined", f"expected declined, got {alice_record.status}"
        bob_record = await bob_store.get_file(decline_id)
        assert bob_record.status == "declined", f"receiver-side record should also read declined, got {bob_record.status}"
        print("TEST 3 (decline): PASS")

        # -- test 4: hash mismatch is caught, not silently accepted ------------
        # Simulate corruption/tampering: the offer claims a sha256 that the
        # real bytes won't match. The receiver must detect this itself
        # (never trust the sender's word for it) and refuse to save the file.
        mismatch_id = "hash-mismatch-test-1"
        wrong_hash = "0" * 64
        bob_mismatch = asyncio.get_event_loop().create_future()

        def bob_on_mismatch(transfer_id, status, saved_path):
            if not bob_mismatch.done():
                bob_mismatch.set_result((transfer_id, status, saved_path))

        bob_ft.on_received = bob_on_mismatch
        bob_ft.on_offer = lambda offer: asyncio.create_task(bob_ft.accept(offer.transfer_id))

        await bob_store.save_file(
            transfer_id=mismatch_id, peer_id=alice_disc.peer_id, direction="received",
            filename="photo.jpg", size=len(full_bytes), sha256=wrong_hash, is_executable=False, status="awaiting_accept",
        )
        await alice_store.save_file(
            transfer_id=mismatch_id, peer_id=bob_disc.peer_id, direction="sent",
            filename="photo.jpg", size=len(full_bytes), sha256=wrong_hash, is_executable=False, status="offered",
        )
        alice_ft._outgoing_paths[mismatch_id] = str(test_file)  # real bytes won't match wrong_hash

        await alice_ft.resend(mismatch_id)
        mismatch_result = await asyncio.wait_for(bob_mismatch, timeout=15)
        assert mismatch_result[1] == "failed", f"expected failed (hash mismatch), got {mismatch_result}"
        leftover_part = bob_ft.incoming_dir / f"{mismatch_id}.part"
        assert not leftover_part.exists(), "corrupted .part file should be deleted, not left on disk"
        dest = Path(bob_ft.downloads_dir) / alice_disc.peer_id / "photo.jpg"
        # (test 1 already legitimately saved a photo.jpg here - just confirm
        # this transfer didn't get treated as a second successful save)
        bob_final_record = await bob_store.get_file(mismatch_id)
        assert bob_final_record.status == "failed", f"DB should record failed, got {bob_final_record.status}"
        print("TEST 4 (hash mismatch rejected): PASS")

        print("\nALL TESTS PASSED")
    finally:
        await alice_msg.stop()
        await bob_msg.stop()
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
