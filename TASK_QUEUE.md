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
  or removal until there's something real behind it.

- [ ] **"Choose photo…" and "Shuffle avatar" buttons in onboarding are dead.**
  File: `frontend/src/components/Onboarding.jsx` (~lines 58–64). Same
  pattern: no `onClick`, no disabled state, nothing explaining they don't
  work yet. "Shuffle avatar" is the easier one to actually implement (cycle
  through the existing per-peer avatar color palette in
  `frontend/src/lib/avatar.js`); "Choose photo…" would need a real file
  picker + storing/serving an avatar image, which is a bigger feature.

## Missing retry/resend affordances (found 2026-09-26)

- [ ] **No way to retry a stalled/dropped file transfer from the UI.**
  The backend already fully supports this:
  `POST /files/{id}/resend` in `backend/app/api.py`, backed by
  `FileTransferService.resend()` in `backend/app/filetransfer.py`, which
  resumes from the exact byte offset after a drop. It's only ever been
  exercised at the API-test level (`backend/app/_test_filetransfer.py`):
  no button anywhere (chat bubble or Files tab) calls `api.resendFile()`.
  Once a transfer shows `status: "failed"`, it's permanently stuck from the
  user's side even though the backend could recover it.

- [ ] **No way to retry a message that failed to send.**
  `ConversationPane.jsx`'s `handleSend()` sets a message to `status:
  "failed"` if the initial `POST /messages` call itself throws (e.g. backend
  momentarily unreachable): `MessageBubble` shows a red `!` with no click
  action. Since the failed message only ever existed in local React state
  (never reached the backend, so there's no `msg_id` to retry against), the
  fix is a retry that just re-calls `api.sendMessage` with the same peer_id
  + body: not a true "resend a backend record" the way the file case is.

## Known security gaps (documented since Step 7, not yet addressed)

- [ ] **No transport encryption.** Messages, files, and call signaling all
  travel as plain `ws://`/TCP between peers on the LAN: anyone else on the
  same network who's actively sniffing can read it. Planned as Phase 5 work,
  not started. See README's Security posture section for the current honest
  framing (don't remove that framing until this is actually fixed).
- [ ] **No cryptographic peer identity.** `peer_id` is just a self-declared
  UUID sent in a hello message: nothing stops another device on the LAN
  from claiming any peer_id it wants, including impersonating someone
  already trusted. Fine for a trusted LAN (the app's actual threat model
  today), not fine for a hostile shared network.

## Bigger features, explicitly out of scope until backend work happens

- [ ] **Group chat / group calling.** The design (screens 4.3/4.4, 10.3,
  10.9's 4-person layout) shows this, but the backend has zero concept of a
  "group": no membership model, no N-way WebRTC signaling. The Chats
  panel's "+" (new conversation) button is intentionally `disabled` with a
  tooltip explaining this: that one's honest, not a silent dead end, but
  it's still blocked on this same missing backend work.
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
  default 50-row limit.
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
