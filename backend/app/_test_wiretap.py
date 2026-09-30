"""
A genuine network-level wiretap test for transport encryption - stronger
proof than capturing a function's return value from inside the process.

How: bob's real WebSocket server binds to an internal port that nothing
outside this test ever learns about. The address/port bob actually
*advertises* via discovery is a small, separate raw TCP relay that just
forwards bytes to that internal port in both directions, keeping a copy
of every byte as it passes. Alice genuinely dials the relay believing
it's bob - this is exactly the vantage point a real network sniffer
sitting on the wire between them would have. The relay never touches any
key material; it only ever sees what a passive observer on the wire
would see.

Two wire-level subtleties this test has to account for, neither of which
has anything to do with this app's own encryption:
  - WebSocket's own framing mandatorily masks every client-to-server
    frame's payload with a per-frame XOR key transmitted alongside it
    (RFC 6455 - a cache-poisoning defense, not encryption). This test
    reassembles the real TCP byte stream per direction and parses actual
    WebSocket frames back out - unmasking client->server payloads -
    before searching for plaintext, the same way a real protocol-aware
    sniffer (Wireshark et al.) would.
  - The `websockets` library negotiates permessage-deflate compression by
    default (RFC 7692), so even an unmasked plaintext frame's payload is
    raw-deflate-compressed bytes, not literal text. Reassembling that
    correctly (context takeover across messages, continuation frames)
    would need a much larger parser for no real benefit here, since
    compression is public and standard, not a confidentiality boundary,
    and it compresses this app's already-encrypted (high-entropy,
    incompressible) frames just as much as it would a plaintext one - it
    doesn't change what this test is actually trying to prove. So this
    test disables compression on its own connections only (production
    code is untouched) to isolate the one wire-level transform that
    actually matters here: masking.

Two markers are checked per exchange - what makes this rigorous rather
than trivially passing because nothing was really captured:
  - a POSITIVE control: "hello"'s peer_id is expected to be found in the
    unmasked frame payloads (it's deliberately sent unencrypted - see
    messaging.py's module docstring). If this isn't found, the capture/
    unmasking setup itself is broken and every other assertion here would
    be meaningless.
  - the actual secret under test (a chat body, an SDP marker, a filename)
    must NOT be found anywhere in those same unmasked payloads.

Not a CLI tool - run directly:
    python -m app._test_wiretap
"""

from __future__ import annotations

import asyncio
import functools
import shutil
import tempfile
from pathlib import Path

from app import messaging as messaging_module
from app.calling import CallService
from app.discovery import PeerDiscovery
from app.filetransfer import FileTransferService, IncomingFileOffer
from app.messaging import MessagingService
from app.storage import MessageStore

RELAY_PORT = 9101   # what bob advertises via discovery - alice dials this
BOB_REAL_PORT = 9102  # bob's messaging server actually binds here, never advertised


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


def extract_ws_frame_payloads(stream: bytes) -> bytes:
    """Parses real RFC 6455 WebSocket frames out of a raw byte stream
    (already past the HTTP upgrade handshake) and returns the
    concatenation of their unmasked payloads. Minimal on purpose: no
    fragmentation reassembly beyond concatenation, no extension support -
    enough to recover genuine application-level bytes for a plaintext
    search, not a general-purpose WS parser."""
    out = bytearray()
    i, n = 0, len(stream)
    while i + 2 <= n:
        b1 = stream[i + 1]
        masked = bool(b1 & 0x80)
        length = b1 & 0x7F
        i += 2
        if length == 126:
            if i + 2 > n:
                break
            length = int.from_bytes(stream[i : i + 2], "big")
            i += 2
        elif length == 127:
            if i + 8 > n:
                break
            length = int.from_bytes(stream[i : i + 8], "big")
            i += 8
        mask_key = None
        if masked:
            if i + 4 > n:
                break
            mask_key = stream[i : i + 4]
            i += 4
        if i + length > n:
            break  # a frame split across TCP reads in a way we didn't reassemble - stop rather than misparse
        payload = stream[i : i + length]
        i += length
        if masked and mask_key:
            payload = bytes(payload[j] ^ mask_key[j % 4] for j in range(len(payload)))
        out.extend(payload)
    return bytes(out)


def real_payloads(capture: list, label: str) -> bytes:
    """Reassembles one direction's full TCP byte stream, strips the HTTP
    upgrade handshake (ends at the first blank line), and returns the
    concatenation of every real WebSocket frame payload after that -
    what a protocol-aware wiretap would actually be able to read."""
    full = b"".join(data for lbl, data in capture if lbl == label)
    handshake_end = full.find(b"\r\n\r\n")
    if handshake_end == -1:
        return b""
    return extract_ws_frame_payloads(full[handshake_end + 4 :])


async def start_relay(listen_port: int, target_port: int, capture: list) -> asyncio.AbstractServer:
    """A dumb, transparent TCP forwarder with zero knowledge of WebSocket
    framing, JSON, or crypto - it just copies bytes both ways and logs
    them, the same thing any real passive wiretap on this wire would see."""

    async def pump(src: asyncio.StreamReader, dst: asyncio.StreamWriter, label: str) -> None:
        try:
            while True:
                data = await src.read(65536)
                if not data:
                    break
                capture.append((label, data))
                dst.write(data)
                await dst.drain()
        except (ConnectionResetError, BrokenPipeError):
            pass
        finally:
            dst.close()

    async def handle(client_reader, client_writer):
        try:
            target_reader, target_writer = await asyncio.open_connection("127.0.0.1", target_port)
        except OSError:
            client_writer.close()
            return
        await asyncio.gather(
            pump(client_reader, target_writer, "alice->bob"),
            pump(target_reader, client_writer, "bob->alice"),
        )

    # 0.0.0.0, matching how the real messaging server itself binds - alice
    # resolves bob's address via discovery's real LAN IP (_get_local_ip()),
    # not loopback, so a relay bound only to 127.0.0.1 would be unreachable.
    return await asyncio.start_server(handle, "0.0.0.0", listen_port)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_wiretap_test_"))
    print(f"scratch dir: {tmp}")

    alice_store = MessageStore(str(tmp / "alice.db"))
    bob_store = MessageStore(str(tmp / "bob.db"))

    # Bob advertises RELAY_PORT via discovery - alice will dial that,
    # believing it's bob's real address. Bob's actual MessagingService
    # binds BOB_REAL_PORT, which nothing outside this test ever learns.
    bob_disc = PeerDiscovery(device_name="Bob", service_port=RELAY_PORT, peer_id="bob-wiretap", public_key=bob_store.get_or_create_device_keys()["public_key"], signing_private_key=bob_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=bob_store.get_or_create_device_keys()["signing_public_key"])
    alice_disc = PeerDiscovery(device_name="Alice", service_port=9201, peer_id="alice-wiretap", public_key=alice_store.get_or_create_device_keys()["public_key"], signing_private_key=alice_store.get_or_create_device_keys()["signing_private_key"], signing_public_key=alice_store.get_or_create_device_keys()["signing_public_key"])

    bob_msg = MessagingService(bob_disc, bob_store)
    bob_msg.port = BOB_REAL_PORT  # decouple bind port from advertised port
    alice_msg = MessagingService(alice_disc, alice_store)

    capture: list[tuple[str, bytes]] = []
    relay = await start_relay(RELAY_PORT, BOB_REAL_PORT, capture)

    # Disable permessage-deflate on this test's own connections only (see
    # module docstring) - production code is never touched, this purely
    # isolates masking as the one wire-level transform worth parsing here.
    orig_ws_connect = messaging_module.ws_connect
    orig_ws_serve = messaging_module.ws_serve
    messaging_module.ws_connect = functools.partial(orig_ws_connect, compression=None)
    messaging_module.ws_serve = functools.partial(orig_ws_serve, compression=None)

    alice_ft = FileTransferService(alice_disc, alice_msg, alice_store, downloads_dir=str(tmp / "alice_files"))
    bob_offers = []
    bob_ft = FileTransferService(bob_disc, bob_msg, bob_store, downloads_dir=str(tmp / "bob_files"), on_offer=lambda o: bob_offers.append(o))

    bob_call = CallService(bob_disc, bob_msg, bob_store)
    alice_call = CallService(alice_disc, alice_msg, alice_store)

    try:
        await asyncio.to_thread(alice_disc.start)
        await asyncio.to_thread(bob_disc.start)
        await alice_msg.start()
        await bob_msg.start()  # binds BOB_REAL_PORT, not the advertised RELAY_PORT
        await wait_mutual_discovery(alice_disc, bob_disc)
        print("mutual discovery OK (alice believes bob is reachable at the relay's address)")

        # -- control: prove the wiretap genuinely recovers real content ------
        secret_body = "the real, actual, literal chat message body"
        await alice_msg.send(bob_disc.peer_id, secret_body)

        async def bob_has_it():
            hist = await bob_store.history(alice_disc.peer_id)
            return any(m.body == secret_body for m in hist)

        await wait_until(bob_has_it, fail_msg="bob never received the message through the relay")
        alice_to_bob = real_payloads(capture, "alice->bob")
        assert b"alice-wiretap" in alice_to_bob, "positive control failed: alice's own peer_id (sent plaintext in hello) was not recovered from the wire - the wiretap/unmasking setup itself is broken"
        print("CONTROL (the wiretap genuinely recovers real WS frame content - alice's plaintext hello peer_id was found): PASS")

        # -- TEST 1: chat body is never visible on the real wire -------------
        bob_to_alice = real_payloads(capture, "bob->alice")
        assert secret_body.encode() not in alice_to_bob, "the real chat message body was found in bytes recovered from the wire (alice->bob)"
        assert secret_body.encode() not in bob_to_alice, "the real chat message body was found in bytes recovered from the wire (bob->alice)"
        print("TEST 1 (a real chat message body never appears anywhere on the actual network wire): PASS")

        # -- TEST 2: call signaling (SDP) is never visible on the wire -------
        sdp_marker = "v=0\r\no=- UNIQUE_SDP_MARKER_86420 IN IP4 192.168.1.50\r\n"
        call_id = await alice_call.start_call(bob_disc.peer_id, {"type": "offer", "sdp": sdp_marker}, media="video")

        async def bob_got_call():
            return bool(bob_call._calls)

        await wait_until(bob_got_call, fail_msg="bob never received the call offer")
        alice_to_bob = real_payloads(capture, "alice->bob")
        assert b"UNIQUE_SDP_MARKER_86420" not in alice_to_bob, "real SDP call-signaling content was found in bytes recovered from the wire"
        print("TEST 2 (real SDP call-signaling content never appears on the wire): PASS")
        await alice_call.end_call(call_id)

        # -- TEST 3: file offer metadata (filename) never visible on wire ----
        test_file = tmp / "UNIQUE_FILENAME_MARKER_13579.txt"
        test_file.write_bytes(b"file content for the wiretap test")
        send_task = asyncio.create_task(alice_ft.send_file(bob_disc.peer_id, str(test_file)))

        async def bob_got_offer():
            return bool(bob_offers)

        await wait_until(bob_got_offer, fail_msg="bob never received the file offer")
        alice_to_bob = real_payloads(capture, "alice->bob")
        assert b"UNIQUE_FILENAME_MARKER_13579" not in alice_to_bob, "a file offer's real filename was found in bytes recovered from the wire"
        print("TEST 3 (a file offer's real filename never appears on the wire): PASS")
        await bob_ft.decline(bob_offers[0].transfer_id)
        try:
            await asyncio.wait_for(send_task, timeout=5)
        except Exception:
            pass

        print("\nALL TESTS PASSED")
        print(f"(for reference: {len(capture)} raw TCP chunks observed across both directions on the real wire)")
    finally:
        async def safe(coro, label):
            try:
                await asyncio.wait_for(coro, timeout=5)
            except Exception as e:
                print(f"cleanup warning ({label}): {e!r}")

        messaging_module.ws_connect = orig_ws_connect
        messaging_module.ws_serve = orig_ws_serve
        # Stop alice/bob's own connections *before* the relay - an
        # asyncio.Server's wait_closed() waits for existing connections to
        # finish, not just the listening socket, so closing the relay
        # first (while alice's connection through it is still open) would
        # itself hang until something else closes that connection anyway.
        await safe(alice_msg.stop(), "alice_msg.stop")
        await safe(bob_msg.stop(), "bob_msg.stop")
        relay.close()
        await safe(relay.wait_closed(), "relay.wait_closed")
        await safe(asyncio.to_thread(alice_disc.stop), "alice_disc.stop")
        await safe(asyncio.to_thread(bob_disc.stop), "bob_disc.stop")
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
