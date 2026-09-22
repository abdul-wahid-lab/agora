"""
Automated integration test for Phase 3 (calling signaling relay).

This does NOT test real WebRTC/media - that only exists in a browser.
What's tested here is everything the Python backend is actually
responsible for: relaying offer/answer/ICE between two peers over the
existing WebSocket control channel, and resolving call collision
deterministically. Fake SDP/ICE payloads (plain dicts) stand in for
what a real RTCPeerConnection would produce - calling.py never looks
inside them, it just relays whatever it's given.

Not a CLI tool - run directly:
    python -m app._test_calling
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from app.calling import CallService, CallState
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


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_call_test_"))
    print(f"scratch dir: {tmp}")

    # peer_ids chosen so string comparison is predictable in the collision test
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8201, peer_id="a-alice-test")
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8202, peer_id="b-bob-test")
    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_msg = MessagingService(alice_disc, alice_store)
    bob_msg = MessagingService(bob_disc, bob_store)

    bob_incoming = asyncio.get_event_loop().create_future()

    def bob_on_incoming(state: CallState, sdp: dict) -> None:
        if not bob_incoming.done():
            bob_incoming.set_result((state, sdp))

    alice_answered = asyncio.get_event_loop().create_future()

    def alice_on_answered(call_id: str, sdp: dict) -> None:
        if not alice_answered.done():
            alice_answered.set_result((call_id, sdp))

    alice_ice_seen = []
    bob_ice_seen = []

    alice_call = CallService(alice_disc, alice_msg, alice_store, on_call_answered=alice_on_answered, on_ice_candidate=lambda cid, c: alice_ice_seen.append((cid, c)))
    bob_call = CallService(bob_disc, bob_msg, bob_store, on_incoming_call=bob_on_incoming, on_ice_candidate=lambda cid, c: bob_ice_seen.append((cid, c)))

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("mutual discovery OK")

        # -- test 1: happy path - offer, answer, ICE both ways, then end -------
        fake_offer_sdp = {"type": "offer", "sdp": "v=0 fake-offer-sdp"}
        call_id = await alice_call.start_call(bob_disc.peer_id, fake_offer_sdp, media="audio")
        assert alice_call.get(call_id).status == "ringing"

        state, sdp = await asyncio.wait_for(bob_incoming, timeout=10)
        assert state.call_id == call_id
        assert state.direction == "incoming"
        assert sdp == fake_offer_sdp
        assert bob_call.get(call_id).status == "ringing"
        print("TEST 1a (offer relayed): PASS")

        fake_answer_sdp = {"type": "answer", "sdp": "v=0 fake-answer-sdp"}
        await bob_call.answer_call(call_id, fake_answer_sdp)
        answered_id, answered_sdp = await asyncio.wait_for(alice_answered, timeout=10)
        assert answered_id == call_id
        assert answered_sdp == fake_answer_sdp
        assert alice_call.get(call_id).status == "in_call"
        assert bob_call.get(call_id).status == "in_call"
        print("TEST 1b (answer relayed, both sides in_call): PASS")

        await alice_call.send_ice_candidate(call_id, {"candidate": "fake-candidate-from-alice"})
        await bob_call.send_ice_candidate(call_id, {"candidate": "fake-candidate-from-bob"})
        await asyncio.sleep(0.3)
        assert any(c["candidate"] == "fake-candidate-from-alice" for _, c in bob_ice_seen), "Bob never saw Alice's ICE candidate"
        assert any(c["candidate"] == "fake-candidate-from-bob" for _, c in alice_ice_seen), "Alice never saw Bob's ICE candidate"
        print("TEST 1c (ICE candidates relayed both directions): PASS")

        await alice_call.end_call(call_id, reason="ended")
        await asyncio.sleep(0.3)
        assert alice_call.get(call_id).status == "ended"
        assert bob_call.get(call_id).status == "ended"
        assert bob_call.get(call_id).end_reason == "ended"
        assert bob_disc.peer_id not in alice_call._active_for_peer
        assert alice_disc.peer_id not in bob_call._active_for_peer
        print("TEST 1d (end call relayed, both sides cleared): PASS")

        # -- test 1e: call history persisted correctly on both sides -----------
        alice_history = await alice_store.list_calls(bob_disc.peer_id)
        bob_history = await bob_store.list_calls(alice_disc.peer_id)
        assert len(alice_history) == 1 and alice_history[0].call_id == call_id
        assert alice_history[0].direction == "outgoing" and alice_history[0].status == "completed"
        assert alice_history[0].duration is not None and alice_history[0].duration >= 0
        assert len(bob_history) == 1 and bob_history[0].call_id == call_id
        assert bob_history[0].direction == "incoming" and bob_history[0].status == "completed"
        print("TEST 1e (call history recorded as 'completed' with a duration on both sides): PASS")

        # -- test 2: decline (Bob ends a still-ringing call) --------------------
        bob_incoming2 = asyncio.get_event_loop().create_future()
        bob_call.on_incoming_call = lambda s, sdp: bob_incoming2.set_result((s, sdp)) if not bob_incoming2.done() else None

        call_id2 = await alice_call.start_call(bob_disc.peer_id, fake_offer_sdp, media="video")
        await asyncio.wait_for(bob_incoming2, timeout=10)
        await bob_call.end_call(call_id2, reason="declined")
        await asyncio.sleep(0.3)
        assert alice_call.get(call_id2).status == "ended"
        assert alice_call.get(call_id2).end_reason == "declined"
        alice_calls2 = await alice_store.list_calls(bob_disc.peer_id)
        declined_record = next(c for c in alice_calls2 if c.call_id == call_id2)
        assert declined_record.status == "declined" and declined_record.duration is None
        print("TEST 2 (decline relayed as call_end with reason, recorded as 'declined' with no duration): PASS")

        # -- test 3: busy - a second offer while already in a call with that peer
        bob_incoming3 = asyncio.get_event_loop().create_future()
        bob_call.on_incoming_call = lambda s, sdp: bob_incoming3.set_result((s, sdp)) if not bob_incoming3.done() else None
        call_id3 = await alice_call.start_call(bob_disc.peer_id, fake_offer_sdp, media="audio")
        await asyncio.wait_for(bob_incoming3, timeout=10)
        await bob_call.answer_call(call_id3, fake_answer_sdp)
        await asyncio.sleep(0.3)
        assert bob_call.get(call_id3).status == "in_call"

        # Alice tries a second, separate call to the already-in-call Bob -
        # bob_call should reject it as busy without disturbing call_id3.
        alice_call2_offer = {"type": "offer", "sdp": "v=0 second-attempt"}
        try:
            await alice_call.start_call(bob_disc.peer_id, alice_call2_offer, media="audio")
            raise AssertionError("expected start_call to reject a second call to a peer we're already calling")
        except ValueError:
            pass  # alice_call itself already guards one-call-per-peer locally
        print("TEST 3a (can't start a second local call to the same peer): PASS")

        await alice_call.end_call(call_id3, reason="ended")
        await asyncio.sleep(0.2)

        # -- test 4: collision - both peers offer each other at the same instant
        bob_incoming4 = asyncio.get_event_loop().create_future()
        bob_call.on_incoming_call = lambda s, sdp: bob_incoming4.set_result((s, sdp)) if not bob_incoming4.done() else None
        alice_incoming4 = asyncio.get_event_loop().create_future()
        alice_call.on_incoming_call = lambda s, sdp: alice_incoming4.set_result((s, sdp)) if not alice_incoming4.done() else None
        alice_yielded = asyncio.get_event_loop().create_future()
        alice_call.on_collision_yield = lambda cid: alice_yielded.set_result(cid) if not alice_yielded.done() else None
        bob_yielded = asyncio.get_event_loop().create_future()
        bob_call.on_collision_yield = lambda cid: bob_yielded.set_result(cid) if not bob_yielded.done() else None

        # alice_disc.peer_id = "a-alice-test" < bob_disc.peer_id = "b-bob-test",
        # so Alice's offer should win the tie-break.
        #
        # Fired concurrently (not sequential awaits) so both sides register
        # their own outgoing call locally - a synchronous dict write, before
        # either's "call_offer" has actually gone over the (real) socket and
        # been received - which is what makes this a genuine collision rather
        # than "Bob's offer happens to arrive before Alice ever calls".
        alice_offer_sdp = {"type": "offer", "sdp": "v=0 alice-collision-offer"}
        bob_offer_sdp = {"type": "offer", "sdp": "v=0 bob-collision-offer"}
        alice_call_id, bob_call_id = await asyncio.gather(
            alice_call.start_call(bob_disc.peer_id, alice_offer_sdp, media="audio"),
            bob_call.start_call(alice_disc.peer_id, bob_offer_sdp, media="audio"),
        )

        # Bob's call_id should win on Bob's own side too (Alice's peer_id is smaller,
        # so from Bob's perspective the incoming offer from Alice should replace
        # Bob's own outgoing one), and Bob should see his own outgoing call yielded.
        yielded_id = await asyncio.wait_for(bob_yielded, timeout=10)
        assert yielded_id == bob_call_id, "expected Bob's own outgoing call to be the one that yielded"
        winning_state, winning_sdp = await asyncio.wait_for(bob_incoming4, timeout=10)
        assert winning_state.call_id == alice_call_id, "Bob should now see Alice's call_id as the active incoming call"
        assert winning_sdp == alice_offer_sdp
        assert bob_call.get(bob_call_id).status == "ended"
        assert bob_call.get(bob_call_id).end_reason == "collision"

        # Alice should NOT see Bob's offer as a new incoming call at all - her
        # own outgoing offer (the winner) just keeps ringing undisturbed.
        assert not alice_incoming4.done(), "Alice (the collision winner) should not treat Bob's offer as a new incoming call"
        assert alice_call.get(alice_call_id).status == "ringing"
        assert not alice_yielded.done(), "Alice's call should not have yielded - she won the tie-break"
        bob_calls4 = await bob_store.list_calls(alice_disc.peer_id)
        collided_record = next(c for c in bob_calls4 if c.call_id == bob_call_id)
        assert collided_record.status == "collision" and collided_record.duration is None
        print("TEST 4 (call collision resolved deterministically by peer_id, recorded as 'collision'): PASS")

        # clean up the still-ringing winning call from test 4 before moving on
        await alice_call.end_call(alice_call_id, reason="ended")
        await asyncio.sleep(0.2)

        # -- test 5: a connection that drops mid-call is recorded as 'dropped',
        # distinct from a normal hangup, even though both only happen after connecting
        bob_incoming5 = asyncio.get_event_loop().create_future()
        bob_call.on_incoming_call = lambda s, sdp: bob_incoming5.set_result((s, sdp)) if not bob_incoming5.done() else None
        call_id5 = await alice_call.start_call(bob_disc.peer_id, fake_offer_sdp, media="audio")
        await asyncio.wait_for(bob_incoming5, timeout=10)
        await bob_call.answer_call(call_id5, fake_answer_sdp)
        await asyncio.sleep(0.2)
        assert alice_call.get(call_id5).status == "in_call"

        # simulates the frontend's oniceconnectionstatechange handler calling
        # end_call with reason="dropped" instead of the user's own "ended"
        await alice_call.end_call(call_id5, reason="dropped")
        await asyncio.sleep(0.2)
        dropped_record = next(c for c in (await alice_store.list_calls(bob_disc.peer_id)) if c.call_id == call_id5)
        assert dropped_record.status == "dropped" and dropped_record.duration is not None
        print("TEST 5 (a call that connected then dropped is recorded as 'dropped', not 'completed'): PASS")

        print("\nALL TESTS PASSED")
    finally:
        await alice_msg.stop()
        await bob_msg.stop()
        alice_disc.stop()
        bob_disc.stop()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
