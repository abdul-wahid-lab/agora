"""
Automated integration test: a group message sent while a member is offline
gets queued in pending_group_messages and auto-delivers once GroupService's
own _flush_pending_loop sees that member reappear in discovery, the same
way messaging.py's 1:1 flush loop and filetransfer.py's retry loop already
work.

Not a CLI tool - run directly:
    python -m app._test_group_message_retry
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
from app.storage import MessageStore


async def wait_until(predicate, timeout=10, interval=0.2, fail_msg="condition never became true"):
    for _ in range(int(timeout / interval)):
        if await predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError(fail_msg)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_grpmsg_retry_test_"))
    print(f"scratch dir: {tmp}")

    alice_id, bob_id = "alice-grpmsg-retry-test", "bob-grpmsg-retry-test"
    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8701, peer_id=alice_id, public_key=alice_store.get_or_create_device_keys()["public_key"], signing_private_key=alice_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=alice_store.get_or_create_device_keys()["signing_public_key"])
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8702, peer_id=bob_id, public_key=bob_store.get_or_create_device_keys()["public_key"], signing_private_key=bob_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=bob_store.get_or_create_device_keys()["signing_public_key"])
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)
    alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"))
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"))

    bob_got_message = asyncio.get_event_loop().create_future()
    alice_groups = GroupService(alice_disc, alice_msg, alice_store, alice_ft, alice_id, "Alice")
    bob_groups = GroupService(
        bob_disc,
        bob_msg,
        bob_store,
        bob_ft,
        bob_id,
        "Bob",
        on_group_message=lambda e: not bob_got_message.done() and bob_got_message.set_result(e),
    )

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await alice_ft.start()
        await alice_groups.start()  # the flush loop under test

        # Both peers' discovery beacons are up, but bob's messaging/groups
        # aren't listening yet - mirrors _test_file_auto_retry.py's own
        # framing exactly: "reachable on the network but the app isn't
        # actually up".
        await wait_until(lambda: _sees(alice_disc, bob_id), fail_msg="alice never saw bob in discovery")
        print("bob visible to discovery (but not reachable) OK")

        # Alice creates a group that (locally) already includes bob, without
        # going through create_group's own invite handshake (bob isn't up to
        # receive it yet) - seed both sides' storage directly, the same way
        # TEST 4 in _test_groups.py seeds a synthetic group.
        from app.storage import GroupMember as GM

        members = [GM(alice_id, "Alice"), GM(bob_id, "Bob")]
        await alice_store.save_group("grp-retry-test", "Retry Test", members)

        msg_id = await alice_groups.send_group_message("grp-retry-test", "are you there")

        async def _is_pending():
            pending = await alice_store.pending_group_messages_for_peer(bob_id)
            return any(p.msg_id == msg_id for p in pending)

        await wait_until(_is_pending, fail_msg="message to offline bob was never queued as pending")
        print("TEST 1 (message to an offline member is queued in pending_group_messages, not silently dropped): PASS")

        print("--- bob 'comes online' ---")
        await bob_msg.start()
        await bob_groups.start()

        evt = await asyncio.wait_for(bob_got_message, timeout=15)
        assert evt.msg_id == msg_id and evt.body == "are you there" and evt.sender_peer_id == alice_id
        print("TEST 2 (bob receives the held message once he reconnects, via the flush loop, no manual resend): PASS")

        async def _no_longer_pending():
            pending = await alice_store.pending_group_messages_for_peer(bob_id)
            return not any(p.msg_id == msg_id for p in pending)

        await wait_until(_no_longer_pending, fail_msg="pending record was never cleared after successful delivery")
        bob_hist = await bob_store.group_history("grp-retry-test")
        assert any(m.msg_id == msg_id for m in bob_hist), "bob's own group history should now contain the message"
        print("TEST 3 (pending record cleared after delivery, message lands in bob's real group history): PASS")

        print()
        print("ALL TESTS PASSED")
    finally:
        await alice_groups.stop()
        await alice_ft.stop()
        await alice_msg.stop()
        try:
            await bob_groups.stop()
            await bob_msg.stop()
        except Exception:
            pass
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


async def _sees(disc: PeerDiscovery, peer_id: str) -> bool:
    return any(p.peer_id == peer_id for p in disc.registry.list())


if __name__ == "__main__":
    asyncio.run(main())
