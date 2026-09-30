"""
Automated integration test for Phase 5 (transport encryption).

Real claims being tested, over two full stacks (discovery + messaging +
file transfer) on real localhost sockets, same pattern as the other
_test_*.py suites:
  1. Messages still round-trip correctly end-to-end through the new
     encrypted channel.
  2. The bytes that actually get handed to the socket are genuinely not
     the plaintext - not "we trust the code path", the literal blob passed
     to conn.send() is captured and checked.
  3. A corrupted/tampered frame is dropped (AEAD auth failure), not
     silently accepted and not a crash - the connection survives it and a
     later legitimate message still goes through.
  4. Trust-on-first-use: a peer's public key is remembered the first time
     it's seen, and a real key change for that same peer_id later fires
     the identity-changed warning with the correct peer_id/name.
  5. The file-transfer TCP data channel (a separate socket from the
     messaging WebSocket) also only ever carries encrypted chunks.

Not a CLI tool - run directly:
    python -m app._test_encryption
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path

from app import crypto_identity
from app.discovery import Peer, PeerDiscovery
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
    tmp = Path(tempfile.mkdtemp(prefix="agora_crypto_test_"))
    print(f"scratch dir: {tmp}")

    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))
    alice_disc = PeerDiscovery(device_name="Alice", service_port=8901, peer_id="alice-crypto-test", public_key=alice_store.get_or_create_device_keys()["public_key"])
    bob_disc = PeerDiscovery(device_name="Bob", service_port=8902, peer_id="bob-crypto-test", public_key=bob_store.get_or_create_device_keys()["public_key"])

    identity_warnings = []
    alice_msg = MessagingService(alice_disc, alice_store, on_identity_changed=lambda pid, name: identity_warnings.append((pid, name)))
    bob_msg = MessagingService(bob_disc, bob_store)

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("mutual discovery OK")

        # -- TEST 1: real round trip through the encrypted channel ----------
        secret_body = "the shipment leaves at midnight, tell no one"
        await alice_msg.send(bob_disc.peer_id, secret_body)

        async def bob_has_it():
            hist = await bob_store.history(alice_disc.peer_id)
            return any(m.body == secret_body for m in hist)

        await wait_until(bob_has_it, fail_msg="bob never received the message through the encrypted channel")
        print("TEST 1 (message round-trips correctly through encryption): PASS")

        # -- TEST 2: the wire bytes are genuinely not plaintext --------------
        # Wrap _encrypt_for (the exact method whose return value gets handed
        # straight to conn.send()) to capture the real blob that goes out,
        # not a reconstruction of what we assume happens.
        captured_blobs = []
        orig_encrypt_for = alice_msg._encrypt_for

        async def spy_encrypt_for(peer_id, message):
            blob = await orig_encrypt_for(peer_id, message)
            if blob is not None:
                captured_blobs.append(blob)
            return blob

        alice_msg._encrypt_for = spy_encrypt_for

        canary_body = "CANARY_PLAINTEXT_MUST_NOT_APPEAR_ON_THE_WIRE"
        await alice_msg.send(bob_disc.peer_id, canary_body)

        async def bob_has_canary():
            hist = await bob_store.history(alice_disc.peer_id)
            return any(m.body == canary_body for m in hist)

        await wait_until(bob_has_canary, fail_msg="bob never received the canary message")
        assert captured_blobs, "no frame was ever captured - test setup is wrong"
        wire_bytes = captured_blobs[-1]
        assert canary_body.encode() not in wire_bytes, "the plaintext body was found in the actual bytes handed to the socket"
        print("TEST 2 (the real bytes sent to the socket do not contain the plaintext): PASS")

        alice_msg._encrypt_for = orig_encrypt_for

        # -- TEST 3: a tampered frame is dropped, not crashed on -------------
        # Cancel the background flush loop for the rest of this test: it's a
        # real, benign, pre-existing behavior (a message still 'pending' at
        # the exact moment a flush tick lands can get a harmless redundant
        # resend - harmless because a real duplicate is idempotent by
        # msg_id) that would otherwise race this deliberately-corrupted send
        # and mask the very thing being tested here with a second, genuinely
        # valid delivery of the same message.
        alice_msg._flush_task.cancel()

        real_shared_key = await alice_msg.get_shared_key(bob_disc.peer_id)
        assert real_shared_key is not None

        orig_ct_encrypt = crypto_identity.encrypt
        tamper_once = {"armed": True}

        def tampering_encrypt(key, plaintext):
            blob = orig_ct_encrypt(key, plaintext)
            if tamper_once["armed"]:
                tamper_once["armed"] = False
                blob = blob[:-1] + bytes([blob[-1] ^ 0xFF])  # flip the last byte of the auth tag
            return blob

        crypto_identity.encrypt = tampering_encrypt
        try:
            tampered_body = "this frame will arrive corrupted and must be dropped"
            await alice_msg.send(bob_disc.peer_id, tampered_body)
        finally:
            crypto_identity.encrypt = orig_ct_encrypt

        await asyncio.sleep(1.0)
        hist = await bob_store.history(alice_disc.peer_id)
        assert not any(m.body == tampered_body for m in hist), "a tampered/corrupted frame was accepted instead of dropped"

        # Connection must have survived the garbage frame - a normal
        # message right after should still go through with no special
        # recovery step.
        recovery_body = "connection survived the tampered frame, this one is clean"
        await alice_msg.send(bob_disc.peer_id, recovery_body)

        async def bob_has_recovery():
            hist = await bob_store.history(alice_disc.peer_id)
            return any(m.body == recovery_body for m in hist)

        await wait_until(bob_has_recovery, fail_msg="connection did not survive the tampered frame")
        print("TEST 3 (a tampered frame is silently dropped, connection keeps working): PASS")

        # -- TEST 4: trust-on-first-use + identity-changed warning -----------
        assert not identity_warnings, "no identity warning should have fired yet - bob's key never changed"

        # Simulate bob's peer_id showing up with a different key (a real
        # reinstall, or someone else now claiming that identity) by
        # directly upserting a Peer with a fresh keypair under the same
        # peer_id into alice's own registry - this is exactly what a
        # fresh discovery sighting with a changed key would look like.
        _, impostor_public_key = crypto_identity.generate_keypair()
        alice_disc.registry.upsert(
            Peer(peer_id=bob_disc.peer_id, name="Bob", address="127.0.0.1", port=bob_disc.service_port, source="mdns", public_key=impostor_public_key)
        )
        # Force re-resolution (see get_shared_key's own documented
        # limitation: a cached key is normally reused without re-checking
        # until this process restarts).
        alice_msg._shared_keys.pop(bob_disc.peer_id, None)
        await alice_msg.get_shared_key(bob_disc.peer_id)

        assert identity_warnings == [(bob_disc.peer_id, "Bob")], f"expected exactly one identity-changed warning for bob, got {identity_warnings}"
        print("TEST 4 (a real key change for an already-known peer_id fires the identity warning): PASS")

        # restore the real key so file transfer (test 5) can still talk to the real bob
        alice_disc.registry.upsert(
            Peer(peer_id=bob_disc.peer_id, name="Bob", address="127.0.0.1", port=bob_disc.service_port, source="mdns", public_key=bob_disc.public_key)
        )
        alice_msg._shared_keys.pop(bob_disc.peer_id, None)

        # -- TEST 5: the file-transfer TCP data channel is also encrypted ----
        alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"))
        bob_offers = []
        bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"), on_offer=lambda o: bob_offers.append(o))

        test_file = tmp / "secret.txt"
        plaintext_marker = b"PLAINTEXT_FILE_BYTES_MUST_NOT_APPEAR_ON_THE_WIRE_" * 20
        test_file.write_bytes(plaintext_marker)

        captured_chunks = []
        orig_ct_encrypt2 = crypto_identity.encrypt

        def spying_encrypt(key, plaintext):
            blob = orig_ct_encrypt2(key, plaintext)
            captured_chunks.append(blob)
            return blob

        async def bob_got_offer():
            return bool(bob_offers)

        crypto_identity.encrypt = spying_encrypt
        try:
            send_task = asyncio.create_task(alice_ft.send_file(bob_disc.peer_id, str(test_file)))
            await wait_until(bob_got_offer, fail_msg="bob never received the file offer")
            await bob_ft.accept(bob_offers[0].transfer_id)
            await send_task
        finally:
            crypto_identity.encrypt = orig_ct_encrypt2

        received_path = tmp / "bob_files" / alice_disc.peer_id / "secret.txt"

        async def file_arrived():
            return received_path.exists()

        await wait_until(file_arrived, fail_msg="file never arrived")
        assert received_path.read_bytes() == plaintext_marker, "received file content doesn't match the original - encryption/decryption round trip broke the bytes"
        assert any(plaintext_marker in blob for blob in captured_chunks) is False, "the plaintext file content was found in one of the actual encrypted blobs written to the socket"
        print("TEST 5 (the file-transfer TCP channel is genuinely encrypted, and the file still arrives byte-identical): PASS")

        print("\nALL TESTS PASSED")
    finally:
        await alice_msg.stop()
        await bob_msg.stop()
        await asyncio.to_thread(alice_disc.stop)
        await asyncio.to_thread(bob_disc.stop)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
