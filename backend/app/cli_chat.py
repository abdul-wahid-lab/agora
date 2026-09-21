"""
Minimal CLI test for Phase 2 (messaging), built on top of Phase 1 discovery.

Run two of these (same machine or two devices on the same LAN):

    python -m app.cli_chat --name Alice --port 8001
    python -m app.cli_chat --name Bob   --port 8002

Commands typed at the prompt:
    peers                    - list currently visible peers
    <name> <message text>    - send a message to that peer by name
    history <name>           - show local message history with that peer
    send <name> <file path>  - offer to send a file to that peer
    files <name>             - show file-transfer history with that peer
    accept <transfer_id>     - accept a pending incoming file offer (prefix ok)
    decline <transfer_id>    - decline a pending incoming file offer (prefix ok)
    resend <transfer_id>     - retry a transfer that stalled mid-stream (prefix ok)
    quit                     - stop

Incoming messages and file offers print as soon as they arrive, regardless
of what you're doing at the prompt.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time

from app.discovery import PeerDiscovery
from app.filetransfer import FileTransferService, IncomingFileOffer
from app.messaging import IncomingMessage, MessagingService
from app.storage import MessageStore


async def main() -> None:
    parser = argparse.ArgumentParser(description="LAN chat CLI test")
    parser.add_argument("--name", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--db", default=None, help="SQLite file path (default: <name>.db)")
    parser.add_argument("--peer-id", default=None, help="Fixed peer_id (default: random per run) - use to simulate the same device restarting")
    args = parser.parse_args()

    db_path = args.db or f"{args.name.lower()}.db"
    store = MessageStore(db_path)
    discovery = PeerDiscovery(device_name=args.name, service_port=args.port, peer_id=args.peer_id)

    def on_message(msg: IncomingMessage) -> None:
        peer = next((p for p in discovery.registry.list() if p.peer_id == msg.peer_id), None)
        who = peer.name if peer else msg.peer_id[:8]
        print(f"\n[{who}] {msg.body}\n> ", end="", flush=True)

    messaging = MessagingService(discovery, store, on_message=on_message)

    pending_offers: dict[str, IncomingFileOffer] = {}

    def on_offer(offer: IncomingFileOffer) -> None:
        pending_offers[offer.transfer_id] = offer
        peer = next((p for p in discovery.registry.list() if p.peer_id == offer.peer_id), None)
        who = peer.name if peer else offer.peer_id[:8]
        size_mb = offer.size / (1024 * 1024)
        warn = ""
        if offer.is_executable:
            warn = "\n  !! THIS IS AN INSTALLABLE/EXECUTABLE FILE - only accept if you trust the sender !!"
        short = offer.transfer_id[:8]
        print(
            f"\n[{who}] wants to send a file: {offer.filename} ({size_mb:.2f} MB){warn}\n"
            f"  -> 'accept {short}' or 'decline {short}'\n> ",
            end="",
            flush=True,
        )

    def on_received(transfer_id: str, status: str, saved_path) -> None:
        if status == "completed":
            print(f"\n[file] received and saved: {saved_path}\n> ", end="", flush=True)
        else:
            print(f"\n[file] transfer {transfer_id[:8]} failed verification (hash mismatch) - discarded\n> ", end="", flush=True)

    downloads_dir = args.db.rsplit(".", 1)[0] if args.db else args.name.lower()
    file_transfer = FileTransferService(
        discovery, messaging, store, downloads_dir=f"{downloads_dir}_files", on_offer=on_offer, on_received=on_received
    )

    print(f"[{args.name}] peer_id={discovery.peer_id} db={db_path}")
    # discovery.start() calls zeroconf's synchronous API, which detects this
    # thread's running asyncio loop and tries to schedule its own internal
    # coroutines on it - but we'd be blocking that very loop to make this
    # call, so it deadlocks (zeroconf raises EventLoopBlocked). Running it in
    # a worker thread gives zeroconf no ambient loop to fight over, so it
    # falls back to its own dedicated background loop as designed.
    await asyncio.to_thread(discovery.start)
    await messaging.start()

    print("Commands: 'peers' | '<name> <message>' | 'history <name>' | 'send <name> <path>' | 'files <name>' | 'accept/decline/resend <id>' | 'quit'")

    loop = asyncio.get_event_loop()
    try:
        while True:
            line = await loop.run_in_executor(None, input, "> ")
            line = line.strip()
            if not line:
                continue
            if line == "quit":
                break
            if line == "peers":
                peers = discovery.registry.list()
                if not peers:
                    print("  (no peers visible)")
                for p in peers:
                    print(f"  - {p.name} @ {p.address}:{p.port} via {p.source}")
                continue
            if line.startswith("history "):
                name = line.split(" ", 1)[1].strip()
                peer = next((p for p in discovery.registry.list() if p.name.lower() == name.lower()), None)
                if not peer:
                    print(f"  no visible peer named {name!r}")
                    continue
                for m in await store.history(peer.peer_id):
                    ts = time.strftime("%H:%M:%S", time.localtime(m.ts))
                    arrow = "->" if m.direction == "sent" else "<-"
                    print(f"  [{ts}] {arrow} {m.body}  ({m.status})")
                continue
            if line.startswith("files "):
                name = line.split(" ", 1)[1].strip()
                peer = next((p for p in discovery.registry.list() if p.name.lower() == name.lower()), None)
                if not peer:
                    print(f"  no visible peer named {name!r}")
                    continue
                records = await store.list_files(peer.peer_id)
                if not records:
                    print("  (no file transfers with this peer)")
                for r in records:
                    ts = time.strftime("%H:%M:%S", time.localtime(r.ts))
                    arrow = "->" if r.direction == "sent" else "<-"
                    exe = " [EXECUTABLE]" if r.is_executable else ""
                    print(f"  [{ts}] {arrow} {r.filename} ({r.size} bytes){exe}  ({r.status}) id={r.transfer_id[:8]}")
                continue
            if line.startswith("send "):
                rest = line.split(" ", 1)[1]
                send_parts = rest.split(" ", 1)
                if len(send_parts) < 2:
                    print("  usage: send <peer name> <file path>")
                    continue
                pname, fpath = send_parts
                peer = next((p for p in discovery.registry.list() if p.name.lower() == pname.lower()), None)
                if not peer:
                    print(f"  no visible peer named {pname!r} - try 'peers'")
                    continue

                async def _do_send(peer_id=peer.peer_id, peer_name=peer.name, fpath=fpath):
                    try:
                        transfer_id = await file_transfer.send_file(peer_id, fpath)
                        record = await store.get_file(transfer_id)
                        print(f"\n[file->{peer_name}] {record.filename}: {record.status}\n> ", end="", flush=True)
                    except Exception as e:
                        print(f"\n[file->{peer_name}] send failed: {e}\n> ", end="", flush=True)

                asyncio.create_task(_do_send())
                print(f"  (offering {fpath} to {peer.name}...)")
                continue
            if line.startswith("accept ") or line.startswith("decline ") or line.startswith("resend "):
                cmd, prefix = line.split(" ", 1)
                prefix = prefix.strip()
                if cmd in ("accept", "decline"):
                    match = next((tid for tid in pending_offers if tid.startswith(prefix)), None)
                    if not match:
                        print(f"  no pending offer matching {prefix!r} - check 'files <name>'")
                        continue
                    pending_offers.pop(match, None)
                    if cmd == "accept":
                        asyncio.create_task(file_transfer.accept(match))
                        print(f"  (accepting {match[:8]}...)")
                    else:
                        await file_transfer.decline(match)
                        print(f"  declined {match[:8]}")
                else:  # resend
                    all_ids = {r.transfer_id for p in discovery.registry.list() for r in await store.list_files(p.peer_id)}
                    match = next((tid for tid in all_ids if tid.startswith(prefix)), None)
                    if not match:
                        print(f"  no known transfer matching {prefix!r}")
                        continue

                    async def _do_resend(tid=match):
                        try:
                            await file_transfer.resend(tid)
                            print(f"\n[file] resend {tid[:8]} finished\n> ", end="", flush=True)
                        except Exception as e:
                            print(f"\n[file] resend {tid[:8]} failed: {e}\n> ", end="", flush=True)

                    asyncio.create_task(_do_resend())
                    print(f"  (resending {match[:8]}...)")
                continue

            parts = line.split(" ", 1)
            if len(parts) < 2:
                print("  usage: <peer name> <message text>")
                continue
            name, body = parts
            peer = next((p for p in discovery.registry.list() if p.name.lower() == name.lower()), None)
            if not peer:
                print(f"  no visible peer named {name!r} - try 'peers'")
                continue
            msg_id = await messaging.send(peer.peer_id, body)
            print(f"  (queued {msg_id[:8]})")
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        print(f"\n[{args.name}] stopping...")
        await messaging.stop()
        discovery.stop()


if __name__ == "__main__":
    asyncio.run(main())
