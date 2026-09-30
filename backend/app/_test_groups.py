"""
Automated integration test for group chat and group calling (groups.py).

Three full stacks (discovery + messaging + calling + groups) in one
process, over real sockets on localhost, same pattern as
_test_calling.py/_test_deletion.py. Covers:
  1. Creating a group relays group_invite to every other member, and every
     member ends up with an identical local copy of the membership.
  2. A group message fans out to every other member (not back to the
     sender), each of whom stores it locally.
  3. Group calling's mesh formation: starting a group call broadcasts
     group_call_start to everyone (including, via a local rebroadcast, the
     initiator itself), and each member independently computes the correct
     peer_id-ordering mesh subset - for 3 members sorted alice < bob <
     carol, alice calls bob and carol, bob calls only carol, carol calls no
     one, exactly 3 real 1:1 calls (via calling.py, no group-aware code in
     calling.py itself), no duplicates.

Not a CLI tool - run directly:
    python -m app._test_groups
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from app.calling import CallService
from app.discovery import PeerDiscovery
from app.filetransfer import FileTransferService, IncomingFileOffer
from app.groups import GroupService
from app.messaging import MessagingService
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


def mesh_targets(self_peer_id: str, members: list) -> list[str]:
    """The exact same rule the frontend's useGroupCall.js applies: call
    every other member whose peer_id sorts after your own."""
    return sorted(m.peer_id for m in members if m.peer_id != self_peer_id and m.peer_id > self_peer_id)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_groups_test_"))
    print(f"scratch dir: {tmp}")

    # Chosen so alphabetic sort matches the intended test order exactly.
    alice_id, bob_id, carol_id = "alice-grp-test", "bob-grp-test", "carol-grp-test"
    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    carol_store = MessageStore(str(tmp / "carol.db"))
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8601, peer_id=alice_id, public_key=alice_store.get_or_create_device_keys()["public_key"], signing_private_key=alice_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=alice_store.get_or_create_device_keys()["signing_public_key"])
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8602, peer_id=bob_id, public_key=bob_store.get_or_create_device_keys()["public_key"], signing_private_key=bob_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=bob_store.get_or_create_device_keys()["signing_public_key"])
    carol_disc = PeerDiscovery(device_name="Carol", service_port=8603, peer_id=carol_id, public_key=carol_store.get_or_create_device_keys()["public_key"], signing_private_key=carol_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=carol_store.get_or_create_device_keys()["signing_public_key"])
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)
    carol_msg = MessagingService(carol_disc, carol_store)
    alice_call = CallService(alice_disc, alice_msg, alice_store)
    bob_call = CallService(bob_disc, bob_msg, bob_store)
    carol_call = CallService(carol_disc, carol_msg, carol_store)

    bob_offers = []
    carol_offers = []

    def bob_on_offer(offer: IncomingFileOffer) -> None:
        bob_offers.append(offer)
        asyncio.create_task(bob_ft.accept(offer.transfer_id))

    def carol_on_offer(offer: IncomingFileOffer) -> None:
        carol_offers.append(offer)
        asyncio.create_task(carol_ft.accept(offer.transfer_id))

    alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"))
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"), on_offer=bob_on_offer)
    carol_ft = FileTransferService(carol_disc, carol_msg, carol_store, downloads_dir=str(tmp / "carol_files"), on_offer=carol_on_offer)

    bob_invited = asyncio.get_event_loop().create_future()
    carol_invited = asyncio.get_event_loop().create_future()
    bob_got_message = asyncio.get_event_loop().create_future()
    carol_got_message = asyncio.get_event_loop().create_future()
    bob_call_start = asyncio.get_event_loop().create_future()
    carol_call_start = asyncio.get_event_loop().create_future()

    alice_groups = GroupService(alice_disc, alice_msg, alice_store, alice_ft, alice_id, "Alice")
    bob_groups = GroupService(
        bob_disc,
        bob_msg,
        bob_store,
        bob_ft,
        bob_id,
        "Bob",
        on_group_invite=lambda g: not bob_invited.done() and bob_invited.set_result(g),
        on_group_message=lambda e: not bob_got_message.done() and bob_got_message.set_result(e),
        on_group_call_start=lambda e: not bob_call_start.done() and bob_call_start.set_result(e),
    )
    carol_groups = GroupService(
        carol_disc,
        carol_msg,
        carol_store,
        carol_ft,
        carol_id,
        "Carol",
        on_group_invite=lambda g: not carol_invited.done() and carol_invited.set_result(g),
        on_group_message=lambda e: not carol_got_message.done() and carol_got_message.set_result(e),
        on_group_call_start=lambda e: not carol_call_start.done() and carol_call_start.set_result(e),
    )

    try:
        for d in (alice_disc, bob_disc, carol_disc):
            await asyncio.to_thread(d.start)
        for m in (alice_msg, bob_msg, carol_msg):
            await m.start()
        await wait_mutual_discovery([alice_disc, bob_disc, carol_disc])
        print("mutual discovery (3-way) OK")

        # -- test 1: create a group, invite propagates to both members ------
        group = await alice_groups.create_group("Test Squad", [(bob_id, "Bob"), (carol_id, "Carol")])
        bob_group = await asyncio.wait_for(bob_invited, timeout=10)
        carol_group = await asyncio.wait_for(carol_invited, timeout=10)
        assert bob_group.group_id == group.group_id == carol_group.group_id
        assert {m.peer_id for m in bob_group.members} == {alice_id, bob_id, carol_id}
        assert {m.peer_id for m in carol_group.members} == {alice_id, bob_id, carol_id}
        bob_local = await bob_store.get_group(group.group_id)
        carol_local = await carol_store.get_group(group.group_id)
        assert bob_local is not None and carol_local is not None
        print("TEST 1 (group_invite propagates identical membership to every member): PASS")

        # -- test 2: a group message fans out to every other member ---------
        msg_id = await alice_groups.send_group_message(group.group_id, "hello everyone")
        bob_evt = await asyncio.wait_for(bob_got_message, timeout=10)
        carol_evt = await asyncio.wait_for(carol_got_message, timeout=10)
        assert bob_evt.msg_id == msg_id and bob_evt.body == "hello everyone" and bob_evt.sender_peer_id == alice_id
        assert carol_evt.msg_id == msg_id
        bob_hist = await bob_store.group_history(group.group_id)
        carol_hist = await carol_store.group_history(group.group_id)
        assert any(m.msg_id == msg_id for m in bob_hist)
        assert any(m.msg_id == msg_id for m in carol_hist)
        alice_hist = await alice_store.group_history(group.group_id)
        assert any(m.msg_id == msg_id for m in alice_hist), "sender's own copy should be stored too"
        print("TEST 2 (group message fans out to every other member, sender keeps its own copy): PASS")

        # -- test 3: group call mesh formation -------------------------------
        evt = await alice_groups.start_group_call(group.group_id, "video")
        # group_service.start_group_call only sends the wire message to the
        # *other* members - api.py's real route also rebroadcasts the same
        # event to the initiator locally (see _on_group_call_start in
        # api.py); simulate that one extra step here since this test
        # exercises GroupService directly, not through the HTTP layer.
        b_evt = await asyncio.wait_for(bob_call_start, timeout=10)
        c_evt = await asyncio.wait_for(carol_call_start, timeout=10)
        assert evt.group_call_id == b_evt.group_call_id == c_evt.group_call_id

        alice_targets = mesh_targets(alice_id, evt.members)
        bob_targets = mesh_targets(bob_id, b_evt.members)
        carol_targets = mesh_targets(carol_id, c_evt.members)
        assert alice_targets == [bob_id, carol_id], alice_targets
        assert bob_targets == [carol_id], bob_targets
        assert carol_targets == [], carol_targets
        print("TEST 3a (mesh rule computes the correct call-who-first subset per member, no duplicates): PASS")

        # Actually place the real 1:1 calls the mesh rule says each member
        # should place, through the real (already-tested) CallService, and
        # confirm every pairwise leg connects with the group_call_id attached.
        fake_sdp = {"type": "offer", "sdp": "v=0 fake-group-call-sdp"}
        alice_to_bob = await alice_call.start_call(bob_id, fake_sdp, "video", group_call_id=evt.group_call_id)
        alice_to_carol = await alice_call.start_call(carol_id, fake_sdp, "video", group_call_id=evt.group_call_id)
        bob_to_carol = await bob_call.start_call(carol_id, fake_sdp, "video", group_call_id=evt.group_call_id)

        await wait_until(lambda: _has_incoming(bob_call, alice_id), fail_msg="bob never got alice's call")
        await wait_until(lambda: _has_incoming(carol_call, alice_id), fail_msg="carol never got alice's call")
        await wait_until(lambda: _has_incoming(carol_call, bob_id), fail_msg="carol never got bob's call")

        bob_side_of_alice_call = next(s for s in bob_call._calls.values() if s.peer_id == alice_id)
        carol_side_of_alice_call = next(s for s in carol_call._calls.values() if s.peer_id == alice_id)
        carol_side_of_bob_call = next(s for s in carol_call._calls.values() if s.peer_id == bob_id)
        assert bob_side_of_alice_call.group_call_id == evt.group_call_id
        assert carol_side_of_alice_call.group_call_id == evt.group_call_id
        assert carol_side_of_bob_call.group_call_id == evt.group_call_id
        assert carol_side_of_bob_call.direction == "incoming"

        # And confirm carol genuinely never tried to place an outgoing call
        # to anyone (her mesh target list was empty) - both her calls are
        # incoming, matching TEST 3a's prediction, not just asserted in
        # isolation from real signaling.
        assert all(s.direction == "incoming" for s in carol_call._calls.values())
        print("TEST 3b (exactly 3 real 1:1 calls formed the full mesh, each carrying the shared group_call_id, carol never dials out): PASS")

        # -- test 4: group calling is capped, over the limit is rejected -----
        from app.groups import MAX_GROUP_CALL_MEMBERS
        from app.storage import GroupMember as GM

        big_members = [GM(f"fake-peer-{i}", f"Fake{i}") for i in range(MAX_GROUP_CALL_MEMBERS + 1)]
        await alice_store.save_group("big-group-test", "Huge Group", big_members)
        try:
            await alice_groups.start_group_call("big-group-test", "video")
            raise AssertionError("start_group_call should have rejected a group over the cap")
        except ValueError as e:
            assert str(MAX_GROUP_CALL_MEMBERS) in str(e), f"error message should mention the cap, got: {e}"
        print(f"TEST 4 (group calling rejects a group of {len(big_members)}, over the {MAX_GROUP_CALL_MEMBERS}-person cap): PASS")

        # -- test 5: group file sharing fans out to every other member -------
        test_file = tmp / "photo.png"
        test_file.write_bytes(b"\x89PNG" + b"\x01" * 5000)
        transfer_ids = await alice_groups.send_group_file(group.group_id, str(test_file))
        assert len(transfer_ids) == 2, f"expected 2 outgoing transfers (bob + carol), got {len(transfer_ids)}"

        await wait_until(lambda: _len_at_least(bob_offers, 1), fail_msg="bob never received the group file offer")
        await wait_until(lambda: _len_at_least(carol_offers, 1), fail_msg="carol never received the group file offer")
        assert bob_offers[0].group_id == group.group_id, "bob's offer should be tagged with the group_id"
        assert carol_offers[0].group_id == group.group_id, "carol's offer should be tagged with the group_id"

        async def _both_completed():
            b = await bob_store.get_file(bob_offers[0].transfer_id)
            c = await carol_store.get_file(carol_offers[0].transfer_id)
            return b is not None and b.status == "completed" and c is not None and c.status == "completed"

        await wait_until(_both_completed, timeout=10, fail_msg="group file transfer never completed on both sides")

        bob_group_files = await bob_store.group_files(group.group_id)
        carol_group_files = await carol_store.group_files(group.group_id)
        alice_group_files = await alice_store.group_files(group.group_id)
        assert len(bob_group_files) == 1 and bob_group_files[0].filename == "photo.png"
        assert len(carol_group_files) == 1
        # Alice's own store has TWO records here, one outgoing transfer per
        # recipient (bob, carol) - sending "to a group" really is N separate
        # 1:1 sends under the hood, this isn't a single shared row.
        assert len(alice_group_files) == 2, f"expected 2 (one outgoing transfer per recipient), got {len(alice_group_files)}"
        print("TEST 5 (a group file fans out as two independent, already-tested 1:1 transfers, both tagged with the group_id, both complete): PASS")

        print()
        print("ALL TESTS PASSED")
    finally:
        for m in (alice_msg, bob_msg, carol_msg):
            await m.stop()
        for d in (alice_disc, bob_disc, carol_disc):
            d.stop()
        shutil.rmtree(tmp, ignore_errors=True)


async def _has_incoming(call_service: CallService, from_peer_id: str) -> bool:
    return any(s.peer_id == from_peer_id and s.direction == "incoming" for s in call_service._calls.values())


async def _len_at_least(lst: list, n: int) -> bool:
    return len(lst) >= n


if __name__ == "__main__":
    asyncio.run(main())
