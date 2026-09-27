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

- [ ] **Per-chat "⋯" quick-actions, WhatsApp-reference** (noted 2026-09-28,
  from a real WhatsApp screenshot the user shared: Search, Media/links/docs,
  Disappearing messages, Chat theme, More). Not built now - queued for
  later, kept here as a concrete reference rather than a vague "add more to
  the menu" note. Of the five: "Search" is covered by the Conversation
  menu's own "Search in Conversation..." being built alongside this entry.
  The other three are genuinely new, real features, none built anywhere in
  Agora today:
  - **Media, links, and docs** - a filtered view scoped to *this one*
    conversation's shared files/images (distinct from `FilesScreen.jsx`,
    which is a global browser across every conversation) - real data
    already exists (`GET /files/{peer_id}`), just needs a per-conversation
    filtered UI, no new backend.
  - **Disappearing messages** - real backend work: messages that
    auto-delete after a set time, needs a per-conversation (or per-message)
    expiry mechanism and a background sweep, not built at all today.
  - **Chat theme** - lowest priority of the three, a per-conversation color
    customization, purely cosmetic - real if built (persisted per peer_id,
    actually applied to that conversation's bubble colors), not a
    placeholder, just not scoped or started.

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
  (disabled, links to the existing queued **Block a peer** entry, not a
  second copy of it).

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
- [ ] **Android/phone app.** Completely separate project, not started.
  Discussed stack: Flutter (Dart) for one codebase across Android/iOS,
  `nsd`/`multicast_dns` for mDNS discovery matching the desktop's `zeroconf`
  setup, `web_socket_channel` for messaging, `sqflite` for local storage:
  the phone reimplements the same wire protocol natively rather than running
  the Python backend on-device. Deliberately deferred until desktop is
  fully validated on two real machines.
- [ ] **Block a peer** (requested 2026-09-28, explicitly deferred by the user
  to build later, not now). Right now anyone on the LAN can message or call
  this device, no way to stop a specific peer_id - `SettingsScreen.jsx`'s
  Privacy view already has an honest disabled placeholder for this
  ("Not built yet, there's no way to block a peer_id today... Real feature,
  queued"), this is that same gap made into a real queue item. Real
  backend work, not just a UI switch: needs a `blocked_peers` table, and
  every real entry point a blocked peer could otherwise reach has to
  actually check it and refuse - `messaging.py`'s incoming message handler,
  `calling.py`'s incoming offer handler, `filetransfer.py`'s incoming file
  offer handler - a block that only hides someone from the peer list while
  still silently accepting their messages/calls/files underneath wouldn't
  be a real block. Where this surfaces in the UI (a button on a peer's
  `InfoSidebar`, a right-click option, the already-drawn Settings toggle,
  or more than one of these) is also still an open decision, not just the
  backend enforcement.

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
