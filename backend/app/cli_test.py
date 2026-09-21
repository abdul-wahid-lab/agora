"""
Minimal CLI test for Phase 1 (discovery).

Run two of these (same machine or two devices on the same LAN) with
different names/ports and watch each one list the other within a few
seconds:

    python -m app.cli_test --name Alice --port 8001
    python -m app.cli_test --name Bob   --port 8002

Ctrl+C to stop. Each device announces on mDNS and UDP broadcast, and
prints its own peer_id plus the live peer list every 2 seconds.
"""

from __future__ import annotations

import argparse
import time

from app.discovery import PeerDiscovery


def main() -> None:
    parser = argparse.ArgumentParser(description="LAN peer discovery CLI test")
    parser.add_argument("--name", required=True, help="Device name to announce")
    parser.add_argument("--port", type=int, required=True, help="Port this device's service runs on")
    args = parser.parse_args()

    discovery = PeerDiscovery(device_name=args.name, service_port=args.port)
    print(f"[{args.name}] peer_id={discovery.peer_id} starting discovery on port {args.port} ...")
    discovery.start()

    try:
        while True:
            time.sleep(2)
            peers = discovery.registry.list()
            print(f"\n[{args.name}] visible peers ({len(peers)}):")
            if not peers:
                print("  (none yet)")
            for p in peers:
                age = time.time() - p.last_seen
                print(f"  - {p.name} @ {p.address}:{p.port} via {p.source} (peer_id={p.peer_id}, last_seen={age:.1f}s ago)")
    except KeyboardInterrupt:
        print(f"\n[{args.name}] stopping...")
    finally:
        discovery.stop()


if __name__ == "__main__":
    main()
