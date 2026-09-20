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

## Design Assets

`D:\Agora\ui prompt\` now holds a full visual design, generated from the [Suggested Build Prompt](ui%20prompt/agora-ui-pages-prompt.md) (§8) and the [File Sharing design prompt](ui%20prompt/agora-ui-pages-prompt.md) (§9):

- **`Agora.dc.html`** (+ `support.js`) — a single canvas containing **37 fully designed screens**, iPhone-frame mockups, covering every section of the UI spec: onboarding, nearby/discovery, chats, calls, settings, system/edge states, and file sharing.
- Design direction actually followed: warm cream/off-white ground (`#fbf7f2` / `#efe7dd`), terracotta/amber accent (`#e2703a`) — matches the "hearth, not cloud-enterprise" brief. Type pairing: **Instrument Serif** for display headings, **Hanken Grotesk** for UI/body, **IBM Plex Mono** for technical labels/metadata.
- Notably went beyond the prompt in a good way on **8.5 Security interstitial** (the APK/install-warning screen): dark high-contrast treatment, sender trust context ("known 14 days, 62 messages"), sha256 shown, two required consent checkboxes, and a 3-second delay before "Install anyway" unlocks, with "Keep it closed" as the visually dominant default action. This is a stronger safety design than the prompt asked for — worth preserving as-is when this gets built.
- Not yet wired to any real framework/frontend — it's a static design reference (per-screen `data-screen-label` attributes make each one greppable), not implementation. Frontend framework choice (React/Next.js vs Flutter, still open) determines how these get turned into real screens.

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

**Matching design screens (ready, not yet built):** `1.1` Splash · `1.2` Permissions · `1.3` Profile setup · `1.4a/b/c` Network check (found / empty / blocked) · `3.1` Nearby peers · `3.1b` Nearby empty · `3.2` Peer quick actions · `3.3` Troubleshooting. This whole set only needs discovery data (already live) — no messaging or calling required — so it's the first UI slice that could be wired up.

---

## Phase 2 — Messaging — ✅ DONE (single-machine verified)

**Spec requirements:** WebSocket server per device, connect to peer's advertised IP:port, send/receive with delivery ack + ordering, persist to SQLite, survive a peer disconnecting/reconnecting mid-conversation without losing message order.

**What was built:**
- [backend/app/storage.py](backend/app/storage.py) — `MessageStore`: one SQLite file per device (no shared/central DB), a `messages` table (msg_id, peer_id, direction, body, status, ts). Each call opens a short-lived connection via `asyncio.to_thread` rather than sharing one connection across coroutines/threads.
- [backend/app/messaging.py](backend/app/messaging.py) — `MessagingService`:
  - Runs a `websockets` server on the same port discovery already advertises for this device.
  - Sending opens (or reuses) one persistent outbound connection per peer — ordering comes for free from using a single connection, not from any sequence-number scheme.
  - Wire protocol: `hello` (identifies the peer_id on a fresh connection) → `chat` (msg_id, body, ts) → `ack` (msg_id). A message starts `pending`, flips to `sent` once written to the socket, and to `delivered` once the ack round-trips back.
  - A background loop every 2s re-attempts delivery of anything still `pending`/`sent` for peers currently visible in the discovery registry — this is the same mechanism for "peer was briefly offline" and for "resume after a call paused a transfer" later in Phase 2B.
- [backend/app/cli_chat.py](backend/app/cli_chat.py) — interactive CLI test: `peers`, `<name> <message>`, `history <name>`, `quit`. Added a `--peer-id` override (default: random per run) specifically to let a test simulate the *same device* restarting — not otherwise needed, and worth remembering this means peer identity isn't yet persisted across real restarts (see Known limitations).

**Errors hit and fixed during this phase:**
1. **`zeroconf._exceptions.EventLoopBlocked` on startup.** `discovery.start()` calls zeroconf's synchronous `register_service`, which detects the *already-running* asyncio event loop in the calling thread (cli_chat.py runs everything under `asyncio.run()`, unlike Phase 1's plain-synchronous `cli_test.py`) and tries to schedule its own internal coroutine on that same loop — but the loop is busy executing our synchronous call and can never get free to run it, so it deadlocks and times out. *Fix*: run `discovery.start()` via `await asyncio.to_thread(discovery.start)` so zeroconf sees no ambient loop in its own thread and falls back to its normal dedicated background loop. Root cause was purely "discovery was written and tested as a synchronous script in Phase 1, then reused inside an asyncio app in Phase 2" — worth remembering if discovery gets embedded into the eventual FastAPI service too.
2. **Duplicate message delivery** — Bob received "hi from alice" four times in the first test run. Root cause: the outbound connection used for *sending* had nothing reading frames *off* it, so Bob's `ack` reply was sent but never consumed by Alice. Her message's status stayed `sent` forever, so the pending-flush loop (which resends anything not yet `delivered`) kept resending it every 2 seconds. *Fix*: spawn a small reader task on every outbound connection as soon as it's opened, whose only job is to catch `ack` frames and flip status to `delivered`. This is the kind of bug that only shows up with two real processes exchanging real acks — worth remembering discovery's single-machine test didn't need this because it never had a return-path protocol.

**Tests performed (all on one machine, two/three processes):**
- ✅ Two-way discovery + send: Alice → Bob delivered, status flow `pending → sent → delivered` confirmed via `history`, Bob's `received` copy stored once.
- ✅ **Hard-drop mid-conversation**: killed Bob (`kill -9`, no graceful mDNS unregister — deliberately, to simulate a real dropped device rather than a clean quit) *while a send to him was about to happen*. Message correctly stayed queued (his registry entry only goes stale after the 10s TTL from Phase 1), then a second Bob process was started with the same `--peer-id` (simulating the same device reconnecting) — the pending-flush loop picked him back up and delivered the message exactly once, no duplicates, status ended at `delivered`.

**Known limitations / not yet done in Phase 2:**
- Only tested on one machine, same caveat as Phase 1 — multi-device WiFi testing still pending for both phases together.
- Peer identity (`peer_id`) is not yet persisted across a real app restart — Phase 1/2 both generate a fresh random UUID per process unless a test forces `--peer-id`. A real device will need to persist this locally (e.g. a small config file) so a restart doesn't look like a brand-new peer to everyone else's message history.
- No message encryption yet — spec calls for treating LAN traffic as untrusted; that's still open (noted already in the spec, not forgotten, just not in scope for getting the transport itself correct first).
- If both sides try to message each other for the first time at the exact same instant, each opens its own outbound connection rather than sharing one — works fine (each direction is independently ordered) but means a peer pair can end up with two live connections instead of one. Not a correctness bug, just an inefficiency; not worth solving before Phase 3, where the same question resurfaces properly as call collision.

**Matching design screens:** `4.1` Chat list · `4.1b` Chats empty · `4.2` Chat 1:1 · `4.3` Group chat · `4.4` New chat · `4.5` Chat info · `7.2` Router isolation (the "can't reach this peer" state belongs here since it's a messaging-connection failure, not a discovery one).

## Phase 2B — File Sharing — ⏳ NOT STARTED (added 2026-09-21)

**Not originally in scope.** The only prior mention was a throwaway "attachment icon (optional file share over LAN)" bullet in `ui prompt/agora-ui-pages-prompt.md`, with no protocol, storage design, or safety handling behind it — not a real feature. Added properly to both [lan-chat-app-spec.md](lan-chat-app-spec.md) and [ui prompt/agora-ui-pages-prompt.md](ui%20prompt/agora-ui-pages-prompt.md) at the user's request, since file sharing (arbitrary types — docs, images, **APKs, game files/ROMs**, archives) will be built alongside text messaging.

**Why it needs its own phase, not just a chat-bubble feature:**
- Game/ROM/APK files can run hundreds of MB to a few GB — too large to buffer through the chat WebSocket or in memory. Needs its own TCP connection per transfer, streamed to disk.
- Needs explicit accept/decline consent before any bytes move (no auto-save), with an extra, visually distinct confirmation step for executable/installable files (.apk/.exe/.sh) — receiving an APK is a security decision, not a routine download.
- Needs resume-after-drop, not restart-from-zero, given WiFi hiccups are already an accepted reality for calls in this project.
- Competes for bandwidth with an active call on the same LAN — spec now calls for pausing/throttling large transfers while a call is in progress.

**Sequencing:** placed after Phase 2 (messaging) since it reuses the WebSocket connection for the send/accept handshake, and before Phase 3 (calling) is considered done, since the bandwidth-contention edge case above only matters once both exist. Not started — no code written yet.

**Matching design screens:** `8.1` Send confirm · `8.2` File bubbles · `8.3` Transfer states · `8.4` Received file actions · `8.5` Security interstitial (the APK-install warning — see Design Assets note above, this one's especially strong) · `8.6` Shared files · `8.7` Storage settings.

## Phase 3 — Calling — ⏳ NOT STARTED

Per spec: WebRTC peer connections, SDP/ICE signaled over the existing WebSocket, no STUN/TURN, explicit call states, collision tie-breaking, clean handling of a peer dropping mid-call. Don't start until Phase 1 + 2 are verified on two real devices, not just this one machine (spec's own §6 rule).

**Matching design screens:** `5.1` Outgoing call · `5.2` Incoming call · `5.2b` Call collision · `5.3` Active audio call · `5.4` Active video call · `5.5` Call ended · `5.6` Call history · `7.3` Peer left mid-call · `7.4` Calls empty.

## Phase 4 — Hybrid Online/Offline Mode — ⏳ NOT STARTED

Per spec: connectivity watchdog (real internet vs. just Wi-Fi association), a transport abstraction so the rest of the app doesn't care whether a peer is reached via LAN or an optional relay, automatic fallback with no user action required.

**Matching design screens:** `6.2` Network settings (mode indicator + opt-in sync toggle) · `7.1` Connectivity banners.

## Phase 5 — Polish — ⏳ NOT STARTED

Per spec: group chat/multi-peer, encryption hardening across all transports, packaging into a real installable app.

**Matching design screens:** `6.1` Settings home · `6.3` Privacy · `6.4` Notifications · `6.5` About. (Group chat itself is design-covered already under Phase 2's `4.3`/`4.4`, since those don't depend on anything Phase 5-specific.)

Every one of the 37 screens in `Agora.dc.html` now has a phase assignment above — nothing in the design is orphaned, and nothing in the phase plan is missing a visual target.

---

## Open questions for the user (not yet decided)
- Frontend choice: spec offers React/Next.js (web) **or** Flutter (native). Not needed until we start wiring a UI on top of Phase 1/2, but worth deciding before then.
- Whether to test Phase 1 across two real physical devices now, or proceed to Phase 2 on a single machine first and batch multi-device testing later.
