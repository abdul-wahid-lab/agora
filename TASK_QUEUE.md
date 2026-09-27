# Task Queue

Everything that's been identified as needing work but deliberately deferred,
in one place, so a future session can pick items off this list instead of
re-discovering them. Internal working doc: not pushed to the public GitHub
repo (same as BUILD_LOG.md / the spec).

Each item has enough context to act on without re-reading the whole
conversation history that found it. When something here gets fixed, move it
out (delete the entry, or mark it done with the date) rather than letting
stale entries pile up.

## Fixed since this file was created (2026-09-26, same day)

- [x] **No way to retry a stalled/dropped file transfer from the UI.**
  The backend already fully supported this (`POST /files/{id}/resend` in
  `api.py`, backed by `FileTransferService.resend()` in `filetransfer.py`,
  which resumes from the exact byte offset), it just had no button anywhere
  calling it. Added a "Retry send" button to `ConversationPane.jsx`'s
  `FileBubble` and a "Retry" button + "Failed" badge to `FilesScreen.jsx`'s
  table row, both calling the already-existing `api.resendFile()`. Only
  shown for the sender's own copy of a failed transfer (`direction ===
  "sent"`), since `resend()` only ever supported that side, a failed
  *received* file still has no retry path, that's the receiver waiting on
  the sender to retry, not a gap in this fix.

- [x] **No way to retry a message that failed to send.** The red "!" on a
  failed `MessageBubble` (`ConversationPane.jsx`) now reads "Failed, tap to
  retry" and re-calls `api.sendMessage` with the same peer_id + body on
  click. Since the failed message never reached the backend in the first
  place (the `POST /messages` call itself threw), there's no server-side
  record to resend against the way the file case has, this just re-attempts
  the same local optimistic entry; a successful retry gets reconciled away
  by the next history poll same as any normal send.

- [x] **"Shuffle avatar" in onboarding was dead.** Now cycles through the
  same 4-color palette peers already use elsewhere (`avatar.js`'s
  `AVATAR_PALETTE`, via a new `paletteAt(index)` export), live in the
  onboarding preview. The choice is saved to `localStorage` on Continue and
  now actually colors the self-avatar bubble in `IconRail.jsx` too, not just
  during onboarding, so it's a real persisted preference, not a cosmetic
  no-op. Important limitation: this can only ever change how *you* see your
  *own* avatar. Every other peer derives your color by calling `paletteFor`
  on your `peer_id` themselves, on their own device, so this has no way to
  change what color anyone else sees for you. "Choose photo…" next to it is
  still unbuilt (see "Dead UI elements" below), now honestly `disabled`
  instead of silently doing nothing.

- [x] **The top menu bar's Rescan button did literally nothing**:
  `App.jsx` wired it to `onRescan={() => {}}`, a hardcoded no-op, and it also
  had no loading/spin feedback of any kind even if it had worked. Fixed:
  `usePeers.js` now exposes a real `refresh()` (forces an immediate
  `GET /peers` instead of waiting for the next 2s poll: discovery itself is
  always continuously running in the background via mDNS/UDP, so there's no
  separate backend "scan" action to trigger; refreshing the visible list is
  the honest thing "Rescan" can actually do) plus a `refreshing` flag.
  `PeerList.jsx`'s Rescan button now shows a small rotating-arrow icon
  (`agSpin` keyframe in `index.css`) while a refresh is in flight, with a
  minimum 500ms visible duration so the animation is perceptible even though
  a LAN fetch usually resolves in milliseconds.

- [x] **A conversation with an offline peer showed "Unknown" and couldn't be
  opened at all** (found 2026-09-26, testing chat history persistence). Two
  causes, both fixed: the backend never persisted a peer's name anywhere
  except the live, memory-only discovery registry, which forgets someone the
  instant they go offline (fixed with a new `known_peers` table in
  `storage.py`, populated by `api.py`'s `_watch_peers` loop, joined into
  `GET /conversations`); and `App.jsx`'s `selectedPeer` only ever looked in
  the live `peers` list, so `ConversationPane` had nothing to render for
  anyone not currently online (fixed with a fallback synthetic peer object
  built from the conversation's own persisted name, plus an `online` flag
  threaded into `ConversationPane`/`InfoSidebar` to gray out Call/Video and
  show "not on this network" instead of stale/blank connection info).

## Dead UI elements (found during the 2026-09-26 two-device test)

- [ ] **The top menu bar ("Agora File Conversation Network View Help") is
  entirely decorative.** File: `frontend/src/components/TitleBar.jsx`
  (`MENU_ITEMS`, ~line 18): each is a plain `<span>`, no click handler, no
  dropdown, nothing. It visually matches the design's real desktop menu bar
  concept but has zero function behind any of the six items. This is a
  bigger job than the other dead-button entries below: each menu needs
  actual decided-on content before it's worth wiring up (e.g. File → maybe
  nothing meaningful for this app; Conversation → clear chat/view info,
  overlapping with the dead "⋯" button below; Network → Rescan/connection
  info; View → nothing built yet to toggle; Help → About/version). Worth
  deciding what (if anything) really belongs in each menu before building
  empty dropdowns that would just be a different flavor of the same
  dead-UI problem.

- [ ] **"⋯" (more options) button in the chat header is dead.**
  File: `frontend/src/components/ConversationPane.jsx` (~line 204). No
  `onClick` at all: not disabled, no tooltip, just does nothing when
  clicked. Needs either a real menu (e.g. view profile, clear chat, block)
  or removal until there's something real behind it. Candidate home for the
  now-documented "clear whole conversation" feature above.

- [ ] **"Choose photo…" in onboarding still has no real feature behind it.**
  ("Shuffle avatar" next to it is now fixed, see "Fixed since this file was
  created" above.) File: `frontend/src/components/Onboarding.jsx`. Needs a
  real file picker + storing/serving a custom avatar image, a bigger feature
  than the palette-cycling fix. For now it's honestly `disabled` with a
  "coming soon" label instead of silently doing nothing when clicked.

- [x] **Delete for me, clear a conversation, clear call history** (all
  local-only, no wire protocol changes). Three new backend routes: `DELETE
  /messages/{msg_id}` (removes one message, `storage.py`'s new
  `delete_message()`), `DELETE /conversations/{peer_id}` (wipes a whole
  thread, `clear_conversation()`, deliberately leaves `known_peers`'s
  remembered name and downloaded files alone, wiping the name would
  resurrect the old "Unknown" bug), and `DELETE /calls/history` (wipes the
  whole call log, `clear_all_calls()`, global rather than per-peer since the
  Calls tab is one flat list, not grouped by person). Frontend: a small 🗑
  button now sits on every real message bubble in `ConversationPane.jsx`
  (hidden on messages that only have a synthetic local id from a live event
  or optimistic send, since there's no real backend row to delete yet until
  the next history poll picks up the real one), the previously-dead "⋯"
  header button now opens a real menu with "Clear chat history," and
  `CallsScreen.jsx` got a "Clear all" button. All three routes verified
  against a live throwaway backend instance (send -> delete -> confirm
  gone, not just confirmed to import cleanly).

- [x] **Delete for everyone**, the hard one of the four, the only one that
  has to talk to the other device. New module
  [backend/app/deletion.py](backend/app/deletion.py) (`DeleteService`),
  built the same way `filetransfer.py`/`calling.py` already ride
  `messaging.py`'s transport: a new `{"type": "delete", "msg_id": ...}`
  control message over the existing WebSocket, no new socket, no change to
  `messaging.py`'s core chat/ack protocol. Deletes your own copy
  immediately and unconditionally; the notification to the peer is
  best-effort, if they're offline right now it's queued in a new
  `pending_deletes` table and a background loop (`DeleteService
  ._flush_pending_loop`, shaped exactly like `messaging.py`'s own
  `_flush_pending_loop` that already does this for normal chat messages)
  retries it automatically once they reappear on discovery, never silently
  dropped. No time window (unlimited, not WhatsApp's ~1 hour, this app's
  identity model doesn't need that restriction). `DELETE
  /messages/{msg_id}` gained `?everyone=true&peer_id=...`; a live incoming
  delete pushes a `message_deleted` event over `/events` so an already-open
  chat updates immediately instead of waiting for the next poll. Frontend:
  the 🗑 on a message you sent now opens a small menu, "Delete for me" /
  "Delete for everyone" (received messages only ever get "Delete for me",
  deleting someone else's message for everyone isn't a real feature).
  **Correction made while building this:** the original "no store-and-
  forward" claim in this file (below) was wrong, `messaging.py` already had
  `_flush_pending_loop` retrying held chat messages every 2s, that part of
  the offline design was already free. Verified with a new automated
  integration test,
  [backend/app/_test_deletion.py](backend/app/_test_deletion.py) (online
  delete relays immediately; offline delete queues then flushes once the
  peer reconnects, using the same two-full-stacks-over-real-sockets pattern
  as `_test_calling.py`), plus a separate live end-to-end run against two
  real running backend processes through the actual HTTP API (not just the
  internal service call). All pre-existing backend tests (`_test_
  filetransfer.py`, `_test_calling.py`, `_test_bandwidth_sharing.py`)
  re-verified green after this change.

  **Also verified through the actual real UI, not just the API** (asked
  explicitly by the user to "test it" after the above): drove two real,
  independent instances of the real React app through headless Chrome via
  the DevTools Protocol (same technique the calling feature used earlier in
  this project), each pointed at its own live backend. Real onboarding, real
  discovery showing up in the real Nearby list, opening a real chat, typing
  and clicking Send for a real message, watching it land in the other
  window, then clicking the real 🗑 icon, the real "Delete for everyone"
  menu item, and confirming the message disappeared from both windows,
  including a live disappearance on the receiving side with no manual
  refresh, then double-checked both SQLite files directly on disk afterward
  and found zero rows for that message on either side. Worth being honest
  about the process: the first two attempts at this looked like failures
  (message not disappearing), but both turned out to be bugs in the test
  script itself (clicking the wrong message's delete icon once old test
  data had accumulated across runs), not in the app, once the test was
  fixed to target the exact right message and reset to a clean database,
  it passed cleanly. Real two-physical-device testing is still the one gap
  this can't close.

## Missing message actions: delete, forward (found 2026-09-26)

Originally none of these existed anywhere in the codebase: confirmed by
grepping the whole backend and frontend for delete/forward-message logic,
only hit was an unrelated file-transfer cleanup test. All four are now
fixed (2026-09-26, see "Fixed since this file was created" at the top);
only "forward" (a separate, distinct feature) is still open. Difficulty as
compared before building:

| Feature | Difficulty | Status |
|---|---|---|
| Delete for me (single message) | Easy | Fixed |
| Clear a whole conversation's history | Easy-Moderate | Fixed |
| Clear call history entries | Easy-Moderate | Fixed |
| Delete for everyone (single message) | Hard | Fixed |
- [ ] **Forward a text message.** The easy version of forwarding: pick a
  message, pick a target conversation, send its `body` as a new outgoing
  message. Mostly a UI flow (message picker + conversation picker), the send
  path itself already exists.
- [ ] **Forward a file.** Not the same as forwarding text: a file transfer is
  its own protocol (`filetransfer.py`), not a database row that can be
  copied. "Forwarding" a received file really means re-offering/re-sending
  the already-downloaded file to a new peer as a brand new transfer, which
  reuses `FileTransferService.send_file()` but needs its own UI entry point
  from a `FileBubble`.

All four need a message-level UI affordance that doesn't exist yet either
(long-press or hover menu on a `MessageBubble`/`FileBubble` to expose these
actions) - this is the natural place the dead "⋯" header button's
functionality could partly live too, worth designing together.

## Images should render like WhatsApp, not as a generic file icon (2026-09-26)

- [ ] **No inline image preview or tap-to-view in chat.** Confirmed by
  reading `ConversationPane.jsx`: every file, image or not, renders through
  the same `FileBubble` as a generic extension-badge icon (PDF/APK/ZIP/MOV
  style), there's zero image-specific handling anywhere in the file (no
  `<img>` tag, no mimetype/extension check for image types). Sending a
  photo today looks identical to sending a zip file. WhatsApp-style would
  need: (1) detecting image extensions (png/jpg/jpeg/gif/webp/heic) the same
  way `EXECUTABLE_EXTS`/`EXT_STYLE` already do it for other types, (2) an
  actual thumbnail rendered inline in the bubble instead of the icon, which
  needs a way to point an `<img src>` at a local file path from Electron's
  renderer (likely a custom `agora-file://` protocol registered in
  `main.cjs`, since raw `file://` access to arbitrary paths is normally
  blocked and a bare `<img src="C:\...">` won't load), and (3) a full-screen
  tap-to-view lightbox on click. This is independent of group chat, it
  applies to the 1:1 chat that already exists today.

## Messages should queue and auto-deliver when the peer comes back online (2026-09-26)

**Correction (2026-09-26, found while designing "delete for everyone"):**
the claim originally written here, that text messages never retry after a
peer goes offline, was wrong. A full re-read of `messaging.py` found
`_flush_pending_loop()`: a background task, started in `MessagingService
.start()`, that runs every 2 seconds, checks every peer currently visible
to discovery, and re-attempts delivery of anything still `pending`/`sent`
for them. So **text messages already have real store-and-forward** on
reconnect, no fix needed there. Leaving the rest of this entry scoped down
to what's actually still missing:

- [ ] **Files have no equivalent auto-retry on reconnect.** Confirmed:
  `filetransfer.py` has no loop shaped like `_flush_pending_loop`, a failed
  transfer only ever gets resent via the manual "Retry send" button built
  earlier today, nothing automatically re-offers it when the peer
  reappears. Fix would mirror `_flush_pending_loop`'s exact shape: a
  background loop in `filetransfer.py`, checking visible peers against
  transfers still `status: "failed"` for them, calling `resend()`
  automatically. Same existing limitation applies: only works while the
  original file path is still known to the (still-running) backend
  process's `_outgoing_paths`.
  This still needs a decision on backoff/limit so a peer that flaps
  on/off doesn't get flooded with re-offer attempts, same open question as
  before.

## Known security gaps (documented since Step 7, not yet addressed)

- [ ] **No transport encryption. Real design work, not a small patch.**
  Messages, files, and call signaling (SDP/ICE) all travel as plain
  `ws://`/TCP between peers on the LAN: anyone else on the same network who's
  actively sniffing can read it. (Note: this does NOT include actual call
  audio/video, since WebRTC's media path is always DTLS-SRTP encrypted by
  the browser/Electron itself, with no way to turn that off. The gap is
  specifically the messaging WebSocket, the file-transfer TCP connection,
  and the pre-media signaling.)

  There's no central server here to issue TLS certificates from, so plain
  HTTPS-style TLS doesn't map cleanly onto this app. The approach that fits
  a peer-to-peer, no-authority design is closer to how SSH/Signal handle it:
  1. Each device generates its own public/private keypair once (e.g.
     X25519), stored locally, separate from `identity.json`'s peer_id.
  2. The `hello` handshake (already exchanged first thing on every new
     connection in `messaging.py`) also exchanges public keys.
  3. Both sides derive a shared secret from that exchange and encrypt
     everything after the handshake with an AEAD cipher (ChaCha20-Poly1305
     or AES-GCM), one shared secret per peer pair.
  4. Trust-on-first-use: the first time a peer_id is ever seen, its public
     key gets remembered (natural fit for the `known_peers` table added for
     the name-persistence fix, just add a `public_key` column). If that same
     peer_id ever shows up with a *different* key later, that's a real red
     flag worth surfacing to the user (someone else claiming an ID they
     don't own) rather than silently trusting it.
  5. The file-transfer TCP connection needs the same treatment separately,
     since it's a distinct socket from the messaging WebSocket.

  Planned as Phase 5 work, not started. See README's Security posture
  section for the current honest framing (don't remove that framing until
  this is actually built and verified, not just started).
- [ ] **No cryptographic peer identity.** `peer_id` is just a self-declared
  UUID sent in a hello message: nothing stops another device on the LAN
  from claiming any peer_id it wants, including impersonating someone
  already trusted. Fine for a trusted LAN (the app's actual threat model
  today), not fine for a hostile shared network.

## Bigger features, explicitly out of scope until backend work happens

- [ ] **Group chat / group calling, including file + image sharing inside a
  group.** (2026-09-26: user explicitly wants group audio/video calls, group
  chat, and file/image sharing within a group, not just 1:1.) The design
  (screens 4.3/4.4, 10.3, 10.9's 4-person layout) shows this, but the
  backend has zero concept of a "group": no membership model, no N-way
  WebRTC signaling (current calling.py is strictly 1:1, one offer/answer
  pair), no group-scoped message/file storage (messages table is keyed by a
  single `peer_id`, there's no group_id anywhere). The Chats panel's "+"
  (new conversation) button is intentionally `disabled` with a tooltip
  explaining this: that one's honest, not a silent dead end, but it's still
  blocked on this same missing backend work. Real design questions before
  starting: how a group is created/named, whether it's a full mesh of
  WebRTC connections (simplest, but bandwidth/CPU scales badly past ~4-5
  people on a laptop) or needs an SFU-style relay (real infrastructure this
  app doesn't have and can't easily get in a serverless LAN design), and
  whether file/image sharing to a group means sending to every member
  individually (reuses the existing 1:1 transfer code N times) or a real
  group-aware protocol.
- [ ] **Settings screens (6.1–6.5)**: not touched in any pass yet. Design
  exists (network mode, privacy/security, notifications, about/help), no
  code at all.
- [ ] **Android/phone app.** Completely separate project, not started.
  Discussed stack: Flutter (Dart) for one codebase across Android/iOS,
  `nsd`/`multicast_dns` for mDNS discovery matching the desktop's `zeroconf`
  setup, `web_socket_channel` for messaging, `sqflite` for local storage:
  the phone reimplements the same wire protocol natively rather than running
  the Python backend on-device. Deliberately deferred until desktop is
  fully validated on two real machines.

## Smaller known gaps (from earlier phases, still true)

- [ ] Search bars in Nearby and Files are visual-only (Files' type-category
  pills and text search do work; the actual search *input* boxes elsewhere
  don't filter anything yet).
- [ ] Call history has no delete/clear action and no pagination beyond the
  default 50-row limit. Difficulty: Easy-Moderate, same local delete-by-
  record shape as the message/conversation deletes above, see the
  difficulty table under "Missing message actions."
- [ ] The bandwidth-sharing throttle during an active call is a fixed
  0.2s-per-chunk delay, not adaptive to actual measured link contention.

## Testing still needed

- [ ] Files/Calls/Chats have now been tested across two real physical
  devices (2026-09-26) and six real bugs were found and fixed, but that was
  one test pass, not exhaustive. Worth another full pass (Nearby → Chats →
  Files → Calls) after the current fixes are rebuilt and copied to both
  machines, specifically re-checking: distinct names showing correctly,
  video calls on both directions, the new file Accept/Decline/Open/Save-As
  actions, and whether `identity.json`'s persisted peer_id actually survives
  an app restart the way it's supposed to.
