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

- [x] **Correction (2026-09-28): the "⋯" (more options) button in the chat
  header was NOT actually dead** (the entry that used to claim it was dead
  was stale - it already had a real "Clear chat history" action, from an
  earlier session's work never reflected here). That action has since moved
  to the real **Conversation** menu (see the top-menu-bar entry below), and
  the "⋯" button itself was removed as the now-redundant second path to it -
  both the correction and the follow-up move are done.

- [x] **Per-chat "⋯" quick-actions, WhatsApp-reference** (fixed 2026-09-29).
  All three real, new items from the reference screenshot are built,
  reachable from the Conversation menu next to Search/Export/Mute:
  - **Media, links, and docs** - `MediaLinksDocsModal` in
    [TitleBarModals.jsx](frontend/src/components/TitleBarModals.jsx), a
    filtered view scoped to the open 1:1 conversation, reusing the existing
    `GET /files/{peer_id}` - no new backend needed, exactly as scoped.
  - **Disappearing messages** - new [disappearing.py](backend/app/disappearing.py)
    (`DisappearingMessagesService`), a real periodic background sweep
    against a new `disappearing_settings` table (`PUT`/`GET
    /conversations/{peer_id}/disappearing`), deliberately **local-only**:
    this device deletes its own copy of expired messages, nothing is sent
    telling the peer to do the same - stated plainly in the modal's own
    copy rather than implying a two-sided guarantee that doesn't exist. A
    live `messages_expired` event lets an already-open conversation drop
    the expired bubbles immediately instead of waiting for the next poll.
  - **Chat theme** - new [lib/chatTheme.js](frontend/src/lib/chatTheme.js),
    local-only like the avatar-color choice (never sent to the peer), a
    small real palette applied to that conversation's actual sent-message
    bubble color, not a decorative swatch picker with no effect.
  - **Tests**: a new automated suite,
    [_test_disappearing.py](backend/app/_test_disappearing.py) (6 tests: the
    setting is real and per-peer not global, the sweep actually deletes an
    expired message with no manual trigger, a message under the duration
    survives, a peer with no setting configured is completely unaffected,
    the live-update callback fires with the real peer_id/count, turning it
    off removes the setting rather than storing a null sentinel). Chat
    theme verified live: picked a real color in the running UI, confirmed
    via `getComputedStyle` that the actual sent-bubble background changed
    to the exact expected RGB value, not just that the picker recorded a
    choice.

- [x] **The top menu bar ("Agora File Conversation Network View Help") is
  now real** (fixed 2026-09-28). Every item below is either a new UI
  surface over an already-existing real action, or genuinely new-but-real
  work - no placeholder items, every disabled state carries a real reason.

  **Branding**: the literal "Agora" text label is now the real logo image
  (`frontend/public/logo.png`) instead - not a menu, just the brand mark.

  **File**: New Group... (opens the same real `ChatsListPanel.jsx` form,
  now controllable from outside via a lifted `creatingOverride` prop) ·
  Send File... (peer picker + the existing `api.sendFile()`, offline peers
  included since sending already queues the same way forwarding does) ·
  Open Received Files Folder (new `app:openDownloadsFolder` IPC,
  `shell.openPath` on the real downloads dir) · Import/Export Contacts...
  (new `GET /peers/known` + `POST /peers/known/import` routes and
  `list_known_peers()` in `storage.py`, read/write via new generic
  `file:saveText`/`file:readText` IPC) · Preferences... (opens Settings) ·
  Clear All History (loops `api.clearConversation()`) · Exit.

  **Conversation** (scoped to whichever chat is open): Search in
  Conversation... (real client-side filter over the loaded timeline, both
  1:1 and group) · Clear Chat History (moved here from the now-removed "⋯"
  button - **the "Delete Conversation" vs "Clear Conversation History"
  question from the plan resolved itself**: `GET /conversations` is already
  derived from the `messages` table's own most-recent-row-per-peer join, so
  clearing all messages already makes a peer vanish from the Chats list on
  its own - a second, separate "delete" action would have been identical to
  the first, so only one was built) · Export Conversation... (fetches the
  real current history directly rather than reading a child component's
  local state, formats as `.txt`, saved via `file:saveText`) · Mute
  Notifications for this Conversation (new [lib/mute.js](frontend/src/lib/mute.js),
  localStorage-backed like the avatar-color choice; **honestly scoped**:
  the only real OS notification anywhere in the app is for an incoming
  *call* (`useCall.js`), there's no message-notification system yet, so
  this only mutes call notifications from that peer today) · View Call
  History with this Peer (real dedicated `GET /calls/history/{peer_id}`
  endpoint, `CallsScreen.jsx` gained a `filterPeerId` prop and a real filter
  chip instead of client-side filtering the combined list) · Block Peer
  (at the time this menu was first built, disabled and linking to the
  queued **Block a peer** entry below - that entry is now built for real,
  see its own `- [x]` entry, and this menu item now performs the real
  block/unblock action).

  **Network**: Rescan for Peers (same real action + radar overlay already
  built) · My Device Info (real `GET /me` + avatar color) · Known Peers
  (new `list_known_peers()`/`GET /peers/known`, since `GET /conversations`
  only returns peers with real message history) · Change Display Name /
  Avatar (shortcuts into Settings) · Network Diagnostics... (real per-peer
  `source: "mdns"|"udp"` breakdown from `GET /peers`, deliberately doesn't
  fabricate a "why isn't X showing up" detection that doesn't exist).

  **View**: Nearby/Chats/Calls/Files with real Ctrl+1..4 keybindings ·
  Toggle Sidebar (real show/hide around `InfoSidebar.jsx`) · Zoom In/Out/
  Reset (real `webContents.setZoomLevel`, new IPC) · Always on Top (real
  `win.setAlwaysOnTop()`, new IPC).

  **Help**: About Agora (opens Settings; lands on the home view, not a
  scoped deep-link straight into the About sub-view, kept simple rather
  than adding controlled sub-view state for one menu shortcut) · View on
  GitHub / Report an Issue (real `shell.openExternal`, allow-listed to
  `github.com` URLs only, not a general-purpose external-link opener) ·
  Keyboard Shortcuts... (a real reference panel, built after the real View
  keybindings existed, not before) · Check for Updates... - **the internet-
  dependency tension flagged in the original plan was resolved by building
  it exactly as suggested there**: a manual, opt-in-only fetch to GitHub's
  real releases API, triggered only by clicking this menu item, never
  automatic or backgrounded - the modal itself states plainly that this is
  the only thing in Agora that ever touches the internet.

  **New shared components**: [DropdownMenu.jsx](frontend/src/components/DropdownMenu.jsx)
  (the generic menu shell, closes on outside-click or a real Escape
  keydown) and [TitleBarModals.jsx](frontend/src/components/TitleBarModals.jsx)
  (Send File/Contacts/Device Info/Known Peers/Diagnostics/Shortcuts, all
  sharing one `ModalOverlay` shell).

  **Tests performed**: full backend suite (8 files) re-verified green after
  the `storage.py`/`api.py` additions. Live end-to-end UI tests via headless
  Chrome (real backend processes, real clicks) covering: the logo replacing
  the text label; all 5 menus present; Conversation menu correctly disabled
  with no chat open and enabled once one is; Search in Conversation actually
  filtering the real rendered timeline (not just opening an inert input);
  Mute toggling a real, localStorage-persisted checkmark; My Device Info and
  Network Diagnostics showing real peer_id/discovery-source data; Toggle
  Sidebar actually hiding/showing the real sidebar; About Agora navigating
  to the real Settings screen; File menu's New Group opening the real
  creation form. Two test-script bugs were found and fixed along the way,
  both real traps worth remembering: (1) `element.click()` in a test never
  fires the `mousedown` event `DropdownMenu`'s outside-click-to-close
  listens for, so a menu "closed" that way was actually still open,
  corrupting later toggle-based open/close checks - fixed by dispatching a
  real Escape keydown via CDP instead; (2) setting a React-controlled
  input's value via the native property setter didn't trigger its
  `onChange` here, unlike some other React setups - fixed by using CDP's
  real `Input.insertText` after focusing the field, which fires genuine
  browser input events. Electron-only pieces (zoom, always-on-top, open
  downloads folder, the native Send File dialog) were not live-tested
  through headless Chrome, since browser dev mode has no `window.electronAPI`
  at all - each correctly shows disabled with an honest reason there instead.

- [x] **"Choose photo…" in onboarding now has a real feature behind it**
  (fixed 2026-09-27). Deliberately scoped down to self-view-only, same as
  the existing avatar-color choice: picking a photo never travels to other
  peers, they still only ever see your name plus a color they derive
  themselves from your peer_id, exactly as before. Building an actual
  synced-photo system (sending the image to peers, a wire message, a size
  cap, a propagation story for later changes) was discussed and explicitly
  deferred as a separate, much bigger decision, not bundled into this fix.
  - **Picker**: reuses the exact same `window.electronAPI.pickFile(category)`
    dialog chat attachments already use, with a new `photo` filter category
    in [main.cjs](frontend/electron/main.cjs)'s `FILE_PICKER_FILTERS` -
    narrower than the existing `media` category (no video extensions),
    restricted to exactly what can be encoded as a data: URI for display.
  - **Storage**: a real file copied into Electron's `userData` directory
    (`avatarFile` tracked in the same `identity.json` that already persists
    peer_id/name), not a data: URI stuffed into `localStorage` - a real
    photo can easily exceed localStorage's ~5-10MB per-origin quota, a file
    on disk has no such ceiling. Three new IPC handlers
    (`profile:getAvatarPhoto`/`setAvatarPhoto`/`clearAvatarPhoto`) reuse the
    same capped-at-15MB read-and-encode helper the existing chat image
    preview already used (refactored out as `readImageAsDataUrl`), and
    switching photos cleans up the old file so stale ones don't pile up.
  - **UI**: a new [useSelfAvatarPhoto.js](frontend/src/hooks/useSelfAvatarPhoto.js)
    hook shared by `Onboarding.jsx`, `IconRail.jsx`, and `SettingsScreen.jsx`
    so all three agree on the current photo without duplicating the IPC
    round-trip. `SettingsScreen.jsx` also gained Choose/Change/Remove
    buttons on the profile card, since onboarding only ever runs once - a
    user needs somewhere to add or change a photo afterward too, not just
    at first run. Correctly `disabled` with "Only available in the desktop
    app" when `window.electronAPI` isn't present (plain browser dev mode),
    same honest-disable pattern as every other Electron-only affordance in
    this app.
  - **Tests**: this logic only runs in Electron's main process and can't be
    driven by headless-Chrome UI automation, and `dialog.showOpenDialog` is
    a native OS dialog that can't be scripted at all - same limitation
    already documented for the image-preview feature. Verified the same
    way that was: a real-Node test (no mocks) against real files, covering
    the exact copy/encode logic - valid image round-trips to the identical
    data: URI, switching extensions deletes the stale old file, an
    oversized file is rejected *before* being copied (not just at read
    time), a non-image extension is rejected, and clearing removes the file
    from disk. Separately confirmed via headless Chrome (browser dev mode,
    no Electron) that Onboarding, the main app shell, and Settings all
    render with zero console errors or exceptions when `window.electronAPI`
    is absent, and that the picker button correctly shows disabled with the
    right tooltip in that case rather than silently doing nothing.
  - **Known gap**: no live Electron click-through of the actual file-picker
    dialog itself (not automatable - it's a native OS dialog), so the exact
    moment of picking a real file through the real dialog has not been
    exercised end-to-end, only the logic on both sides of it.

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
only hit was an unrelated file-transfer cleanup test. All six items below
(four delete variants, two forward variants) are now fixed. Difficulty as
compared before building:

| Feature | Difficulty | Status |
|---|---|---|
| Delete for me (single message) | Easy | Fixed |
| Clear a whole conversation's history | Easy-Moderate | Fixed |
| Clear call history entries | Easy-Moderate | Fixed |
| Delete for everyone (single message) | Hard | Fixed |
| Forward a text message | Easy | Fixed (2026-09-27) |
| Forward a file | Moderate | Fixed (2026-09-27) |

- [x] **Forward a text message and forward a received file** (2026-09-27).
  Both reuse a single new shared component,
  [ForwardMenu](frontend/src/components/ConversationPane.jsx) (in
  `ConversationPane.jsx`, used by both `MessageBubble` and `FileBubble`): a
  small ↪ icon opens a popover listing everyone else currently discoverable
  (`usePeers()`, called directly inside `ConversationPane` since it's a
  self-contained hook, no new prop-threading through `App.jsx` needed),
  excluding the current conversation's own peer. Picking someone just calls
  the existing `api.sendMessage()` (for a message, any direction, text
  forwarding isn't sender-only the way delete-for-everyone is) or
  `api.sendFile()` (for a file) against that target, no new backend routes
  at all, this is pure reuse of paths that already existed and were already
  tested.
  - **File forwarding is deliberately scoped to received, completed files
    only.** A file you sent has no real local path recorded anywhere the
    frontend can see, confirmed by reading `filetransfer.py`:
    `saved_path` is only ever set on the *receiving* side
    (`update_file_status(..., saved_path=...)`), a sent file's original
    path only ever lives in the backend's in-memory `_outgoing_paths`
    (same limitation the earlier file-retry fix already ran into).
  - **A currently-offline peer wasn't offered in the picker at all**
    (reversed 2026-09-28, see the entry below the icon/context-menu one -
    this restriction turned out to be inconsistent with how the rest of the
    app already works and was removed).
  - **Verified live, message forwarding through the real UI**: three real
    backend instances (Alice/Bob/Carol) driven through three real headless
    Chrome windows via the DevTools Protocol, same technique as the
    delete-for-everyone test. Alice sent Bob a real message, Bob clicked
    the real ↪ icon and picked Carol from the real forward menu, and
    Carol's real chat with Bob showed the forwarded text, confirmed both in
    the DOM and by reading Carol's SQLite file directly afterward. Passed
    on the first real attempt (the delete-for-everyone test's earlier
    lessons, fresh databases per run, scope the click to the exact right
    message, carried straight over).
  - File forwarding was verified by build/lint only (clean, no new
    warnings) and by code-path reuse (`api.sendFile` is the exact same call
    the composer's own attach-file flow already exercises and already had
    real two-device testing), not by a separate live three-peer
    file-transfer click-through, a smaller but real gap in this round's
    verification, worth a dedicated pass if this area gets touched again.
  - **Superseded 2026-09-27, see the entry right below**: the small
    persistent 🗑/↪ icon buttons this originally shipped with turned out to
    render as near-invisible marks on a real machine (an emoji-font
    fallback problem, not something the app controls), and were replaced
    entirely by a right-click context menu.

- [x] **Real bug found live: the delete/forward icons (🗑/↪) rendered as
  near-invisible marks on a real machine** (found and fixed 2026-09-27, via
  a user screenshot showing a barely-visible dot where the icons should be).
  Root cause: those were plain emoji characters, and emoji rendering
  depends entirely on the OS having a working color-emoji font Chromium can
  fall back to - not guaranteed on every Windows install, and on at least
  one real machine it silently degraded to a tiny fallback glyph instead of
  a visible icon, with no error anywhere to signal it. Fixed by replacing
  both with plain inline SVGs (`TrashIcon`/`ForwardIcon` in
  [BubbleContextMenu.jsx](frontend/src/components/BubbleContextMenu.jsx)),
  which render identically regardless of installed system fonts - the same
  approach `IconRail.jsx`'s own nav icons and `PeerList.jsx`'s Rescan
  spinner already used, just not yet applied here.

  **While fixing this, also rebuilt the interaction model per direct user
  request**: instead of two small persistent hover icons next to every
  bubble, right-clicking a message (or an eligible file) now opens one
  combined context menu with delete and forward together - closer to how
  desktop chat apps typically handle this, and naturally immune to the
  icon-visibility problem above since there's no persistent icon to render
  at all. `ForwardMenu.jsx` (the old shared component) is now fully dead
  code and was deleted outright rather than left unused; the new
  [BubbleContextMenu.jsx](frontend/src/components/BubbleContextMenu.jsx)
  and its `useContextMenu()` hook are shared by `ConversationPane.jsx` and
  `GroupConversationPane.jsx` alike, positioned at the real click
  coordinates and clamped so it can't render off-screen near a window edge,
  closes on outside-click or Escape.
  - **Tests performed**: two new live end-to-end runs (three real backend
    processes each, headless Chrome driving the real UI via the DevTools
    Protocol, real `Input.dispatchMouseEvent` right-clicks, not synthetic
    JS events) - one for 1:1 chat, one for group chat. Both confirmed: a
    sent message's menu shows Delete for me + Delete for everyone + forward
    targets (correctly excluding the peer/group you're already in); a
    received message's menu correctly omits Delete for everyone; clicking
    outside closes the menu; clicking a forward target actually delivers
    the message to that peer's real backend over the real wire; clicking
    Delete for everyone on a group message actually removed it from
    another real member's real database. Both runs needed one fix along
    the way that turned out to be a test-script bug, not an app bug (a
    stale CORS-blocked origin in one run, a selector matching the sidebar's
    own message preview text ahead of the real bubble in the other) - kept
    here since it's a real trap worth remembering if this area gets tested
    again: prefer scoping right-click targets to elements carrying the
    `title="Right-click for delete/forward"` marker, not just matching text
    content anywhere on the page.
  - Full backend suite and frontend production build both re-verified
    clean after these changes (backend itself wasn't touched at all here).

- [x] **Forward should work regardless of whether the target is currently
  online** (fixed 2026-09-28, found from a screenshot showing an offline
  conversation's forward list saying "No one else on this network right
  now"). The original restriction (forward candidates limited to
  `usePeers()`'s live list only) was inconsistent with how the rest of the
  app already behaves: the plain composer has never gated sending on
  whether the recipient is online, `messaging.py`'s `_flush_pending_loop`
  already queues and auto-delivers to anyone offline, and forwarding was
  always just a call to that same `api.sendMessage()`/`api.sendFile()`. So
  the "no visible confirmation it queued" concern that justified excluding
  offline peers applied equally to a normal send, which was never treated
  as a problem there - there was no real reason forward should be more
  cautious than the composer it's built on top of.

  Fixed in both `ConversationPane.jsx` and `GroupConversationPane.jsx`: the
  forward candidate list now merges `usePeers()`'s live list with
  `useConversations()`'s persisted history (anyone with a `known_peers` row,
  online or not), deduped by `peer_id`, live entries winning on name since
  they're the freshest source. `GroupConversationPane.jsx` needed a new
  `conversations` prop threaded down from `App.jsx` (which already computes
  it for `ChatsListPanel`/the offline-peer fallback) rather than a second
  independent fetch. `BubbleContextMenu.jsx`'s empty-state text changed from
  "No one else on this network right now" to "Nobody else to forward to
  yet", since the old wording became actively wrong once offline contacts
  are listed.

  **Verified live end-to-end** (three real backend processes): established
  real conversation history between Alice and Bob, then killed Bob's
  process entirely and waited for discovery's TTL to actually expire him
  from Alice's live peer list (not just assumed) - confirmed via `GET
  /peers` that Bob was genuinely gone. Opened a different, still-online
  conversation in the real UI, right-clicked a message, and confirmed
  Bob still appeared as a real forward target despite being offline.
  Clicked to forward to him: confirmed via `GET /messages/{bob}` that the
  message landed with `status: "pending"` (queued, not lost). Restarted
  Bob's real backend and confirmed, via both Alice's and Bob's own
  databases, that the message flipped to `status: "delivered"` and
  genuinely arrived in Bob's real history within a few seconds of him
  reconnecting - the same flush-loop guarantee 1:1 chat already relies on,
  now proven to cover a forward too, not just a normal send.

## Images should render like WhatsApp, not as a generic file icon (2026-09-26)

- [x] **No inline image preview or tap-to-view in chat** (fixed
  2026-09-27). Built as planned: `frontend/src/lib/fileTypes.js` detects
  image extensions (png/jpg/jpeg/gif/webp/bmp), a new
  [ImagePreview.jsx](frontend/src/components/ImagePreview.jsx) renders the
  actual photo inline plus a full-screen tap-to-view lightbox (Escape or
  click-outside to close). For loading the local file into `<img>`, used a
  **data: URI over IPC instead of the originally-planned custom
  `agora-file://` protocol**: `main.cjs`'s new `file:readImageDataUrl`
  handler reads the file, caps it at 15MB (so a huge image isn't read into
  memory just for a thumbnail, "Open"/"Save a copy…" still work normally
  regardless of the cap), and returns a `data:` URI, simpler and safer than
  a registered protocol (no path-traversal-prone handler needed), and
  Chromium's default `webSecurity` (never disabled in this app) blocks a
  plain `file://` src anyway. Falls back to the original extension-badge
  icon, not a blank gap, if there's no Electron (browser dev mode) or the
  read genuinely fails. **Real, known limitation**: only works for
  *received* images, same reason `FileOpenActions`/file-forwarding are also
  received-only, `saved_path` is never recorded for anything you sent (see
  `filetransfer.py`). Verified: the exact read/encode/size-cap logic tested
  directly in real Node against real files (round-trip byte match,
  uppercase extension, non-image rejection, oversized rejection, missing
  file), since this piece only runs in Electron's main process and can't be
  exercised through headless-Chrome UI automation the way the rest of this
  session was tested.

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

- [x] **Files have no equivalent auto-retry on reconnect** (fixed
  2026-09-27). `FileTransferService` gained the exact `start()`/`stop()`/
  `_flush_pending_loop()` shape planned here: every 2s, checks every
  outgoing transfer this process still remembers a path for
  (`_outgoing_paths`), and calls `resend()` on any still at
  `status: "failed"` whose peer is now visible to discovery again.
  Deliberately scoped to `"failed"` only, not `"offered"` (the status a
  mid-stream drop resets to), since `"offered"` is ambiguous with a
  transfer still legitimately awaiting its first accept/decline response,
  resend()-ing one of those would stomp on a real in-flight offer. Same
  existing limitation as the manual button: only works while this same
  backend process is still the one that originally sent it. No
  backoff/limit added, same open question as before, not hit in practice
  yet. Verified with a new automated test,
  [_test_file_auto_retry.py](backend/app/_test_file_auto_retry.py) (send
  fails while the peer's messaging service isn't running, confirmed
  `status: "failed"`, peer "reconnects", confirmed the transfer completes
  automatically with byte-identical content and no manual `resend()` call
  ever made) - all pre-existing backend tests re-verified green after this
  change too.

## Known security gaps (documented since Step 7 - all fixed as of 2026-10-01)

- [x] **Transport encryption and cryptographic peer identity** (fixed
  2026-09-30, real design work: new `crypto_identity.py`). Built exactly
  the SSH/Signal-style approach this entry originally scoped, since there's
  no central server here to issue TLS certificates from:
  1. Each device generates its own X25519 keypair on first run
     (`storage.get_or_create_device_keys`, a new `device_identity` table),
     kept local forever, completely separate from `identity.json`'s
     peer_id.
  2. Public keys are broadcast openly alongside peer_id/device_name over
     the *existing* discovery channel (mDNS TXT records + UDP broadcast
     payload) rather than adding a new handshake round-trip - both sides
     already learn each other's public key the same way they already learn
     each other's name.
  3. Any two peers derive the identical underlying secret independently via
     X25519 + HKDF-SHA256, then split it into two distinct **directional**
     keys (`messaging.get_send_key`/`get_recv_key`, backed by
     `crypto_identity.derive_directional_keys`) - not one shared key reused
     both ways, see the adversarial-testing addendum below for exactly why
     that distinction is load-bearing, not cosmetic. Every real frame after
     "hello" (chat, ack, and every control-channel message file
     transfer/calling/groups/deletion already send via `send_control`) is
     encrypted with ChaCha20-Poly1305 - authenticated, not just
     confidential, so a tampered frame is detected and dropped, not
     silently accepted. "hello" itself stays plaintext (it carries no
     secret - just an identity announcement already broadcast openly by
     discovery anyway).
  4. Trust-on-first-use, exactly as scoped: `known_peers` gained a
     `public_key` column, and `check_and_remember_peer_key` records a
     peer's key the first time it's seen. A *different* key for an
     already-known peer_id fires a real `peer_identity_changed` event,
     surfaced as a dismissible app-wide banner
     (`IdentityWarningBanner.jsx`) rather than silently trusted or
     silently blocked - the app doesn't decide for you whether it's a
     genuine reinstall or someone else claiming that identity.
  5. The file-transfer TCP data channel (a separate raw socket from the
     messaging WebSocket) got the same treatment separately, exactly as
     scoped: each chunk is encrypted with the same per-peer shared key,
     length-prefixed so the receiver can read exact encrypted blobs. This
     also closes a real pre-existing gap beyond confidentiality: that
     socket had no identity check of its own (whoever connected to the
     ephemeral listener port got to stream bytes in), so the AEAD auth tag
     is what actually stops a third party from injecting bytes into
     someone else's transfer.

  README's Security posture section is updated to reflect this is real
  and verified, not just planned.

  **Tests**: a new automated suite,
  [_test_encryption.py](backend/app/_test_encryption.py) (5 tests, real
  localhost sockets): messages round-trip correctly through the encrypted
  channel; the *actual bytes* handed to the socket (captured directly, not
  assumed) do not contain the plaintext body; a deliberately tampered
  frame is dropped rather than accepted, and the connection survives it
  (a normal message right after still goes through); a real key change for
  an already-known peer_id fires the identity-changed warning with the
  correct peer_id/name; the file-transfer TCP channel is also genuinely
  encrypted (captured chunks don't contain the plaintext file content) and
  the received file is still byte-identical to the original. Every
  existing suite (10 files) re-verified green with encryption now
  mandatory - required updating every test's `PeerDiscovery` construction
  to supply a real public key, since a peer with no resolvable key is
  correctly treated as unreachable rather than falling back to plaintext.
  A real, subtle bug was found and fixed along the way while writing the
  tamper-detection test: a pre-existing benign race between `send()` and
  the background pending-message flush loop (a message can get a harmless
  redundant resend if a flush tick lands in the brief window before status
  flips from "pending" to "sent") was masking the deliberately-corrupted
  frame with a second, genuinely valid delivery - not a security bug
  (duplicates are idempotent by msg_id), but real enough to document
  directly in `messaging.py`. Also verified live against two actual
  separate backend processes (not the same-process test suite): real
  mutual discovery exchanging real distinct public keys, a real message
  round trip, and a real file transfer (offer -> accept -> encrypted
  chunked stream -> byte-identical received file) end to end.

  **Addendum, 2026-09-30 (later the same day): a genuine network-level
  wiretap test, plus real adversarial security testing.** Requested
  explicitly as a much deeper pass than the above - "test it in very
  detail," then a direct request to attack it "like a hacker" with at
  least 5 different strategies. Two real, previously-unknown
  vulnerabilities were found and fixed as a direct result. This was not a
  rubber-stamp - the testing itself surfaced genuine problems that the
  functional test suite above had no way to catch, because it never tried
  to actually attack anything.

  **[_test_wiretap.py](backend/app/_test_wiretap.py)**: a real network-level
  wiretap, not another same-process capture. Bob's real WebSocket server
  binds to an internal port nothing outside the test ever learns; the
  address bob *advertises* via discovery is a small, separate raw TCP
  relay that just forwards bytes in both directions while keeping a copy
  of every one - alice genuinely dials the relay believing it's bob,
  exactly the vantage point a real network sniffer would have. Two wire-
  level subtleties had to be worked through to make this rigorous rather
  than misleading: WebSocket mandatorily masks every client-to-server
  frame's payload with a per-frame XOR key (RFC 6455, not encryption - a
  cache-poisoning defense), so literal wire bytes never match plaintext
  even for a genuinely unencrypted frame; and the `websockets` library
  negotiates permessage-deflate compression by default, so even unmasked
  bytes are raw-deflate, not literal text. The test reassembles the real
  TCP stream, parses actual WebSocket frames back out and unmasks them,
  and disables compression on its own connections only (production code
  untouched) to isolate the wire-level transform that actually matters
  here. A positive control (confirming "hello"'s plaintext peer_id really
  is recoverable this way) is checked alongside the real assertions, so
  the test can't trivially pass by accident. Confirms: a real chat body, a
  real SDP call-signaling marker, and a real file offer's filename never
  appear anywhere in what a genuine wire observer could recover.

  **[_test_adversarial.py](backend/app/_test_adversarial.py)**: five actual
  attacks, not five more happy-path checks:
  1. **Reflection (CONFIRMED VULNERABLE, then FIXED)** - the original
     design used ONE shared key for both directions of a conversation.
     Proven exploitable directly: a ciphertext alice legitimately sent to
     bob, captured and replayed back at alice's own connection with bob's
     peer_id, decrypted successfully and was stored as if bob had sent it.
     Fixed with `crypto_identity.derive_directional_keys` - the same raw
     X25519 secret is now split via HKDF into two distinct, labelled
     sub-keys (`"A->B"` and `"B->A"`), so a blob valid in one direction can
     never be mistaken for the other, even between the exact same two
     devices. `messaging.py` now caches and exposes `get_send_key`/
     `get_recv_key` per peer instead of one `get_shared_key`; every send
     site and every decrypt site was updated to use the correct one, and
     `filetransfer.py`'s sender/receiver paths were updated the same way.
     Re-verified fixed both at the crypto-primitive level and end-to-end
     (a real replay attempt against a real running connection is now
     correctly rejected).
  2. **Replay (same direction)** - the exact same captured ciphertext
     resent to its real, intended recipient 5 times in a row. Harmless in
     practice: every message type in this app is already idempotent by
     its own id (`msg_id`-keyed `INSERT OR REPLACE`), so a duplicate just
     overwrites itself with identical content. Documented as a real,
     residual limitation rather than silently declared "fine": there is no
     general anti-replay mechanism (no sequence numbers, no nonce ledger,
     no session freshness binding) - it's incidental good luck that every
     message type so far happens to be idempotent, not a designed
     guarantee, and a future message type that ISN'T naturally idempotent
     would reopen this. Not fixed now (a real sequence-number/session
     scheme is a bigger design change than this pass's scope); flagged
     here so it isn't forgotten.
  3. **Discovery spoofing (CONFIRMED EXPLOITABLE - pre-existing, not new)**
     - a single raw UDP socket, with no relationship to this app's own
     code at all, broadcasting a forged packet claiming an existing
     peer_id with an attacker-controlled public key. A one-shot version
     didn't stick (the real device's own periodic re-announce won the
     race), but a sustained flood (every 50ms, versus the real device's 3s
     announce interval) reliably and repeatedly won the registry. This is
     the exact gap this section's own "No cryptographic peer identity"
     entry already named before any of this session's work started -
     encryption doesn't close it, it just changes what "wins" the
     exploit: a device that's never talked to a peer_id before will happily
     encrypt everything to whichever key most recently claimed that
     peer_id in an unauthenticated broadcast. Not fixed here (would need
     signed discovery broadcasts, itself signed by the same long-term
     keypair - a real, larger follow-up, not a quick patch); the
     README's Security posture section is updated to state this
     explicitly rather than let "peer-to-peer traffic is end-to-end
     encrypted" read as a stronger guarantee than it actually is on a
     hostile network.
  4. **Malformed-frame DoS (no vulnerability found)** - empty frames, 1
     random byte, 11 bytes (shorter than the nonce), exactly 12 bytes
     (nonce with zero ciphertext), 64KB of garbage, and a well-formed-
     looking-but-wrong nonce+tag, all sent at the real messaging server.
     It survived every one and kept accepting real connections afterward -
     confirms the existing `try/except DecryptionError: continue` +
     length-check defensive coding in `_handle_inbound` actually holds up
     under deliberate abuse, not just well-formed input.
  5. **File-transfer length-prefix DoS (CONFIRMED VULNERABLE, then FIXED)**
     - the receiver reads a 4-byte length prefix, then
     `reader.readexactly(that_many_bytes)`, with the length entirely
     trusted from whoever is connected. Proven exploitable directly: a
     connection claiming a chunk length of ~4GB, followed by 500 real
     bytes and then permanent silence, left the receive task blocked in
     `readexactly()` indefinitely - no timeout anywhere in that path, so
     the task, its open socket, and the transfer's listener all stayed
     alive forever. Fixed in `filetransfer.py` with
     `MAX_ENCRYPTED_CHUNK_LEN` (rejects any claimed length bigger than a
     real chunk could ever legitimately be) and
     `CHUNK_READ_TIMEOUT_SECONDS` (a generous 60s per read, the same
     "safety net, not a UX countdown" philosophy as the existing
     offer-response timeout). Fixing this surfaced a **second**, unrelated
     real bug: aborting from inside the `with open(part_path, ...) as f:`
     block and calling `part_path.unlink()` while `f` was still open threw
     `PermissionError` on Windows (POSIX allows deleting an open file;
     Windows does not) - this exact pattern already existed in the
     hash-mismatch/decrypt-failure abort path too, introduced earlier the
     same day and never exercised by a real Windows failure until this
     test hit it. Fixed by restructuring `_receive` to set a flag and
     `break` instead of returning from inside the `with` block, doing the
     unlink only after the file handle is genuinely closed. Re-verified: the
     hang is gone (rejected in ~0.2s), the task raises no exception, the
     transfer is correctly marked `failed`, and the partial file is
     actually cleaned up from disk.

  All 13 backend test suites (the original 10, plus `_test_encryption.py`,
  `_test_wiretap.py`, and `_test_adversarial.py`) re-verified green after
  both fixes, run together, multiple times, to rule out flakiness in the
  new adversarial/wiretap tests themselves.

- [x] **Discovery broadcasts aren't signed - a peer_id's public key could be
  hijacked via forged UDP packets** (found 2026-09-30, fixed 2026-10-01).
  Found and confirmed exploitable via `_test_adversarial.py`'s Attack 3
  while adversarially testing the transport-encryption work above (not a
  new regression from it - the underlying gap was exactly this section's
  original "No cryptographic peer identity" entry, just now demonstrated
  concretely rather than only described). A raw UDP socket with no
  relationship to this app's own code could broadcast
  `{"peer_id": "<any existing peer_id>", "public_key": "<attacker's own
  key>", ...}`, and `PeerRegistry.upsert` accepted it with zero
  verification - last-packet-seen-wins, no signature, no consistency check
  against mDNS. A one-shot forged packet lost the race to the real
  device's own periodic re-announce, but a sustained flood (every ~50ms,
  versus the real device's 3-second interval) reliably and repeatedly won.
  Trust-on-first-use (already built) didn't close this: it protects a
  peer_id you've *already* established a key for from silently changing
  later, but did nothing for the very first sighting.

  **Fixed with signed discovery broadcasts.** A second, separate Ed25519
  signing keypair per device (`crypto_identity.generate_signing_keypair` -
  deliberately never the same key as the X25519 encryption keypair, mixing
  DH and signing key purposes is a real crypto engineering anti-pattern
  regardless of whether a concrete attack exploits it), generated once and
  persisted in the same `device_identity` table (backfilled in place for
  any device that already had an X25519 row from before this existed).
  Every mDNS TXT record and UDP broadcast payload now carries
  `signing_public_key` + a real Ed25519 `signature`
  (`crypto_identity.sign_announcement`) over the announcement's real
  security-relevant fields (peer_id, address, port, encryption public_key
  - deliberately NOT device_name, which is cosmetic and can legitimately
  change). A receiver (`discovery.py`'s `_MdnsListener._handle` and
  `_udp_listen_loop`) now verifies that signature and checks it against
  `storage.check_and_pin_signing_key` - a new synchronous method (matching
  `get_or_create_device_keys`'s existing sync pattern, since discovery
  callbacks run on zeroconf's own thread and the UDP listener thread, not
  the asyncio loop) that pins a peer_id's signing key the first time it's
  seen and rejects any later announcement claiming that peer_id with a
  *different* key - all of this **before** an announcement is ever allowed
  to reach the live `PeerRegistry`, not lazily afterward the way the
  encryption-key trust-on-first-use check in messaging.py works. An
  unsigned announcement, an invalidly-signed one, or a validly-self-signed
  one from a key never pinned to that peer_id before are all dropped
  outright. This still doesn't (and structurally can't) protect the very
  first time a peer_id is ever seen - the same boundary any
  trust-on-first-use scheme has, SSH included - but it closes the window
  where an *already-established* peer_id's traffic could be silently
  redirected mid-relationship.

  **Tests**: `_test_adversarial.py`'s Attack 3 was rewritten (not just
  re-verified) to attack the *fixed* system - a completely unsigned
  forgery, and the exact previously-successful attack technique using a
  freshly-generated attacker signing keypair to self-sign a forged
  announcement, both confirmed rejected; the real victim's genuine entry
  confirmed unaffected by either attempt. All 13 backend suites (including
  every test file's `PeerDiscovery` construction, which now needs real
  signing keys the same way it needed a real encryption public key before)
  re-verified green. Also verified live against two real separate backend
  processes: real mutual discovery with real signed announcements, a real
  message round trip, and then a genuine external Python process (no
  relationship to the test harness) firing the exact same sustained
  forged-UDP-flood attack at the live processes over real sockets -
  confirmed alice's real backend kept bob's real address/key throughout,
  completely unaffected. README's Security posture section is updated to
  drop the "not yet independently verifiable" caveat this entry used to
  justify.

  **Addendum, 2026-10-01: stress-testing the signed-discovery fix itself
  found two more real bugs, both fixed.** Requested explicitly ("find more
  errors and fix them... stress test them"), aimed specifically at the
  newest code from the addendum above, on the theory that a brand-new fix
  is exactly where a brand-new bug is most likely to be hiding. It was:

  1. **A TOCTOU race in `check_and_pin_signing_key` itself - confirmed,
     then fixed.** The method's original shape was a plain SELECT (is a
     key already pinned?) followed by a separate INSERT if not - correct
     for one caller at a time, but discovery.py's real callers are two
     genuinely independent OS threads (the mDNS listener thread and the
     UDP listener thread), and a brand-new peer_id's mDNS and UDP
     announcements can arrive within microseconds of each other. Proven
     exploitable directly: two real threads racing to pin the same
     never-before-seen peer_id with two *different* keys, both read
     "nothing pinned yet" before either commit, and **both** returned
     `True` - the exact TOCTOU pattern that could let a precisely-timed
     forged announcement win equal footing with a real one on a first
     sighting, undermining the guarantee the whole fix above exists to
     provide. Fixed by wrapping the check and the write in one atomic
     `BEGIN IMMEDIATE` transaction with a `busy_timeout` - a second
     thread's own transaction now blocks until the first one fully
     commits, instead of racing it. Re-tested: 20/20 concurrent trials
     with the fix landed exactly one winner, zero with both.
  2. **Unbounded `known_peers` growth, made cheaper by the fix above -
     confirmed, then fixed.** Trust-on-first-use (both the older
     encryption-key path and the new signing-key one) permanently
     remembers every never-before-seen peer_id it's ever pinned, with no
     cap and no expiry. That was already true before this session, but
     reaching it used to require an attacker to complete a real WebSocket
     handshake per fake identity; the signed-discovery fix made the exact
     same permanent-insert path reachable with nothing more than one
     cheap, self-signed, one-way UDP packet per fake peer_id - no
     connection needed at all. Measured directly: a local flood of 5,000
     distinct self-signed fake identities inserted all 5,000 rows with no
     pushback, extrapolating to roughly a quarter-million permanent rows
     an hour sustained. Fixed with a new `MAX_KNOWN_PEERS` cap (10,000 -
     generous for what this app actually is, a LAN chat app, not a
     service with a real user base in the millions) and oldest-
     `last_seen`-evicted-first eviction, applied to every first-sighting
     insert path into that table: `check_and_pin_signing_key`,
     `check_and_remember_peer_key`, and `save_known_peer` (the
     contacts-import path, lower severity since it's local-API-only, but
     fixed for consistency). Re-tested: a 200-identity flood against a
     (deliberately lowered for a fast test) cap of 50 landed exactly 50
     rows, the oldest entries gone, the newest kept.

  **Also stress-tested, no bug found, kept as regression coverage:**
  high-volume message throughput (500 real encrypted messages sent as
  fast as possible - all 500 arrived, no loss, no duplication, no
  corruption) and a 10-peer full-mesh discovery+messaging scenario (all
  10 peers discovered all 9 others and successfully exchanged real
  encrypted messages both ways with every other peer, 90 messages total,
  correctly delivered).

  **A real, separate performance characteristic was found and understood,
  though it turned out not to be about disk I/O at all.** The 500-message
  throughput test above completed at roughly 20 messages/second - slower
  than expected for encryption this cheap (measured independently at
  under 0.01ms per operation) on a purely local connection. Profiling
  traced almost all of the real time to two separate SQLite round trips
  per message (`save_message`, then later `update_status`), each around
  20ms. Enabling WAL mode (`journal_mode=WAL` + `synchronous=NORMAL`,
  SQLite's own recommended pairing - still fully crash-safe, the only
  trade-off is a vanishingly small durability window on true power loss)
  was the obvious first fix to try, and is now in place project-wide via
  a single shared `_connect()` helper every method routes through - but
  it turned out **not** to be the actual bottleneck: a controlled
  before/after comparison showed no meaningful throughput change from WAL
  mode alone. Isolating further, raw synchronous SQLite (no `asyncio` at
  all) completed the identical fresh-connection-per-call pattern in
  ~7ms, while the real `asyncio.to_thread`-wrapped call measured ~20ms -
  the gap is `asyncio.to_thread`'s own thread-pool dispatch overhead, not
  disk I/O, not SQLite, and not this app's own crypto. Kept the WAL
  change anyway (a real, valid improvement for read/write concurrency
  safety, independent of this specific number), but did **not** further
  chase the `asyncio.to_thread` overhead itself - reducing it would mean
  a real architectural change (e.g. a persistent connection / an async
  SQLite driver), a bigger undertaking than this pass's scope, and not
  something real human usage (a person sending messages one at a time,
  not benchmarking) is likely to ever notice. Documented here rather than
  quietly dropped, since "investigated a real report, found the true
  cause, decided not to chase it further" is a different (and more
  honest) outcome than either "fixed" or "ignored."

  A 10-peer mDNS+UDP discovery convergence time was also measured (2
  peers: 4.7s, 5 peers: 9.8s, 10 peers: 18.4s - roughly linear, ~1.9s per
  additional peer) while building the mesh test above. Noted rather than
  chased further: all instances shared one machine/one process/one
  network stack for this test, which is not how real deployment works
  (each peer is a separate physical device), so this number may be an
  artifact of that test's own setup rather than a real per-device
  discovery cost - confirming which would need actual separate hardware,
  not something to guess at from a single-machine test.

  **Tests**: a new permanent suite,
  [_test_stress.py](backend/app/_test_stress.py) (4 tests): the signing-
  key pin race, run 10 concurrent trials, asserts exactly one winner every
  time; the known_peers cap, flooded with 200 identities against a small
  test cap, asserts the table stays bounded with the right entries
  evicted; a 100-message throughput regression check (smaller than the
  500-message exploratory run, kept fast for routine runs); a 5-peer mesh
  discovery+delivery regression check (smaller than the 10-peer
  exploratory run, same reasoning). All 14 backend suites (the previous
  13 plus this new one) re-verified green together, and `_test_stress.py`
  run 3 times on its own to confirm the concurrency tests aren't flaky.

## Bigger features, explicitly out of scope until backend work happens

- [x] **Group chat / group calling, including file + image sharing inside a
  group** (fixed 2026-09-27). The full design conversation that led here is
  worth keeping: started from "just build it," worked through why a single
  relay device would get overloaded, worked through a distributed ring's
  real drawbacks (latency, one weak link dragging down everyone past it,
  quality loss per hop, fragile on departure), landed on a genuinely good
  hybrid idea (small mesh clusters linked by relay, boundary work itself
  split across members, not one device) - and then made the pragmatic call
  to **cap group calls at 4 people instead**, since that stays entirely
  within the mesh's real comfort zone with zero new relay engineering and
  zero new risk. The cluster/relay design is real and sound, just not
  needed yet at this scale; if group calls ever need to grow past 4, that
  conversation (mesh clusters + distributed boundary relaying, not a single
  overloaded relay) is the one to revisit, not a plain ring.

  **What's built, all with automated tests plus live real-UI verification
  (headless Chrome, real fake-camera WebRTC, 3 real backend processes):**
  - **Group creation and membership**: new `groups`/`group_members` tables,
    [groups.py](backend/app/groups.py)'s `GroupService.create_group()`
    sends a `group_invite` control message to each invited member over
    their existing 1:1 connection - no group has a single owner, every
    member independently ends up with an identical local copy of who's in
    it. Frontend: a real "New group" flow in
    [ChatsListPanel.jsx](frontend/src/components/ChatsListPanel.jsx) (name
    + pick from live peers), groups shown in their own section above 1:1
    conversations.
  - **Group text chat, no size limit**: `send_group_message()` fans the
    same message out to every other member individually, each stores their
    own copy. [GroupConversationPane.jsx](frontend/src/components/GroupConversationPane.jsx)
    is the chat view, reached by selecting a group instead of a person.
    Offline delivery, delete, and forward were added right after, see the
    entry below, this first version's offline-drop limitation no longer
    applies.
  - **Group calling, full mesh, capped at 4**: no group-aware code in
    `calling.py` at all - a group call is just several ordinary 1:1 calls
    happening at once, tagged with a shared `group_call_id`
    (`CallState`/`CallOfferBody` both gained this one optional field).
    Mesh formation avoids duplicate connections with a simple rule applied
    identically on every device: call every other member whose peer_id
    sorts after your own (same ordering idea `calling.py`'s own 1:1
    collision tie-break already used). New
    [useGroupCall.js](frontend/src/hooks/useGroupCall.js) computes each
    device's own slice of the mesh and manages N simultaneous
    RTCPeerConnections. `MAX_GROUP_CALL_MEMBERS = 4` is enforced **on the
    backend** (`start_group_call` raises `ValueError` over the cap), not
    only as a disabled button, so it can't be bypassed by calling the API
    directly.
  - **Real consent, not silent auto-join** (fixed 2026-09-27, was flagged
    right after the first version shipped). Whoever starts a call
    auto-joins (they already consented), everyone else gets the same
    ringtone a 1:1 call uses (`startRingtone`, now shared via
    [webrtc.js](frontend/src/lib/webrtc.js)) and a real floating Join/
    Decline prompt, matching `CallOverlay.jsx`'s own incoming-call design.
    Building this surfaced **three real bugs**, each caught by live
    testing and fixed in turn: (1) the initiator briefly saw a consent
    prompt for their own call, a genuine race where the WebSocket
    broadcast could reach them before their own HTTP response did - fixed
    by generating `group_call_id` client-side and recording consent before
    the request even goes out, not after; (2) a duplicate 1:1 popup showed
    on top of the real group prompt, because `useCall.js`'s 1:1 handler
    had no idea group calls existed - fixed with one check to ignore any
    incoming call carrying a `group_call_id`; (3) a caller was left stuck
    at "Connecting…" forever after the other person declined, because a
    straggler mesh leg can arrive *after* a decline was already clicked -
    fixed by remembering declined `group_call_id`s and auto-declining any
    later straggler instead of either re-prompting or leaving it hanging.
  - **Group file and image sharing**: "sending a file to a group" is
    exactly N independent, completely normal 1:1 transfers
    (`send_group_file()` calls the already-tested
    `FileTransferService.send_file()` once per other member, own
    transfer_id, own accept/decline, own resume-on-drop), just tagged with
    a `group_id` (new nullable column on `files`, added via a real `ALTER
    TABLE` migration, not just the static schema, see the note below on
    why that distinction mattered) so every member's own files table knows
    which group's timeline to show it in. The sender's own view collapses
    the N per-recipient rows into one bubble with an aggregate status
    ("sent to 2, 1 delivered"), rather than showing the same file N times.
    Reuses `SecurityGate`/`FileOpenActions`/`ImagePreview` entirely as-is,
    none of them were actually 1:1-specific.
  - **A real schema-migration bug found and fixed along the way**: adding
    `group_id TEXT` directly inside the `CREATE TABLE IF NOT EXISTS files`
    statement crashed the backend outright on any device with a pre-
    existing `agora.db` (confirmed against a real leftover local database,
    not hypothetically) - `CREATE TABLE IF NOT EXISTS` is a no-op against
    an already-existing table, so the new column silently never reached
    it, and the `CREATE INDEX` right after failed against the missing
    column. Fixed with a real `_migrate()` step using `PRAGMA table_info`
    + `ALTER TABLE ADD COLUMN`, idempotent, runs on every startup, verified
    against both a fresh database and the exact old one that first
    surfaced the bug.

  **Tests**: [backend/app/_test_groups.py](backend/app/_test_groups.py),
  5 automated tests (invite propagation, message fan-out, mesh-formation
  math, real 3-way mesh calling via `CallService`, the call cap, group file
  fan-out), all passing, plus every pre-existing backend suite re-verified
  green. Separately verified three full times through the real UI via
  headless Chrome: group chat end-to-end, a real 3-way **video** call
  reaching genuine `iceConnectionState: "connected"` on every leg with real
  senders/receivers (confirmed via a small permanent debug hook,
  `window.__agoraGroupCallDebug()`, left in `useGroupCall.js`), and group
  image sharing with both recipients independently completing.
- [x] **Group messages get offline delivery, delete, and forward** (fixed
  2026-09-27, the two real gaps left over from the entry above). Both reuse
  patterns already proven for 1:1 chat rather than inventing anything new:
  - **Offline delivery**: `send_group_message()` now checks whether each
    fan-out actually reached its recipient; an unreachable member's copy is
    queued in a new `pending_group_messages` table (keyed by
    `(msg_id, peer_id)`, since one message can be pending for several
    different offline members at once) instead of silently dropped.
    `GroupService` gained its own `start()`/`stop()`/`_flush_pending_loop()`,
    the exact same shape as `messaging.py`'s/`filetransfer.py`'s/
    `deletion.py`'s (poll `discovery.registry.list()` every 2s, retry
    anything pending for a now-visible peer).
  - **Delete for me / delete for everyone**: local-only delete needs no wire
    message. "Delete for everyone" is the group analogue of `deletion.py`'s
    own `delete_for_everyone()` - fans a new `group_delete` control message
    out to every other member, with its own equivalent offline queue
    (`pending_group_deletes`). New route:
    `DELETE /groups/{group_id}/messages/{msg_id}?everyone=true|false`.
  - **Forward**: no new wire protocol here either, forwarding a group
    message is just calling the existing send-message/send-file endpoint
    again with the same body/path. The forward menu that used to live
    inline inside `ConversationPane.jsx` was pulled out into a shared
    [ForwardMenu.jsx](frontend/src/components/ForwardMenu.jsx) so 1:1 and
    group chat share one implementation, and both now offer every live peer
    **and** every other group as a forward target (previously 1:1 chat
    could only forward to a peer, and groups couldn't forward at all).
  - **A real bug found by testing**: the first version of the queued
    `group_delete` flush only stored `msg_id`, leaving nowhere to put the
    group id on retry - the receiving side's control handler read
    `msg["group_id"]` unconditionally and crashed with a `KeyError` inside
    the WebSocket connection handler the instant a queued delete flushed to
    a reconnected member. The automated test's assertions technically still
    passed (the local delete happens before the crash), the crash only
    showed up in the test process's own log, caught because the test also
    asserted the receiver's `on_group_delete` callback fired with the
    correct value rather than only checking the message disappeared. Fixed
    by adding `group_id` to `pending_group_deletes` and its lookup method's
    return shape.
  - **Tests**: two new automated suites,
    [_test_group_message_retry.py](backend/app/_test_group_message_retry.py)
    and [_test_group_delete.py](backend/app/_test_group_delete.py) (the
    latter is what caught the `KeyError` bug above), plus every pre-existing
    backend suite re-verified green. Also verified live against two real
    `uvicorn` backend processes talking over the actual HTTP/WS wire (not
    just the in-process service objects the automated suite uses):
    real `POST /groups`, `POST /groups/{id}/messages`,
    `DELETE /groups/{id}/messages/{msg_id}`, and a forwarded `POST /messages`
    all exercised end-to-end through `api.py`'s real routes. **Known gap**:
    no live browser-UI click-through test of the new delete-menu/
    forward-menu buttons specifically inside `GroupConversationPane.jsx`
    (verified instead by a clean production build plus the real two-process
    API-level test above, since this is CRUD-shaped reuse of components
    already UI-tested for 1:1 chat, not new interaction logic) - worth a
    dedicated click-through pass if this area gets touched again.
- [x] **Settings screens** (fixed 2026-09-27, scoped down from the design).
  New [SettingsScreen.jsx](frontend/src/components/SettingsScreen.jsx),
  reached by clicking the self-avatar bubble at the bottom of `IconRail.jsx`
  (now a real button, wasn't one before) rather than adding a 5th rail icon.
  **Deliberately does not copy the design's screens verbatim**: the actual
  mockup (`ui prompt/Agora.dc.html`, screens 6.1/6.3/6.4/6.5) claims
  "Encrypted, even at home" with X25519/ChaCha20-Poly1305 badges on the
  Privacy screen, and "Messages and calls travel... encrypted" on About,
  both flatly false for this app today, transport encryption is the
  still-open item right below this one. Built instead:
  - **Privacy & security**: an honest "Not encrypted yet" status card
    (same wording as README's Security posture section), a real "Clear all
    local chat history" action (loops the already-tested
    `api.clearConversation()` over every conversation), and "Show me in
    Nearby" / blocking both shown but honestly `disabled` with a reason,
    not silently missing and not faked as working.
  - **Notifications**: the real OS `Notification.permission` status plus a
    real "Allow" button calling `Notification.requestPermission()` (closes
    the exact gap Step 8's own notes flagged: "nothing requests that
    permission yet"). No per-category/per-conversation toggles, those
    aren't wired to anything real and weren't built as decoration.
  - **About**: the actual app version (`vite.config.js` now injects
    `__AGORA_VERSION__` from `package.json` at build time, single source of
    truth instead of a second hardcoded copy that could drift), real GitHub
    links, and the "how it works" copy corrected to not claim message
    encryption that doesn't exist.
  - **Network settings (6.2) was skipped entirely on purpose**: its design
    (a "sync when internet available" toggle) is exactly the hybrid
    online/offline mode Phase 4 explicitly and permanently removed, per
    BUILD_LOG: "6.2/7.1's network-mode-toggle... designs are retired along
    with it." Building it now would resurrect a decision already made.
  Verified live through the real UI (headless Chrome via the DevTools
  Protocol): opened Settings, navigated into all three sub-screens and
  back, confirmed the honest encryption-status text, the real notification
  permission text, and the real "version 0.0.0" string all actually render
  in the running app, not just in the source.
- [x] **Auto-update from GitHub** (fixed 2026-10-03). A real "Updates"
  modal behind Help > Check for Updates
  ([UpdatesModal.jsx](frontend/src/components/UpdatesModal.jsx)): checks a
  GitHub repo's latest release against the running version, downloads the
  Windows installer asset, and launches it, instead of just linking to the
  releases page like the very first version of this menu item did.

  **Resolved the internet-positioning tension by making it strictly
  opt-in, not deciding it unilaterally**: the automatic-background-check
  toggle in the same modal defaults to **off** - Agora still never reaches
  the internet on its own unless a user deliberately turns this on, and
  even then it only ever checks, it never downloads or installs without
  an explicit click. A manual check (the menu item itself) always works
  regardless of the toggle, same as before.

  **Not hardcoded to this project's own repo** - a correction made mid-build
  after initially wiring it straight to `abdul-wahid-lab/agora`: the user
  wanted the repository itself to be something typed in, not assumed. The
  modal now asks for a GitHub repository URL on first use
  ([updateSettings.js](frontend/src/lib/updateSettings.js)'s
  `parseGithubRepoUrl`), rejects anything that doesn't parse as a
  `github.com/<owner>/<repo>` address immediately with no network call
  ("That URL is wrong..."), then does a real `GET
  /repos/{owner}/{repo}` lookup before accepting it - a syntactically
  fine but nonexistent repo is still rejected, not just a regex match.
  Once accepted it's remembered (localStorage) so it's never asked again
  until "Change" is clicked.

  **Download/install needs real filesystem and process access**, which a
  sandboxed renderer doesn't have - added `update:download` and
  `update:install` IPC handlers in
  [main.cjs](frontend/electron/main.cjs). The download handler
  re-validates the host itself (`github.com` /
  `objects.githubusercontent.com`, following redirects, up to 5 hops) even
  though the renderer only ever passes a `browser_download_url` straight
  from the GitHub API - the privileged process doesn't trust the
  renderer's own validation. Installing launches the downloaded installer
  detached and quits the app, since the installer needs Agora fully
  exited to replace its files.

  **Also added release management**: a "Manage Old Releases..." section
  lists the configured repo's releases (public, no auth needed to read)
  with checkboxes and a delete button. Deleting a GitHub release needs a
  token with write access to that repo - genuinely only usable by the
  repo's own maintainer, since GitHub itself refuses the request
  otherwise. The token lives only in this device's localStorage, entered
  by hand, never bundled into the app or sent anywhere but directly to
  api.github.com.

  **A real bug found and fixed along the way**: this project's own repo
  currently has zero GitHub Releases published, so `/releases/latest`
  404s - the first version of the error handling lumped that into a
  generic "couldn't reach GitHub" message, which is actively misleading
  (it's not a connectivity problem at all). Fixed to detect a 404
  specifically and say "No releases have been published on that
  repository yet."

  **Deliberately not built, and said so rather than silently skipping
  it**: `electron-builder`'s current signing step logs "no signing info
  identified, signing is skipped" for every build in this project - there
  is no code-signing certificate. An auto-updater silently replacing an
  unsigned binary is a real residual trust gap; HTTPS (GitHub's own TLS)
  and the host allowlist above are the only integrity guarantees right
  now, not a cryptographic signature on the binary itself. Worth revisiting
  if/when a real signing certificate exists.

  **Tests performed, live**: real headless Chrome against the real UI -
  confirmed a fresh install with no repo configured shows the URL entry
  screen rather than silently checking anything; confirmed a garbage
  string is rejected instantly with no network call; confirmed a
  syntactically-valid but real-world-nonexistent repo is rejected only
  after an actual failed GitHub lookup (not just a regex pass); confirmed
  a real, existing repo is accepted, persisted, and immediately carried
  into a real check against the real GitHub API (correctly reporting "no
  releases yet", since none exist); confirmed the repo is remembered
  across a reload without re-asking; confirmed the auto-update toggle
  persists; confirmed the Manage Releases section loads the real (empty)
  release list from the real API. Not tested live: actually downloading
  and running an installer end-to-end, since doing so would require a
  real newer release to already exist on GitHub, which there isn't yet.

  **Addendum, 2026-10-03 (same day): a second, fully offline update
  source, and a default repo.** Two corrections after discussion with the
  user:
  1. The GitHub source now defaults to `abdul-wahid-lab/agora`
     ([updateSettings.js](frontend/src/lib/updateSettings.js)'s
     `DEFAULT_REPO`) instead of the modal opening to a blank URL-entry
     screen on first use - a fresh install checks the company's own repo
     immediately, with "Change" (pre-filled with the current repo, not
     blank) still available to point it at any other repo, including
     someone's own fork.
  2. Added a genuinely different update source, not just another way to
     reach GitHub: a **local folder**. A tab switcher in the same modal
     ("GitHub" / "Local Folder") lets a user instead browse to a folder -
     a USB drive, a shared network path, anything reachable with zero
     internet - that already has an Agora installer in it. No manifest
     file: the version is read straight out of the filename (new
     `update:pickFolder`/`update:scanFolder` IPC in
     [main.cjs](frontend/electron/main.cjs), using the exact same
     `Agora Setup X.Y.Z.exe` naming convention `electron-builder` already
     produces), compared against the running version with a plain
     three-part numeric comparison
     (`updateSettings.js`'s `isNewerVersion` - `0.0.9` correctly sorts
     below `0.0.10`, not lexically above it), and installed directly via
     the same `update:install` IPC the GitHub path uses, with no download
     step since the file is already local. This is the one source that
     actually matches Agora's "no server, ever" positioning in a way
     GitHub structurally can't: one device on a LAN with no internet can
     share an update file and everyone else installs from that folder.
     Stated plainly rather than glossed over: this path has neither HTTPS
     nor the GitHub path's host allowlist behind it - the entire trust
     model is "the user picked this folder and file themselves," a
     different (not worse, not better) kind of trust than the other path,
     layered on top of the already-flagged no-code-signing gap.

  A third option discussed and deliberately **not** built: a generic
  "any URL, any website" source. Narrowed down in conversation to "a
  GitHub repo that isn't necessarily mine" - which the existing
  any-repo-URL support already covers, so nothing new was needed there.

  **Tests performed, live**: real headless Chrome confirmed a fresh
  install (no repo, no source-mode configured) defaults straight to
  `github.com/abdul-wahid-lab/agora` and checks it immediately, with no
  manual-entry screen shown first; confirmed "Change" opens pre-filled
  with the current repo rather than blank; confirmed the Local Folder tab
  renders and persists as the chosen mode; confirmed "Browse..." degrades
  to a clear message rather than crashing outside Electron (no
  `window.electronAPI` in that context). The folder-scan regex and the
  version-comparison helper were both verified directly against the
  project's own real `frontend/release/` output (correctly finds `Agora
  Setup 0.0.0.exe` over the portable `Agora 0.0.0.exe`, correctly extracts
  `0.0.0`) and against numeric edge cases (`0.0.9` vs `0.0.10`, `1.0.0` vs
  `0.9.9`). Not tested live: an actual end-to-end folder-install, since
  that needs a second, genuinely different installer version to test
  against, which doesn't exist yet.
- [ ] **Android/phone app.** Completely separate project, not started.
  Discussed stack: Flutter (Dart) for one codebase across Android/iOS,
  `nsd`/`multicast_dns` for mDNS discovery matching the desktop's `zeroconf`
  setup, `web_socket_channel` for messaging, `sqflite` for local storage:
  the phone reimplements the same wire protocol natively rather than running
  the Python backend on-device. Deliberately deferred until desktop is
  fully validated on two real machines.
- [x] **Screen sharing during a call** (fixed 2026-10-01). Works from
  **either** an audio call or a video call, exactly as scoped - not gated
  behind video-only, since the whole point is letting someone show their
  screen even when the call itself started as audio-only, camera never
  touched.

  **The real design decision, and why it needed no backend/wire-protocol
  changes at all:** the obvious approach - start sharing, then renegotiate
  the connection with a new SDP offer/answer - would have needed new
  `calling.py` wire message types and new state, with real risk of
  colliding with the existing busy/collision call logic (any `call_offer`
  arriving for an already-`in_call` peer is currently treated as a second,
  unwanted call attempt and refused). Used a different, standard WebRTC
  pattern instead: every call - audio or video - pre-negotiates a second,
  initially-empty video "slot" (an `RTCRtpTransceiver`, added right after
  this device's own camera/mic tracks but before the one and only
  offer/answer this call ever does) plus a data channel, both as part of
  the SAME initial negotiation. Starting to share is just
  `RTCRtpSender.replaceTrack()` into that already-negotiated slot - no new
  SDP round trip, `calling.py` never even knows it happened.
  [crypto_identity.py](backend/app/crypto_identity.py),
  [messaging.py](backend/app/messaging.py), and
  [calling.py](backend/app/calling.py) are completely unmodified by this
  feature.

  **How the viewer finds out sharing started/stopped** - the one part that
  did need a first design correction, caught by real testing, not assumed:
  the original plan relied on the pre-negotiated track's own native
  mute/unmute events (no track attached = muted, a real signal WebRTC
  already provides). Live-tested against two real separate backend
  processes and it did not fire reliably - `replaceTrack(null)` stopped
  real frames but the receiver's `track.muted` stayed `false` for over 25
  seconds, nowhere near responsive enough for a working "stop sharing"
  button. Replaced with an explicit message ("screen_share_start"/"stop")
  sent over a small `RTCDataChannel`, pre-negotiated in the exact same
  connection the same way as the video slot - still zero changes to this
  app's own signaling protocol, since it rides the WebRTC connection
  directly, peer to peer, never touching `messaging.py`/`calling.py`.
  Re-tested after the fix: correctly reverts within ~1 second.

  **Electron scaffolding, built from nothing** (a repo-wide search found
  zero prior screen-capture code anywhere in the project):
  `session.defaultSession.setDisplayMediaRequestHandler` in
  [main.cjs](frontend/electron/main.cjs) (without this,
  `getDisplayMedia()` just rejects outright under Electron - there's no
  default behavior to fall back on), backed by `desktopCapturer` and two
  new IPC channels (`screen:getSources`, `screen:choose`) since Electron
  has no built-in source picker on Windows the way some platforms do. A
  real picker UI
  ([ScreenSharePickerModal.jsx](frontend/src/components/ScreenSharePickerModal.jsx))
  shows real thumbnails when more than one screen exists, and skips itself
  entirely (auto-selects) for the common single-monitor case rather than
  asking a pointless "which of your 1 screens?" question. Gracefully
  degrades to the browser's own native picker with zero custom UI when
  `window.electronAPI` doesn't exist at all (a plain browser/dev context) -
  a real crash was found and fixed here too: calling `.then()` on
  `window.electronAPI?.getScreenSources?.()` when the bridge doesn't
  exist throws immediately, since optional chaining short-circuits to
  `undefined`, not a promise.

  **Real UI, not a stub**: the shared screen becomes the main stage tile in
  [CallOverlay.jsx](frontend/src/components/CallOverlay.jsx) (`objectFit:
  contain`, not `cover` - cropping someone's real screen content would cut
  off content, not just background, unlike a face), labelled distinctly
  from a camera tile ("{name}'s screen"); in
  [GroupCallOverlay.jsx](frontend/src/components/GroupCallOverlay.jsx) it's
  an extra grid tile (spanning 2 columns) per sharing participant, correctly
  sized into the grid's existing column-count logic. A group screen share
  broadcasts to every mesh leg at once from one real capture
  (`Promise.all` over every leg's transceiver), and a member who joins
  mid-share gets caught up automatically once their own data channel opens
  - not left seeing a blank tile until someone restarts the share.

  **Tests performed** - live, against two real separate backend processes,
  two real headless-Chrome instances with fake media devices
  (`--use-fake-device-for-media-stream`, real MediaStreamTracks, not
  stubs), driven via CDP, not just a build check:
  - A real **audio** call: connects, "Share screen" is present and
    clickable (not gated on video), the viewer's UI shows the real
    shared-screen tile, and the viewer's `<video>` element has a real,
    live `MediaStreamTrack` attached (`readyState: "live"`, real
    `videoWidth`/`videoHeight` - actual WebRTC media, not UI state).
    Stopping correctly reverts the viewer's UI.
  - A real **video** call - the harder case, since two video transceivers
    now exist (camera + screen), genuinely exercising the "last video
    transceiver is always the screen slot" disambiguation logic the audio
    case can't touch at all: confirmed the real camera feed works
    correctly *before* sharing is ever touched, confirmed the viewer ends
    up with **two** simultaneous real, live video tracks once sharing
    starts (camera not clobbered by screen, or vice versa), confirmed
    stopping correctly reverts.
  - The mute/unmute failure above was itself caught by this same live
    testing (not assumed), root-caused with direct instrumentation of the
    real track's `muted` property, and re-verified fixed the same way.
  - Group-call screen sharing was not live-tested with a real multi-person
    mesh (the same per-leg mechanism as the 1:1 case, already proven twice
    above, applied in a loop) - noted honestly rather than claimed as
    verified when it wasn't.
- [ ] **Video/call recording.** Requested 2026-10-01, not started, and a
  genuinely separate task from screen sharing above (not "recording for
  screen shares specifically" - corrected after initially being scoped as
  a follow-up bolted onto that feature, which was wrong). The user has a
  separate existing repo with a working video-recording feature they'll
  hand over later, to be brought into Agora as its own real feature.
  Nothing to build until that repo is actually provided - no shape/design
  decisions made yet (what gets recorded - camera, screen, both; where a
  recording is saved; whether the peer being recorded is notified/consents,
  a real privacy question worth deciding deliberately rather than
  defaulting to silent).
- [x] **QR-code peer pairing** (fixed 2026-10-03). A QR button next to
  Rescan in [PeerList.jsx](frontend/src/components/PeerList.jsx) opens a
  two-tab modal
  ([QrPairingModal.jsx](frontend/src/components/QrPairingModal.jsx)):
  "Your code" renders this device's own pairing code; "Scan a code" reads
  another device's code with the camera and adds it directly, without
  waiting for radar.

  **Resolved the open trust-model question from when this was scoped**,
  rather than inventing a second, weaker path into the peer registry: the
  QR code encodes exactly the same signed announcement this device already
  broadcasts over mDNS/UDP (peer_id, address, port, public_key,
  signing_public_key, signature - new `PeerDiscovery.self_announcement()`
  in [discovery.py](backend/app/discovery.py), exposed as `GET /me/qr`).
  Scanning a code posts that same payload to a new `POST
  /peers/add-scanned`, which runs it through the identical
  `crypto_identity.verify_announcement` signature check and
  `storage.py`'s `check_and_pin_signing_key` pinning that
  `discovery.py`'s own mDNS/UDP listeners enforce on every real broadcast -
  a forged or tampered QR code is rejected exactly like a forged broadcast
  packet would be, and scanning your own code is explicitly refused. On
  success it just upserts into the live `PeerRegistry`; the existing
  `_watch_peers()` loop in [api.py](backend/app/api.py) picks it up on its
  own next tick and persists it via `save_known_peer` and a `peer_joined`
  broadcast exactly like a real discovery hit - no separate "how a
  QR-added peer becomes a contact" code path to keep in sync with the
  normal one.

  **The code itself** carries an Agora logo in the center (`qrcode`'s "H"
  error-correction level, tolerant of the ~5% of modules the logo covers),
  drawn with a white rounded backing so it reads as one clean marker
  rather than noise.

  **Tests performed, live, not assumed**: two real separate backend
  processes - fetched `GET /me/qr` from one, confirmed it's a real signed
  payload; posted it to the other's `POST /peers/add-scanned` and confirmed
  it lands in that device's real `GET /peers` and `GET /peers/known`;
  confirmed scanning your own code is rejected (400); confirmed a payload
  with one field changed after signing is rejected (400, signature no
  longer verifies). Separately, a real headless-Chrome session against the
  real UI confirmed the QR button opens the modal, the canvas renders real
  non-blank QR pixel data fetched from the real `/me/qr` endpoint (not a
  stub), the Scan tab starts a real camera stream without crashing, and
  zero console errors throughout. Finally, decoded the actual rendered
  logo-overlaid canvas with `jsQR` directly and confirmed it decodes back
  to the exact original signed payload - the logo does not break
  scannability.
- [x] **Block a peer** (fixed 2026-09-29). Real backend enforcement, not a
  UI-only switch: a new `blocked_peers` table in
  [storage.py](backend/app/storage.py), checked from a single real choke
  point rather than separately in each feature - every peer-to-peer channel
  (chat, files, calls, group traffic) rides the same
  [messaging.py](backend/app/messaging.py) WebSocket connection, so one
  check in `_handle_inbound` (incoming) and `_get_connection` (outgoing)
  refuses all of it at once. The check runs on **every inbound frame**, not
  just at "hello" time - a connection already open before the block happens
  still gets cut off on its very next frame, not just on new connections.
  Enforcement is bidirectional: a blocked peer can't reach this device, and
  this device can't reach them either, until unblocked. Reachable from the
  Conversation menu (Block Peer / Unblock Peer, with a real confirm
  dialog), from a live banner in the open conversation with its own
  Unblock button, and from `SettingsScreen.jsx`'s Privacy view (its old
  disabled placeholder replaced with a real "BLOCKED PEERS · N" list and
  working Unblock buttons). A blocked peer also disappears from the live
  Nearby/peer list, and the conversation's composer disables itself with an
  explanatory placeholder.
  - **Real bug found and fixed along the way**:
    [filetransfer.py](backend/app/filetransfer.py)'s offer-response wait
    had no timeout - blocking a peer mid-transfer closes the connection
    right after "hello," and `send_control()` can report success at the
    socket-buffer level even though the receiving side already hung up,
    so the offer-wait was left waiting forever for a response that would
    never come. Fixed with a 60s safety-net timeout (`asyncio.wait_for`),
    generous enough to never rush a real person's decision to accept or
    decline a file, only to catch a peer that will truly never respond.
  - **Tests**: a new automated suite,
    [_test_blocking.py](backend/app/_test_blocking.py) (7 tests against
    real localhost sockets, full alice/bob stacks): baseline delivery
    before any block, the block is really recorded, a blocked peer's
    message never reaches the recipient's store, outgoing messages to a
    blocked peer stay "pending" and never arrive (bidirectional), a file
    offer to a blocked peer is refused rather than hanging, a call to a
    blocked peer is refused, and unblocking restores real delivery. Also
    verified live end-to-end in the running UI against two real backend
    processes (not just the automated suite): blocking through the real
    menu, confirming the real banner/disabled composer/hidden-from-peer-list
    behavior, confirming a real message sent while blocked never arrives,
    then confirming delivery genuinely resumes after unblocking - all 8
    live assertions passed.

## Requested in live two-person testing (2026-10-05)

See BUILD_LOG.md's Steps 32-36 for full detail on everything below.

- [x] **Voice messages** (fixed 2026-10-06, see BUILD_LOG Step 40) - press
  and hold the new mic button in either composer to record
  (`getUserMedia`+`MediaRecorder`), release to send. Structurally a file
  transfer, as scoped, through the exact same offer/accept/stream/verify
  path - plus one new, narrowly-scoped endpoint, `POST /files/send-voice`,
  for the one real gap the scoping note couldn't resolve on paper: a
  recorded `Blob` never touches disk on its own the way every other
  attachment's source path already does, so `sendFile`'s path-based
  endpoint has nothing to point at. A voice note is told apart from a real
  video (both are `.webm`, Chromium's only reliable `MediaRecorder` output)
  by one fixed, exact filename rather than a new "kind" column - see
  `fileTypes.js`'s `isVoiceMessage`. Inline playback is a new
  `AudioPreview.jsx`, the `<audio controls>` equivalent of the existing
  `VideoPreview.jsx`, exactly as scoped. Live-verified with two real
  browsers (real recorded audio, not a mock) - a genuine `<audio>` element
  with real playable data, screenshotted actual WhatsApp-style voice-note
  bubbles in the chat timeline. Found and fixed one real bug along the way:
  a Rules-of-Hooks violation that crashed `ConversationPane` the moment a
  conversation was actually opened, caught only because this was tested
  live rather than just built clean.

  **Updated 2026-10-06, see BUILD_LOG Step 41** - two more real requests
  landed on top of the above: the sender couldn't hear their own sent
  voice note back (fixed with an opt-in `keep_sender_copy` on `send_file`/
  `send_group_file`, used only by voice messages), and the whole
  recording/review/playback UI was rebuilt to match a real design
  reference (`ui prompt/Agora-standalone.html`, screens 9.1-9.3) instead
  of the simple hold-to-send version above: a real live waveform during
  recording, slide-to-cancel, drag-up-to-lock (hands-free recording), a
  review screen before sending (play/discard/optional note/Send), and a
  redesigned two-tone waveform chat bubble (`VoiceBubblePlayer.jsx`)
  replacing native `<audio controls>`. `AudioPreview.jsx` and
  `VoiceRecordButton.jsx` (named above) no longer exist - replaced by
  `VoiceBubblePlayer.jsx` and `VoiceRecorder.jsx`. A real bug found live:
  the lock gesture's first implementation was a separate clickable button,
  which is physically impossible to use correctly with one mouse while
  still holding the mic button down - fixed to a drag-up gesture instead,
  the same family as slide-to-cancel.

- [x] **The answering-side screen-share bug, actually root-caused this
  time** (fixed 2026-10-05, see BUILD_LOG Step 38). The real cause: this
  app identified "the screen transceiver" by *position* (`findScreenTransceiver`
  - "the last video-kind transceiver, since both sides always create it
  last") rather than by anything explicit - a real, repeatable report
  pinned it down precisely: "if A calls, only his sharing works; if B
  shares, it shows the camera feed instead of the screen, or nothing,"
  which is exactly what wrong-transceiver matching looks like, not stale
  state. Fixed by having the offering side of a connection (1:1 and every
  group-call mesh leg) explicitly send the real `mid` of its screen
  transceiver as a plain extra field on the call offer (the backend
  already relays `sdp` as an opaque dict either way - zero backend
  changes) - `mid` is the one value WebRTC itself guarantees stays
  identical for the same m-line on both the offer and the answer, so
  matching on it is unambiguous regardless of transceiver creation order
  on either side. `useCall.js` and `useGroupCall.js` both updated; the old
  position-based `findScreenTransceiver` stays as a fallback only for the
  case where no mid was sent at all.

- [x] **The actual remaining cause of the same bug, found by live-tracing
  two real browsers instead of reasoning on paper** (fixed 2026-10-05, see
  BUILD_LOG Step 39) - the mid fix above was real and necessary but not
  sufficient, which is why it was still broken on retest. The real
  mechanism: the answering side's screen m-line has no local track queued
  up before `setRemoteDescription` runs, so the browser auto-creates its
  transceiver as `recvonly` rather than `sendrecv` - a sender on a
  `recvonly` transceiver silently never transmits, no matter what
  `replaceTrack()` puts on it. That's the actual reason only the call's
  offerer could ever share (their own screen transceiver was created
  directly as `sendrecv`), regardless of correct mid matching. Fixed by
  explicitly setting `screenTransceiver.direction = "sendrecv"` on the
  answering side right before `createAnswer()`, in both `useCall.js`'s
  `acceptCall` and `useGroupCall.js`'s `acceptMeshLeg` - still inside the
  one and only offer/answer exchange, no renegotiation needed. Verified
  live with two real Chromium instances (Playwright, real desktop capture
  auto-accepted): the caller's remote-screen `<video>` element went from
  0x0/no-track to 1280x720 live frames at the captured screen's own
  aspect ratio, visibly distinct from the 640x480 camera feeds, with a
  screenshot confirming the actual captured screen content renders in the
  UI. Confirmed fixed on the user's own retest immediately afterward.

- [x] **Peer avatar photos, visible to peers, cached locally, refreshed
  when changed** (fixed 2026-10-05). Reverses a prior explicit design
  decision (`main.cjs`'s old comment: "this never travels to other peers")
  on direct request. New `backend/app/photos.py` (`PhotoStore` disk cache
  + `PhotoExchange` request/response over the existing encrypted control
  channel, same pattern as `filetransfer.py`'s offer/response), a
  `known_peers.photo_hash` column, `PUT`/`DELETE /me/photo` and
  `GET /peers/{peer_id}/photo` in `api.py` (cache served immediately,
  background-refreshed when the peer is live), and a new `PeerAvatar.jsx`
  component wired into `ConversationPane.jsx`'s header, `InfoSidebar.jsx`,
  and `PeerList.jsx`. Deliberately does not touch the signed-discovery/
  crypto_identity.py path at all. Tested live: `_test_photos.py`, two real
  backend stacks over real sockets, byte-for-byte round trip verified both
  directions, correct `None`-not-error for no photo set, correct
  `ConnectionError`-not-hang for an unreachable peer. Not yet wired into
  every other avatar spot in the app (`CallsScreen.jsx` history rows,
  `GroupConversationPane.jsx` per-message avatars, `CallOverlay.jsx`/
  `GroupCallOverlay.jsx` call tiles) - `PeerAvatar` exists and is ready to
  drop into any of those the same way, just not done everywhere yet.

- [x] **Inline video preview/playback in the chat timeline** (fixed
  2026-10-05). New `GET /files/{transfer_id}/raw` (`api.py`, real HTTP
  Range support via FastAPI's `FileResponse`, so a `<video>` element can
  actually seek) and `VideoPreview.jsx`, wired into both `FileBubble` and
  `GroupFileBubble` the same way `ImagePreview`/`isImageFile` already are.

- [x] **Calls shown inline in the chat timeline** (fixed 2026-10-05, 1:1
  only). `ConversationPane.jsx`'s existing messages+files timeline merge
  now includes `calls` as a third kind, refetched on the `call_ended` WS
  event, rendered via a new `CallBubble` that reuses `CallsScreen.jsx`'s
  own `summaryLine`/`fmtDuration` (now exported). **Still open:** the
  group-chat equivalent (`GroupConversationPane.jsx`) - a group call is
  several per-member `CallRecord` rows (one per mesh leg) sharing a
  `group_call_id`, and collapsing those into one meaningful timeline entry
  when legs can have different outcomes (some joined, some missed) is a
  real aggregation design question, not a quick copy-paste of the 1:1
  version.

- [ ] **Screen-share consent for group calls.** Step 32 added a real
  accept/decline handshake before any frame is sent, but only for 1:1
  calls (`useCall.js`). Group calls (`useGroupCall.js`) still share
  instantly with no prompt. Extending the same `screen_share_request`/
  `accept`/`decline` pattern to a mesh call means deciding what "consent"
  means with more than one other participant - everyone must accept
  before sharing starts, or each participant's own leg independently
  decides whether to receive it - a real design choice, not just more
  wiring of the same mechanism.

- [ ] **Group-call UI redesign for more participants, and reusing the
  same treatment for screen sharing.** A reference mockup was shared
  directly in chat during this session (not saved anywhere in the repo -
  ask for it again when this is picked up): a richer `GroupCallOverlay`
  showing an "IN THIS CALL · N" participant list with per-person mic-
  activity indicators, a mesh-topology readout (link count, bitrate,
  "relay: none, all local"), an active-speaker label, and the existing
  menu-bar-tray style extended to show live transfer status - explicitly
  requested both for scaling past the current small-grid layout and for
  how a shared screen is presented within a group call. This is a real
  visual design project of its own, not a quick change.

- [x] **Fully automatic online updates, and real bogus-file detection for
  the Local Folder source** (fixed 2026-10-05, see BUILD_LOG Step 34).
  Online: a new, separate "Also install automatically" setting past the
  existing "Automatically check" one - when both are on, a background
  check that finds a real newer release downloads and installs with no
  click at all, restarting the app on its own (a brief visible toast
  appears first, so it's never a silent surprise). Offline: `main.cjs`'s
  folder scan now verifies a candidate file's actual embedded Windows PE
  `ProductName` (confirmed "Agora" on real builds via PowerShell's
  `Get-Item ... .VersionInfo`) instead of trusting its filename alone - a
  renamed unrelated file is now correctly left alone rather than offered
  as an update.

- [ ] **A real, live click-through of the actual download/install/relaunch**
  (narrower than before - see BUILD_LOG Step 45, which already confirmed the
  *detection* half live: the real GitHub release-check, against this
  project's own actual first published release, genuinely finds it and
  reports the right version). What's still unverified is everything past
  that point - clicking Install, watching it actually download the real
  asset, run the installer, and relaunch into the new version - since
  every attempt to launch the packaged app from the automated tool
  environment itself exited before `main.cjs` ever logged a line, while
  the exact same portable build's own `main.log` shows it running fine for
  the real user on this same machine in real sessions. Needs an actual
  human (or a properly set up Playwright/CDP harness, which this project
  doesn't have yet) to click through: Install → download → run installer →
  relaunch, the Local Folder source against a folder with a genuine newer
  build in it, and - if it's safe to actually let it fire - the
  fully-automatic install path with both settings turned on.

## Desktop design-reference audit (2026-10-06, see BUILD_LOG Step 42), Round 2

Requested directly - "the app should strictly follow the ui i have given." Round 1
(quick fixes: header Files/··· button, composer control order, Nearby's empty-state
troubleshooting panel) is done and live-verified. These are the bigger items found
comparing the live app against `ui prompt/Agora-standalone.html`'s own ten
"Desktop app" screens (10.1-10.10) - each needs a real new backend capability,
not just a UI change, so each is its own scoped item rather than one big task.

- [ ] **Per-peer latency and connection-quality display.** The reference shows
  a signal-strength indicator next to each peer in the Nearby list and a
  real round-trip latency (`2 ms`) in the call window and conversation
  info sidebar, in place of this app's current raw IP:port display.
  Nothing currently measures round-trip time between peers at all - needs
  a real ping/pong mechanism over the existing control channel (or piggy-
  backed on existing traffic) before any UI can show it honestly. Signal
  "strength" specifically has no real underlying hardware signal this app
  can read (software discovery over a LAN connection isn't WiFi RSSI) -
  worth deciding whether to approximate it from latency/packet-loss
  instead of literally faking a signal-bars icon with no real data behind
  it.

- [ ] **Device-type broadcast** ("MacBook Pro", "Pixel", "Studio desktop"
  in the reference, instead of a raw IP address). Discovery's own
  announcement payload would need a new field for this (OS/device name),
  broadcast and shown the same way the existing device name already is -
  a real wire-protocol addition, not just a frontend change.

- [ ] **A dedicated Transfers panel** - bigger than originally scoped here
  (see BUILD_LOG Step 43's 10.8 finding). The reference's file bubbles
  show "received in 3 s · 78 MB/s" / "62% · sending · 84 MB/s · 7 s left"
  with a cancel ✕, which still needs `filetransfer.py` to track and expose
  real throughput over a transfer's lifetime and a real cancel path
  through the offer/accept/stream state machine - but 10.8 shows this
  living in a real *third sidebar panel*, "Transfers," listing every
  active/recent transfer across every conversation at once (not just the
  one bubble you're looking at), with per-transfer cancel/retry/reveal-in-
  folder actions, a "Clear finished" action, and a persistent note that
  transfers keep running even with the window closed to the tray. A real
  standalone surface, not a bubble tweak - scope this as its own screen
  before starting, not an incremental addition to the chat bubble.

- [ ] **A system tray icon** (the reference's macOS menu-bar extra -
  Windows' equivalent is a tray icon) showing live transfer status at a
  glance and quick actions (Send a file…, Pause all transfers, Open
  Agora, Quit) without the main window needing to be open or focused.
  Doesn't exist in `main.cjs` at all currently - a real new Electron
  surface (`Tray` API), not a window content change.

- [ ] **Preferences redesign** (reference screen 10.10): start-Agora-at-
  login toggle (Electron's `app.setLoginItemSettings`, not currently
  used), a discovery-method picker (mDNS vs. UDP-broadcast-fallback vs.
  automatic - the backend already does this internally via `discovery.py`
  but exposes no choice to the user), a received-files storage breakdown
  by category with "Reveal folder"/"Clear received files" actions, and a
  diagnostics panel (device id, reachable peer count, handshake success
  rate, throughput peak, uptime, "Copy diagnostics" for pasting into a bug
  report). Current `SettingsScreen.jsx` has none of this - a real rebuild,
  not a tweak. The reference frames this as a separate OS-style
  Preferences window rather than an in-app tab; worth deciding whether to
  match that literally or keep it as a richer tab, since Electron's
  multi-window story adds real complexity (a second renderer, its own
  IPC surface) for a UI pattern this app hasn't needed anywhere else yet.

- [x] **The remaining five desktop reference screens, audited and every
  real gap fixed** (done 2026-10-06, see BUILD_LOG Step 43): 10.3 (group
  chat header - overlapping member avatars, "Call all," a new Members
  list modal, Files/··· quick actions matching 1:1 chat), 10.4 (incoming-
  call quick replies - "Can't talk now"/"Two minutes"/"Message," decline
  with a reason instead of going silent), 10.5 (security gate's "known: N
  days, M messages" trust line, computed from existing history), 10.6 (a
  real "peer left the network" banner, surfacing auto-resume behavior that
  already quietly existed), 10.8 (found the dedicated Transfers panel -
  see the item above, rescoped rather than built small). All live-verified
  with two real browsers, not just a clean build - including catching and
  fixing a real bug in the new Members modal (a device never discovers
  itself via mDNS, so it always showed its own owner as "offline" in their
  own group).

## From the voice-message design reference (2026-10-06), deliberately not built yet

Found while implementing voice messages against `ui prompt/Agora-standalone.html` -
real, deliberately designed screens (9.3-9.4), each a genuinely separate project,
not attempted alongside the UI rebuild in BUILD_LOG Step 41.

- [ ] **On-device voice message transcription.** The design shows a received
  voice bubble with a "hold to transcribe" affordance and the transcribed
  text shown inline, captioned "Transcribed on this device · never
  uploaded." The real decision this needs before any code: which local
  speech-to-text engine, since a cloud API would contradict this app's
  entire no-internet design posture - something like whisper.cpp (a real
  model file to ship/download, real CPU cost per transcription, a new
  native dependency the Python backend or Electron main process would
  need to drive) is the obvious shape, but picking and integrating one is
  a real project, not a quick addition.

- [ ] **Voice message read receipts** ("Played by Ada" in the design,
  under a sent bubble). Needs a new small wire-protocol message (something
  like `voice_played`, parallel to how `delivered` already works for text)
  and UI for it - doesn't exist for any file type today, not just voice.

- [ ] **Playback speed control** (1×/1.5×/2× in the design's bubble menu
  and settings screen). Lighter-weight than the two above - `<audio>`'s
  own `playbackRate` already does the real work - but needs a UI home: a
  per-bubble button (shown briefly in the design next to the waveform) and/
  or the default-speed setting below.

- [ ] **A dedicated "Voice messages" settings screen** (design's 9.4):
  toggles for on-device transcription (once built) and default playback
  speed, plus an audio-quality readout. "Raise to listen" (hold the phone
  to your ear) is phone-only and has no desktop equivalent - left out of
  any future version of this screen rather than faked.

## Reported 2026-10-06: didn't work over a mobile phone hotspot

- [ ] **Connectivity failed, again, with one device on a phone's mobile
  hotspot** - reported directly, not yet reproduced or diagnosed (which
  side failed - discovery, messaging, or a call - wasn't specified in the
  report). Worth treating as a real, separate investigation rather than
  guessing at a fix blind, because the existing assumption already written
  into this project's own troubleshooting notes may itself be wrong: Step
  32's test session (BUILD_LOG, this same mobile-hotspot setup) and the
  handbook's own troubleshooting section both currently say router AP/
  client isolation is the risky case and "hotspots don't isolate clients
  from each other" - but that's less true than it used to be. iOS's
  Personal Hotspot and a growing number of Android hotspot implementations
  now isolate connected clients from each other by default for security,
  the same symptom this app already has a name for on the router side
  (peers show up via mDNS/UDP broadcast - or don't - but `pending` messages
  never move to `sent`, or two phones never discover each other at all).
  Needs a real repro on an actual hotspot to confirm which layer is
  actually blocked (discovery's UDP broadcast/mDNS specifically, versus the
  direct peer-to-peer TCP messaging/file connection that discovery only
  points at) before any fix makes sense - those are different problems
  with different possible mitigations (e.g., falling back to a different
  discovery mechanism isn't the same fix as working around a blocked
  direct connection).

  **Attempted 2026-10-06, genuinely blocked on hardware, not abandoned:**
  this machine actually was on a real Android-style hotspot at the time
  (SSID "shax," 192.168.43.0/24, confirmed via `netsh wlan show
  interfaces`) - a real chance to test, not a hypothetical. Both UDP
  broadcast and mDNS discovery confirmed genuinely working on this
  specific hotspot (one test backend found the other via `"source":
  "udp"`, the other via `"source": "mdns"` - both mechanisms functional,
  not just one). But this was still only ever one laptop talking to
  itself over two local processes - confirmed via `arp -a` that the only
  other address on the subnet (192.168.43.98) was the phone's own AP/
  gateway interface itself (its MAC matched the reported AP BSSID
  exactly), not a second connected client. AP/client isolation
  specifically blocks traffic *between two connected stations* - it has
  no way to manifest in a same-host test, no matter how real the hotspot
  is, since same-host broadcast/multicast traffic generally never has to
  cross the AP to "come back" the way two genuinely separate devices'
  traffic would. No second device (phone, tablet, another laptop) was
  available to connect to the same hotspot and test against. Still needs
  a real second device on the same hotspot to actually resolve - the
  single-machine test confirmed the discovery *mechanisms* work in
  principle on this network, but could not and cannot confirm or rule out
  isolation between two real stations.

## Smaller known gaps (from earlier phases, still true)

- [x] **Search bars in Nearby and Files are visual-only** (fixed
  2026-09-27). Files' own search already worked (type-category pills and
  filename text search both real, `FilesScreen.jsx`), the actual gap was
  only [PeerList.jsx](frontend/src/components/PeerList.jsx)'s Nearby search
  box: a plain `<span>` with static placeholder text, no input element, no
  state, nothing wired to it at all. Turned into a real controlled `<input>`
  that filters the visible peer list live by name (`ON THIS NETWORK · N`
  now reflects the filtered count too), with an honest empty state ("No one
  named X is on this network right now") when a search matches nobody. The
  old placeholder ("Search people and files…") overclaimed a cross-screen
  search that was never built and isn't now either, since this component
  only ever has peer data available, not files, corrected to "Search
  people…" instead of quietly leaving the overclaim in place. Verified by a
  clean production build (no dedicated live click-through test for this one,
  a plain controlled-input filter with no async/wire-protocol involved).
- [x] **Call history has no pagination beyond the default limit** (fixed
  2026-09-27). `CallsScreen.jsx` now tracks a growing `limit` (starts at 50)
  passed to the already-existing `GET /calls/history?limit=` route (no
  backend change needed, it already supported an arbitrary limit, the
  frontend just never varied it), with a real "Load more" button shown
  whenever the last fetch returned a full page (the same "there might be
  more" signal any offset-less pager relies on without a separate total-
  count endpoint). Deliberately re-fetches the whole `[0, limit)` window on
  every poll tick rather than tracking a separate offset, so the existing
  live 4s refresh and manual pagination share one code path instead of
  needing to reconcile two: "Load more" just grows the window, refresh
  re-fetches whatever window is currently loaded. Verified against a real
  live backend process seeded with 75 real call records: `GET
  /calls/history?limit=50` returned exactly 50, `?limit=100` returned all
  75, confirming growing the limit (exactly what the button does) returns
  genuinely more rows through the real API, not just a UI-only illusion.
- [x] **The bandwidth-sharing throttle during an active call was a fixed
  0.2s-per-chunk delay** (fixed 2026-09-27), now adaptive on top of that
  same floor. [filetransfer.py](backend/app/filetransfer.py)'s
  `_stream_to_peer` now measures how long each chunk's real
  `writer.drain()` actually took (`write_elapsed`) and feeds it into a new
  `throttle_sleep_seconds()`: `BASE_THROTTLE_SLEEP` (0.2s, same policy floor
  as before, so a call always gets at least this much headroom regardless
  of what's measured) plus up to `MAX_EXTRA_THROTTLE_SLEEP` (1.0s) more,
  scaled by that measured latency. `drain()` only returns once the OS is
  ready to accept more data, so an elevated drain time is a real (not
  fabricated) sign that something, the call's own media traffic included,
  is genuinely competing for this device's own send path right now, not the
  literal bandwidth of the call's RTP stream itself (which this backend can
  never observe, WebRTC media flows browser-to-browser and never touches
  this process at all) - documented honestly as a proxy signal, not a real
  bandwidth allocator, same as before. **Tested two ways**: a new
  deterministic unit test on the pure `throttle_sleep_seconds()` formula
  (no real sockets, avoids a flaky timing-based integration test trying to
  induce real TCP backpressure) confirms it returns exactly the baseline at
  zero measured latency, scales up with higher latency, and caps at the
  maximum rather than growing unbounded; the pre-existing
  `_test_bandwidth_sharing.py` integration test (real sockets, real
  `CallService`, wall-clock timing) re-verified green unchanged, since on
  loopback with no real contention the adaptive top-up correctly stays
  near-zero and the flat 0.2s floor alone still produces the same
  measurable slowdown it always did.

## Testing still needed

- [ ] Files/Calls/Chats have now been tested across two real physical
  devices (2026-09-26) and six real bugs were found and fixed, but that was
  one test pass, not exhaustive. Worth another full pass (Nearby → Chats →
  Files → Calls) after the current fixes are rebuilt and copied to both
  machines, specifically re-checking: distinct names showing correctly,
  video calls on both directions, the new file Accept/Decline/Open/Save-As
  actions, and whether `identity.json`'s persisted peer_id actually survives
  an app restart the way it's supposed to.
