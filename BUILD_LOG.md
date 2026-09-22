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
| 3 — Calling | ✅ done (single-machine verified) | 5.1–5.6, 5.2b, 7.3, 7.4 |
| 4 — Hybrid mode | ❌ removed (2026-09-21) — no hybrid mode, ever; LAN/WiFi-only by design | ~~6.2, 7.1~~ |
| 5 — Polish | ⏳ not started | 6.1, 6.3–6.5 |

## Desktop app build-out

Decided 2026-09-21: ship this as a real installable Windows app (like Discord/Slack/WhatsApp Desktop), not a CLI or a browser tab. Strategy: **Electron shell + React frontend (ported from the existing 37-screen design) + the existing Python backend, spawned automatically by Electron as a background process and talked to over a localhost-only API.** Electron chosen over Tauri specifically for this project — no second toolchain (Rust) on top of Python + Node, and the existing design is already React-based.

| Step | Status |
|---|---|
| 1 — Local FastAPI wrapper around the existing backend | ✅ done (single-machine verified) |
| 2 — Port design to React, wire Nearby/onboarding to live discovery | ✅ done (single-machine verified) |
| 3 — Wire Chat screens to messaging | ✅ done (single-machine verified) |
| 4 — Wire file-sharing screens to file transfer | ✅ done (single-machine verified) |
| 5 — Wire Calls screen to calling (real WebRTC audio/video) | ✅ done (single-machine verified) |
| 6 — Electron shell, sidecar process spawning, installer packaging | ⏳ not started |
| 7 — Exact-match rebuild against the real design file (Onboarding, Nearby, Chats, Files, Calls) | ✅ done (single-machine verified) |

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

### Step 2 — React port — ✅ DONE (Nearby + onboarding live)

**What was built:** [frontend/](frontend/) — a Vite + React app (plain React for now, not yet wrapped in Electron — that's Step 5).

- [frontend/src/api.js](frontend/src/api.js) — client for `backend/app/api.py`: REST calls plus `connectEvents()`, a `WS /events` subscriber with auto-reconnect and backoff.
- [frontend/src/index.css](frontend/src/index.css) — design tokens lifted directly from the Agora design file: same palette (`#efe7dd` ground, `#e2703a` terracotta accent), same type pairing (Instrument Serif / Hanken Grotesk / IBM Plex Mono).
- [frontend/src/components/Sidebar.jsx](frontend/src/components/Sidebar.jsx) — the four-item nav rail (Nearby/Chats/Calls/Files) from the design.
- [frontend/src/components/NearbyScreen.jsx](frontend/src/components/NearbyScreen.jsx) — **fully live**, not mock data: polls `GET /peers` every 1.5s, layers `WS /events` (`peer_joined`/`peer_left`) on top for faster updates, shows the empty state when no peers are visible, renders per-peer transport (`via mdns`/`via udp`) exactly like the CLI did.
- [frontend/src/App.jsx](frontend/src/App.jsx) — shell + a live bottom status bar (`LAN-only` / `backend unreachable`, peer count) polling `GET /me` + `GET /peers`.

**Test performed:** ran two backend instances (`AGORA_NAME=Alice`/`Bob`, ports 8001/8002, APIs on 5001/5002) plus the Vite dev server, pointed the frontend's `.env` at Alice's API (`http://127.0.0.1:5001`), and screenshotted the running page. Confirmed end-to-end, not simulated: the page showed "you are Alice · peer_id 200cbb31" (live from `GET /me`) and a real "Bob · 192.168.1.103:8002 · via udp" row (live from `GET /peers`), with the status bar correctly reading "LAN-only · 1 peer".

**Onboarding — added right after:** [frontend/src/components/Onboarding.jsx](frontend/src/components/Onboarding.jsx) — Splash → Permissions (informational only, matching the design's plain-language reasons for each) → Profile setup, gated behind `localStorage["agora.onboarded"]` so it only shows once per browser. Verified all three steps render correctly via screenshots, including the profile-setup "Start looking around" button's disabled state until a name is typed.

**Known limitations / not yet done:**
- The name typed in Profile setup is stored in `localStorage` only — it does **not** rename the device on the network. `device_name` is fixed at backend startup via an env var; there's no `PUT /me` endpoint yet to actually change it live. This is called out directly in a code comment in `App.jsx` so it isn't mistaken for working.
- Permission prompts (mic/camera/notifications) are purely informational cards right now — they don't trigger real OS permission dialogs. That only becomes meaningful once Electron (Step 5) can request real OS-level permissions; a browser tab can't request "local network access" as its own permission type at all.
- Calls and Files nav items still show a "coming next" placeholder — Files is Step 4; Calls has no backend yet (Phase 3).
- No way yet to rename the device from the UI — `device_name` is fixed at backend startup via an env var, not exposed as an API endpoint. Profile setup will need a small backend addition (e.g. `PUT /me`) before it can be more than cosmetic.
- Chrome headless was used to verify rendering during development (`--screenshot` against the Vite dev server) — not a permanent test harness, just how this was checked without a person clicking through it manually.

### Step 3 — Chats screen wired to messaging — ✅ DONE

**What was built:** [frontend/src/components/ChatsScreen.jsx](frontend/src/components/ChatsScreen.jsx) — a two-pane view: a live peer list on the left (same `GET /peers` polling pattern as Nearby) and a conversation pane on the right.

- Selecting a peer loads `GET /messages/{peer_id}` and re-polls it every 2.5s to pick up status transitions (`pending → sent → delivered`).
- Sending calls `POST /messages` and appends an optimistic bubble immediately (`status: "pending"`) rather than waiting for the next poll — reconciled against the server's copy on the next poll tick; a failed send is marked `status: "failed"` inline instead of silently vanishing.
- A `WS /events` listener appends `message` events for the currently-open peer in real time, so an incoming message shows up with no poll delay and no reload.
- Outgoing/incoming bubbles are visually distinct (accent-filled vs. surface+border, matching the design), with a timestamp and a delivery glyph (`…` pending, `✓` sent, `✓✓` delivered/received) on outgoing bubbles only.
- Pulled the avatar color-hash + initials helpers (previously duplicated inline in `NearbyScreen.jsx`) out into [frontend/src/lib/avatar.js](frontend/src/lib/avatar.js), shared by both screens now that a second screen needs the same avatars.

**Test performed** (two real backend instances, Alice on 5001 / Bob on 5002, Vite dev server, headless Chrome driven over the DevTools protocol so real click/type events could be dispatched into the page — not just `curl` against the API):
- ✅ Sent a message from Bob → Alice via `curl` before opening the UI; Alice's Chats screen showed real history on load (`pending → sent → delivered`, correct bubble side, correct timestamp).
- ✅ Typed into the actual message input and clicked the actual **Send** button (via a dispatched native `input` event + `.click()`, not a direct API call) — message appeared instantly as an optimistic bubble, then confirmed delivered.
- ✅ With the Alice↔Bob conversation open, sent a message from Bob's side via the API — it appeared in Alice's open conversation within ~1s over `WS /events`, no reload, no poll wait.
- ✅ Empty state ("Pick someone nearby to start chatting") confirmed before any peer is selected.

**Known limitations / not yet done:**
- No group chats yet — one-to-one only, matching where Phase 2 (messaging backend) currently stands.
- No message-history pagination — `GET /messages/{peer_id}` defaults to the last 50; fine for now, will matter once conversations get long.
- No "typing…" indicator or read receipts beyond the existing delivered/received status.
- Optimistic messages use a client-generated `msg_id` (`pending-<timestamp>`) that's replaced wholesale by the next history poll rather than reconciled in place — cosmetically fine (no duplicate renders observed) but worth revisiting if sends ever need per-message retry UI.

### Step 4 — Files screen wired to file transfer — ✅ DONE

**What was built:** [frontend/src/components/FilesScreen.jsx](frontend/src/components/FilesScreen.jsx) — same two-pane pattern as Chats (live peer list left, transfer list right for the selected peer).

- `GET /files/{peer_id}` polled every 2s, plus a `WS /events` listener that refetches immediately on `file_offer`/`file_status` so a new incoming offer or a completion doesn't wait for the next poll tick.
- Sending is a path-input row (there's no real OS file picker yet — this is a dev-mode browser tab, not Electron — so it mirrors the CLI's `send <peer> <path>` model: type/paste an absolute path on this machine). Typing a path with an executable-ish extension (`.apk .exe .msi .bat .cmd .com .sh .jar .appimage .ps1`) shows a warning *before* sending, matching the backend's own `EXECUTABLE_EXTS` set.
- Each transfer card shows filename, direction, size, timestamp, and a status pill; a received offer still `awaiting_accept` gets **Accept**/**Decline** buttons; a `.apk`/`.exe`/etc. offer gets a red border and an inline "only accept if you trust this person" warning; a completed received file shows its saved path; a failed *sent* transfer gets a **Retry** button (calls `resend()`).

**Bug caught during verification, fixed before considering this done:** the Accept/Decline buttons and the executable warning were initially gated on `f.status === "offered"` — but that string is only ever used for the *sender's own* record. The receiver's copy of a fresh offer is saved as `"awaiting_accept"` (see `filetransfer.py`'s `_handle_offer`), so the buttons silently never appeared on the receiving side. Caught by actually clicking through Bob's real UI (not just checking the sender's screen) and fixed by switching both conditions to `"awaiting_accept"`.

**Test performed** (two real backend instances, two real frontend windows — Alice on 5173/5001, Bob on 5174/5002 — headless Chrome driving both over the DevTools protocol so real clicks landed in both pages):
- ✅ Sent a normal `.txt` file from Alice's Files screen (typed path, clicked Send) — appeared instantly on Alice's side as `Awaiting response`.
- ✅ Typed a `.apk` path and confirmed the pre-send warning appeared before clicking Send.
- ✅ On Bob's real UI: both offers appeared as `Awaiting response` with **Accept**/**Decline** buttons, and the `.apk` card had the red border + inline trust warning.
- ✅ Clicked **Accept** (a real DOM click, not an API call) on the `.txt` offer — card moved to `Completed` with the correct `saved to <path>` line.
- ✅ Clicked **Decline** on the `.apk` offer — card moved to `Declined`, no transfer ever started, matching the backend's decline-before-any-bytes-move design.
- ✅ Alice's own screen reflected both outcomes (`Completed` / implicitly declined) once Bob acted, confirmed via the sender-side card list.

**Known limitations / not yet done:**
- No real file picker — a full path must be typed/pasted. This is inherent to running as a browser tab; Electron (Step 6) can use a native `<input type="file">` with real path access or its own dialog API.
- No transfer progress bar — status jumps straight from `awaiting_accept`/`accepted` to `completed`/`failed` in the UI, even though the backend streams in 256KB chunks. Fine for the small files tested; worth adding for large transfers.
- `resend()`/Retry is wired but only meaningfully tested at the API level in `_test_filetransfer.py`, not re-verified through this screen's button in this pass.

### Step 5 — Calls screen wired to calling — ✅ DONE (single-machine verified)

Full detail is under **Phase 3 — Calling** above (backend signaling relay, the messaging refactor it required, all bugs caught during verification, and the end-to-end test results) — this entry just tracks it against the desktop build-out's own step numbering. Summary: [frontend/src/hooks/useCall.js](frontend/src/hooks/useCall.js) + [frontend/src/components/CallOverlay.jsx](frontend/src/components/CallOverlay.jsx) + [frontend/src/components/CallsScreen.jsx](frontend/src/components/CallsScreen.jsx) give real, verified, peer-to-peer WebRTC audio **and** video calling (frame-level confirmed, not just track presence), mute/camera toggle, a persisted call history list per peer, a ringtone + tab-title flash for incoming calls (works regardless of window focus), and bandwidth-sharing that measurably throttles file transfers while a call is active. Only remaining gap: real multi-device WiFi testing, which needs an actual second device, not more code.

### Step 7 — Exact-match rebuild against the real design file — ✅ DONE (single-machine verified)

**Why this step exists:** Steps 2-5 above were each independently designed and verified working, but they were *my own interpretation* of "a chat/calling app," not a port of the actual design file. Called out directly (2026-09-22): "I want the exact same UI... not just random UI." Fair - the design file (`ui prompt/Agora-standalone.html`) turned out to have a **dedicated desktop section (screens 10.1-10.10)** with a real menu bar, an icon-only nav rail, a unified peer/chat list, an info sidebar, and a dark full-window call UI - none of which the earlier steps had, because I'd never actually gone and extracted it.

**How the design was extracted:** the file is a claude.ai artifact bundle (compiled/minified, not readable source), so pixel values couldn't be read from the file text directly. Opened it in headless Chrome instead and pulled each screen's fully-rendered `outerHTML` via `document.querySelector('[data-screen-label="..."]').outerHTML` over the DevTools protocol - every color, spacing, radius, and font value in this rebuild is a computed style copied out of the actual rendered design, not eyeballed from a screenshot.

**Scope decision:** the design also shows group chat and group/mesh calling (10.3, 10.9's 4-person layout, a floating menu-bar-widget popover). The backend has zero concept of a "group" - no membership, no N-way call signaling. Rather than build convincing-looking UI wired to nothing real, this step matches everything the backend actually supports (1:1 chat, 1:1 calls, real file transfer) exactly, and treats group chat/group calling as its own separate, later backend project - confirmed with the user before proceeding this way.

**What was rebuilt, screen by screen:**
- **Design tokens** ([frontend/src/index.css](frontend/src/index.css)) - replaced the earlier approximate 3-tier surface system with the exact colors extracted (`--chrome`, `--rail`, `--panel`, `--border-soft`, `--text-strong`, `--text-muted`, a real per-peer avatar palette with matched text colors) plus the design's own named animations (`agRing`, `agPulse`, `agSweep`, `agBlink`).
- **App shell** - new [TitleBar.jsx](frontend/src/components/TitleBar.jsx) (traffic lights + real menu bar + live peer-count pill), [IconRail.jsx](frontend/src/components/IconRail.jsx) (hand-drawn icon shapes matching the design exactly, not an icon font), [StatusBar.jsx](frontend/src/components/StatusBar.jsx).
- **Nearby + Chats, unified properly** - the design treats these as genuinely different lists (Nearby = live presence, Chats = actual conversations sorted by recency with a last-message preview), not two copies of the same peer list the way Step 2/3 had them. Required a new backend piece: `MessageStore.list_conversations()` + `GET /conversations`, a self-join query picking each peer's single most-recent message. [PeerList.jsx](frontend/src/components/PeerList.jsx) (rebuilt) and [ChatsListPanel.jsx](frontend/src/components/ChatsListPanel.jsx) (new) each feed the same [ConversationPane.jsx](frontend/src/components/ConversationPane.jsx) (new) + [InfoSidebar.jsx](frontend/src/components/InfoSidebar.jsx) (new).
- **Messages and files, merged into one timeline** - the design shows file transfers as bubbles interleaved with text messages in the same conversation, not a separate screen. `ConversationPane` now fetches both `history()` and `files()` for the selected peer and sorts them together by timestamp. This surfaced a real gap: the backend already computed live transfer progress (`FileTransferService.on_progress`) but never exposed it - added a `file_progress` WS event and wired a real progress bar for in-flight sent files, rather than faking a percentage.
- **Files browser** ([FilesScreen.jsx](frontend/src/components/FilesScreen.jsx), rebuilt) - the design's Files tab is a global browser across *all* peers (category filters, by-person grouping, a sortable table), not per-peer bubbles - needed a new `MessageStore.list_all_files()` + `GET /files` (kept `GET /files/{peer_id}` for the per-conversation view). Also ported the exact dark security-gate modal for executable files: two required checkboxes plus a real 3-second countdown before "Accept anyway" unlocks - verified the countdown and the checkbox-gating both actually work, not just render.
- **Calls, restructured to match a completely different interaction model than Step 5 assumed** - the design's Calls tab is a **call-history list** (à la a phone app's recents), not a peer-picker; placing a call happens from a conversation's Call/Video buttons instead (already wired in `ConversationPane`). Needed `MessageStore.list_all_calls()` + `GET /calls/history`. [CallsScreen.jsx](frontend/src/components/CallsScreen.jsx) rebuilt around this; real stats shown (total/missed/dropped calls, this-week talk time) rather than the design's fabricated latency/packet-loss numbers, which nothing in this app measures.
- **Incoming calls are a small floating toast** (top-right, dark, with an avatar/presence ring and quick Accept/Decline), not the full-screen light takeover Step 5 built - [CallOverlay.jsx](frontend/src/components/CallOverlay.jsx) rewritten. Ringing/in-call now use the actual dark, diagonal-stripe-textured call window from the design (10.9), adapted from its 4-person grid down to 1:1 (one remote tile, one local PiP corner) since that's what actually exists.
- **Onboarding** ([Onboarding.jsx](frontend/src/components/Onboarding.jsx), rebuilt) - the design is a single split-panel window (hero message + 3-step list on an accent-colored left panel, the actual profile form on the right, with the permission note and Continue button inline at the bottom) - not the 3-screen Splash→Permissions→Profile wizard Step 2 built. Simpler and matches exactly.

**Bugs caught during this pass (not by inspection - by actually clicking through both sides):**
1. `sha256` was never exposed by either files endpoint, despite being stored - the security gate's "sha256: unknown" was accurate but a real gap once the modal needed to show it. Fixed by adding it to both `/files` and `/files/{peer_id}`.
2. A malformed close button in `SecurityGate` would have positioned itself relative to the wrong ancestor (missing `position: relative` on the modal box) - caught and fixed before it ever rendered wrong, by re-reading the JSX rather than trusting it.
3. **Test-script false alarm, not an app bug:** an early verification pass showed Alice's "Call" click landing on the Calls *nav tab* instead of the conversation header's Call button - traced to the test helper's `.includes("Call")` fallback matching the sidebar's "Calls" label first in DOM order. Fixed the test (exact-match only) and re-verified the real click path worked correctly all along.

**Tests performed (two real backend instances + two real frontend windows, headless Chrome with fake media devices, real onboarding start-to-finish - not skipped via localStorage this time):**
- ✅ Onboarding: typed a name on both sides, confirmed the Continue button stays disabled until non-empty, confirmed the exact split-panel layout renders (screenshotted against the extracted reference).
- ✅ Nearby → Chats: sent files and messages, confirmed Chats' recency-sorted list and Nearby's presence-list both work and share the same conversation pane/state.
- ✅ Files: sent a plain file (auto-accepted on click, no gate) and a fake `.apk` (correctly triggered the security gate) from Alice; on Bob's real UI, ticked both checkboxes, watched the 3-second countdown actually count down and stay locked until it hit zero, then successfully accepted.
- ✅ Calls: Alice clicked **Call** on Bob's conversation header while Bob was sitting on the **Files tab** - Bob's incoming-call toast appeared correctly over the Files browser, proving the cross-tab visibility fix from the original Phase 3 work still holds after this UI rewrite. Bob clicked **Accept** for real; both sides reached a live, ticking call in the dark call window. Alice clicked **Leave**; both sides' Calls tab immediately showed the completed call (`Audio · 3 s · local, direct`) with accurate stats.

**Known limitations / not yet done:**
- Group chat and group/mesh calling are fully out of scope for this step (see Scope decision above) - the nav rail, list panels, and call UI all assume 1:1 only.
- The floating menu-bar-widget popover (10.9's corner overlay) isn't built - it's a system-tray-adjacent concept that only makes sense once Electron (Step 6) exists.
- Settings screens (6.1-6.5) weren't touched in this pass.
- Search bars in Nearby/Files are visual-only (not wired to actually filter/search yet, except Files' type-category pills and text search, which are functional).
- Still only ever verified on one machine, per every phase's standing caveat.

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

**The actual UI (Nearby only, so far).** Needs the backend API running plus the frontend dev server:

```powershell
# terminal 1 - backend + API
cd D:\Agora\backend
$env:AGORA_NAME="Alice"; $env:AGORA_PORT="8001"
.\agora\Scripts\python.exe -m uvicorn app.api:app --host 127.0.0.1 --port 5001

# terminal 2 - frontend
cd D:\Agora\frontend
npm install   # first time only
npm run dev
```

Open the URL Vite prints (`http://localhost:5173`). Start a second backend instance the same way (different `AGORA_NAME`/`AGORA_PORT`/API port) on another machine, or on this one with a different port, and it'll show up live in the Nearby list — no refresh needed.

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

## Phase 3 — Calling — ✅ DONE (single-machine verified)

Per spec: WebRTC peer connections, SDP/ICE signaled over the existing WebSocket, no STUN/TURN, explicit call states, collision tie-breaking, clean handling of a peer dropping mid-call. (Note: started without the spec's own "verify Phase 1+2 on two real devices first" gate being met yet — proceeding on the same single-machine-first basis every prior phase has used, per explicit instruction to continue.)

**Architecture decision:** the Python backend does **not** implement WebRTC itself. `backend/app/calling.py` is a pure signaling relay — it forwards SDP offer/answer and ICE candidates between two peers over the same WebSocket control channel `filetransfer.py` already rides (via `MessagingService.add_control_handler`, a small refactor - see below), tracks call state, and resolves collision. The actual `RTCPeerConnection`, media capture, and rendering all happen in the browser/Electron frontend, which has native WebRTC support. Since both peers are always on the same subnet, ICE only ever needs local host candidates - no STUN/TURN server exists anywhere in this design.

**Messaging refactor required first:** `MessagingService.on_control` was a single-callback slot already claimed by `FileTransferService`. Adding a second consumer (`CallService`) the same way would have silently overwritten it and broken file transfer. Replaced with `add_control_handler()` backed by a list, dispatched to every registered handler - `filetransfer.py` updated to register instead of assign. Both `_test_filetransfer.py` and the new calling test re-verified green after this change.

**What was built (backend):**
- [backend/app/calling.py](backend/app/calling.py) — `CallService`: `start_call`/`answer_call`/`send_ice_candidate`/`end_call`, plus collision resolution (`_handle_offer`): if both peers have an unanswered outgoing call to each other at the same instant, the lexicographically smaller `peer_id` wins and proceeds; the loser cancels its own outgoing call and treats the winner's offer as a fresh incoming call. Both sides resolve this independently from the same two peer_ids - no extra negotiation message needed.
- [backend/app/api.py](backend/app/api.py) — `POST /calls/offer`, `POST /calls/{id}/answer`, `POST /calls/{id}/ice`, `POST /calls/{id}/end`, `GET /calls/{id}`, plus `WS /events` now also pushes `call_incoming`/`call_answered`/`call_ice`/`call_ended`.
- [backend/app/_test_calling.py](backend/app/_test_calling.py) — automated integration test (same pattern as `_test_filetransfer.py`): offer/answer/ICE relay, end/decline, busy (second offer to an already-in-call peer), and — the one that actually needed a real fix to test correctly — collision, using `asyncio.gather` instead of sequential awaits so both sides genuinely place their call before either message is received (a sequential version isn't a real collision test, it's just "whoever's message arrives first wins by default"). All pass.

**What was built (frontend) — and a real bug caught only by testing both sides' actual UI, not just the initiator's:**
- [frontend/src/hooks/useCall.js](frontend/src/hooks/useCall.js) — owns the entire call lifecycle **at the App level**, not inside the Calls screen. First version had it inside `CallsScreen.jsx`; testing caught that an incoming call arriving while the receiver was on any other tab (Nearby, Chats, Files) was **silently lost forever** - `call_incoming` is a live WS broadcast with no replay, and if nothing was listening yet because the Calls screen hadn't mounted, the event just vanished. Fixed by lifting the WS listener and all call state into `App.jsx` (via this hook) so it's always live regardless of the active tab, and rendering the ringing/incoming/in-call UI as a full-screen overlay ([frontend/src/components/CallOverlay.jsx](frontend/src/components/CallOverlay.jsx)) above whatever screen is open - this is also just closer to how real calling apps behave (a call takes over, it doesn't wait for you to be on the right tab).
- [frontend/src/components/CallsScreen.jsx](frontend/src/components/CallsScreen.jsx) — now just the "browse peers, start a call" screen; the actual ringing/in-call UI lives in the overlay.
- Non-trickle ICE for this first pass: both offer and answer wait for `iceGatheringState === "complete"` before being sent, so the SDP already contains every candidate and the `call_ice` relay endpoint isn't required for basic connectivity (it's still implemented and tested at the backend level for future trickle support). Simpler to get right on a first pass; on a LAN, gathering only host candidates is fast.
- No STUN/TURN config (`iceServers: []`), matching the backend design.

**Second real bug caught by testing, not by inspection:** even after the tab-visibility fix, remote audio still didn't play. `ontrack` fires as soon as media negotiation completes, which can happen *before* React has re-rendered to `status: "in_call"` - and the `<audio>`/`<video>` elements only exist in that render branch. The original code tried to set `remoteVideoRef.current.srcObject` directly inside `ontrack`, which silently no-ops when the ref is still null. Fixed the same way the local video preview already was: the stream is stashed in a ref regardless of whether an element exists yet, and a `useEffect` keyed on `call.status`/`call.media` re-applies it once the elements actually mount.

**Tests performed:**
- ✅ **Automated signaling test** (`_test_calling.py`, real localhost sockets, two full stacks in one process): offer relayed, answer relayed, ICE relayed both directions, end-call relayed and clears state on both sides, decline, busy (second offer to an in-call peer rejected without disturbing the existing call), and collision (both sides call each other at the same instant via `asyncio.gather` - the smaller-peer_id side's call proceeds untouched, the other side's own outgoing call is cancelled and replaced by the winner's incoming offer). All pass.
- ✅ **Real two-browser audio call** (two live backend processes + two live frontend windows, headless Chrome driven over the DevTools protocol with `--use-fake-device-for-media-stream` so `getUserMedia` succeeds without real hardware, real clicks dispatched into both pages): Alice placed an audio call to Bob while Bob's tab was sitting on **Nearby** (not Calls) - the incoming-call overlay appeared over the Nearby screen exactly as intended, proving the tab-visibility fix works. Bob clicked the real Accept button; both sides showed a live, ticking call timer. `RTCPeerConnection.iceConnectionState` reached `"connected"` on **both** sides (confirmed via runtime instrumentation, not just UI text), and after the ontrack fix, both sides' remote `<audio>` element had exactly 1 live audio track attached. Alice's real Hang Up button cleanly ended the call on both sides with no stuck state.
- ✅ Confirmed via direct backend log/API inspection that the `POST /calls/offer` → WebSocket `call_offer` → receiver's `call_incoming` broadcast path is what's actually carrying the offer (not some other path) - traced through Alice's access log (`POST /calls/offer 200 OK`) and Bob's live event stream.

**Second pass — call history, mute/camera, and distinguishing a dropped connection from a normal hangup:**
- [backend/app/storage.py](backend/app/storage.py) — new `calls` table (`call_id`, `peer_id`, `direction`, `media`, `status`, `started_at`, `ended_at`, `duration`) + `save_call_start`/`update_call_end`/`list_calls`. A call is written the moment it starts ringing (status defaults to `missed`) so an unanswered/cancelled call still shows up in history, then finalized on end.
- [backend/app/calling.py](backend/app/calling.py) — `CallState` gained `connected_at`, set the instant both sides reach `in_call` (on `answer_call` for the callee, on receiving `call_answered` for the caller). A shared `_finalize()` helper computes `duration = now - connected_at` (or `None` if it never connected) and maps the end reason to a history status via `_final_status()`: a call that connected is `completed` unless the reason is specifically `"dropped"` (an ICE failure, not a hangup) - one that never connected is recorded as its specific reason (`declined`/`busy`/`collision`/`failed`) or `missed` otherwise. Every call path (`end_call`, the `call_end` control handler, and the collision-yield branch) now routes through this one helper instead of duplicating the bookkeeping three times.
- `GET /calls/history/{peer_id}` exposes it; [frontend/src/components/CallsScreen.jsx](frontend/src/components/CallsScreen.jsx) shows a live-polled "Recent calls" list per peer (direction arrow, media, status, timestamp, duration) - design screen `5.6`.
- [frontend/src/hooks/useCall.js](frontend/src/hooks/useCall.js) — `toggleMute()`/`toggleCamera()` flip `track.enabled` on the local stream directly (no renegotiation needed) and expose `muted`/`cameraOff` for the UI; [frontend/src/components/CallOverlay.jsx](frontend/src/components/CallOverlay.jsx) got Mute/Cam-off buttons during `in_call`.
- `oniceconnectionstatechange` reaching `failed`/`disconnected` while actually `in_call` now calls `hangUp("dropped")` instead of a generic hangup, surfacing "Connection lost" distinctly from a normal "Call ended" - both to the local UI and in the persisted history status.
- **Bug caught while wiring the overlay buttons:** `<button onClick={onHangUp}>` passes the click `SyntheticEvent` as `onHangUp`'s first argument - harmless when `hangUp()` took no parameters, but once it gained a `reason` parameter this would have silently sent the event object as the end reason to the backend. Fixed by wrapping every action button in an arrow function (`onClick={() => onHangUp()}`) so no accidental argument passes through - caught by re-reading the diff before testing, not by a failure.

**Tests performed (second pass):**
- ✅ **Automated** (`_test_calling.py`, expanded): a completed call is recorded `completed` with a non-null duration on both sides; a declined call is recorded `declined` with no duration; a collision-losing call is recorded `collision`; a call that connects and is then ended with reason `"dropped"` is recorded `dropped`, not `completed` - proving the status mapping actually distinguishes them rather than collapsing every post-connection ending into one bucket. All pass, plus the original signaling tests re-verified green.
- ✅ **Real two-browser video call**, this time actually verified frame-by-frame (the gap explicitly called out after the first pass): screenshotted both sides mid-call and saw Chrome's fake-camera test pattern (an animated shape over a live millisecond counter) rendering in both the large remote `<video>` and the small local-preview thumbnail, on both Alice's and Bob's screens - with visibly different counter values between the two independent streams (`0:00:06:600` vs `0:00:06:700`), confirming these are two genuinely separate live feeds, not one stream mirrored or a static frame.
- ✅ Clicked the real **Mute** button mid-call and confirmed the label flipped to **Unmute** (backed by `track.enabled` actually toggling).
- ✅ After hanging up, opened the Calls tab on both sides and confirmed **Recent calls** showed the just-finished call - `↗ Video · Completed` on Alice's side, `↙ Video · Completed` on Bob's, matching timestamp and a `0:05` duration on both - proving history persists correctly on both ends of the same call, not just the initiator's.

**Third pass — bandwidth-sharing with file transfer, and a ringtone/title-flash for unfocused windows:**
- [backend/app/filetransfer.py](backend/app/filetransfer.py) — `FileTransferService` takes an `is_call_active: Callable[[], bool]` callback (defaults to always-`False` so nothing else that constructs it needs to change). `_stream_to_peer`'s chunk loop sleeps an extra 0.2s per chunk whenever it's true - a deliberate throttle, not a hard pause, so a transfer backs off during a call instead of either ignoring it or stalling completely for the call's whole duration.
- [backend/app/api.py](backend/app/api.py) — wires it as `lambda: any(c.status == "in_call" for c in calling._calls.values())`. `file_transfer` is constructed one line before `calling`, but the lambda only reads the name at call time (well after module load), not at definition time, so the forward reference is fine.
- [backend/app/_test_bandwidth_sharing.py](backend/app/_test_bandwidth_sharing.py) — new automated test: times the same transfer with no call active, with a real `CallService` pair actually connected (`in_call`), and again after the call ends. Asserts the in-call run is meaningfully slower and the post-call run speeds back up - a real wall-clock effect, not just confirming the flag gets read. Passed (baseline 0.14s, throttled 0.92s, post-call 0.09s in one run).
- [frontend/src/hooks/useCall.js](frontend/src/hooks/useCall.js) — a synthesized two-tone ringtone (Web Audio oscillator, no audio asset to ship) plays on a loop, and the tab title flashes to "Incoming call…", for as long as `call.status === "ringing" && call.direction === "incoming"` - both keep working regardless of window focus, unlike the full-screen overlay which only helps if the window is visible. A best-effort `Notification` also fires if the tab is hidden and permission already happens to be granted (nothing requests that permission yet - real OS notification permissions are Electron/Step 6's job).
- **Verified the one part of this that's easy to get wrong silently:** Chrome only lets a fresh `AudioContext` produce sound after the page has *real* user activation - a synthetic `element.click()` from test automation doesn't count, so an early test run correctly showed `state: "suspended"`. Re-tested using genuine trusted input events (CDP's `Input.dispatchMouseEvent`, which Chrome does treat as real activation) after simulating normal prior use (clicking through nav tabs) and confirmed `navigator.userActivation.hasBeenActive === true` and the `AudioContext` reached `state: "running"` - meaning the ringtone will actually be audible in real usage, where a user has always clicked around before any call could arrive. Documented rather than silently left ambiguous, since "it works in my test" and "it works for a real user" aren't automatically the same claim for autoplay-gated audio.

**Deliberately not built, with reasoning:**
- **Retry for a call whose signaling drops mid-setup** — file transfer's `resend()` exists because a partially-received file has real bytes on disk worth preserving and resuming from a byte offset. A call has no equivalent partial state to resume; placing a fresh call *is* the retry. Treating this as a missing feature would be building a distinction that doesn't actually exist for calls.
- **Real two-device WiFi testing** — this is the one item on this list that more code cannot close. Every phase since Phase 1 carries the same caveat: verified with two processes on one machine, never two physical devices on real WiFi. The spec itself calls out router client isolation and real WebRTC/mDNS behavior as things single-machine testing structurally cannot validate. Closing this requires an actual second device on the network, not further engineering effort here.

**Known limitations / not yet done in Phase 3:**
- Only tested on one machine (two backend processes, two browser tabs) - same multi-device caveat as every prior phase (see above - this is the one gap that isn't closeable by more code).
- Call history has no delete/clear action and no pagination beyond the default 50-row limit.
- The bandwidth-sharing throttle is a fixed 0.2s-per-chunk delay, not adaptive to actual measured link contention - a real bandwidth allocator would look at actual throughput, not just "is a call active right now."

**Matching design screens:** `5.1` Outgoing call · `5.2` Incoming call · `5.2b` Call collision · `5.3` Active audio call · `5.4` Active video call · `5.5` Call ended · `5.6` Call history · `7.3` Peer left mid-call · `7.4` Calls empty.

## Phase 4 — REMOVED (2026-09-21)

**Decision: no hybrid online/offline mode, ever.** Whether the internet happens to be reachable is irrelevant and is never checked — Agora works purely on LAN/WiFi presence, full stop. No connectivity watchdog, no cloud relay, no "sync when internet returns," no mode indicator to build. This entire phase is deleted, not deferred — see the spec's own Phase 4 section for the reasoning. `6.2`/`7.1`'s network-mode-toggle and connectivity-banner designs are retired along with it (single-mode apps don't need a mode indicator).

## Phase 5 — Polish — ⏳ NOT STARTED

Per spec: group chat/multi-peer, encryption hardening across all transports, packaging into a real installable app.

**Matching design screens:** `6.1` Settings home · `6.3` Privacy · `6.4` Notifications · `6.5` About. (Group chat itself is design-covered already under Phase 2's `4.3`/`4.4`, since those don't depend on anything Phase 5-specific.)

Every one of the 37 screens in `Agora.dc.html` now has a phase assignment above — nothing in the design is orphaned, and nothing in the phase plan is missing a visual target.

---

## Open questions for the user (not yet decided)
- **Resolved:** frontend choice — React (Vite), not Flutter, decided when the desktop build-out started (2026-09-21), specifically so the same codebase/design language carries forward into a future React Native Android app.
- **Still open:** every phase (1 through 3) has been built and verified single-machine only, never on two real physical devices over real WiFi. This has been a running, explicitly-accepted risk the whole way through rather than a blocker — worth flagging again now that calling (the phase most likely to behave differently on real WiFi vs. loopback-adjacent localhost, per the spec's own AP-isolation and NAT-traversal warnings) is the phase in progress.
