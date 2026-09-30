"""
Automated integration test for blocking a peer.

Real claim being tested: blocking is enforced at the single real choke
point every peer-to-peer channel rides through (messaging.py's
_handle_inbound/_get_connection), so it actually refuses chat, file offers,
and call offers all at once - not just one of them because a check only got
added to that one handler. Two full stacks (discovery + messaging + calling
+ filetransfer) over real localhost sockets, same pattern as the other
_test_*.py suites.

Not a CLI tool - run directly:
    python -m app._test_blocking
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
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


async def wait_until(predicate, timeout=10, interval=0.1, fail_msg="condition never became true"):
    for _ in range(int(timeout / interval)):
        if await predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError(fail_msg)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_block_test_"))
    print(f"scratch dir: {tmp}")

    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8501, peer_id="alice-block-test", public_key=alice_store.get_or_create_device_keys()["public_key"], signing_private_key=alice_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=alice_store.get_or_create_device_keys()["signing_public_key"])
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8502, peer_id="bob-block-test", public_key=bob_store.get_or_create_device_keys()["public_key"], signing_private_key=bob_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=bob_store.get_or_create_device_keys()["signing_public_key"])
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)

    alice_offers = []
    alice_incoming_calls = []
    alice_call = CallService(alice_disc, alice_msg, alice_store, on_incoming_call=lambda s, sdp: alice_incoming_calls.append(s))
    bob_call = CallService(bob_disc, bob_msg, bob_store)
    alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"), on_offer=lambda o: alice_offers.append(o))
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"))

    test_file = tmp / "photo.png"
    test_file.write_bytes(b"\x89PNG" + b"\x01" * 500)

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("mutual discovery OK")

        # -- baseline: a normal message works before any block -------------
        msg_id_before = await bob_msg.send(alice_disc.peer_id, "hi before block")
        await wait_until(lambda: _has(alice_store, bob_disc.peer_id, msg_id_before), fail_msg="baseline message never arrived before blocking")
        print("TEST 1 (baseline message delivery works before any block): PASS")

        # -- alice blocks bob ------------------------------------------------
        await alice_store.block_peer(bob_disc.peer_id, "Bob")
        assert await alice_store.is_peer_blocked(bob_disc.peer_id)
        print("TEST 2 (block recorded in alice's own store): PASS")

        # -- bob's messages to alice no longer arrive -------------------------
        msg_id_blocked = await bob_msg.send(alice_disc.peer_id, "hi after block - should be refused")
        await asyncio.sleep(1.0)  # give it a real chance to arrive if the block failed
        assert not await _has(alice_store, bob_disc.peer_id, msg_id_blocked), "a message from a blocked peer should never be stored"
        print("TEST 3 (message from a blocked peer never reaches the recipient's store): PASS")

        # -- alice's own sends to bob don't go through either (bidirectional) -
        alice_to_bob_msg_id = await alice_msg.send(bob_disc.peer_id, "can alice still reach bob?")
        await asyncio.sleep(1.0)
        alice_hist = await alice_store.history(bob_disc.peer_id)
        sent_record = next((m for m in alice_hist if m.msg_id == alice_to_bob_msg_id), None)
        assert sent_record is not None and sent_record.status == "pending", f"expected the send to stay pending (never delivered) while bob is blocked, got {sent_record}"
        bob_hist = await bob_store.history(alice_disc.peer_id)
        assert not any(m.msg_id == alice_to_bob_msg_id for m in bob_hist), "bob should never have received a message sent while blocked"
        print("TEST 4 (alice's own outgoing messages to a blocked peer never get delivered either): PASS")

        # -- bob's file offer to alice is refused -----------------------------
        # Fired as a background task rather than awaited directly: bob's own
        # send_control() can report success (the bytes reached the OS socket
        # buffer) even though alice's server already closed the connection
        # right after "hello" and never actually read this frame - so
        # send_file() will genuinely hang until its own 60s safety-net
        # timeout fires (see filetransfer.py's _offer_and_stream). The real
        # property under test here is simpler and faster to check directly:
        # alice must never see the offer at all, regardless of how bob's own
        # call eventually resolves.
        send_task = asyncio.create_task(bob_ft.send_file(alice_disc.peer_id, str(test_file)))
        await asyncio.sleep(0.5)
        assert len(alice_offers) == 0, "alice should never see a file offer from a blocked peer"
        print("TEST 5 (file offer from a blocked peer is refused, same choke point as chat): PASS")
        send_task.cancel()
        try:
            await send_task
        except (asyncio.CancelledError, ConnectionError):
            pass

        # -- bob's call offer to alice is refused -----------------------------
        fake_sdp = {"type": "offer", "sdp": "v=0 fake"}
        try:
            await bob_call.start_call(alice_disc.peer_id, fake_sdp, "audio")
        except Exception:
            pass  # either raises or silently fails to reach alice - both acceptable, what matters is alice never sees it
        await asyncio.sleep(0.3)
        assert len(alice_incoming_calls) == 0, "alice should never see an incoming call from a blocked peer"
        print("TEST 6 (call offer from a blocked peer is refused, same choke point): PASS")

        # -- unblock restores normal traffic in both directions ---------------
        await alice_store.unblock_peer(bob_disc.peer_id)
        assert not await alice_store.is_peer_blocked(bob_disc.peer_id)

        msg_id_after_unblock = await bob_msg.send(alice_disc.peer_id, "hi after unblock")
        await wait_until(lambda: _has(alice_store, bob_disc.peer_id, msg_id_after_unblock), fail_msg="message never arrived after unblocking")
        print("TEST 7 (unblocking restores real message delivery): PASS")

        print()
        print("ALL TESTS PASSED")
    finally:
        await alice_msg.stop()
        await bob_msg.stop()
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


async def _has(store: MessageStore, peer_id: str, msg_id: str) -> bool:
    hist = await store.history(peer_id)
    return any(m.msg_id == msg_id for m in hist)


if __name__ == "__main__":
    asyncio.run(main())
