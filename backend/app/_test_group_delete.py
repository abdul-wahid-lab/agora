"""
Automated integration test for "delete for everyone" on a group message
(GroupService.delete_group_message_for_everyone).

Three full stacks (discovery + messaging + groups) over real localhost
sockets, same pattern as _test_deletion.py's own two-peer test - just with
a third member so fan-out to *multiple* others is actually exercised, not
just a single 1:1 relay. Covers both real scenarios: every member online at
delete time (immediate relay to each), and one member offline at delete
time (queued in pending_group_deletes for just that member, then flushed
automatically once they reconnect).

Not a CLI tool - run directly:
    python -m app._test_group_delete
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from app.discovery import PeerDiscovery
from app.filetransfer import FileTransferService
from app.groups import GroupService
from app.messaging import MessagingService
from app.storage import GroupMember as GM
from app.storage import MessageStore


async def wait_mutual_discovery(peers: list[PeerDiscovery], timeout=10) -> None:
    for _ in range(timeout * 10):
        ok = all(all(any(p.peer_id == other.peer_id for p in d.registry.list()) for other in peers if other is not d) for d in peers)
        if ok:
            return
        await asyncio.sleep(0.1)
    raise TimeoutError("peers never fully discovered each other")


async def wait_until(predicate, timeout=10, interval=0.15, fail_msg="condition never became true"):
    for _ in range(int(timeout / interval)):
        if await predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError(fail_msg)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_grpdel_test_"))
    print(f"scratch dir: {tmp}")

    alice_id, bob_id, carol_id = "alice-grpdel-test", "bob-grpdel-test", "carol-grpdel-test"
    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    carol_store = MessageStore(str(tmp / "carol.db"))
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8801, peer_id=alice_id, public_key=alice_store.get_or_create_device_keys()["public_key"], signing_private_key=alice_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=alice_store.get_or_create_device_keys()["signing_public_key"])
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8802, peer_id=bob_id, public_key=bob_store.get_or_create_device_keys()["public_key"], signing_private_key=bob_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=bob_store.get_or_create_device_keys()["signing_public_key"])
    carol_disc = PeerDiscovery(device_name="Carol", service_port=8803, peer_id=carol_id, public_key=carol_store.get_or_create_device_keys()["public_key"], signing_private_key=carol_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=carol_store.get_or_create_device_keys()["signing_public_key"])
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)
    carol_msg = MessagingService(carol_disc, carol_store)
    alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"))
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"))
    carol_ft = FileTransferService(carol_disc, carol_msg, carol_store, downloads_dir=str(tmp / "carol_files"))

    bob_deletes = []
    carol_deletes = []
    alice_groups = GroupService(alice_disc, alice_msg, alice_store, alice_ft, alice_id, "Alice")
    bob_groups = GroupService(bob_disc, bob_msg, bob_store, bob_ft, bob_id, "Bob", on_group_delete=lambda gid, mid: bob_deletes.append((gid, mid)))
    carol_groups = GroupService(carol_disc, carol_msg, carol_store, carol_ft, carol_id, "Carol", on_group_delete=lambda gid, mid: carol_deletes.append((gid, mid)))

    members = [GM(alice_id, "Alice"), GM(bob_id, "Bob"), GM(carol_id, "Carol")]

    try:
        for d in (alice_disc, bob_disc, carol_disc):
            await asyncio.to_thread(d.start)
        for m in (alice_msg, bob_msg, carol_msg):
            await m.start()
        for g in (alice_groups, bob_groups, carol_groups):
            await g.start()
        await wait_mutual_discovery([alice_disc, bob_disc, carol_disc])
        print("mutual discovery (3-way) OK")

        for s in (alice_store, bob_store, carol_store):
            await s.save_group("grpdel-test", "Delete Test", members)

        # -- test 1: everyone online at delete time - immediate relay to both --
        msg_id = await alice_groups.send_group_message("grpdel-test", "delete me")
        await wait_until(lambda: _has(bob_store, msg_id), fail_msg="bob never received the original message")
        await wait_until(lambda: _has(carol_store, msg_id), fail_msg="carol never received the original message")

        await alice_groups.delete_group_message_for_everyone("grpdel-test", msg_id)
        assert not await _has(alice_store, msg_id), "alice's own copy should be gone immediately"

        await wait_until(lambda: _not_has(bob_store, msg_id), fail_msg="bob's copy was never deleted while online")
        await wait_until(lambda: _not_has(carol_store, msg_id), fail_msg="carol's copy was never deleted while online")
        assert bob_deletes == [("grpdel-test", msg_id)]
        assert carol_deletes == [("grpdel-test", msg_id)]
        print("TEST 1 (online group delete-for-everyone reaches every other member): PASS")

        # -- test 2: carol offline at delete time - queued, then flushed -------
        msg_id2 = await alice_groups.send_group_message("grpdel-test", "delete me later")
        await wait_until(lambda: _has(bob_store, msg_id2), fail_msg="bob never received the second message")
        await wait_until(lambda: _has(carol_store, msg_id2), fail_msg="carol never received the second message")

        await carol_groups.stop()
        await carol_msg.stop()  # simulate carol unreachable - discovery stays up, so alice still sees her as "visible"
        await asyncio.sleep(0.2)

        await alice_groups.delete_group_message_for_everyone("grpdel-test", msg_id2)
        assert not await _has(alice_store, msg_id2), "alice's own copy should be gone immediately even with carol offline"
        await wait_until(lambda: _not_has(bob_store, msg_id2), fail_msg="bob (still online) should have gotten the delete right away")

        pending = await alice_store.pending_group_deletes_for_peer(carol_id)
        assert (msg_id2, "grpdel-test") in pending, "delete notice to offline carol should be queued, not dropped"
        print("TEST 2a (offline member's delete notice queues instead of dropping, others still get it immediately): PASS")

        await carol_msg.start()
        await carol_groups.start()  # carol "reconnects"
        await wait_until(lambda: _not_has(carol_store, msg_id2), timeout=8, fail_msg="queued group delete was never flushed after carol reconnected")

        pending_after = await alice_store.pending_group_deletes_for_peer(carol_id)
        assert (msg_id2, "grpdel-test") not in pending_after, "pending_group_deletes row should be cleared after a successful flush"
        print("TEST 2b (offline group delete flushed automatically on reconnect, carol's on_group_delete callback fires without crashing on a missing group_id): PASS")

        assert carol_deletes[-1] == ("grpdel-test", msg_id2), "carol's on_group_delete callback should have fired with the real group_id, not crashed with a KeyError"

        print()
        print("ALL TESTS PASSED")
    finally:
        for g in (alice_groups, bob_groups, carol_groups):
            try:
                await g.stop()
            except Exception:
                pass
        for ft in (alice_ft, bob_ft, carol_ft):
            await ft.stop()
        await alice_msg.stop()
        for m in (bob_msg, carol_msg):
            try:
                await m.stop()
            except Exception:
                pass
        for d in (alice_disc, bob_disc, carol_disc):
            d.stop()
        shutil.rmtree(tmp, ignore_errors=True)


async def _has(store: MessageStore, msg_id: str) -> bool:
    hist = await store.group_history("grpdel-test", limit=1000)
    return any(m.msg_id == msg_id for m in hist)


async def _not_has(store: MessageStore, msg_id: str) -> bool:
    return not await _has(store, msg_id)


if __name__ == "__main__":
    asyncio.run(main())
