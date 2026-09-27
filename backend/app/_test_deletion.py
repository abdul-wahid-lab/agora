"""
Automated integration test for "delete for everyone" (deletion.py).

Two full stacks (discovery + messaging + deletion) in one process over real
localhost sockets, same pattern as _test_calling.py/_test_filetransfer.py.

Covers both real scenarios: the peer online at delete time (immediate
relay), and the peer offline at delete time (queued in `pending_deletes`,
then flushed automatically once they reconnect - the same guarantee
messaging.py's own _flush_pending_loop already gives a normal chat message).

Not a CLI tool - run directly:
    python -m app._test_deletion
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from app.deletion import DeleteService
from app.discovery import PeerDiscovery
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
    tmp = Path(tempfile.mkdtemp(prefix="agora_delete_test_"))
    print(f"scratch dir: {tmp}")

    alice_disc = PeerDiscovery(device_name="Alice", service_port=8401, peer_id="alice-del-test")
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8402, peer_id="bob-del-test")
    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)

    bob_saw_deletes = []
    alice_delete = DeleteService(alice_disc, alice_msg, alice_store)
    bob_delete = DeleteService(bob_disc, bob_msg, bob_store, on_remote_delete=lambda pid, mid: bob_saw_deletes.append((pid, mid)))

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()
        await alice_delete.start()
        await bob_delete.start()
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("mutual discovery OK")

        # -- test 1: peer online at delete time - immediate relay --------------
        msg_id = await alice_msg.send(bob_disc.peer_id, "hello, delete me")
        await wait_until(
            lambda: _has(bob_store, alice_disc.peer_id, msg_id),
            fail_msg="bob never received the original message",
        )

        await alice_delete.delete_for_everyone(bob_disc.peer_id, msg_id)
        assert not await _has(alice_store, bob_disc.peer_id, msg_id), "alice's own copy should be gone immediately"

        await wait_until(
            lambda: _not_has(bob_store, alice_disc.peer_id, msg_id),
            fail_msg="bob's copy was never deleted while online",
        )
        assert bob_saw_deletes == [(alice_disc.peer_id, msg_id)]
        print("test 1 (online delete-for-everyone) OK")

        # -- test 2: peer offline at delete time - queued, then flushed --------
        msg_id2 = await alice_msg.send(bob_disc.peer_id, "delete me later")
        await wait_until(
            lambda: _has(bob_store, alice_disc.peer_id, msg_id2),
            fail_msg="bob never received the second message",
        )

        await bob_msg.stop()  # simulate bob unreachable - discovery (bob_disc) stays up, so alice still sees him as "visible"
        await asyncio.sleep(0.2)

        await alice_delete.delete_for_everyone(bob_disc.peer_id, msg_id2)
        assert not await _has(alice_store, bob_disc.peer_id, msg_id2), "alice's own copy should be gone immediately even if bob is offline"
        pending = await alice_store.pending_deletes_for_peer(bob_disc.peer_id)
        assert msg_id2 in pending, "delete should be queued while bob is unreachable, not dropped"
        print("test 2a (offline delete queues instead of dropping) OK")

        await bob_msg.start()  # bob "reconnects"
        await wait_until(
            lambda: _not_has(bob_store, alice_disc.peer_id, msg_id2),
            timeout=8,  # deletion.py's flush loop ticks every 2s
            fail_msg="queued delete was never flushed after bob reconnected",
        )
        pending_after = await alice_store.pending_deletes_for_peer(bob_disc.peer_id)
        assert msg_id2 not in pending_after, "pending_deletes row should be cleared after a successful flush"
        print("test 2b (offline delete flushed automatically on reconnect) OK")

        print("ALL PASSED")
    finally:
        await alice_delete.stop()
        await bob_delete.stop()
        await alice_msg.stop()
        try:
            await bob_msg.stop()
        except Exception:
            pass
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


async def _has(store: MessageStore, peer_id: str, msg_id: str) -> bool:
    return any(m.msg_id == msg_id for m in await store.history(peer_id))


async def _not_has(store: MessageStore, peer_id: str, msg_id: str) -> bool:
    return not await _has(store, peer_id, msg_id)


if __name__ == "__main__":
    asyncio.run(main())
