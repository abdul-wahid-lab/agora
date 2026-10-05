# Agora: Architecture, Workflows, and Design

A technical reference for how Agora actually works: the architecture, every subsystem, every user-facing workflow from first launch onward, the complete feature set, the interface, and an honest account of what the system can and cannot yet do.

## Table of contents

- Part I: What Agora Is
- Part II: System Architecture
- Part III: Peer Discovery
- Part IV: Messaging
- Part V: Encryption and Trust
- Part VI: File Transfer
- Part VII: Voice and Video Calling
- Part VIII: Local Storage
- Part IX: Desktop Packaging and Distribution
- Part X: Complete Feature Catalog
- Part XI: User Interface Reference
- Part XII: End-to-End Workflows
- Part XIII: Possibilities, Limitations, and Future Directions

---

## Part I: What Agora Is

### I.1 The core idea

Agora is private, serverless, local communication for places where internet connectivity, privacy, or account-based communication is undesirable or unavailable. It is not another messaging app competing on message bubbles, read receipts, and typing indicators. Those things exist in Agora too, but they are not what it is for. What it is for is the one property none of the familiar messaging apps can offer, because their entire architecture assumes the thing Agora deliberately refuses to have: a server.

Every one of those apps, no matter how private their encryption claims to be, still needs a company's infrastructure in the middle of the conversation to find the other person, route the message, and often to store it until it is collected. Take the internet away, or take away trust in whoever owns that infrastructure, and the app stops working or stops being private. Agora starts from the opposite assumption: two devices on the same network can find each other, encrypt a connection between themselves, and talk directly, with nothing else involved at all.

### I.2 Three pillars

**Offline and emergency.** The internet is down, was never available, or cannot be trusted to come back in time to matter. Agora does not degrade in this situation, because it was never built to depend on connectivity to begin with. There is no "reconnecting" state for the internet, because the app has no concept of being connected to the internet in the first place. A storm knocking out cell towers, a rural area that never had broadband, a conference venue whose Wi-Fi collapses under thousands of phones at once: all the same situation from Agora's point of view, and all situations where it keeps working exactly as designed while every server-dependent alternative stops.

**Local and private.** Messages travel directly between devices on the same local network. There is no central server routing traffic, no company's infrastructure sitting in the middle of the conversation, and so no single party that can be compelled, breached, or simply choose to hand over a copy of what was said. Privacy here is not a policy promise about how responsibly a company will treat your data; it is a structural fact that there is no copy of the conversation anywhere except on the devices that were actually part of it.

**Temporary communities.** Walk into a place, find out who else is there and reachable, talk to them, and leave. Nothing about that connection persists afterward beyond what a device chooses to remember locally for its own convenience. There is no account, no synced friend list, no platform anywhere that remembers the group was ever together once everyone has gone.

[DIAGRAM: diagram_pillars.png | Figure I.1 - The three pillars behind every design choice in Agora]

### I.3 Where this actually gets used

The pillars above are not marketing language; they describe real, concrete situations, and they double as a genuinely useful test for any new feature. If an idea only makes sense assuming reliable internet, or assumes some central authority exists to arbitrate something, it is very likely the wrong feature for Agora, or at the very least needs its internet dependency made optional and clearly visible rather than quietly assumed.

Universities and campuses: students coordinating on the same network without a campus-wide account. Classrooms: a teacher and a room full of students, no school-issued login required. Conferences and events: attendees finding and messaging each other with no conference app backend behind it. Airplanes: genuinely zero connectivity, the one setting where Agora is the only thing that can work at all. Hospitals during an outage: when the official systems are down, a LAN-only tool keeps working for coordination. Disaster response: the clearest case of all, where needing a server just to talk to someone standing ten feet away becomes actively dangerous. Remote areas: villages, mountains, camps, construction sites, anywhere broadband was never run. Security-sensitive environments: situations where routing communication through any third party is unacceptable, whether or not that third party is currently reachable. Factories and warehouses: large buildings with patchy indoor coverage where a local network beats cellular. Hotels and resorts: guests coordinating without a captive-portal app ecosystem. LAN parties: the most literal case, a room full of devices on one switch. Group travel: coordinating without roaming charges or unreliable foreign data. Privacy-sensitive meetings: conversations nobody involved wants living on a server afterward. Stadiums and festivals: places with so many phones competing for the same cell towers that ordinary messaging becomes unreliable even though everyone is standing next to everyone else. Pop-up and field networks: a network that exists for a day and is gone, with nothing left to register or clean up anywhere.

### I.4 No server, anywhere, ever

The strongest version of this idea, held consistently throughout the system's design: no server, not even an optional one. Not a fallback relay for when two peers cannot find each other directly. Not an opt-in cloud backup. Not a "sign in to sync across your devices" feature bolted on for convenience. The internet is never required and never checked for, with one narrow, deliberate exception: an opt-in update checker, covered in Part IX, which a user can disable entirely and which the app never silently depends on. Every other part of Agora functions completely without ever touching a network beyond the LAN it is running on.

---

## Part II: System Architecture

### II.1 Why peer-to-peer, not client-server

Every device running Agora runs the identical stack: a desktop application talking to its own local backend, which runs discovery, messaging, file transfer, and calling services, which in turn talk to that device's own private database. Two devices on a network are peers, full stop. There is no third kind of node, no "server mode" a device can be switched into, no machine anything else has to route through.

[DIAGRAM: r_architecture.png | Figure II.1 - No server anywhere: two peer devices, identical stack]

A self-hosted server, even one a user runs on their own network, would still be a single point of failure and a single point of trust that a genuinely peer-to-peer design does not need. It would need to be kept running, kept updated, kept reachable, and every one of the three pillars above describes a situation where that assumption breaks down: a classroom where no one machine is "the server," an emergency where the device that would have hosted it might be the one that is gone, a pop-up network where nobody is willing to leave a laptop running. A pure peer-to-peer model also keeps the feature set uniform. Every device can discover, message, call, and transfer files with every other device, with no asymmetry between server and client roles to design around or explain to anyone.

### II.2 How the pieces fit together

On each device, a thin desktop shell hosts the user interface and talks to a local backend process over a loopback-only connection. That backend owns five cooperating services: discovery (finding other devices), messaging (talking to them), encryption (keeping that talk private), file transfer (sending more than text), and calling (real-time audio and video). All five share one underlying identity, one underlying trust model, and one underlying database, so a user experiences them as a single coherent application rather than five separate tools stitched together.

The local backend binds only to the loopback address, `127.0.0.1`. This is a deliberate security boundary, not an accidental default. If the local API were reachable from the network, any other device nearby, not just a paired peer, could potentially call it directly and bypass whatever trust the real peer-to-peer protocol enforces. Binding to loopback means the local API is purely this device's own interface talking to its own backend. Every byte that actually crosses the network goes through separate sockets that the discovery and messaging services own, and those sockets do enforce real cryptographic trust on everything that arrives.

### II.3 The desktop shell

The user-facing application is a desktop program with its own custom-drawn title bar, menu, and window controls, rather than the operating system's native window chrome. It spawns the backend as a genuine child process the moment it starts, and shuts it down cleanly when the window closes. The two communicate only over that loopback connection and a narrow set of operating-system integrations the shell provides on the backend's behalf: picking files and folders, listing available screens for screen sharing, and downloading and installing updates. None of those capabilities are exposed to the interface layer directly; they are requested through a deliberately narrow bridge, so the interface can ask for a specific, named action but cannot reach into the operating system more broadly than that.

### II.4 Ports and addressing

The local interface talks to the backend on a loopback port chosen at startup. Peer-to-peer discovery and messaging bind to every network interface on a separate, fixed port, since that is the port other devices need to actually reach. A broadcast-based fallback discovery mechanism uses one additional fixed port that every device agrees on in advance, because broadcast discovery only works if everyone is listening on the same port without having to be told what it is first.

---

## Part III: Peer Discovery

### III.1 Finding another device without an address book

Discovery is how two devices on the same network find each other without either one knowing the other's address ahead of time. It runs over two independent mechanisms feeding one shared, live list of visible peers, so a device only needs to be reachable through one of the two to show up to everyone else.

[DIAGRAM: r_discovery_seq.png | Figure III.1 - Discovery: mutual announcement between two devices]

The first and primary mechanism is a standard, operating-system-supported service-advertisement protocol, the same general approach used by printers and streaming devices to announce themselves on a network. Using a well-established mechanism rather than something custom means Agora is more likely to get through whatever a given router or network's firewall rules were actually designed around, since those rules were written with exactly this kind of traffic in mind.

The second, fallback mechanism is a plain broadcast packet sent to every device on the network on a fixed, well-known port. Some networks, particularly corporate and public Wi-Fi, deliberately filter the primary mechanism to limit device-to-device chatter. A broadcast on a fixed port is cruder, but it tends to get through in exactly the cases where the more modern mechanism does not. Running both costs very little, a second lightweight background listener, and turns what would otherwise be a silent, hard-to-diagnose failure on an unusual network into a working fallback instead.

### III.2 QR code pairing, a third way in

Radar-style discovery depends on both devices being within range of the same broadcast domain, which is usually true but not always: some networks genuinely segment devices from each other even while both are technically on the same Wi-Fi. QR pairing exists for exactly that case, and more generally for anyone who would rather not wait on a background scan at all. One device shows a scannable code encoding its own signed announcement; scanning that code on another device submits the same data a live discovery hit would have produced, through the identical verification and trust-pinning path described below. It is a faster way to feed in the same trusted data, not a separate or weaker way of adding someone.

### III.3 Every announcement is signed

An attacker on the same network could, in principle, broadcast a fake announcement claiming to be someone else's device. To close that off, every announcement on every discovery path, whether it arrives over the network or gets scanned from a QR code, is signed by the sending device's own signing key before it is ever allowed to affect the live list of visible peers. The receiving device verifies that signature, and the first time it sees a given identity, it remembers which signing key produced that signature. From then on, any announcement claiming to be that same identity has to carry a signature from that same remembered key. The full mechanism, and why it works even against someone who can generate a perfectly valid signature of their own, is covered in Part V, since it is really part of the trust system rather than the discovery system, even though it rides on discovery's own messages to get there.

---

## Part IV: Messaging

### IV.1 Direct, device-to-device chat

Messaging in Agora is exactly what it sounds like: one device sends, the other receives, with nothing in between holding or routing the message. A message that cannot be delivered right now is held entirely on the sender's own device until it can be, rather than handed off to any third party to hold on the sender's behalf.

[DIAGRAM: r_messaging_seq.png | Figure IV.1 - Messaging: send, deliver, acknowledge]

A message moves through three states over its lifetime, visible in the interface as a small delivery indicator next to each bubble: held locally and not yet handed off, handed off to the recipient's connection, and finally confirmed received by an explicit acknowledgment sent back. If the intended recipient is not reachable at the moment a message is sent, it simply stays in the first state. There is no error shown, no retry button needed, nothing lost. A background process watches for a previously unreachable peer becoming visible again and resends anything still waiting for them, in the original order, exactly once each.

For the complete path a message actually takes end to end, from the moment it is typed to the moment delivery is confirmed, broken into what happens on the sender's own device and what happens on the receiver's:

[DIAGRAM: r_message_full_detail_sender.png | Figure IV.2 - Sending a message: the sender's own device, full detail]

[DIAGRAM: r_message_full_detail_receiver.png | Figure IV.3 - Receiving a message: the receiver's own device, full detail]

### IV.2 One connection per peer, kept open

Rather than opening a brand-new connection for every single message, each device keeps one connection open per peer it is actively talking to, reusing it for every message that follows. Opening a fresh connection every time would mean paying the cost of a new encrypted handshake on every send, and would make keeping messages in order and retrying failed sends meaningfully harder to reason about, since multiple connections to the same peer could then be in flight at once with no natural way to coordinate between them. A single reused connection makes the common case fast and the failure case simple: a connection either is or is not currently open, and if it drops, exactly one piece of the system is responsible for cleaning it up.

The real cost of that simplicity is that a single shared connection has to be protected against being written to from two places at once, something that only shows up under genuinely heavy concurrent load rather than in ordinary use. Messaging, file transfer, and calling all share this same connection for their own signaling, so that protection, once built, covers all three rather than needing to be solved separately for each.

### IV.3 Why delivery acknowledgment is its own message

A network connection guarantees that bytes arrive in order while it stays open, but it says nothing about whether the other side actually did anything with them, and nothing at all about a message that was queued for a connection that was never open to begin with. An explicit acknowledgment, sent only once the receiving device has actually saved the message to its own storage, is what lets the sender's delivery indicator mean something real rather than just confirming the data left the network card.

### IV.4 Group messaging

A group conversation is not a shared channel hosted anywhere; it is each member's device sending the same message independently to every other member over its own encrypted connection to them. If a member is offline, their copy queues and delivers the same way an ordinary one-to-one message would. There is no group server to compromise, because there is no group server at all, only a set of individually encrypted conversations that happen to carry the same content and the same group identifier.

---

## Part V: Encryption and Trust

### V.1 The problem with no server to trust

This is the part of Agora doing the most unusual work, because there is no central authority anywhere in the system to issue certificates, verify an identity, or revoke a compromised key. The approach that fits is the same one SSH and modern secure messengers independently arrived at: every device has its own long-lived identity, any two devices can derive a shared secret between themselves without ever transmitting it, and trust is built up the first time two devices actually meet, rather than vouched for in advance by a third party.

### V.2 Two keypairs, generated once

Each device generates two separate keypairs the first time it runs, and never regenerates them afterward.

| Keypair | Used for | Ever leaves the device? |
|---|---|---|
| Encryption identity | Deriving the shared secret two devices encrypt their conversation with | Only the public half, broadcast during discovery |
| Signing identity | Proving a discovery announcement genuinely came from the identity it claims | Only the public half, broadcast during discovery |

[DIAGRAM: r_key_generation.png | Figure V.1 - Identity key generation and reuse]

These solve two genuinely different mathematical problems, and using one key for both purposes is a well-known mistake in cryptographic engineering, independent of whether a specific weakness has already been found in any particular case. It is the kind of shortcut that can look harmless for a long time and then turn out to matter in a context nobody designing the system anticipated. Generating two keys instead of one costs almost nothing, and the risk it avoids is real.

### V.3 Signed discovery: proving an announcement is genuine

Every discovery announcement is signed over the fields that actually matter to trust: identity, address, port, and public encryption key, deliberately excluding the cosmetic display name a device shows, since a name can legitimately change without that change meaning anything about trust. A receiving device verifies the signature and, the first time it sees that identity, remembers which signing key produced it.

[DIAGRAM: r_signed_discovery_seq.png | Figure V.2 - Signed discovery: verify, then remember on first sighting]

This is what actually stops a forged announcement. An attacker can generate their own fresh keypair and sign their own fake announcement with it, and that signature will be perfectly valid on its own terms. What they cannot do is produce a signature that matches a signing key already remembered for someone else's identity. The first contact with a given identity is necessarily a leap of faith, the same way meeting someone in person for the first time is, but every contact after that is checked against what was learned the first time, and if that identity's key ever changes later, the system treats it as a real, visible event rather than something to silently accept or silently block.

### V.4 Directional keys: what actually encrypts a message

Once two devices know each other's genuine, verified public key, each one independently computes the same shared secret, with neither side ever transmitting it. That shared secret is then split into two separate keys, one for each direction of the conversation, rather than used as a single key both ways.

[DIAGRAM: r_directional_keys.png | Figure V.3 - Directional key derivation: two keys, not one]

A single shared key used in both directions has a specific, concrete weakness: a message one side encrypted can be captured and sent straight back at its own sender, who has no way to tell it apart from a genuine reply, since the same key validates data moving either direction. Splitting the secret into two distinct, direction-labelled keys closes this completely. Something valid in one direction can never be mistaken for something valid in the other, even between the same two devices sharing the same underlying secret.

### V.5 Every real frame, encrypted and authenticated

A bare identity announcement, carrying no secret information, is the only thing ever sent in the clear. Everything that follows it, chat content, delivery acknowledgments, file chunks, call signaling, is encrypted with an authenticated cipher before it goes anywhere near the network.

[DIAGRAM: r_encrypted_frame_seq.png | Figure V.4 - Every real frame: encrypted, authenticated, or dropped]

Hiding content and proving it has not been tampered with are two different guarantees, and an authenticated cipher provides both at once. A frame that has been altered or forged in transit fails to authenticate and is dropped outright. It is never partially processed and never silently accepted with corrupted content. The dedicated connection used for file transfer gets the identical treatment per chunk, which closes a real gap beyond simple privacy: that connection has no identity check of its own otherwise, so without the correct key, nothing sent to it will ever successfully decrypt, let alone be mistaken for a genuine file chunk.

### V.6 When a known identity's key changes

Separately from signing-key trust, each device also remembers a peer's encryption public key the first time real communication happens with them. If that key changes later, it is surfaced as a visible, dismissible warning in the interface rather than silently accepted or silently blocked. The system deliberately does not decide on the user's behalf whether a changed key means the other person reinstalled the app on a new device, or means someone else now claims that identity, because only the two humans involved can actually know which it is.

### V.7 What falls outside this system

Call media, the actual audio and video, is encrypted directly by the underlying real-time communication engine rather than by anything Agora's own code implements, and there is no way to turn that off. The honest gaps that remain are the lack of a code-signing certificate on the packaged application, covered in Part IX, and the comparatively weaker trust model of one specific update source, covered in the same place.

---

## Part VI: File Transfer

### VI.1 Offer, accept, then stream

File transfer lets one device send a file directly to another, with the receiving side given a genuine choice to accept or decline before anything is written to disk.

[DIAGRAM: r_filetransfer_flow.png | Figure VI.1 - File transfer: offer, accept, stream, verify, resume]

Sending a file starts with an offer sent to the recipient over the same encrypted connection already used for chat, rather than a separate mechanism built just for this. The recipient sees a real accept or decline choice. Only once they accept does a dedicated connection open for the actual bytes, a separate channel from the one carrying chat, still protected by the identical per-chunk encryption described in Part V. The file streams to disk in chunks, and once the transfer completes, the receiving device independently computes a cryptographic hash of what it actually received and checks it against the hash the sender included with the original offer. If the connection drops partway through, the transfer can resume from the last confirmed byte rather than starting over from zero.

### VI.2 Why a separate connection for bulk data

The connection carrying chat also carries delivery acknowledgments and call signaling, all of which are sensitive to delay in a way a large file is not. Streaming file bytes over that same connection would make everything else sharing it wait behind however much of the file happened to be queued ahead of it, so a chat message typed mid-transfer could end up stuck behind megabytes of file data. A dedicated connection, opened only once a transfer is actually accepted, keeps bulk data physically separate from everything that needs to feel instant.

### VI.3 Why verify a hash when the network already guarantees delivery

A reliable network connection already guarantees that bytes are not corrupted in transit; a damaged segment gets retransmitted automatically. The hash check is not protecting against a noisy connection. It is protecting against every other way a file can end up wrong: a bug somewhere in reassembling chunks back into a file, a write to disk that did not actually finish, a resume that picked up from the wrong point. A hash computed from the actual bytes now sitting on disk, the same bytes the recipient is about to open, catches every one of those at once rather than needing a separate check for each.

### VI.4 Why resume instead of always restarting

On a real local network, a transfer can be interrupted by something as ordinary as a laptop briefly losing its Wi-Fi connection while someone carries it between rooms. Restarting a large file from the beginning every single time that happens would make sharing anything but a small file painful on any connection that is not rock solid. Resuming from the last confirmed byte, with the final hash check as the real safety net against a resume that picked up from the wrong place, makes file sharing tolerate the kind of ordinary interruption a local network actually produces.

### VI.5 A deliberate speed bump for executable files

Receiving an executable or installer file carries real-world consequences a text file or photo does not. Those file types get an additional interstitial, two checkboxes that must be explicitly checked plus a short countdown, before the ordinary accept path is even reachable. It sits on top of, not instead of, the hash verification and encrypted transport every file already gets, specifically for the one category of file a receiver could be talked into running without fully considering what it does.

---

## Part VII: Voice and Video Calling

### VII.1 Signaling relayed, media direct

Calling provides real-time audio and video between two devices. The setup information two devices need to exchange before a call can begin, who is calling whom and what the connection parameters are, travels over the same encrypted messaging connection already open between them. The audio and video itself flows directly between the two devices once the call is established, never passing through anything else.

[DIAGRAM: r_calling_seq.png | Figure VII.1 - Calling: signaling relayed, media direct]

Real-time calling technology always needs some channel to exchange that initial setup information before a direct connection can exist; that is inherent to how it works, not a problem specific to Agora. The common answer elsewhere is a dedicated server built just for that exchange. Agora has no server to be that, and building an entirely separate signaling channel for calls, when an encrypted, already-open, already-trusted connection to that exact device already exists for chat, would be pure duplication. Riding the existing connection means calling inherits connection management, encryption, and peer-liveness tracking for free, rather than needing its own version of each.

### VII.2 No relay servers for difficult networks

Some calling systems rely on relay servers to help two devices behind restrictive networks find a path to each other. On the same local network, which is the only situation Agora operates in, two devices can always reach each other directly, so there is no such problem to solve, and no reason to add the server dependency that kind of relay would represent, even only as a fallback.

### VII.3 One call per peer, handled predictably

A device tracks at most one active call with a given peer at a time. A second call offer arriving while one is already active with that same peer is treated as a deliberate collision case, not silently layered on top of the existing call, so that two people trying to call each other at the exact same moment resolves to one consistent outcome on both sides rather than each side ending up with a different idea of what just happened.

### VII.4 Group calling

More than two people can be on a call together, with every participant connected directly to every other participant rather than through any central mixing point. Joining requires the other side to actually answer; nobody is added to a call automatically just because they were invited.

### VII.5 Screen sharing

Screen sharing works as an addition to any call already in progress, audio or video, not as a separate call type that has to be started instead of a normal one. The underlying real-time connection is set up from the start with room for an extra video source that may or may not ever get used. If screen sharing is turned on mid-call, it fills that already-reserved slot instead of requiring the entire connection to be renegotiated from scratch, which keeps the feature simple to add to a call that is already running without changing how any other part of calling works.

[DIAGRAM: diagram_transceiver.png | Figure VII.2 - Reserving a media slot up front, instead of renegotiating mid-call]

---

## Part VIII: Local Storage

### VIII.1 One database per device, nothing shared

Every device keeps its own private database file. There is no shared, synced, or central database anywhere in the system. A message on one device and the same message on the other device's screen are never the same row in the same table on any machine, because there is no machine the two devices' data ever shares.

[DIAGRAM: r_storage_flow.png | Figure VIII.1 - Per-device storage, no shared database anywhere]

The database holds a handful of tables covering what one device needs to remember about itself: messages sent and received with their delivery state, file transfers with their verification hash and save location, call history with duration and outcome, known peers with their display name and when they were last seen (so a conversation still shows a real name even after someone has gone offline), and a short list of pending deletions waiting to reach a peer who was offline when a delete-for-everyone request was made.

### VIII.2 Why an embedded database, not a database server

A client-server database would reintroduce exactly the kind of infrastructure dependency Agora's whole design rejects, for data that is, on any one device, genuinely small: one person's own message history, not a shared multi-user workload. An embedded database file that needs no running process and no configuration is already the right tool for one application managing one device's worth of data, which is precisely Agora's actual storage shape.

### VIII.3 Keeping concurrent access safe

Rather than holding one long-lived database connection open for the life of the application, each individual read or write opens its own short connection, used once and closed. This keeps the locking behavior simple to reason about, since no operation is ever waiting on another one holding a connection open indefinitely. Under genuinely heavy concurrent load, this still needs real care at the edges: a write that starts a transaction has to know whether it actually got that far before deciding whether a failure needs to be rolled back, and a write that collides with another one in progress needs to retry a bounded number of times rather than fail outright or hang forever. Getting this right matters more than it might seem, because a database that silently drops a write under load, or crashes a background service instead of retrying it, fails in a way that is very hard for a user to notice until messages are already missing.

---

## Part IX: Desktop Packaging and Distribution

### IX.1 A real application, not a browser tab

The shipped application is a genuine desktop process tree, not a browser tab pointed at a web page and not a mockup of one.

[DIAGRAM: r_packaging_flow.png | Figure IX.1 - The real desktop process tree]

The main application process spawns the backend as an actual child process the moment it starts. In the packaged build this is a fully self-contained executable with no dependency on anything else being installed on the machine it runs on; nothing about running Agora requires a user to separately install a compatible runtime first. The main process opens a window with its own custom-drawn title bar, matching the application's real design rather than falling back to whatever chrome the operating system happens to draw by default, and wires that window to the backend and to a narrow set of system-level capabilities the interface itself is never given direct access to.

### IX.2 Why a self-contained executable

Requiring a user to install a separate, correct, compatible runtime environment before a desktop chat application will even run is a real barrier most people would reasonably refuse to cross. A fully self-contained backend means the packaged application is genuinely double-click-and-run, with no hidden prerequisite, which matters directly for the temporary-communities pillar described in Part I: a tool that needs a development environment installed first fails the walk-in-use-it-leave use case before it has even started.

### IX.3 A custom title bar

The interface design calls for a specific title bar, window controls styled consistently with the rest of the application and a real menu bar across the top, that needed to look identical regardless of whatever theme a user's operating system happens to be running. Drawing that bar directly rather than relying on native window chrome is the standard way to achieve that, and the window controls drawn into it are wired to genuine window-control actions rather than simply drawn to look like they do something.

### IX.4 Checking for updates, entirely optional

An update check is the one place Agora ever deliberately reaches outside the local network, and it exists as a strictly opt-in feature rather than something that happens automatically in the background by default. A user can check manually, point the checker at any public code-hosting repository, or point it at a local folder containing a downloaded installer, the one option that needs no internet access at all because the version information is read directly from the file sitting on disk. An automatic, scheduled check can be turned on, but it stays off unless a user deliberately switches it on, and the application's core functioning never depends on it having run at all. A device that never once checks for an update in its entire working life still does everything Agora is meant to do.

The weakest link in this feature, stated plainly rather than glossed over, is that the packaged application is not currently signed with a code-signing certificate, and the local-folder update source in particular has a correspondingly lighter trust model than checking a known repository over a secure connection. Both are honest, acknowledged gaps rather than oversights nobody noticed.

---

## Part X: Complete Feature Catalog

### X.1 Discovery and pairing

The default view after setup shows every peer currently visible on the network, found through either discovery mechanism, with a live presence indicator next to each one, a search field to filter the list by name, and a manual rescan action for forcing an immediate refresh rather than waiting for the next automatic check. A real-time animated radar visualization gives visual confirmation that discovery is actually running, shown whenever no conversation is open or a rescan is in progress. QR code pairing offers a second way to add someone: showing this device's own scannable signed announcement, or scanning someone else's, both going through the identical trust check a live discovery hit would. A known-peers list remembers everyone ever seen, not only people with existing message history, and can be exported and imported to pre-seed a name against an identity before it is next actually discovered. A device-info screen shows this device's own identity and a short fingerprint of its public key, so it can in principle be read aloud or compared with someone in person. A diagnostics view helps troubleshoot discovery or connectivity problems on an unfamiliar network.

### X.2 Messaging

Direct one-to-one chat with real delivery-state tracking and automatic retry once an unreachable peer becomes visible again. Group chat with messages sent independently to every member over their own encrypted connection, queued the same way for anyone currently offline. Delete for me, removing a message from only this device's own view, and delete for everyone, a real deletion request sent to the peer and retried automatically if they are offline when it is first sent. Clearing a single conversation or all chat history, local and irreversible, affecting only this device since there is no shared copy anywhere else to clear. Forwarding a message or a received file to any peer, including one currently offline, queued the same way a normal send would be. Inline image previews shown directly in the conversation rather than as a bare filename link. Disappearing messages, a per-conversation timer after which messages remove themselves automatically. A right-click menu on any message for its available actions. Per-chat quick actions covering muting a peer's call notifications, choosing a conversation's visual theme, and setting its disappearing-messages timer. A per-conversation view of every media file, link, and document shared in it.

### X.3 File transfer

Sending a file with a genuine accept-or-decline choice on the receiving end, and the additional interstitial described in Part VI for executable and installer files specifically. A transfer interrupted mid-stream resumes from the last confirmed point rather than restarting. A file offer that initially fails because a peer is unreachable retries automatically once they reconnect. Every completed transfer is independently verified against the hash included with the original offer. File transfer deliberately slows itself down while a call is active over the same connection, so bulk data never degrades real-time audio or video, and speeds back up automatically once the call ends. Group file and image sharing works the same way group chat does, sent independently to each member and tagged with a shared group identifier.

### X.4 Calling

One-to-one audio and video calls, signaled over the existing encrypted messaging connection with media flowing directly between the two devices. Group calling with every participant connected directly to every other participant, capped at a small number of people, requiring a real answer rather than auto-joining anyone, with a predictable, deterministic outcome when two offers collide at nearly the same instant. Screen sharing available during any call, audio or video, without needing the call to already involve video, since the entire point of screen sharing is not needing the camera at all. A call history with real pagination, correctly distinguishing a completed call from one that was declined, dropped, or resolved as a collision, with accurate duration tracking wherever one applies. Call history can be filtered to just one peer, reachable directly from a conversation with them.

### X.5 Security and trust

Every real frame of data after the very first identity announcement is encrypted with an authenticated cipher using separate keys for each direction. Every discovery announcement is signed and checked against a remembered signing key before it can affect who shows up as visible. A peer's encryption key changing after first contact is surfaced as a visible, dismissible warning rather than silently trusted or silently blocked. Blocking a peer is enforced at the single point every peer-to-peer channel, chat, files, calls, and group traffic, actually passes through, not a cosmetic hide in the interface alone. The extra interstitial for executable files described in Part VI.

### X.6 Settings and personalization

A notifications screen reflecting the real operating-system permission state. An about screen showing the real application version, real project links, and accurate, non-overclaiming language about what is and is not encrypted. A real menu bar with working menus rather than a decorative static strip. A self-portrait photo picker with real image handling, not a fixed set of placeholder icons. Per-conversation color themes, kept local to the device viewing them. A documented keyboard-shortcut reference covering navigation between the main sections, zoom, and more. Window-level controls for staying always on top and for zooming the interface in, out, or back to its default, available only in the desktop build and clearly explained as unavailable when running as a plain browser tab during development. The optional update checker described in Part IX, covering a code-repository source, a local-folder source, and an optional automatic schedule.

### X.7 Desktop application essentials

A frameless, custom-titlebar window; a fully self-contained backend needing nothing else installed; both an installer and a portable, no-install build. A real system notification for an incoming call, shown even when the application window is not focused. Per-user application-data storage, with the database and any downloaded files kept in a proper, standard per-user folder rather than inside the installed application's own directory, which may not even be writable and which an uninstall would otherwise delete.

---

## Part XI: User Interface Reference

### XI.1 The main shell

A custom top bar replaces the operating system's native window chrome: the application logo, a real menu bar, and a cluster on the right showing connection status, the current count of visible peers, and genuine window controls for minimizing, maximizing, and closing. A narrow vertical strip of icons down one side selects which main section is showing, Nearby, Chats, Calls, Files, or Settings, with the user's own avatar shown at the bottom of that strip. A thin status strip reflects real connection state. A dismissible banner appears when a known peer's encryption key has changed since it was first remembered, a real security signal surfaced inline rather than buried somewhere nobody would see it in time. A dedicated gate sits in front of genuinely sensitive actions, such as opening a received executable, rather than a confirmation dialog easy to click through without reading.

### XI.2 Nearby

A sidebar holds a search field, a rescan control, the entry point into QR pairing, and the live list of currently visible peers. An animated radar visualization fills the main area when no conversation is selected, or while a rescan is actively running. The QR pairing view offers two tabs: one showing this device's own scannable signed announcement, rendered with the application logo in its center without breaking the code's scannability, and one offering a live camera view that reads someone else's code and adds them directly.

### XI.3 Chats

A list panel shows every conversation with real message history, separate from Nearby's broader list of everyone currently visible, along with group conversations and the flow for starting a new group. The main conversation view shows message bubbles with live delivery indicators, the message composer, inline image previews, and the entry points for starting a call with that person. The group equivalent shows the same conversation view with per-member status where relevant and its own entry point into a group call. A right-click menu on any message bubble offers delete-for-me, delete-for-everyone where applicable, and forward. A full-size viewer opens from any inline image. An action set appears on an incoming or completed file transfer directly inline in the conversation, covering accept, decline, open, and save. A side panel, toggleable from the menu bar, shows details about whichever conversation or group is currently open.

### XI.4 Calls

A real call history list, paginated and filterable by peer, correctly distinguishing completed, declined, dropped, and collision outcomes. The full-screen one-to-one call view shows the live video or audio tile, a shared-screen tile when screen sharing is active, sized to show the whole screen rather than cropping it the way a cropped face would be acceptable but a cropped screen is not, and a control bar for muting, toggling the camera, sharing a screen, and ending the call. The group equivalent shows a grid of participant tiles plus an extra tile for each active screen share, sized into the grid's own layout logic. A picker appears when more than one screen or window is available to share, automatically skipping itself in the common case of a single monitor, and falling back to the browser's own native picker when running outside the desktop build.

### XI.5 Files

A single screen lists every file transfer across every conversation, searchable by filename, showing its current status and offering direct actions to open it, save it elsewhere, or reveal it in the file system.

### XI.6 Settings

Three sub-screens: notifications, reflecting the real operating-system permission state; about, showing the real application version, real project links, and honest encryption-status language; and the display-name and avatar editor. There is deliberately no network-mode toggle here, for the reasons covered in Part XIII.

### XI.7 Menu-bar dialogs

A shared dialog frame underlies every dialog below: a centered window, closeable by clicking outside it or an explicit close control. From it: sending a file by picking a peer and then a file; exporting and importing the known-peers list; viewing this device's own identity and fingerprint; viewing every peer ever seen; running network diagnostics; a documented keyboard-shortcut reference; a view of everything shared in the currently open conversation; setting a conversation's disappearing-messages timer; choosing a conversation's theme; and the full update-checking surface, covering a repository source, a local-folder source, automatic-check scheduling, and release management.

### XI.8 First launch

A short onboarding flow runs exactly once per installed device identity, before the main application shell appears for the first time, asking only for a display name and an avatar before handing off to the real application.

---

## Part XII: End-to-End Workflows

This part walks through what actually happens, step by step, for every real task a person does with Agora. Each one is written the way it unfolds in practice, from the action a person takes to what the two devices involved actually do in response, tying the architecture described earlier in this document to the concrete, ordinary moments a user experiences.

### XII.1 First launch and setup

A person installs Agora, or runs the portable build with no installation step at all, and opens it for the first time. The application generates this device's two permanent identity keypairs, the encryption keypair and the signing keypair described in Part V, entirely locally, with nothing transmitted anywhere during generation. A short onboarding screen asks for a display name and, optionally, an avatar photo. Once that is set, the main application shell appears, the backend starts its discovery and messaging services in the background, and the device begins listening for other devices on whatever network it is connected to. Nothing about this step requires or checks for an internet connection at any point.

### XII.2 Finding and adding a peer nearby

With another device running Agora on the same network, both devices begin broadcasting and listening for each other automatically, with no action required from either person. Within moments, each device's Nearby screen shows the other as a live, present peer, with its chosen display name and a presence indicator. Tapping that entry opens a conversation with them, ready to send the first message immediately. If the automatic scan has not picked someone up yet, pressing rescan forces an immediate refresh rather than waiting for the next scheduled check.

### XII.3 Adding a peer by QR code

When two devices cannot see each other through the ordinary scan, or when someone would simply rather not wait, one person opens their own QR code from the Nearby screen's pairing entry point. The code encodes that device's full signed announcement, the same data an ordinary discovery broadcast carries. The second person opens the scan tab and points their camera at it. The moment it is read, their device verifies the signature exactly as it would for a live broadcast, pins the signing key to that identity, and adds the peer immediately, with a conversation ready to open right away.

### XII.4 Sending and receiving a text message

A person opens a conversation with a visible peer, types a message, and sends it. The message is immediately saved to the sender's own local database and shown in the conversation as held locally. The sending device's backend encrypts it with the outbound directional key shared with that peer and sends it over their already-open, or freshly opened, connection. The instant it leaves, the sender's view updates to show it handed off. On the receiving device, the backend decrypts it, saves it to its own database, shows it in the conversation immediately, and sends an acknowledgment back over the same connection. The instant that acknowledgment reaches the sender, the delivery indicator updates one final time to confirm the message actually reached the other person, not merely that it was sent into the network.

If the recipient is not reachable at the moment of sending, the message simply stays at the held-locally state, with no error and nothing further required from the sender. The moment that peer becomes visible again, a background process on the sender's device notices and resends everything still waiting for them automatically, in the order it was originally written.

### XII.5 Sending and receiving a file

From an open conversation, a person chooses to send a file and picks one from their device. The sender's backend computes a hash of the file and sends an offer describing it, including that hash, over the existing encrypted connection to the recipient. The recipient sees the offer appear inline in the conversation with a real choice to accept or decline. If the file is an executable or installer, two checkboxes and a short countdown appear first, and the ordinary accept action only becomes available once both are satisfied. On accepting, a dedicated connection opens between the two devices just for the file's bytes, encrypted the same way every other real frame is. The file streams across in chunks and is written to disk as it arrives. Once the final chunk lands, the receiving device computes its own hash of what it actually has on disk and compares it against the one the sender offered; a match confirms the file arrived intact, and the transfer is marked complete on both sides.

If the connection drops partway through, for instance from a brief Wi-Fi interruption, the next attempt picks up from the last byte the receiver had already confirmed rather than starting over, with the same final hash check catching anything that resumed incorrectly.

### XII.6 Starting a one-to-one call

From an open conversation, a person starts an audio or video call. An offer, containing the connection information the call needs, is sent to the peer over the existing messaging connection. The recipient's device shows a real incoming-call notification, visible even if Agora is not currently the focused window, with the choice to answer or decline. On answering, the two devices exchange the remaining connection details over that same messaging channel, and a direct audio or video connection opens between them, carrying the actual call media without passing through the signaling channel at all from that point forward. Either side can mute, turn the camera on or off, or end the call at any time; ending it updates call history on both devices with an accurate duration.

If a person tries to call a peer who is, at that same moment, already calling them, both devices recognize the collision and resolve it to one single, consistent outcome rather than each side ending up with a different call state.

### XII.7 Sharing a screen during a call

While an audio or video call is already in progress, a person chooses to share their screen. If more than one screen or window is available, a picker appears to choose which one; with a single monitor, this step is skipped automatically. The moment a source is chosen, the screen begins streaming into a media slot that was already reserved when the call first connected, so nothing about the existing call needs to be torn down or re-established. On the other side, a dedicated tile for the shared screen appears alongside the existing audio or video tile, sized to show the entire screen without cropping it. Turning screen sharing off removes that tile and leaves the underlying call running exactly as it was.

### XII.8 Creating and using a group

A person starts a new group from the Chats screen, choosing a name and adding members from their existing peers. From that point forward, any message sent in the group is sent independently to every member's device over each member's own individual encrypted connection; there is no shared group channel anywhere. A member who is offline when a message is sent receives it the same way a one-to-one message queues and delivers, the moment they become reachable again. Starting a group call or sharing a file in the group works the same way, fanned out as an independent action to each member rather than funneled through any single point.

### XII.9 Blocking a peer

From a conversation or the known-peers list, a person blocks someone. From that moment, every peer-to-peer channel, chat, files, calls, and any group traffic involving that identity, is rejected at the single point all of those channels actually pass through, not merely hidden from view in the interface. Unblocking reverses this immediately, with no separate re-pairing step required, since the peer's identity was never forgotten, only refused.

### XII.10 Setting a disappearing-messages timer

From a conversation's quick-actions menu, a person sets a timer. Every message sent or received in that conversation afterward is automatically removed once it has been visible for that long, tracked locally on each device independently; there is no shared clock or shared state keeping the two devices' timers synchronized beyond both having agreed to the same duration.

### XII.11 Deleting and forwarding a message

Deleting a message for oneself removes it only from this device's own view and database, with no effect on the other person's copy, since there is no shared copy to affect. Deleting for everyone sends an explicit deletion request to the peer over the same encrypted connection as any other message; if they are offline, the request queues and retries automatically the same way an ordinary message would. Forwarding a message, or a file already received, opens a peer picker and resends the content as a fresh message to whoever is chosen, including someone currently offline, queued exactly the same way a normal send would be.

### XII.12 Checking for and installing an update

From the help menu, a person opens the updates dialog. Checking a repository source reaches out, over a secure connection, to the configured code-hosting repository, by default the project's own, to see if a newer release exists; checking a local-folder source instead reads a version number directly out of an installer file's name on disk, with no network access involved at all. If a newer version is found, the dialog offers to download, or for the local-folder source simply to run, the new installer directly from inside the application. None of this runs automatically unless a person has explicitly turned on the optional automatic-check schedule, and the application functions identically whether or not an update check has ever been run.

### XII.13 What happens when a peer goes offline mid-conversation

If a peer's device loses network connectivity, closes the application, or simply moves out of range while a conversation is open, the next message sent to them is saved locally and marked as held, exactly as it would be for someone never seen at all. Nothing in the sender's experience changes beyond the delivery indicator no longer advancing past that first state. The moment discovery sees that peer again, whether seconds or hours later, the held messages resend automatically in their original order, with no manual intervention required from either side.

---

## Part XIII: Possibilities, Limitations, and Future Directions

### XIII.1 The idea everything else serves

Everything in this system serves one idea: communication that needs nothing but the devices already in the room. No server, no account, no internet connection, no third party ever in a position to see, hold, or be compelled to hand over what was said. Every design choice described in this document, built or deliberately avoided, was judged against whether it serves that idea or quietly compromises it.

### XIII.2 What is necessary versus what is valuable on top

Measured against the three pillars in Part I, the load-bearing core of the system is discovery, messaging, encryption, file transfer, and calling. Remove any one of those and the system stops being able to deliver on offline and emergency use, local and private use, or temporary communities; they are not features sitting on top of the idea, they are the idea. Everything else described in this document is real, finished, and genuinely useful, but sits a layer above that core: groups extend messaging, calling, and file sharing to more than two people at once, which matters enormously for a classroom or a response team but is not required for the simplest two-person case to work at all. Screen sharing and QR pairing are real quality-of-life improvements, not requirements for the core promise to hold. The optional update checker is the one deliberate exception to never touching the internet, valuable for keeping a group of devices current, but the system's core promise holds completely even for a device that never once checks for an update. Personalization and desktop conveniences make the application pleasant to live in day to day, and would be the correct things to set aside first if anything ever needed to be.

### XIII.3 What was deliberately left out, and why

A hybrid mode that would sync conversations through the internet when available was considered early on and deliberately set aside for good. The entire value of this system is not needing the internet, ever; a hybrid mode would mean maintaining two genuinely different code paths, one peer-to-peer and one relying on some online syncing mechanism, for a capability that directly contradicts the reason the system exists in the first place. A broader, generic update source covering any arbitrary website or file was also considered and found to already be fully covered by the existing repository-based update path, since that path already accepts any public code-hosting repository, not only the project's own; building a second, more general mechanism on top would have duplicated something already solved rather than filled a real gap. Call and screen recording has been intentionally left alone pending a real, separate decision about what gets recorded, where a recording is kept, and the genuine privacy question of whether the other party on a call needs to be notified or asked before any recording of them begins, a question worth deciding deliberately rather than defaulting to silently recording someone.

### XIII.4 What could genuinely still be improved

A fresh pass of testing across two entirely separate physical machines, rather than two processes on one machine, is worth doing regularly as the system continues to grow, since that is the only way to catch certain classes of real-world networking behavior that two processes sharing one machine's networking stack simply cannot reproduce. Group-call screen sharing has been proven reliably as a mechanism between two people at a time, but has not yet been exercised against a real call involving three or more simultaneous participants, and that gap is worth stating honestly rather than assuming the two-person case fully covers it. The local-folder update source's trust model is real but structurally lighter than the repository source's, a tradeoff worth revisiting if a code-signing certificate for the packaged application is ever obtained, which remains the single largest acknowledged gap in how updates are distributed today.

### XIII.5 What could be added without compromising the core idea

A handful of ideas remain genuinely worth exploring without threatening anything described above: a way to pre-share a trusted contact list across an entire temporary community's devices before anyone has physically met, built carefully enough that it never reintroduces a server, perhaps as a signed, exportable bundle extending the existing contacts export already built; a lighter-weight distinction between peers merely visible nearby and peers someone has actually chosen to add, useful on networks crowded with far more devices than anyone actually wants to see; and, longer term, a companion mobile application implementing the same discovery, messaging, and trust model natively, which would make "everyone in the room" a realistic premise rather than one limited to whoever happens to be running the desktop build. None of these are necessary to what the system already is. They are directions worth real consideration, not a committed plan, exactly the same way every feature that did ship was once exactly that.
