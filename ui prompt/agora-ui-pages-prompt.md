# Agora — Detailed UI Prompt (All Pages & Screens)

A page-by-page UI specification for the LAN-first chat & call app ("Agora"). Use this as a prompt for a design tool, a frontend framework build, or an AI coding assistant to generate the actual screens.

---

## Design Direction (brief)
- **Mood:** warm, local, "same room" — not corporate/cloud-enterprise. Think physical proximity, not global scale.
- **Visual language:** rounded shapes, warm neutral background, one accent color tied to "signal/presence" (e.g. a warm amber or coral, evoking a hearth/lantern rather than cold tech blue).
- **Key UI motif:** a subtle "presence ring" or "signal pulse" animation used consistently anywhere a peer is shown as online/nearby — this becomes the app's signature visual element.
- **Connectivity state must always be visible** — a persistent, unobtrusive indicator showing LAN-only vs. Online (hybrid) mode, since this is the app's core differentiator.

---

## 1. Onboarding & Setup

### 1.1 Splash / Launch Screen
- App logo/wordmark, minimal, brief tagline (e.g. "Talk to who's around you.")
- Auto-transitions after checking permissions/network state.

### 1.2 Permissions Screen
- Requests: local network access, microphone, camera, notifications.
- Each permission listed with a one-line plain-language reason (e.g. "Local network access — so Agora can find people near you").
- Clear "why we need this" framing since LAN/mDNS permissions are unusual and users will be suspicious.

### 1.3 Profile Setup Screen
- Display name input, optional avatar/photo picker or generated avatar.
- No account/email/password — explicitly reinforce "no sign-up needed, works instantly on this network."
- Optional: generate a short unique device ID shown small in settings later (for debugging/support).

### 1.4 Network Check Screen (first run)
- Shows a live check: "Scanning for people nearby…"
- Three states to design for: (a) peers found → proceed to Nearby screen, (b) no peers found yet → friendly empty state with troubleshooting tip, (c) discovery blocked (e.g. router isolation detected) → clear error with a "learn more" link to a help screen.

---

## 2. Core Navigation

### 2.1 Main Shell / Tab Bar
- Three primary tabs: **Nearby** (peer discovery), **Chats** (conversation list), **Calls** (call history/active calls).
- Persistent top-of-screen connectivity badge: "On this network" (LAN-only) vs. "Online" (hybrid mode) vs. "Reconnecting…"

---

## 3. Nearby (Discovery)

### 3.1 Nearby Peers List
- Live-updating list of devices currently visible on the LAN.
- Each row: avatar, display name, device type icon (phone/laptop/desktop), presence pulse animation.
- Empty state: illustration + "No one else is on this network yet" + a subtle animated "scanning" indicator so it's clear the app is actively searching, not stalled.
- Pull-to-refresh or manual "Rescan" action.

### 3.2 Peer Detail / Quick Actions Sheet
- Tapping a peer opens a bottom sheet: message icon, call icon, video call icon, and "View profile" link.
- Shows connection quality/signal indicator if easily available (nice-to-have, not essential).

### 3.3 Discovery Troubleshooting Screen
- Reached from an empty Nearby state or a settings link.
- Plain-language checklist: "Make sure you're on the same WiFi," "Some routers block device discovery — here's how to check," with a link to router-specific help if feasible.

---

## 4. Chats

### 4.1 Chat List (Conversations)
- List of existing conversations, most recent first: avatar, name, last message preview, timestamp, unread badge.
- Presence pulse dot on avatar if that peer is currently on the network.
- Empty state for first-time users: "Say hello to someone nearby" with a CTA pointing to the Nearby tab.

### 4.2 Individual Chat Screen (1:1)
- Standard message bubble layout, sender-aligned right, receiver left.
- Delivery status indicators per message: sent → delivered → seen (delivered = reached peer's device over LAN; seen = read).
- Header shows peer name + live presence state ("On this network" / "Left the network" / "Online via internet" in hybrid mode).
- Input bar: text field, attachment icon (opens the file-share picker, §4.6), call icon, video call icon in header.
- If peer goes offline mid-conversation: an inline system message ("Alex left the network — messages will send when they're back") rather than silently failing.
- File messages render as their own bubble type (see §4.6), not a text bubble with a link.

### 4.3 Group Chat Screen
- Same bubble layout, with sender name labels above bubbles from others.
- Header shows group name + member avatars stack + live count of "X of Y nearby right now."
- "Add people" action limited to currently-discovered peers (can't add someone not on the network).

### 4.4 New Chat / Group Creation Screen
- Multi-select list of currently nearby peers.
- Group name + optional group avatar for group creation.
- Disabled state / explanation if fewer than 2 peers are discovered.

### 4.5 Chat Info / Settings Screen (per conversation)
- Peer/group name, shared media gallery, mute notifications toggle, clear history, leave group (if group).
- "Shared files" list here shows every file exchanged in this conversation (any type — not just images), independent of scrolling back through the chat.

### 4.6 File Sharing (send, receive, and transfer states)
Files of **any type** can be sent — documents, photos/video, APKs, game files/ROMs, archives. No type filtering; instead, risk is surfaced through the UI states below rather than by blocking file types outright.

- **Picker sheet** (opened from the chat input's attachment icon): "Photos," "Files," and "Browse" entries — a plain OS-style file browser, since a "game file" or ROM won't live in a photo picker.
- **Sender-side bubble states**, in order: *Waiting for [peer] to accept* → *Sending… 42% · 3.1 MB/s · ~8s left* → *Sent* / *Failed — tap to retry* (retry resumes from where it stopped, doesn't restart).
- **Receiver-side consent card** (not an auto-download): file name, size, type icon, sender name, and explicit **Accept** / **Decline** buttons. Nothing touches disk until Accept is tapped.
- **Executable/installable files (.apk, .exe, .sh, etc.)** get a visually distinct consent card — a warning color/icon treatment, not the same calm card as a photo — with copy like "This is an installable app, not a regular file. Only accept it if you trust [peer]." A second confirmation is required to actually open/install after the file lands, separate from the accept-transfer step.
- **In-progress transfer**: progress bar embedded in the bubble itself (both sides see it), a pause/cancel affordance, and automatic resume with a brief "Reconnecting transfer…" state if the peer drops off WiFi mid-transfer rather than the transfer just silently dying.
- **Completed file bubble**: file-type icon (not a generic paperclip — distinguish image/video/archive/APK/other at a glance), name, size, and an "Open" / "Save as…" action appropriate to the OS.
- **Large-transfer + active-call interaction**: if a big transfer is running while a call starts (or vice versa), show a small inline note — "Pausing file transfer to keep call quality up" — rather than letting the two silently fight over bandwidth.

---

## 5. Calls

### 5.1 Outgoing Call Screen
- Full-screen: peer avatar large/centered, name, "Calling…" state, ringing animation (the presence-pulse motif scaled up).
- Cancel button, mute/camera pre-toggle if video call.

### 5.2 Incoming Call Screen
- Full-screen takeover (or system-level call UI on mobile): caller avatar, name, network badge ("calling from this network").
- Accept / Decline, with quick-reply text option ("Can't talk now") as a secondary action.
- Design for call collision: if you're calling someone who's calling you at the same moment, auto-resolve per the tie-break rule and show "Connecting…" directly rather than confusing dual ringing UIs.

### 5.3 Active Call Screen (Audio)
- Peer avatar centered, call duration timer, mute/speaker/end-call controls.
- Subtle connection-quality indicator (since this is LAN, quality should almost always be excellent — worth surfacing as a trust signal, e.g. "Local connection — HD audio").

### 5.4 Active Call Screen (Video)
- Full-screen remote video, self-view picture-in-picture (draggable corner).
- Controls: mute, camera toggle, camera flip (front/back), end call, minimize-to-chat-head (continue browsing app while call stays active).

### 5.5 Call Ended / Summary Screen
- Brief transition screen: duration, "Call ended," option to redial or return to chat — auto-dismisses to the chat screen after a moment rather than requiring a tap.

### 5.6 Call History Tab
- List of past calls: peer, type (audio/video), duration, missed/completed status, timestamp.
- Tap to redial or jump to chat with that peer.

---

## 6. Settings

### 6.1 Settings Home
- Sections: Profile, Network, Privacy & Security, Notifications, About/Help.

### 6.2 Network Settings Screen
- Current mode indicator (LAN-only / Hybrid).
- Toggle: "Sync when internet is available" (opt-in to the optional cloud layer).
- Manual "Rescan network" action.
- Advanced/debug section: local device ID, discovery method in use (mDNS vs. UDP fallback), last known peers — useful for troubleshooting, tucked away from the main flow.

### 6.3 Privacy & Security Screen
- Explanation that LAN traffic is encrypted even though it never leaves the local network.
- Option to clear all local chat history.
- Blocked peers list (if you implement blocking).

### 6.4 Notification Settings
- Per-conversation and global notification toggles, sound/vibration options.

### 6.5 About / Help Screen
- App version, link to the network troubleshooting guide, "How Agora works" explainer (plain-language: no internet needed, no accounts, your data stays on this network).

---

## 7. System / Edge-Case Screens

### 7.1 Connectivity Change Toast/Banner
- Small non-blocking banner appearing app-wide when switching modes: "You're offline — Agora will keep working on this network" or "Internet's back — syncing…"

### 7.2 Router Isolation Detected Screen
- Triggered when peers are discoverable but connections consistently fail — a distinct error state from "no peers found," since the cause and fix are different.
- Plain-language explanation + link to troubleshooting.

### 7.3 Peer Left Mid-Call Screen
- Brief interstitial when a call drops due to the peer leaving the network rather than a normal hangup: "Alex disconnected from the network" instead of a generic "Call failed."

### 7.4 First-Time Empty States (all tabs)
- Nearby: "Scanning for people nearby…"
- Chats: "No conversations yet — find someone in Nearby"
- Calls: "No call history yet"

---

## 8. Suggested Build Prompt (for a design/coding AI tool)

```
Design a complete UI for "Agora," a LAN-first chat and calling app. The app's core
identity is local, warm, and immediate — no accounts, no cloud dependency, just people
on the same WiFi network finding and talking to each other.

Design direction: warm neutral palette with a single accent color (amber/coral) used
consistently for presence indicators. Use a recurring "presence pulse" animation motif
on avatars to indicate a peer is currently reachable on the network. Avoid cold,
corporate/enterprise tech styling — lean toward "hearth and home," not "cloud platform."

Produce the following screens, each as a distinct, fully designed page:

Onboarding: Splash screen, Permissions screen (network/mic/camera/notifications,
each with a plain-language reason), Profile setup (name + avatar, explicitly no
account/sign-up), first-run Network Check screen with three states (peers found,
none found yet, discovery blocked).

Main navigation: a three-tab shell — Nearby, Chats, Calls — with a persistent,
always-visible connectivity badge showing LAN-only vs. Online (hybrid) vs.
Reconnecting state.

Nearby tab: live peer list with presence-pulse avatars and device-type icons, an
empty/scanning state, a peer quick-actions bottom sheet (message/call/video call/
view profile), and a discovery-troubleshooting screen for when no peers are found.

Chats tab: conversation list with unread badges and presence dots, an empty state,
an individual 1:1 chat screen with delivery status ticks (sent/delivered/seen) and
inline system messages when a peer leaves the network mid-conversation, a group
chat screen showing live "X of Y nearby" member count, a new-chat/group-creation
screen restricted to currently discovered peers, and a per-conversation info/settings
screen with a shared-files list.

File sharing: an attachment picker supporting any file type (documents, photos/video,
APKs, game files/ROMs, archives), sender-side progress bubbles (waiting for accept /
sending with %, speed, ETA / sent / failed-tap-to-retry with resume), a receiver-side
explicit accept/decline consent card that never auto-downloads, a visually distinct
extra-confirmation treatment for executable/installable files (.apk/.exe/.sh), transfer
pause/resume across a WiFi drop, and a note when a large transfer is paused to protect
an active call's quality.

Calls tab: outgoing call screen, incoming call screen (with quick-decline-with-message
option), active audio call screen, active video call screen (with draggable
self-view PIP and a minimize-to-chat-head control), a brief call-ended transition
screen, and a call history list.

Settings: settings home, network settings (mode indicator, opt-in cloud sync toggle,
manual rescan, and a tucked-away advanced/debug panel), privacy & security screen
(local encryption explanation, clear history, blocked peers), notification settings,
and an about/help screen with a plain-language "how Agora works" explainer.

System states: a non-blocking connectivity-change banner, a distinct "router
isolation detected" error screen (different from "no peers found," since the fix
differs), and a "peer disconnected mid-call" interstitial distinct from a normal
call-ended screen.

For every screen involving another person (peer lists, chat headers, call screens),
show their live network presence state clearly — this is the single most important
piece of information in the whole app, since the entire value proposition is
"who can I actually reach right now."
```

---

## 9. Standalone Design Prompt — File Sharing

Self-contained — paste this into a design tool on its own (Figma AI, v0, or similar) to design just the file-sharing screens/states without needing the rest of this doc. Repeats the design direction so it isn't lost.

```
Design the file-sharing screens and states for "Agora," a LAN-first chat app. Mood:
warm, local, "same room" — not corporate/cloud-enterprise. Rounded shapes, warm neutral
background, one accent color tied to presence (amber/coral, "hearth" not "cold tech
blue"). Reuse the app's existing "presence pulse" motif where it fits naturally (e.g. a
gentle pulse on an active transfer's progress ring) rather than inventing a new one.

Files can be ANY type — documents, photos/video, APKs, game files/ROMs, archives — sent
directly between two people already chatting. No type is blocked, but risk is
communicated through the design of these states, not by hiding a "Files" option.

Design these, each as its own clear state/screen:

1. ATTACHMENT PICKER SHEET — opened from the chat input's attachment icon. Simple
   options: Photos, Files, Browse. Should feel as lightweight as picking an emoji, not
   like a heavyweight upload flow.

2. SENDER PROGRESS BUBBLE — a chat bubble that is NOT a text bubble. Needs four visual
   states in sequence: "Waiting for [name] to accept" (calm, low-emphasis) -> "Sending...
   42% - 3.1 MB/s - ~8s left" (an inline progress bar/ring, live numbers) -> "Sent" (quiet
   checkmark, settles into a normal-looking file bubble) -> "Failed - tap to retry" (clear
   but not alarming — a dropped WiFi transfer is normal, not an error to feel bad about).

3. RECEIVER CONSENT CARD (standard file) — appears before anything downloads. Shows file
   name, size, a type-specific icon (photo/video/archive/document/other — each visually
   distinct at a glance, not one generic paperclip), sender name, and two clear actions:
   Accept / Decline. Should feel like a small, low-friction decision.

4. RECEIVER CONSENT CARD (installable file — .apk/.exe/.sh/etc.) — same information as
   #3, but a deliberately different visual treatment: a warning color/icon accent (not
   the calm amber/coral used elsewhere — this is the one place a second, cautionary color
   is justified), and copy along the lines of "This is an installable app, not a regular
   file — only accept it if you trust [name]." Design a SECOND confirmation step that
   appears after the file finishes downloading, before it can be opened/installed,
   visually related to but distinct from the accept card (e.g. a bottom-sheet with the
   same warning treatment).

5. IN-PROGRESS TRANSFER (shared by both sides) — an embedded progress bar inside the
   bubble itself, a pause/cancel control, and a distinct "Reconnecting transfer..." state
   (for when the peer's WiFi drops mid-transfer) that reads as "hang on, this is normal,"
   not "something broke."

6. COMPLETED FILE BUBBLE — file-type icon, name, size, Open / Save-as actions. Design at
   least 4 distinct type icons: image/video, archive, installable app, generic/other —
   glanceable, not a text label doing all the work.

7. SHARED FILES LIST — a dedicated screen (reached from chat info/settings) listing
   every file ever exchanged in a conversation, independent of scrolling through
   messages. Grid or list, your call, but must scale to a game/ROM library's worth of
   large files without feeling like a cluttered download manager.

8. BANDWIDTH-SHARING NOTICE — a small inline note that appears in the chat when a large
   transfer is automatically paused because a call started ("Pausing file transfer to
   keep call quality up"). Low-emphasis, informative, not an alert.

Keep the whole set feeling like one coherent app, not a bolted-on "files" module —
same corner radii, same type scale, same spacing rhythm as the rest of Agora's chat
and call screens.
```
