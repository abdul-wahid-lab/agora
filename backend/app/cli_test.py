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

from app import crypto_identity
from app.discovery import PeerDiscovery


def main() -> None:
    parser = argparse.ArgumentParser(description="LAN peer discovery CLI test")
    parser.add_argument("--name", required=True, help="Device name to announce")
    parser.add_argument("--port", type=int, required=True, help="Port this device's service runs on")
    args = parser.parse_args()

    # A throwaway, session-only signing identity (not persisted via
    # storage.py, since this pure discovery diagnostic has no db) - just
    # enough for this process's own announcements to be signed, since
    # discovery.py now rejects unsigned announcements outright (see
    # crypto_identity.py's Phase 5b). Two of these run against each other
    # (the normal way to use this tool) verify each other's signatures
    # fine; there's no persistent pinning here, so a signing key "changing"
    # between runs is expected and not flagged - that's storage.py's job in
    # the real app, not this tool's.
    signing_private_key, signing_public_key = crypto_identity.generate_signing_keypair()
    discovery = PeerDiscovery(device_name=args.name, service_port=args.port, signing_private_key=signing_private_key, signing_public_key=signing_public_key)
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
