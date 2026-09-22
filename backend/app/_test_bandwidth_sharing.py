"""
Automated integration test: a file transfer throttles itself while a call
is active on the same device, and runs at normal speed once the call ends.

Per spec: a large file transfer shouldn't be free to saturate the LAN link
while a call is live on the same network. This wires FileTransferService's
`is_call_active` callback to a real CallService and checks wall-clock time,
not just that the flag gets read - the whole point is that a transfer
during an active call visibly slows down compared to the same transfer
outside a call.

Not a CLI tool - run directly:
    python -m app._test_bandwidth_sharing
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
import time
from pathlib import Path

from app.calling import CallService
from app.discovery import PeerDiscovery
from app.filetransfer import FileTransferService, IncomingFileOffer
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


async def send_and_time(ft_sender, disc_receiver, path, on_offer_setter, received_future_factory) -> float:
    fut = received_future_factory()
    on_offer_setter(fut)
    start = time.monotonic()
    await ft_sender.send_file(disc_receiver.peer_id, str(path))
    await asyncio.wait_for(fut, timeout=20)
    return time.monotonic() - start


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_bw_test_"))
    print(f"scratch dir: {tmp}")

    # 3 chunks' worth (CHUNK_SIZE is 256KB) so the throttle's per-chunk sleep
    # actually accumulates into a measurable difference.
    test_file = tmp / "clip.bin"
    test_file.write_bytes(b"\x7a" * (3 * 256 * 1024 + 1000))

    alice_disc = PeerDiscovery(device_name="Alice", service_port=8301, peer_id="alice-bw-test")
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8302, peer_id="bob-bw-test")
    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)

    alice_call = CallService(alice_disc, alice_msg, alice_store)
    bob_call = CallService(bob_disc, bob_msg, bob_store)

    bob_received_holder = {}

    def bob_on_offer(offer: IncomingFileOffer) -> None:
        asyncio.create_task(bob_ft.accept(offer.transfer_id))

    def bob_on_received(transfer_id, status, saved_path) -> None:
        fut = bob_received_holder.get("fut")
        if fut and not fut.done():
            fut.set_result((transfer_id, status, saved_path))

    alice_ft = FileTransferService(
        alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"),
        is_call_active=lambda: any(c.status == "in_call" for c in alice_call._calls.values()),
    )
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"), on_offer=bob_on_offer, on_received=bob_on_received)

    def set_offer_holder(fut):
        bob_received_holder["fut"] = fut

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("mutual discovery OK")

        # -- baseline: no call active, transfer runs at normal speed -----------
        baseline_seconds = await send_and_time(
            alice_ft, bob_disc, test_file, set_offer_holder, lambda: asyncio.get_event_loop().create_future()
        )
        print(f"baseline transfer (no call): {baseline_seconds:.2f}s")

        # -- with a real call in_call on Alice's side, the same transfer should
        # take noticeably longer, purely from is_call_active() being true ------
        fake_offer_sdp = {"type": "offer", "sdp": "v=0 fake"}
        fake_answer_sdp = {"type": "answer", "sdp": "v=0 fake"}
        bob_incoming = asyncio.get_event_loop().create_future()
        bob_call.on_incoming_call = lambda s, sdp: bob_incoming.set_result(s) if not bob_incoming.done() else None
        call_id = await alice_call.start_call(bob_disc.peer_id, fake_offer_sdp, media="audio")
        incoming_state = await asyncio.wait_for(bob_incoming, timeout=10)
        await bob_call.answer_call(incoming_state.call_id, fake_answer_sdp)
        await asyncio.sleep(0.3)
        assert alice_call.get(call_id).status == "in_call", "test setup: call should be connected before measuring"

        throttled_seconds = await send_and_time(
            alice_ft, bob_disc, test_file, set_offer_holder, lambda: asyncio.get_event_loop().create_future()
        )
        print(f"throttled transfer (call active): {throttled_seconds:.2f}s")

        await alice_call.end_call(call_id, reason="ended")

        assert throttled_seconds > baseline_seconds + 0.3, (
            f"expected the in-call transfer to be meaningfully slower than baseline "
            f"(baseline={baseline_seconds:.2f}s, throttled={throttled_seconds:.2f}s)"
        )
        print("TEST (transfer throttles while a call is active, and only then): PASS")

        # -- after the call ends, transfer speed returns to normal --------------
        after_call_seconds = await send_and_time(
            alice_ft, bob_disc, test_file, set_offer_holder, lambda: asyncio.get_event_loop().create_future()
        )
        print(f"post-call transfer: {after_call_seconds:.2f}s")
        assert after_call_seconds < throttled_seconds, "transfer should speed back up once the call ends"
        print("TEST (throttle lifts once the call ends): PASS")

        print("\nALL TESTS PASSED")
    finally:
        await alice_msg.stop()
        await bob_msg.stop()
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
