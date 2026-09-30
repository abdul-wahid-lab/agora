"""
Adversarial security tests for transport encryption - actively trying to
break it, not just confirming the happy path works. Five real attacks,
run against real localhost sockets:

  1. Reflection: capture a legitimate ciphertext one peer sent and replay
     it back at them, claiming to be from the other side.
  2. Replay: resend the exact same captured ciphertext to its real
     recipient multiple times.
  3. Discovery spoofing: forge a UDP broadcast claiming an existing
     peer_id with an attacker-controlled key - both an unsigned attempt
     and a self-signed one using a freshly-generated attacker keypair.
  4. Malformed-frame DoS: send garbage/empty/oversized binary frames at
     the messaging server and confirm it stays alive.
  5. File-transfer length-prefix DoS: a connected peer claims an absurd
     chunk length, then goes silent - confirm this doesn't hang forever.

Three of these (1, 3, and 5) found real, confirmed vulnerabilities during
development, which were then fixed:
  - Attack 1 found that a single shared key used for both directions let
    a captured ciphertext be reflected back at its own sender and decrypt
    successfully. Fixed with directional keys (crypto_identity.
    derive_directional_keys) - a send_key and a distinct recv_key per
    peer, so a blob only valid in one direction can never be mistaken for
    the other.
  - Attack 3 found that discovery.py's PeerRegistry accepted *any*
    mDNS/UDP announcement for *any* peer_id with zero verification, so a
    sustained forged-UDP-broadcast flood reliably won an established
    peer_id's registry entry - and with it, that peer_id's traffic
    (address, port, and the encryption key everything gets encrypted to).
    Fixed with signed discovery broadcasts: a separate Ed25519 signing
    keypair per device (crypto_identity.generate_signing_keypair,
    sign_announcement, verify_announcement), and storage.py's
    check_and_pin_signing_key enforcing trust-on-first-use *at the
    discovery layer itself*, before an announcement is ever allowed to
    reach the live registry - not lazily, later, only once messaging.py
    happens to talk to that peer_id. This test now confirms the exploit
    that used to succeed here no longer does, for both an unsigned forgery
    and a self-signed one using a freshly-generated attacker keypair.
    Still can't (and structurally never can) protect the very first time a
    peer_id is ever seen - that boundary is inherent to any
    trust-on-first-use scheme, the same as SSH's.
  - Attack 5 found that a connected peer could claim an absurd chunk
    length in the file-transfer TCP channel's length prefix and then go
    silent, leaving the receiver blocked in readexactly() forever with no
    way out. Fixed with a sane max-length check (MAX_ENCRYPTED_CHUNK_LEN)
    and a read timeout (CHUNK_READ_TIMEOUT_SECONDS) in filetransfer.py.

Not a CLI tool - run directly:
    python -m app._test_adversarial
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import struct
import tempfile
import time
import uuid
from pathlib import Path
from typing import Callable, Optional

from websockets.asyncio.client import connect as ws_connect

from app import crypto_identity as ci
from app.discovery import PeerDiscovery
from app.filetransfer import MAX_ENCRYPTED_CHUNK_LEN, FileTransferService
from app.messaging import MessagingService
from app.storage import MessageStore

LENGTH_PREFIX = struct.Struct(">I")


async def wait_mutual_discovery(a: PeerDiscovery, b: PeerDiscovery, timeout=10) -> None:
    for _ in range(timeout * 10):
        if any(p.peer_id == b.peer_id for p in a.registry.list()) and any(p.peer_id == a.peer_id for p in b.registry.list()):
            return
        await asyncio.sleep(0.1)
    raise TimeoutError("peers never discovered each other")


async def wait_until(predicate, timeout=10, interval=0.1, fail_msg="condition never became true"):
    for _ in range(int(timeout / interval)):
        if await predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError(fail_msg)


async def attack_1_reflection(tmp: Path) -> None:
    a_store, b_store = MessageStore(str(tmp / "r_a.db")), MessageStore(str(tmp / "r_b.db"))
    a_disc = PeerDiscovery(device_name="Alice", service_port=19601, peer_id="r-alice", public_key=a_store.get_or_create_device_keys()["public_key"], signing_private_key=a_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=a_store.get_or_create_device_keys()["signing_public_key"], on_verify_signing_key=a_store.check_and_pin_signing_key)
    b_disc = PeerDiscovery(device_name="Bob", service_port=19602, peer_id="r-bob", public_key=b_store.get_or_create_device_keys()["public_key"], signing_private_key=b_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=b_store.get_or_create_device_keys()["signing_public_key"], on_verify_signing_key=b_store.check_and_pin_signing_key)
    a_msg, b_msg = MessagingService(a_disc, a_store), MessagingService(b_disc, b_store)
    await asyncio.to_thread(a_disc.start)
    await asyncio.to_thread(b_disc.start)
    await a_msg.start()
    await b_msg.start()
    try:
        await wait_mutual_discovery(a_disc, b_disc)

        send_key = await a_msg.get_send_key("r-bob")
        recv_key = await a_msg.get_recv_key("r-bob")
        assert send_key != recv_key, "alice's send and recv keys for the same peer must differ"

        # Encrypt something AS ALICE (her send_key: alice->bob), then try
        # to decrypt it as if it were something arriving FROM bob (her
        # recv_key: bob->alice). Must fail.
        forged = ci.encrypt(send_key, json.dumps({"type": "chat", "msg_id": str(uuid.uuid4()), "body": "reflected", "ts": time.time()}).encode())
        try:
            ci.decrypt(recv_key, forged)
            raise AssertionError("VULNERABLE: alice's own outbound ciphertext decrypted as if it were inbound from bob")
        except ci.DecryptionError:
            pass

        # End-to-end: connect to alice's REAL server, claim to be bob, and
        # replay a real captured alice->bob ciphertext back at her.
        real_frame = ci.encrypt(send_key, json.dumps({"type": "chat", "msg_id": str(uuid.uuid4()), "body": "genuine alice-to-bob content, reflected", "ts": time.time()}).encode())
        conn = await ws_connect(f"ws://127.0.0.1:{a_disc.service_port}")
        try:
            await conn.send(json.dumps({"type": "hello", "peer_id": "r-bob", "device_name": "Bob"}))
            await asyncio.sleep(0.2)
            await conn.send(real_frame)
            await asyncio.sleep(1.0)
        finally:
            await conn.close()

        hist = await a_store.history("r-bob")
        assert not any(m.body == "genuine alice-to-bob content, reflected" for m in hist), "VULNERABLE: alice accepted her own message reflected back at her, as if bob sent it"
    finally:
        await a_msg.stop()
        await b_msg.stop()
        await asyncio.to_thread(a_disc.stop)
        await asyncio.to_thread(b_disc.stop)


async def attack_2_replay(tmp: Path) -> None:
    a_store, b_store = MessageStore(str(tmp / "rp_a.db")), MessageStore(str(tmp / "rp_b.db"))
    a_disc = PeerDiscovery(device_name="Alice", service_port=19611, peer_id="rp-alice", public_key=a_store.get_or_create_device_keys()["public_key"], signing_private_key=a_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=a_store.get_or_create_device_keys()["signing_public_key"], on_verify_signing_key=a_store.check_and_pin_signing_key)
    b_disc = PeerDiscovery(device_name="Bob", service_port=19612, peer_id="rp-bob", public_key=b_store.get_or_create_device_keys()["public_key"], signing_private_key=b_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=b_store.get_or_create_device_keys()["signing_public_key"], on_verify_signing_key=b_store.check_and_pin_signing_key)
    a_msg, b_msg = MessagingService(a_disc, a_store), MessagingService(b_disc, b_store)
    await asyncio.to_thread(a_disc.start)
    await asyncio.to_thread(b_disc.start)
    await a_msg.start()
    await b_msg.start()
    try:
        await wait_mutual_discovery(a_disc, b_disc)
        key = await a_msg.get_send_key("rp-bob")
        msg_id = str(uuid.uuid4())
        frame = ci.encrypt(key, json.dumps({"type": "chat", "msg_id": msg_id, "body": "replay me", "ts": time.time()}).encode())

        conn = await ws_connect(f"ws://127.0.0.1:{b_disc.service_port}")
        try:
            await conn.send(json.dumps({"type": "hello", "peer_id": "rp-alice", "device_name": "Alice"}))
            for _ in range(5):
                await conn.send(frame)
            await asyncio.sleep(1.0)
        finally:
            await conn.close()

        hist = await b_store.history("rp-alice")
        matching = [m for m in hist if m.msg_id == msg_id]
        assert len(matching) == 1, f"expected exactly one stored row for a replayed msg_id (idempotent storage), got {len(matching)}"
    finally:
        await a_msg.stop()
        await b_msg.stop()
        await asyncio.to_thread(a_disc.stop)
        await asyncio.to_thread(b_disc.stop)


async def attack_3_discovery_spoofing(tmp: Path) -> None:
    v_store = MessageStore(str(tmp / "ds_victim.db"))
    v_keys = v_store.get_or_create_device_keys()
    victim_disc = PeerDiscovery(
        device_name="Victim", service_port=19621, peer_id="ds-victim",
        public_key=v_keys["public_key"], signing_private_key=v_keys["signing_private_key"], signing_public_key=v_keys["signing_public_key"],
        on_verify_signing_key=v_store.check_and_pin_signing_key,
    )
    await asyncio.to_thread(victim_disc.start)
    await asyncio.sleep(0.3)

    observer_store = MessageStore(str(tmp / "ds_observer.db"))
    o_keys = observer_store.get_or_create_device_keys()
    observer_disc = PeerDiscovery(
        device_name="Observer", service_port=19622, peer_id="ds-observer",
        public_key=o_keys["public_key"], signing_private_key=o_keys["signing_private_key"], signing_public_key=o_keys["signing_public_key"],
        on_verify_signing_key=observer_store.check_and_pin_signing_key,
    )
    await asyncio.to_thread(observer_disc.start)

    def _forge(peer_id: str, public_key: str, extra: Optional[dict] = None) -> bytes:
        msg = {"peer_id": peer_id, "device_name": "Victim", "address": "127.0.0.1", "port": 1, "public_key": public_key}
        if extra:
            msg.update(extra)
        return json.dumps(msg).encode()

    def _flood(sock: socket.socket, payload: bytes, matches: Callable[[], bool], attempts: int = 40) -> bool:
        for _ in range(attempts):
            sock.sendto(payload, ("255.255.255.255", 42424))
            time.sleep(0.05)
            if matches():
                return True
        return False

    async def observer_sees_victim():
        return any(p.peer_id == "ds-victim" for p in observer_disc.registry.list())

    try:
        await wait_until(observer_sees_victim, fail_msg="observer never saw the real victim's genuine, signed announcement")
        real_key = next(p.public_key for p in observer_disc.registry.list() if p.peer_id == "ds-victim")

        # -- 3a: a completely unsigned forgery - no signing_public_key or
        # signature fields at all. Must never reach the registry.
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            unsigned_forgery = _forge("ds-victim", "UNSIGNED_ATTACKER_KEY==")
            won = await asyncio.to_thread(_flood, sock, unsigned_forgery, lambda: next((p.public_key for p in observer_disc.registry.list() if p.peer_id == "ds-victim"), None) == "UNSIGNED_ATTACKER_KEY==")
            assert not won, "VULNERABLE: a completely unsigned forged announcement was accepted into the registry"
        finally:
            sock.close()

        # -- 3b: the real, previously-confirmed exploit - a SELF-SIGNED
        # forgery. The attacker doesn't need the real victim's signing key;
        # they generate their own fresh Ed25519 keypair, sign their forged
        # announcement with it, and it's a perfectly valid signature - just
        # for an identity storage.py has never pinned as "ds-victim"
        # before. This is exactly the flood that won 100% of the time
        # before check_and_pin_signing_key existed.
        attacker_signing_priv, attacker_signing_pub = ci.generate_signing_keypair()
        attacker_enc_key = "ATTACKER_CONTROLLED_ENCRYPTION_KEY=="
        signature = ci.sign_announcement(attacker_signing_priv, "ds-victim", "127.0.0.1", 1, attacker_enc_key)
        self_signed_forgery = _forge("ds-victim", attacker_enc_key, {"signing_public_key": attacker_signing_pub, "signature": signature})
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            won = await asyncio.to_thread(_flood, sock, self_signed_forgery, lambda: next((p.public_key for p in observer_disc.registry.list() if p.peer_id == "ds-victim"), None) == attacker_enc_key)
            assert not won, (
                "VULNERABLE: a self-signed forged announcement (valid signature, but from a signing key "
                "never pinned to this peer_id before) was accepted - check_and_pin_signing_key isn't "
                "actually rejecting a conflicting identity"
            )
        finally:
            sock.close()

        # -- sanity: the real victim's genuine traffic is completely
        # unaffected by the (failed) attack - still resolvable, still the
        # real key, not stuck in some broken/rejected state.
        still_real = next((p.public_key for p in observer_disc.registry.list() if p.peer_id == "ds-victim"), None)
        assert still_real == real_key, "the real victim's entry should be completely unaffected by the failed forgery attempts"
    finally:
        await asyncio.to_thread(victim_disc.stop)
        await asyncio.to_thread(observer_disc.stop)


async def attack_4_malformed_frames(tmp: Path) -> None:
    b_store = MessageStore(str(tmp / "mf_b.db"))
    b_disc = PeerDiscovery(device_name="Bob", service_port=19631, peer_id="mf-bob", public_key=b_store.get_or_create_device_keys()["public_key"], signing_private_key=b_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=b_store.get_or_create_device_keys()["signing_public_key"], on_verify_signing_key=b_store.check_and_pin_signing_key)
    b_msg = MessagingService(b_disc, b_store)
    await asyncio.to_thread(b_disc.start)
    await b_msg.start()
    try:
        payloads = [b"", os.urandom(1), os.urandom(11), os.urandom(12), os.urandom(65536), os.urandom(12) + b"X" * 16]
        for i, payload in enumerate(payloads):
            conn = await ws_connect(f"ws://127.0.0.1:{b_disc.service_port}")
            await conn.send(json.dumps({"type": "hello", "peer_id": f"attacker-{i}", "device_name": "x"}))
            await asyncio.sleep(0.05)
            await conn.send(payload)
            await asyncio.sleep(0.1)
            await conn.close()

        # server must still be alive and accepting real connections
        conn = await ws_connect(f"ws://127.0.0.1:{b_disc.service_port}")
        await conn.send(json.dumps({"type": "hello", "peer_id": "final-check", "device_name": "x"}))
        await asyncio.sleep(0.2)
        await conn.close()
    finally:
        await b_msg.stop()
        await asyncio.to_thread(b_disc.stop)


async def attack_5_filetransfer_dos(tmp: Path) -> None:
    b_store = MessageStore(str(tmp / "ft_b.db"))
    b_disc = PeerDiscovery(device_name="Bob", service_port=19641, peer_id="ft-bob", public_key=b_store.get_or_create_device_keys()["public_key"], signing_private_key=b_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=b_store.get_or_create_device_keys()["signing_public_key"], on_verify_signing_key=b_store.check_and_pin_signing_key)
    b_msg = MessagingService(b_disc, b_store)
    await asyncio.to_thread(b_disc.start)
    await b_msg.start()
    b_ft = FileTransferService(b_disc, b_msg, b_store, downloads_dir=str(tmp / "ft_files"))
    try:
        transfer_id = "adversarial-dos-1"
        await b_store.save_file(transfer_id=transfer_id, peer_id="attacker", direction="received", filename="x.txt", size=999999, sha256="0" * 64, is_executable=False, status="awaiting_accept")
        record = await b_store.get_file(transfer_id)
        part_path = b_ft.incoming_dir / f"{transfer_id}.part"

        holder = {}

        async def on_client(reader, writer):
            holder["task"] = asyncio.current_task()
            await b_ft._receive(reader, writer, transfer_id, record, part_path, 0, b"0" * 32)

        server = await asyncio.start_server(on_client, "127.0.0.1", 0)
        try:
            port = server.sockets[0].getsockname()[1]
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(LENGTH_PREFIX.pack(0xFFFFFFF0))  # claims a ~4GB chunk
            writer.write(b"A" * 500)  # then goes silent
            await writer.drain()

            start = time.monotonic()
            task = None
            for _ in range(30):
                await asyncio.sleep(0.2)
                task = holder.get("task")
                if task and task.done():
                    break
            elapsed = time.monotonic() - start

            assert task is not None and task.done(), f"VULNERABLE: still blocked reading an oversized chunk claim after {elapsed:.1f}s (no timeout, no length sanity check)"
            assert task.exception() is None, f"the fix itself raised: {task.exception()!r}"
            rec = await b_store.get_file(transfer_id)
            assert rec.status == "failed", f"expected the transfer to be marked failed, got {rec.status!r}"
            assert not part_path.exists(), "the partial file should have been cleaned up, not left on disk"
            writer.close()
        finally:
            server.close()
    finally:
        await b_msg.stop()
        await asyncio.to_thread(b_disc.stop)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_adversarial_test_"))
    print(f"scratch dir: {tmp}")
    try:
        await attack_1_reflection(tmp)
        print("ATTACK 1 (reflection - a captured ciphertext replayed back at its own sender): BLOCKED (fixed via directional keys)")

        await attack_2_replay(tmp)
        print("ATTACK 2 (replay - the same captured ciphertext resent to its real recipient 5x): HARMLESS (idempotent by msg_id)")

        await attack_3_discovery_spoofing(tmp)
        print("ATTACK 3 (discovery spoofing - unsigned and self-signed forged UDP broadcasts): BLOCKED (fixed via signed discovery broadcasts + check_and_pin_signing_key)")

        await attack_4_malformed_frames(tmp)
        print("ATTACK 4 (malformed/empty/oversized garbage frames): SURVIVED (server stayed alive and responsive)")

        await attack_5_filetransfer_dos(tmp)
        print("ATTACK 5 (file-transfer oversized length-prefix + silence): BLOCKED (fixed with a max-length check + read timeout)")

        print("\nALL ADVERSARIAL TESTS PASSED")
    finally:
        import shutil

        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
