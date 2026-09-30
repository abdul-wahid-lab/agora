"""
Stress and concurrency tests - not "does the happy path work" (the other
_test_*.py suites already cover that), but "what happens under real
concurrent load, real scale, and a real adversary specifically targeting
the newest code." Found and fixed two real bugs during development:

  1. A TOCTOU race in storage.check_and_pin_signing_key: two real OS
     threads (mirroring discovery.py's mDNS thread and UDP listener
     thread) racing to pin a brand-new peer_id's signing key could both
     read "nothing pinned yet" before either one's write committed, so
     *both* returned True - undermining the exact guarantee that method
     exists to provide (a precisely-timed forged announcement could win
     equal footing with the real one on a first sighting). Fixed by
     wrapping the check-then-write in a single atomic transaction
     (BEGIN IMMEDIATE + busy_timeout), so a second thread's own
     transaction blocks until the first one fully commits.

  2. Unbounded known_peers growth: trust-on-first-use permanently
     remembers every never-before-seen peer_id, and a real flood test
     showed an attacker can trigger a first-sighting insert with nothing
     more than one cheap, self-signed UDP broadcast per fake identity -
     no connection handshake needed. Fixed with MAX_KNOWN_PEERS and
     oldest-last_seen-evicted-first eviction in storage.py, applied to
     every first-sighting insert path (signing-key pinning, encryption-key
     trust-on-first-use, and the contacts-import/known-peer path).

Also includes broader stress checks that didn't find a bug, kept as
regression coverage: high-volume message throughput with no loss/
duplication/corruption, and a multi-peer mesh converging and delivering
correctly.

Not a CLI tool - run directly:
    python -m app._test_stress
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
from pathlib import Path

from app import crypto_identity as ci
from app.discovery import PeerDiscovery
from app.messaging import MessagingService
from app.storage import MessageStore
import app.storage as storage_module


async def wait_mutual_discovery(a: PeerDiscovery, b: PeerDiscovery, timeout=10) -> None:
    for _ in range(timeout * 10):
        if any(p.peer_id == b.peer_id for p in a.registry.list()) and any(p.peer_id == a.peer_id for p in b.registry.list()):
            return
        await asyncio.sleep(0.1)
    raise TimeoutError("peers never discovered each other")


def test_1_signing_key_pin_race(tmp: Path) -> None:
    path = str(tmp / "race.db")
    store = MessageStore(path)

    # Run several trials - a race this narrow doesn't always land on a
    # single attempt, even unfixed; the original bug reproduced reliably
    # within a handful of tries using a real threading.Barrier to force
    # maximum overlap.
    for trial in range(10):
        trial_path = str(tmp / f"race_{trial}.db")
        trial_store = MessageStore(trial_path)
        results = []
        barrier = threading.Barrier(2)

        def worker(key):
            barrier.wait()
            r = trial_store.check_and_pin_signing_key("race-peer", key)
            results.append((key, r))

        t1 = threading.Thread(target=worker, args=("KEY_A",))
        t2 = threading.Thread(target=worker, args=("KEY_B",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        accepted = [k for k, r in results if r]
        assert len(accepted) == 1, f"trial {trial}: TOCTOU race reproduced - both keys accepted: {results}"

    print("TEST 1 (concurrent signing-key pin race, 10 trials): PASS (exactly one key won every time)")


def test_2_known_peers_cap(tmp: Path) -> None:
    original_cap = storage_module.MAX_KNOWN_PEERS
    storage_module.MAX_KNOWN_PEERS = 50
    try:
        path = str(tmp / "cap.db")
        store = MessageStore(path)

        n = 200
        for i in range(n):
            _, pub = ci.generate_signing_keypair()
            store.check_and_pin_signing_key(f"peer-{i}", pub)

        import sqlite3

        conn = sqlite3.connect(path)
        count = conn.execute("SELECT COUNT(*) FROM known_peers").fetchone()[0]
        has_oldest = conn.execute("SELECT 1 FROM known_peers WHERE peer_id = ?", ("peer-0",)).fetchone()
        has_newest = conn.execute("SELECT 1 FROM known_peers WHERE peer_id = ?", (f"peer-{n - 1}",)).fetchone()
        conn.close()

        assert count <= 50, f"known_peers grew past the cap: {count} rows for a cap of 50"
        assert has_oldest is None, "the oldest entry should have been evicted to make room"
        assert has_newest is not None, "the most recent entry should never be evicted for room to itself"
        print(f"TEST 2 (known_peers cap enforced under a {n}-identity flood): PASS (bounded at {count} rows, oldest evicted, newest kept)")
    finally:
        storage_module.MAX_KNOWN_PEERS = original_cap


async def test_3_message_throughput(tmp: Path) -> None:
    a_store = MessageStore(str(tmp / "tp_a.db"))
    b_store = MessageStore(str(tmp / "tp_b.db"))
    a_keys, b_keys = a_store.get_or_create_device_keys(), b_store.get_or_create_device_keys()
    a_disc = PeerDiscovery(
        device_name="Alice", service_port=22001, peer_id="alice-tp",
        public_key=a_keys["public_key"], signing_private_key=a_keys["signing_private_key"], signing_public_key=a_keys["signing_public_key"],
        on_verify_signing_key=a_store.check_and_pin_signing_key,
    )
    b_disc = PeerDiscovery(
        device_name="Bob", service_port=22002, peer_id="bob-tp",
        public_key=b_keys["public_key"], signing_private_key=b_keys["signing_private_key"], signing_public_key=b_keys["signing_public_key"],
        on_verify_signing_key=b_store.check_and_pin_signing_key,
    )
    a_msg, b_msg = MessagingService(a_disc, a_store), MessagingService(b_disc, b_store)
    await asyncio.to_thread(a_disc.start)
    await asyncio.to_thread(b_disc.start)
    await a_msg.start()
    await b_msg.start()
    try:
        await wait_mutual_discovery(a_disc, b_disc)

        n = 100  # smaller than the original 500-message exploratory run, to keep this a fast regression check
        for i in range(n):
            await a_msg.send("bob-tp", f"throughput message {i}")

        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            hist = await b_store.history("alice-tp", limit=n + 10)
            if len(hist) >= n:
                break
            await asyncio.sleep(0.2)

        hist = await b_store.history("alice-tp", limit=n + 10)
        bodies = {m.body for m in hist}
        expected = {f"throughput message {i}" for i in range(n)}
        assert bodies == expected, f"message loss or corruption under load: missing={expected - bodies}, unexpected={bodies - expected}"
        assert len(hist) == len(bodies), f"duplicate rows under load: {len(hist)} rows for {len(bodies)} distinct bodies"
        print(f"TEST 3 ({n}-message throughput, no loss/duplication/corruption): PASS")
    finally:
        await a_msg.stop()
        await b_msg.stop()
        await asyncio.to_thread(a_disc.stop)
        await asyncio.to_thread(b_disc.stop)


async def test_4_multi_peer_mesh(tmp: Path) -> None:
    n = 5  # smaller than the original 10-peer exploratory run, to keep this a fast regression check
    discs, msgs, stores = [], [], []
    for i in range(n):
        store = MessageStore(str(tmp / f"mesh{i}.db"))
        keys = store.get_or_create_device_keys()
        disc = PeerDiscovery(
            device_name=f"Peer{i}", service_port=22101 + i, peer_id=f"mesh-peer-{i}",
            public_key=keys["public_key"], signing_private_key=keys["signing_private_key"], signing_public_key=keys["signing_public_key"],
            on_verify_signing_key=store.check_and_pin_signing_key,
        )
        msgs.append(MessagingService(disc, store))
        discs.append(disc)
        stores.append(store)

    try:
        for d in discs:
            await asyncio.to_thread(d.start)
        for m in msgs:
            await m.start()

        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if all(len(d.registry.list()) == n - 1 for d in discs):
                break
            await asyncio.sleep(0.2)
        counts = [len(d.registry.list()) for d in discs]
        assert all(c == n - 1 for c in counts), f"mesh discovery incomplete: {counts} (expected all {n - 1})"

        tasks = [msgs[i].send(f"mesh-peer-{j}", f"hello {i}->{j}") for i in range(n) for j in range(n) if i != j]
        await asyncio.gather(*tasks)

        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            done = True
            for i, s in enumerate(stores):
                for j in range(n):
                    if i == j:
                        continue
                    hist = await s.history(f"mesh-peer-{j}", limit=50)
                    if not any(m.body == f"hello {j}->{i}" for m in hist):
                        done = False
            if done:
                break
            await asyncio.sleep(0.3)

        for i, s in enumerate(stores):
            for j in range(n):
                if i == j:
                    continue
                hist = await s.history(f"mesh-peer-{j}", limit=50)
                assert any(m.body == f"hello {j}->{i}" for m in hist), f"peer {i} never received the real message from peer {j}"

        print(f"TEST 4 ({n}-peer full mesh discovery + delivery): PASS")
    finally:
        for m in msgs:
            await m.stop()
        for d in discs:
            await asyncio.to_thread(d.stop)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_stress_test_"))
    print(f"scratch dir: {tmp}")
    try:
        test_1_signing_key_pin_race(tmp)
        test_2_known_peers_cap(tmp)
        await test_3_message_throughput(tmp)
        await test_4_multi_peer_mesh(tmp)
        print("\nALL STRESS TESTS PASSED")
    finally:
        import shutil

        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
