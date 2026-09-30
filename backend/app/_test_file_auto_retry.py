"""
Automated integration test: a failed outgoing file transfer retries itself
automatically once the peer comes back online, the same way messaging.py's
_flush_pending_loop already does for a held chat message.

Not a CLI tool - run directly:
    python -m app._test_file_auto_retry
"""

from __future__ import annotations

import asyncio
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


async def wait_until(predicate, timeout=10, interval=0.2, fail_msg="condition never became true"):
    for _ in range(int(timeout / interval)):
        if await predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError(fail_msg)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_ft_retry_test_"))
    print(f"scratch dir: {tmp}")

    test_file = tmp / "doc.bin"
    test_file.write_bytes(b"\x11" * 200_000)
    original_hash = sha256_file(str(test_file))

    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8501, peer_id="alice-retry-test", public_key=alice_store.get_or_create_device_keys()["public_key"], signing_private_key=alice_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=alice_store.get_or_create_device_keys()["signing_public_key"])
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8502, peer_id="bob-retry-test", public_key=bob_store.get_or_create_device_keys()["public_key"], signing_private_key=bob_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=bob_store.get_or_create_device_keys()["signing_public_key"])
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)

    bob_received = asyncio.get_event_loop().create_future()

    def bob_on_offer(offer: IncomingFileOffer) -> None:
        asyncio.create_task(bob_ft.accept(offer.transfer_id))

    def bob_on_received(transfer_id, status, saved_path) -> None:
        if not bob_received.done():
            bob_received.set_result((transfer_id, status, saved_path))

    alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"))
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"), on_offer=bob_on_offer, on_received=bob_on_received)

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await alice_ft.start()  # the flush loop under test
        # Deliberately NOT starting bob_msg/bob_ft yet - bob_disc (discovery)
        # is up so alice sees him as visible, but nothing is listening on
        # his messaging port, simulating "reachable on the network but the
        # app isn't actually up" (matches the manual-retry test's own
        # framing from Step 8, just automated instead of button-triggered).
        await wait_until(lambda: _sees(alice_disc, bob_disc.peer_id), fail_msg="alice never saw bob in discovery")
        print("bob visible to discovery (but not reachable) OK")

        try:
            await alice_ft.send_file(bob_disc.peer_id, str(test_file))
            raise AssertionError("send_file should have raised ConnectionError while bob is unreachable")
        except ConnectionError:
            pass

        records = await alice_store.list_all_files()
        record = next((r for r in records if r.filename == "doc.bin"), None)
        assert record is not None and record.status == "failed", f"expected a failed record, got {record}"
        transfer_id = record.transfer_id
        print("initial send failed as expected, status='failed' OK")

        print("--- bob 'comes online' ---")
        await bob_msg.start()

        await asyncio.wait_for(bob_received, timeout=15)
        result = bob_received.result()
        assert result[0] == transfer_id, f"expected the same transfer_id to be auto-retried, got {result[0]} vs {transfer_id}"
        assert result[1] == "completed", f"expected completed, got {result}"
        saved_path = Path(result[2])
        assert saved_path.exists()
        assert sha256_file(str(saved_path)) == original_hash, "resent file content should match the original exactly"

        # bob's on_received can fire slightly before alice's own resend()
        # call (still awaiting bob's file_complete ack) returns and updates
        # her own record - poll briefly rather than assume they're
        # simultaneous.
        async def _alice_completed():
            r = await alice_store.get_file(transfer_id)
            return r.status == "completed"

        await wait_until(_alice_completed, timeout=5, fail_msg="alice's own record never reached 'completed'")

        print("TEST (failed transfer auto-retries and completes once the peer reconnects, no manual resend() call made): PASS")
        print()
        print("ALL TESTS PASSED")
    finally:
        await alice_ft.stop()
        await alice_msg.stop()
        try:
            await bob_msg.stop()
        except Exception:
            pass
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


def _sees_sync(disc: PeerDiscovery, peer_id: str) -> bool:
    return any(p.peer_id == peer_id for p in disc.registry.list())


async def _sees(disc: PeerDiscovery, peer_id: str) -> bool:
    return _sees_sync(disc, peer_id)


if __name__ == "__main__":
    asyncio.run(main())
