# Build Log — LAN-First Chat & Call App

Running record of setup, phase-by-phase progress, errors hit, and what's
actually been verified working. Spec lives in [lan-chat-app-spec.md](lan-chat-app-spec.md).
Following the spec's own instruction: build order is Phase 1 → 2 → 3 → 4 → 5,
and Phase 3 (calling) doesn't start until 1 and 2 are solid on real devices.

## Status at a glance

| Phase | Status | Design screens |
|---|---|---|
| 1 — Discovery | ✅ done (single-machine verified) | 1.1–1.4c (onboarding), 3.1–3.3 (nearby) |
| 2 — Messaging | ✅ done (single-machine verified) | 4.1–4.5, 7.2 |
| 2B — File sharing | ✅ done (single-machine verified) | 8.1–8.7 |
| 3 — Calling | ⏳ not started | 5.1–5.6, 5.2b, 7.3, 7.4 |
| 4 — Hybrid mode | ⏳ not started | 6.2, 7.1 |
| 5 — Polish | ⏳ not started | 6.1, 6.3–6.5 |

## Desktop app build-out

Decided 2026-09-21: ship this as a real installable Windows app (like Discord/Slack/WhatsApp Desktop), not a CLI or a browser tab. Strategy: **Electron shell + React frontend (ported from the existing 37-screen design) + the existing Python backend, spawned automatically by Electron as a background process and talked to over a localhost-only API.** Electron chosen over Tauri specifically for this project — no second toolchain (Rust) on top of Python + Node, and the existing design is already React-based.

| Step | Status |
|---|---|
| 1 — Local FastAPI wrapper around the existing backend | ✅ done (single-machine verified) |
| 2 — Port design to React, wire Nearby/onboarding to live discovery | ⏳ not started |
| 3 — Wire Chat screens to messaging | ⏳ not started |
| 4 — Wire file-sharing screens to file transfer | ⏳ not started |
| 5 — Electron shell, sidecar process spawning, installer packaging | ⏳ not started |

### Step 1 — Local API layer — ✅ DONE

**What was built:** [backend/app/api.py](backend/app/api.py) — a FastAPI app wrapping the already-working `PeerDiscovery`/`MessagingService`/`FileTransferService` classes with no changes to any of them. Important design point: this server binds to **127.0.0.1 only** — it is never reachable from other peers on the LAN, it's purely how this device's own future UI talks to this device's own backend. The actual peer-to-peer traffic still goes out on the separate 0.0.0.0-bound discovery/messaging ports, completely independent of this API's port.

- REST: `GET /me`, `GET /peers`, `POST /messages`, `GET /messages/{peer_id}`, `POST /files/send`, `GET /files/{peer_id}`, `POST /files/{id}/accept|decline|resend`.
- `WS /events` — pushes `message`, `peer_joined`/`peer_left`, `file_offer`, and `file_status` events live, so the future React UI doesn't have to poll for anything that matters in real time (peer presence is still cheap to poll via `GET /peers` too, but events fire proactively as a bonus).
- `POST /files/send` and the accept/decline/resend endpoints fire the underlying (slow, waits-for-peer-response) calls as background tasks and return immediately — a REST request can't sit open waiting for a human on the other end to accept a file.

**Tests performed** (two `uvicorn` instances on one machine, real HTTP/WebSocket calls via `curl` and a small websockets test script):
- ✅ `GET /me` / `GET /peers` — discovery data correctly exposed over HTTP.
- ✅ `POST /messages` → `GET /messages/{peer_id}` on both sides — same `pending → sent → delivered` flow as the CLI, now driven purely over HTTP.
- ✅ Full file transfer via the API: `POST /files/send` → offer appeared in the receiver's `GET /files` within ~2s → `POST /files/{id}/accept` → transfer completed → saved file's sha256 matched the original exactly.
- ✅ `WS /events` — connected a plain websocket client, sent a message from the other side via REST, confirmed the `message` event arrived over the socket in real time.

**Known limitations:** peer-join/leave events are driven by a 1.5s poll of the in-memory registry inside the API process (not push-based from discovery.py itself) — fine for a single UI client, would need a proper pub/sub if this ever needed to support multiple simultaneous local UI connections. `on_event("startup"/"shutdown")` is FastAPI's older lifecycle API (still functional in 0.141, but the newer `lifespan` context-manager style is preferred going forward — left as-is since it works and isn't worth a churn-only change right now).

## Test it yourself

There's no UI wired up yet — Phases 1, 2, and 2B are CLI-only for now (`app.cli_chat`), by design, per the spec's own "prove the transport before touching UI" instruction.

**Quick test, one machine, two terminals.** In both, `cd D:\Agora\backend` first.

Terminal 1:
```powershell
.\agora\Scripts\python.exe -m app.cli_chat --name Alice --port 8001
```
Terminal 2:
```powershell
.\agora\Scripts\python.exe -m app.cli_chat --name Bob --port 8002
```
Wait a couple seconds, then in either one: `peers` (the other should show up), then `Bob hey can you see this` (or `Alice ...` from Bob's side) to send a message, then `history Bob` to confirm it went `pending → sent → delivered`. Kill one with Ctrl+C mid-conversation and watch the other's `peers` list drop it after ~10s (TTL/leave detection).

**File sharing:** `send Bob C:\path\to\some\file` from one side. The *other* side will get an incoming-offer prompt printed automatically (with a loud warning if it's an `.apk`/`.exe`/etc.) — type `accept <the short id shown>` or `decline <id>`. Check `files Bob` on either side afterward to see status move through `offered → accepted/declined → transferring → completed`. Note: reacting to a freshly-printed transfer_id from a *second* terminal you're driving via script/pipe rather than typing by hand hits a real Windows/MSYS stdin quirk (see Phase 2B notes below) — typing it yourself in a normal terminal works fine; the automated regression test (`python -m app._test_filetransfer`) is the reliable way to exercise this end-to-end without a human at the keyboard.

**Real test, two actual devices on the same WiFi** — the one that actually matters, since the spec explicitly warns single-machine testing can hide bugs that only show up across real network interfaces:

1. Copy `backend/` to the second device (don't copy the `agora/` venv folder itself — rebuild a fresh venv there from `requirements.txt`).
2. Run the same `cli_chat.py` command on each device — ports can both be `8001` since they're different machines.
3. **Windows will likely prompt a Firewall dialog** the first time each side starts listening — click **Allow access** for Private networks, or incoming connections get silently blocked even though discovery still shows the peer.
4. Same `peers` / `<name> <message>` / `history <name>` commands as above.

If peers show up in `peers` but messages stay stuck on `pending` forever, that's very likely **router AP/client isolation** (spec §4's known edge case) — try a phone hotspot as a comparison, since hotspots don't isolate clients from each other.

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

## Phase 2B — File Sharing — ✅ DONE (single-machine verified)

**Not originally in scope.** The only prior mention was a throwaway "attachment icon (optional file share over LAN)" bullet in `ui prompt/agora-ui-pages-prompt.md`, with no protocol, storage design, or safety handling behind it — not a real feature. Added properly to both [lan-chat-app-spec.md](lan-chat-app-spec.md) and [ui prompt/agora-ui-pages-prompt.md](ui%20prompt/agora-ui-pages-prompt.md) at the user's request, since file sharing (arbitrary types — docs, images, **APKs, game files/ROMs**, archives) will be built alongside text messaging.

**Why it needs its own phase, not just a chat-bubble feature:**
- Game/ROM/APK files can run hundreds of MB to a few GB — too large to buffer through the chat WebSocket or in memory. Needs its own TCP connection per transfer, streamed to disk.
- Needs explicit accept/decline consent before any bytes move (no auto-save), with an extra, visually distinct confirmation step for executable/installable files (.apk/.exe/.sh) — receiving an APK is a security decision, not a routine download.
- Needs resume-after-drop, not restart-from-zero, given WiFi hiccups are already an accepted reality for calls in this project.
- Competes for bandwidth with an active call on the same LAN — spec now calls for pausing/throttling large transfers while a call is in progress.

**Sequencing:** placed after Phase 2 (messaging) since it reuses the WebSocket connection for the send/accept handshake, and before Phase 3 (calling) is considered done, since the bandwidth-contention edge case above only matters once both exist.

**What was built:**
- [backend/app/storage.py](backend/app/storage.py) — added a `files` table (transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts) alongside the existing `messages` table.
- [backend/app/messaging.py](backend/app/messaging.py) — added a generic `on_control` hook so other services can ride the same WebSocket for their own message types without messaging.py knowing anything about them, plus a `send_control()` method. This is how file-transfer control messages piggyback on the existing chat connection per the spec, with zero coupling between the two modules.
- [backend/app/filetransfer.py](backend/app/filetransfer.py) — `FileTransferService`:
  - Handshake over the existing WebSocket: `file_offer` (filename, size, sha256, is_executable) → `file_offer_response` (accept, TCP port, resume_at) → `file_complete`/`file_failed`.
  - Bytes move over a **separate raw TCP connection** opened fresh per transfer, streamed straight to a `.part` file on disk in 256KB chunks — never buffered in memory, so this scales to the multi-GB game-file/ROM case the spec calls out.
  - Receiver computes its own sha256 of the completed `.part` file and compares to what the *offer* claimed — it never trusts the sender's word after the fact, only what it can verify itself.
  - Resume: the receiver's `.part` file size on disk *is* the resume point (not an in-memory counter), so a `resend()` after a drop picks up from the real last-flushed byte, not wherever the process's memory thought it was.
  - Executable/installable extensions (`.apk .exe .msi .bat .cmd .com .sh .jar .appimage .ps1`) are flagged `is_executable` in the offer itself, so the receiving side can show a distinctly stronger warning *before* the accept decision is even made — matches the design's `8.5 Security interstitial`.
  - Nothing auto-accepts or auto-saves anywhere in this module — `accept()` only ever runs in response to an explicit call from the UI/CLI layer.
- [backend/app/cli_chat.py](backend/app/cli_chat.py) — added `send <peer> <path>`, `files <peer>`, `accept/decline/resend <transfer_id prefix>`. Incoming offers print immediately (with the executable warning inline) the same way incoming chat messages do.
- [backend/app/_test_filetransfer.py](backend/app/_test_filetransfer.py) — automated integration test (see below) driving two full stacks in one process over real sockets.

**Errors hit and fixed during this phase:**
1. **Interactive CLI testing hit a Windows/MSYS platform wall, not a code bug.** Verifying `accept <id>` requires reacting to a transfer_id that's only known once the offer actually arrives — mid-session, not scriptable in advance. Tried feeding a running background process's stdin through a named pipe (`mkfifo`) from later shell commands; first attempt deadlocked outright (opened the pipe's write end before anything held the read end open — classic FIFO open-order deadlock), and after fixing the ordering, the venv's native `python.exe` crashed immediately with `RuntimeError: lost sys.stdin` — MSYS/Cygwin-emulated FIFOs apparently don't hand native Win32 CRT processes a stdin handle they can actually read. *Fix*: stopped fighting the terminal and wrote [_test_filetransfer.py](backend/app/_test_filetransfer.py), an automated asyncio test that drives two `FileTransferService` instances directly in one process over real localhost sockets — no interactive stdin involved at all. More deterministic than the manual approach anyway, and it's a real regression test that stays in the repo rather than a one-off manual session. (The earlier CLI offer/warning flow was still confirmed manually first — see Tests performed.)
2. No bugs found in the actual transfer logic on the first fully-working test run — the offer/accept/stream/hash-verify/save pipeline worked correctly the first time the stdin issue was worked around. The resume logic (test 2 below) also passed on the first attempt.

**Tests performed:**
- ✅ **Executable warning UI path** (manual, interactive CLI, two real background processes): sent a `.jpg` and a fake `.apk` from Alice to Bob. The `.jpg` offer printed normally; the `.apk` offer printed with `!! THIS IS AN INSTALLABLE/EXECUTABLE FILE - only accept if you trust the sender !!` inline, and `files <peer>` correctly tagged it `[EXECUTABLE]` in the history listing.
- ✅ **Happy path** (automated, `_test_filetransfer.py`): offer → accept → 500KB streamed over a dedicated TCP connection → receiver's independently-computed sha256 matches → file saved to `<downloads>/<sender_peer_id>/<filename>` → sender's own record also reads `completed`.
- ✅ **Resume** (automated): seeded a receiver-side `.part` file with exactly the first half of the real file's bytes (simulating "dropped mid-transfer last time"), called `resend()`, and confirmed via an instrumented spy that the sender started streaming from **exactly** byte 250,017 of 500,034 — not from zero — and the final reassembled file's hash matched the original exactly.
- ✅ **Decline**: receiver declining leaves the sender's record as `declined`, no bytes ever move, no hang.
- ✅ **Hash mismatch is caught, not silently accepted**: seeded an offer where the claimed hash doesn't match the real bytes (simulating corruption/tampering in transit) — receiver's independent verification catches it, deletes the bad `.part` file, reports `file_failed` back to the sender, and never lets a corrupted file reach the "completed" state or the real downloads folder.

**Known limitations / not yet done in Phase 2B:**
- Only tested on one machine/process — same multi-device caveat as Phases 1 and 2.
- No bandwidth-sharing with an active call yet — can't exist meaningfully until Phase 3 (calling) does. Spec still calls for pausing/throttling a large transfer while a call is active; deferred until there's a call to contend with.
- `resend()` only works within the same process lifetime — outgoing file paths are remembered in memory (`_outgoing_paths`), not persisted, so a sender-side restart loses the ability to resend an in-flight transfer (mirrors the peer-identity-not-persisted limitation already noted in Phase 2).
- No progress-percentage UI in the CLI (the design's `8.3 Transfer states` calls for live %/speed/ETA) — the backend calls `on_progress` per chunk already, this is purely a CLI-polish gap deferred until there's a real UI to show it in.
- A single-byte corruption anywhere in a multi-GB file currently means re-transferring the whole thing on retry (whole-file hash, no per-chunk checksums) — acceptable for now, worth revisiting if large-file transfers turn out to be flaky in practice.

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
