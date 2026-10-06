"""
Automated integration test for avatar photo sync (photos.py).

Real claim being tested: PhotoExchange.fetch() actually round-trips real
bytes over the same encrypted control-message channel file transfer and
calling already use - not just that the code parses, that two genuinely
separate MessageStore/PeerDiscovery/MessagingService stacks over real
localhost sockets can ask each other for a photo and get the right answer
back, including the "no photo set" and "peer unreachable" cases a UI
actually has to handle.

Not a CLI tool - run directly:
    python -m app._test_photos
"""

from __future__ import annotations

import asyncio
import hashlib
import shutil
import tempfile
from pathlib import Path

from app.discovery import PeerDiscovery
from app.messaging import MessagingService
from app.photos import PhotoExchange, PhotoStore
from app.storage import MessageStore


async def wait_mutual_discovery(a: PeerDiscovery, b: PeerDiscovery, timeout=10) -> None:
    for _ in range(timeout * 10):
        if any(p.peer_id == b.peer_id for p in a.registry.list()) and any(p.peer_id == a.peer_id for p in b.registry.list()):
            return
        await asyncio.sleep(0.1)
    raise TimeoutError("peers never discovered each other")


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_photo_test_"))
    print(f"scratch dir: {tmp}")

    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_keys = alice_store.get_or_create_device_keys()
    bob_keys = bob_store.get_or_create_device_keys()
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8601, peer_id="alice-photo-test", public_key=alice_keys["public_key"], signing_private_key=alice_keys["signing_private_key"], signing_public_key=alice_keys["signing_public_key"])
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8602, peer_id="bob-photo-test", public_key=bob_keys["public_key"], signing_private_key=bob_keys["signing_private_key"], signing_public_key=bob_keys["signing_public_key"])
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)

    alice_photos = PhotoStore(str(tmp / "alice_photos"))
    bob_photos = PhotoStore(str(tmp / "bob_photos"))
    alice_exchange = PhotoExchange(alice_msg, alice_photos)
    bob_exchange = PhotoExchange(bob_msg, bob_photos)

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("PASS: mutual discovery")

        # 1. No photo set yet - asking should cleanly come back with None,
        # not an error, not a hang.
        result = await bob_exchange.fetch(alice_disc.peer_id, timeout=5)
        assert result is None, f"expected None for no photo set, got {result!r}"
        print("PASS: fetching a peer with no photo set returns None, not an error")

        # 2. Alice sets a real photo; Bob asks for it and gets the exact
        # same bytes back, over a real localhost socket round trip.
        fake_jpeg = b"\xff\xd8\xff\xe0" + bytes(range(256)) * 200  # ~51KB, not tiny
        alice_photos.set_self_photo(fake_jpeg)
        fetched = await bob_exchange.fetch(alice_disc.peer_id, timeout=5)
        assert fetched == fake_jpeg, "fetched bytes didn't match what Alice actually set"
        assert hashlib.sha256(fetched).hexdigest() == hashlib.sha256(fake_jpeg).hexdigest()
        print(f"PASS: real photo round-trips correctly ({len(fetched)} bytes, hash matches)")

        # 3. Symmetry: Bob sets his own photo, Alice fetches it - proving
        # this isn't accidentally one-directional.
        bob_jpeg = b"\xff\xd8\xff\xe1" + bytes(range(200, 255)) * 300
        bob_photos.set_self_photo(bob_jpeg)
        fetched_bob = await alice_exchange.fetch(bob_disc.peer_id, timeout=5)
        assert fetched_bob == bob_jpeg
        print("PASS: works in the other direction too (Bob's photo, fetched by Alice)")

        # 4. A peer_id that was never discovered at all should fail fast
        # with ConnectionError, not hang until the timeout.
        try:
            await bob_exchange.fetch("nobody-home-peer-id", timeout=2)
            raise AssertionError("expected ConnectionError for an unreachable peer_id")
        except ConnectionError:
            print("PASS: an unreachable peer_id raises ConnectionError, not a hang")

        # 5. A real concurrency case, not a hypothetical one: ConversationPane's
        # header and InfoSidebar both render a PeerAvatar for the same peer_id
        # on the same page, so two near-simultaneous fetches for one peer_id
        # genuinely happen with no cache yet. Both must actually succeed, not
        # one of them silently time out because the second request's Future
        # replaced the first's in _waiters.
        results = await asyncio.gather(
            bob_exchange.fetch(alice_disc.peer_id, timeout=5),
            bob_exchange.fetch(alice_disc.peer_id, timeout=5),
        )
        assert results[0] == fake_jpeg and results[1] == fake_jpeg, "both concurrent fetches for the same peer_id must succeed with the real bytes"
        print("PASS: two concurrent fetches for the same peer_id both succeed (no lost waiter)")

        print("\nALL PHOTO SYNC TESTS PASSED")
    finally:
        await alice_msg.stop()
        await bob_msg.stop()
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
