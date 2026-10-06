"""
Automated integration test: a device already in a call with one peer
correctly rejects a call from a different peer as busy, found missing by a
real two-person test session (Alice and Bob mid-call, Carol calls Alice -
Carol's offer fell straight through to becoming a second, independent
incoming-call state, since the existing busy/collision check only ever
compared against Carol's own peer_id, which had no prior call on file).

Not a CLI tool - run directly:
    python -m app._test_busy_device
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from app.calling import CallService
from app.discovery import PeerDiscovery
from app.messaging import MessagingService
from app.storage import MessageStore


async def wait_mutual_discovery(a: PeerDiscovery, b: PeerDiscovery, timeout=10) -> None:
    for _ in range(timeout * 10):
        if any(p.peer_id == b.peer_id for p in a.registry.list()) and any(p.peer_id == a.peer_id for p in b.registry.list()):
            return
        await asyncio.sleep(0.1)
    raise TimeoutError("peers never discovered each other")


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_busy_test_"))
    print(f"scratch dir: {tmp}")

    stores = {name: MessageStore(str(tmp / f"{name}.db")) for name in ("alice", "bob", "carol")}
    keys = {name: stores[name].get_or_create_device_keys() for name in stores}
    discs = {
        name: PeerDiscovery(
            device_name=name.capitalize(),
            service_port=8701 + i,
            peer_id=f"{name}-busy-test",
            public_key=keys[name]["public_key"],
            signing_private_key=keys[name]["signing_private_key"],
            signing_public_key=keys[name]["signing_public_key"],
        )
        for i, name in enumerate(stores)
    }
    msgs = {name: MessagingService(discs[name], stores[name]) for name in stores}

    alice_ended = []
    carol_ended = []
    alice_call = CallService(discs["alice"], msgs["alice"], stores["alice"], on_call_ended=lambda cid, reason: alice_ended.append((cid, reason)))
    bob_call = CallService(discs["bob"], msgs["bob"], stores["bob"])
    carol_call = CallService(discs["carol"], msgs["carol"], stores["carol"], on_call_ended=lambda cid, reason: carol_ended.append((cid, reason)))

    try:
        for d in discs.values():
            await asyncio.to_thread(d.start)
        for m in msgs.values():
            await m.start()
        await wait_mutual_discovery(discs["alice"], discs["bob"])
        await wait_mutual_discovery(discs["alice"], discs["carol"])
        print("PASS: all three discovered each other")

        # Alice calls Bob, Bob answers - a real in_call state on both sides,
        # not just a ringing one, since the busy check cares about either.
        alice_to_bob = await alice_call.start_call(discs["bob"].peer_id, {"type": "offer", "sdp": "fake"}, "audio")
        await asyncio.sleep(0.3)
        await bob_call.answer_call(alice_to_bob, {"type": "answer", "sdp": "fake"})
        await asyncio.sleep(0.3)
        assert alice_call._calls[alice_to_bob].status == "in_call", "Alice-Bob call never reached in_call"
        print("PASS: Alice and Bob are genuinely in a call")

        # Carol calls Alice while Alice is in that call with Bob - Alice has
        # no prior call on file for Carol specifically, so the old per-peer-
        # only check would have let this straight through.
        carol_to_alice = await carol_call.start_call(discs["alice"].peer_id, {"type": "offer", "sdp": "fake"}, "audio")
        await asyncio.sleep(0.5)

        assert carol_ended and carol_ended[-1] == (carol_to_alice, "busy"), f"expected Carol's call to end as busy, got {carol_ended}"
        print("PASS: Carol's call to Alice is rejected as busy")

        assert carol_to_alice not in alice_call._calls, "Alice should never have created a call state for Carol's rejected offer"
        print("PASS: Alice never created a second, independent call state for Carol")

        assert alice_call._active_for_peer.get(discs["bob"].peer_id) == alice_to_bob, "Alice's real call with Bob must be completely undisturbed"
        assert alice_call._calls[alice_to_bob].status == "in_call"
        print("PASS: Alice's real call with Bob is untouched throughout")

        print("\nALL BUSY-DEVICE TESTS PASSED")
    finally:
        for m in msgs.values():
            await m.stop()
        for d in discs.values():
            d.stop()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
