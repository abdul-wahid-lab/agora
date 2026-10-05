# Stress test instructions

This file explains what Agora's stress/adversarial test suites are, what each one actually exercises, how to run them yourself, and how to read the results. It is a reference for running and reproducing this testing, not a record of what was found - that's `STRESS_TEST_REPORT.md`.

Local-only documentation, like `BUILD_LOG.md` and `TASK_QUEUE.md` - not pushed to the public GitHub repo.

## What exists, and where

All of these live in `backend/app/` as `_test_*.py` files (the leading underscore keeps them out of any package's public API, not a disabling convention - they're meant to be run directly). None of them are wired into a CI pipeline; they're run by hand.

| File | What it covers | Scale |
|---|---|---|
| `_test_stress.py` | Signing-key pin race, known_peers cap, message throughput, multi-peer mesh | Regression-sized: fast, meant to run every time, not to find new bugs |
| `_test_extreme_stress.py` | The same shapes of test as above, pushed far harder, plus concurrent file transfers, concurrent real calls, an adversarial flood at real volume, and the real FastAPI HTTP server under concurrent load | Deliberately large: can take several minutes, meant to surface bugs that only show up under real scale |
| `_test_adversarial.py` | Five specific attacks: reflection, replay, discovery spoofing, malformed/garbage frames, oversized file-transfer length-prefix | Correctness-focused, not scale-focused |
| `_test_wiretap.py` | A real network capture confirming traffic is actually encrypted on the wire, not just "the code calls encrypt()" | One real packet-capture pass |
| `_test_encryption.py`, `_test_calling.py`, `_test_filetransfer.py`, `_test_groups.py`, `_test_blocking.py`, `_test_deletion.py`, `_test_group_delete.py`, `_test_bandwidth_sharing.py`, `_test_file_auto_retry.py` | Feature-level correctness (happy path + a few real edge cases each) | Small, fast, one scenario each |

## How to run them

All of them are plain scripts, not pytest suites (pytest isn't installed in this project's venv) - run each with `-m`, from `backend/`:

```bash
cd backend
./agora/Scripts/python.exe -m app._test_stress
./agora/Scripts/python.exe -m app._test_extreme_stress
./agora/Scripts/python.exe -m app._test_adversarial
```

(Swap `agora/Scripts/python.exe` for whatever your venv's interpreter path actually is - `agora` is this project's venv folder name, not a generic placeholder.)

Each script prints `PASS`/`FAIL` per test as it goes, a final tally, and exits non-zero on any failure (so it's scriptable: `&& echo ok || echo failed`). None of them need a real LAN with other devices - they spin up their own real backend processes/services on localhost loopback ports in the 22000-24000 range, picked to avoid colliding with the real app's default ports (8001, 5001) or each other.

`_test_extreme_stress.py` specifically takes real minutes to run (large file transfers, a 20,000-identity flood, 600 concurrent real HTTP requests) - don't run it inside a tight feedback loop the way you'd run the small feature tests.

## What "stress" actually means here, test by test

- **Signing-key race**: real OS threads (not asyncio tasks - this exercises actual thread-scheduling nondeterminism) all claim the same brand-new peer_id with different keys at the exact same instant, via a `threading.Barrier` forcing maximum overlap. Exactly one must win, every time, or discovery's trust-on-first-use pinning has a real spoofing hole.
- **known_peers flood**: thousands of fake identities, each one a completely real (if self-generated) Ed25519 keypair - not strings, not mocks - hammering the pin-and-remember path concurrently. The cap and eviction have to hold under real concurrent writes, not just a convenient sequential loop.
- **Throughput**: real messages, both directions at once, through the real `MessagingService`, checked for exact content, zero loss, and zero duplication afterward - not "did it finish," but "is every single message exactly once, exactly correct."
- **Large mesh**: real `PeerDiscovery` + `MessagingService` instances - genuinely separate objects with their own sockets and services, not one shared instance passed around - mutually discovering each other and delivering an all-pairs message set.
- **Concurrent file transfers**: multiple real files, each filled with real random bytes (not zeros - zeros can hide corruption that happens to still compress/pad correctly), sent over real sockets at the same time, each one's SHA-256 checked byte-for-byte on arrival.
- **Concurrent calls**: many real `CallService` pairs starting, at the literal same instant, to check for state cross-talk between pairs that have nothing to do with each other, plus a deliberate collision storm on one pair (both sides firing overlapping offers rapidly) to stress the busy/collision bookkeeping specifically.
- **Adversarial flood**: thousands of garbage TCP connections at a real listening socket, followed by one real, correct message - confirming the server didn't just survive the flood, but is still correctly serving real traffic afterward.
- **Real HTTP API concurrency**: a real `uvicorn`-hosted `api.py` process, hit with hundreds of concurrent requests across several endpoints at once, including deliberately malformed `POST /peers/add-scanned` bodies (the QR-pairing endpoint) that must be refused cleanly rather than crashing the process or hanging.

## Reading a failure

A `FAIL` line names the specific invariant that broke and the real numbers behind it (not just "assertion failed") - that's deliberate, so a failure is a starting point for investigation, not a mystery to re-derive. If a test fails:

1. Re-run it alone first - some of these (the mesh and throughput tests especially) share loopback ports with real LAN discovery traffic if other real devices/instances are active on the same network at the time, which can produce a misleading result that isn't a real bug (this happened once already during this project's testing - see `STRESS_TEST_REPORT.md`).
2. Check whether the failure is new, or already described as a known, deliberately-accepted limitation in `STRESS_TEST_REPORT.md` or `TASK_QUEUE.md`.
3. If it's new and real, fix the underlying code, not the test - these are deliberately written to fail loudly when something is actually wrong.
