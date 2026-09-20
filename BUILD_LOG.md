# Build Log — LAN-First Chat & Call App

Running record of setup, phase-by-phase progress, errors hit, and what's
actually been verified working. Spec lives in [lan-chat-app-spec.md](lan-chat-app-spec.md).
Following the spec's own instruction: build order is Phase 1 → 2 → 3 → 4 → 5,
and Phase 3 (calling) doesn't start until 1 and 2 are solid on real devices.

---

## Environment / Setup

| Item | Value |
|---|---|
| OS | Windows 11 Pro |
| Python | 3.13.12 (miniconda base install) |
| Project root | `D:\Agora` |
| Backend venv | `D:\Agora\backend\agora` (named to match project, per user request) |
| Backend deps | fastapi, uvicorn[standard], zeroconf, websockets — see `backend/requirements.txt` |
| Git | Initialized fresh (`git init`) — repo had no prior history |

Setup steps taken:
1. `git init` in `D:\Agora`.
2. Created `backend/app/` package.
3. Created `backend/requirements.txt` (fastapi, uvicorn, zeroconf, websockets).
4. `python -m venv venv` inside `backend/`, then installed requirements.
5. Renamed `venv/` → `agora/` per user instruction (name the venv the same as the project directory).
   - Verified the rename didn't break anything: venv's `python.exe` doesn't hardcode its own folder name, so `agora/Scripts/python.exe -c "import fastapi, zeroconf, ..."` still works fine. (Only `Scripts/activate.bat`'s `VIRTUAL_ENV` var would show the old path if used — irrelevant since we invoke the interpreter directly.)

---

## Phase 1 — Peer Discovery — ✅ DONE (single-machine verified)

**Spec requirements** (from section 3 and the detailed prompt):
- mDNS/Zeroconf announcement with device name + IP/port
- Live peer list, updating as peers join/leave (TTL/heartbeat)
- UDP broadcast fallback for when mDNS is blocked
- Minimal CLI test before touching any UI

**What was built:**
- [backend/app/discovery.py](backend/app/discovery.py)
  - `PeerRegistry` — thread-safe peer store, dedups by `peer_id`, TTL sweep (10s) drops stale peers.
  - `PeerDiscovery` — runs both discovery paths concurrently and feeds the same registry:
    - **mDNS path**: registers a `_lanchat._tcp.local.` service via `zeroconf`, with `peer_id` and `device_name` in TXT properties; browses for other instances of the same service type.
    - **UDP broadcast path**: separate thread broadcasts a JSON announce packet every 3s on port 42424; a listener thread on the same port ingests announces from other peers.
  - Peers from either transport land in the same list, tagged with `source: "mdns" | "udp"` so it's visible which path found them (useful later for diagnosing "mDNS is blocked on this network" per the spec's edge-case list).
- [backend/app/cli_test.py](backend/app/cli_test.py) — minimal CLI: `python -m app.cli_test --name <NAME> --port <PORT>`, prints the live peer list every 2s.

**Test performed:**
Ran two instances on the same machine (`Alice` on port 8001, `Bob` on port 8002) as background processes and inspected their logs.

**Results — all verified working:**
- ✅ Both peers announced and found each other via **mDNS** (Bob saw Alice's mDNS announce first).
- ✅ Both peers also found each other via the **UDP broadcast fallback** independently — confirms the fallback path works on its own, not just as a silent no-op.
- ✅ **Join** detection: peer appeared in the list within ~1-2s of the other process starting.
- ✅ **Leave/TTL** detection: `kill -9`'d Bob (simulating a hard drop, no graceful shutdown/unregister) — Alice kept showing Bob for a few cycles based on stale UDP announces, then correctly expired and removed him from the peer list once `last_seen` exceeded the 10s TTL (removed on the sweep tick just after ~12s elapsed, matching the 5s sweep interval + 10s TTL design).

**Errors hit and fixed during this phase:**
1. **Silent empty log files** when running the CLI as a backgrounded process with output redirected to a file (`> alice.log 2>&1 &`). Python buffers stdout when it isn't attached to a real terminal, so nothing appeared in the log for many seconds.
   - *Fix*: ran with `python -u` (unbuffered stdout) for the background test processes. Not a code bug — just a test-harness gotcha, noted here in case it comes up again when scripting future tests.
2. No other runtime errors — dependency install, mDNS registration, and UDP socket binding all worked on the first try in this environment.

**Known limitations / not yet done in Phase 1:**
- Only tested on a single machine (two processes, same loopback-adjacent LAN interface). The spec explicitly warns (`Section 6`) that mDNS/UDP broadcast behavior can differ across real separate devices — **still needs testing across two actual devices on the same WiFi** before Phase 2/3 work is trusted.
- No explicit "mDNS is blocked" *detection* logic yet — right now both paths just always run in parallel and whichever works, works. A deliberate detect-and-report path (spec's client/AP-isolation edge case) is deferred to Phase 4/5 polish or before, whenever it's tackled.
- No graceful `remove_service` UI signal tested (only tested via hard-kill/TTL expiry, not a clean shutdown that unregisters the mDNS service).

---

## Phase 2 — Messaging — ⏳ NOT STARTED

Per spec: WebSocket server per device, connect to peer's advertised IP:port, send/receive with delivery ack + ordering, persist to SQLite.

## Phase 2B — File Sharing — ⏳ NOT STARTED (added 2026-09-21)

**Not originally in scope.** The only prior mention was a throwaway "attachment icon (optional file share over LAN)" bullet in `ui prompt/agora-ui-pages-prompt.md`, with no protocol, storage design, or safety handling behind it — not a real feature. Added properly to both [lan-chat-app-spec.md](lan-chat-app-spec.md) and [ui prompt/agora-ui-pages-prompt.md](ui%20prompt/agora-ui-pages-prompt.md) at the user's request, since file sharing (arbitrary types — docs, images, **APKs, game files/ROMs**, archives) will be built alongside text messaging.

**Why it needs its own phase, not just a chat-bubble feature:**
- Game/ROM/APK files can run hundreds of MB to a few GB — too large to buffer through the chat WebSocket or in memory. Needs its own TCP connection per transfer, streamed to disk.
- Needs explicit accept/decline consent before any bytes move (no auto-save), with an extra, visually distinct confirmation step for executable/installable files (.apk/.exe/.sh) — receiving an APK is a security decision, not a routine download.
- Needs resume-after-drop, not restart-from-zero, given WiFi hiccups are already an accepted reality for calls in this project.
- Competes for bandwidth with an active call on the same LAN — spec now calls for pausing/throttling large transfers while a call is in progress.

**Sequencing:** placed after Phase 2 (messaging) since it reuses the WebSocket connection for the send/accept handshake, and before Phase 3 (calling) is considered done, since the bandwidth-contention edge case above only matters once both exist. Not started — no code written yet.

## Phase 3 — Calling — ⏳ NOT STARTED
## Phase 4 — Hybrid Online/Offline Mode — ⏳ NOT STARTED
## Phase 5 — Polish — ⏳ NOT STARTED

---

## Open questions for the user (not yet decided)
- Frontend choice: spec offers React/Next.js (web) **or** Flutter (native). Not needed until we start wiring a UI on top of Phase 1/2, but worth deciding before then.
- Whether to test Phase 1 across two real physical devices now, or proceed to Phase 2 on a single machine first and batch multi-device testing later.
