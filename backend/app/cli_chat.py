"""
Minimal CLI test for Phase 2 (messaging), built on top of Phase 1 discovery.

Run two of these (same machine or two devices on the same LAN):

    python -m app.cli_chat --name Alice --port 8001
    python -m app.cli_chat --name Bob   --port 8002

Commands typed at the prompt:
    peers                 - list currently visible peers
    <name> <message text> - send a message to that peer by name
    history <name>        - show local message history with that peer
    quit                  - stop

Incoming messages print as soon as they arrive, regardless of what you're
doing at the prompt.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time

from app.discovery import PeerDiscovery
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

    print(f"[{args.name}] peer_id={discovery.peer_id} db={db_path}")
    # discovery.start() calls zeroconf's synchronous API, which detects this
    # thread's running asyncio loop and tries to schedule its own internal
    # coroutines on it - but we'd be blocking that very loop to make this
    # call, so it deadlocks (zeroconf raises EventLoopBlocked). Running it in
    # a worker thread gives zeroconf no ambient loop to fight over, so it
    # falls back to its own dedicated background loop as designed.
    await asyncio.to_thread(discovery.start)
    await messaging.start()

    print("Commands: 'peers' | '<name> <message>' | 'history <name>' | 'quit'")

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
