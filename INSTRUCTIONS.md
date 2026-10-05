# Working instructions for this project: the complete reference

Every standing rule, strategy, technical pattern, and piece of project history given or established while working on Agora, in full, from the start. Not a summary of a summary: the long version, written so that any future session, whether mine or anyone else's, can pick this project up cold and work on it exactly the way it has been worked on so far, without re-deriving any of this from scratch and without re-triggering any correction that has already been made once.

This file is local-only documentation, the same as `BUILD_LOG.md` and `TASK_QUEUE.md`: it is never pushed to the public GitHub repo (`github.com/abdul-wahid-lab/agora`). It documents how the work gets done, not the product itself, and per the rules it itself describes (see Part III), internal working documents stay out of the public artifact.

Because this file is itself a record of a standing instruction never to use an em-dash, it is written, start to finish, without using one. If you ever find one in this file, that is a mistake, not a style choice. Fix it on sight.

## Table of contents

- Part I: What Agora is, and what it is not
- Part II: Documentation discipline
- Part III: Version control workflow
- Part IV: Writing style
- Part V: Testing and verification methodology
- Part VI: Design decision-making
- Part VII: Handling scope corrections
- Part VIII: Technical architecture reference
- Part IX: Project history, step by step
- Part X: Established implementation patterns (worked recipes)
- Part XI: Quick-reference appendix
- Part XII: Complete feature catalog
- Part XIII: Complete UI reference
- Part XIV: Possibilities, limitations, and future directions

---

## Part I: What Agora is, and what it is not

### I.1 The core positioning statement

Agora is **private, serverless, local communication for places where internet connectivity, privacy, or account-based communication is undesirable or unavailable.** It is explicitly, deliberately **not "another messaging app."** This distinction was stated directly, as a redirection away from an earlier framing that led with chat-app feature parity (message bubbles, read receipts, typing indicators) rather than with the properties that actually make Agora different from every other chat application that already exists.

The redirection happened because a pitch built around "a chat app that also happens to work offline" undersells the actual differentiator and invites direct comparison with WhatsApp, Signal, Telegram, and every other app in that category, a comparison Agora cannot win on feature count and should not try to. The correct framing leads with the properties those apps cannot offer at all, by design, because their entire architecture depends on the thing Agora specifically does not have: a server.

### I.2 The three pillars

Every real use case for Agora touches at least one of these, and the strongest use cases touch more than one at once. This is not a coincidence; it is the actual shape of the product.

**Pillar one: offline and emergency.** The internet is down, was never there, or cannot be trusted to come back in time to matter. Agora does not degrade in this situation because it was never built to depend on connectivity in the first place. There is no "reconnecting..." state for the internet, because there is no concept of being connected to the internet baked into how the app functions. A natural disaster knocking out cell towers, a rural location that never had broadband, a conference venue whose Wi-Fi collapses under thousands of simultaneous devices: all the same failure mode from Agora's point of view, and all situations where Agora keeps working exactly as designed while every server-dependent alternative stops working.

**Pillar two: local and private.** Messages travel directly between devices on the same local network. There is no central server to route traffic through, no company's infrastructure in the middle of the conversation, and therefore no single entity that can be compelled, hacked, or simply chooses to hand over a copy of what was said. Privacy here is not a policy promise about how a company will handle your data responsibly; it is a structural property of there being no copy anywhere except on the devices that were actually part of the conversation.

**Pillar three: temporary communities.** Walk into a location, discover who else is there and reachable, talk to them, and leave. No account persists the connection afterward unless a device deliberately keeps a local record of a peer it has seen before (which it does, for convenience, in `known_peers`, but that is a local convenience cache on one device, not a server-side relationship record anyone else can see or that follows a user anywhere). There is no profile, no friend list synced across devices, no platform that remembers you were ever there once you and the others have left.

### I.3 Concrete use cases, and why they matter as a planning tool

The use cases below are not marketing flavor text; they are genuinely useful as a test for any new feature. If a proposed feature only makes sense assuming a user has reliable internet, or assumes a central authority exists to arbitrate something, it is very likely the wrong feature for Agora, or at minimum needs its internet dependency made optional and clearly surfaced (see Part VI on design decisions with real tradeoffs).

Universities and campuses: students on the same campus network coordinating without needing a campus-wide app account. Classrooms: a teacher and students in one room, no need for every student to have a school-issued login. Conferences and events: attendees discovering and messaging each other without a conference app's backend. Airplanes: real, literal zero connectivity, where Agora is the only thing that can work at all. Hospitals during outages: when the official systems are down, a LAN-only tool keeps working for coordination. Disaster and emergency response: the textbook case, where the whole premise of needing a server to talk to someone ten feet away becomes actively dangerous. Remote areas: villages, mountains, camps, construction sites, anywhere broadband was never installed. Military and security environments: situations where routing communication through any third party's infrastructure is unacceptable regardless of whether that infrastructure is currently reachable. Factories and warehouses: large physical spaces with spotty indoor coverage where LAN or ad hoc networking outperforms cellular. Hotels and resorts: guests coordinating without needing to be on a hotel's captive-portal Wi-Fi app ecosystem. LAN parties: the most literal, nostalgic case, a room full of devices on one switch. Family and group trips: a group traveling together who want to coordinate without roaming charges or spotty foreign cellular data. Privacy-sensitive meetings: situations where the participants specifically do not want a record of the conversation living on anyone's servers. Events with overloaded cellular networks: stadiums, festivals, anywhere so many phones compete for cell towers that normal messaging apps become unreliable even though every phone is right next to every other phone. Temporary or pop-up networks: field teams, exhibitions, situations with a network that exists for a day and then is gone, with nothing that needs cleaning up afterward because nothing was ever centrally registered.

### I.4 How this shapes decisions

Frame any marketing copy, README updates, pitch material, or feature-prioritization decision around these three pillars, not around chat-app feature parity. Message bubbles, read receipts, typing indicators, and so on are implementation details in service of the actual positioning, not the point of the product. A feature request that would make Agora feel more like a conventional messaging app, at the cost of its no-server, no-account, no-internet-dependency properties, should be treated with real skepticism, not built reflexively because "other apps have it."

The strongest version of this rule: no server, anywhere, ever, not even optional. Not a fallback server for when peers can't find each other directly. Not an opt-in cloud backup. Not a "sign in to sync across devices" feature. The internet is never required and never checked for, except in the one specific, narrow, deliberate exception that exists today: the auto-update feature, and even that was built to be strictly opt-in (see Part X.6 for the full design), because any exception to "never touches the internet" has to be a conscious, surfaced decision, never a quiet default.

---

## Part II: Documentation discipline

### II.1 The standing instruction

Keep the project's documentation current as part of doing the work itself, not as a separate step performed only when explicitly asked. This was stated directly as a standing instruction, after a long pattern, across many turns of work, of documenting phases, errors hit, and test results inside `BUILD_LOG.md` without being asked each time. The user treats `BUILD_LOG.md` specifically as the authoritative running record of the entire project's history: what was built, what broke, how it was actually fixed, and what was and was not verified. It is not a nice-to-have changelog; it is closer to a lab notebook, and it is relied upon as such.

### II.2 The three documents and what each one is for

**`BUILD_LOG.md`.** The authoritative, chronological, numbered-step record of the project. Every real unit of work (a phase, a feature, a significant bug-fix round) gets its own dated, numbered `### Step N:` entry. A good entry includes: what was actually built, in enough technical detail that someone who was not present for the work could understand the real shape of the change; errors or wrong assumptions hit along the way, and how they were actually diagnosed and fixed, not just that "a bug was fixed"; what was tested, and specifically how (live, against real processes, or build-only, or a specific manual click-through); and, just as important as any of the above, what was explicitly *not* tested, stated honestly rather than left implied or omitted. As of this writing the log runs to 30 numbered steps; see Part IX for the full list.

**`TASK_QUEUE.md`.** The living list of what remains to be done, plus (this is the part that is easy to under-do) a genuinely detailed closing writeup for every item once it actually gets finished, moved from an open `- [ ]` checkbox to a closed `- [x]` one. A closing writeup is not "done, see commit." It covers: the real design decisions made during the work and the reasoning behind them, especially when an initial plan had to change because testing revealed it was wrong; any real bugs found during the work, with enough detail that the fix could be understood or re-derived without re-reading the diff; and an honest "tested live" versus "not tested" accounting, matching the same honesty standard as `BUILD_LOG.md`. This file absorbed the role that an earlier file, `lan-chat-app-spec.md`, used to play as the project's planning document; both still exist in the repository, but `TASK_QUEUE.md` is where active planning and the closing-writeup discipline actually happens now.

**`README.md`.** The public-facing description of the project, and the one internal-feeling document that actually does get pushed to the public repository (see Part III). Its "Build status" table should track `BUILD_LOG.md`'s own status honestly, not optimistically. Its architecture sections, including the Encryption section with its Mermaid diagrams, need to stay consistent with what is actually shipped in the code; a diagram describing an aspirational design that was never built, or that was later changed, is worse than no diagram at all, because it actively misleads a reader who has no other way to check.

### II.3 How to apply this in practice

After implementing or testing any phase or feature, update the relevant documentation before considering the work finished, without waiting to be asked for a documentation pass as a separate step. When a feature's scope changes mid-build, every document that reflected the old framing needs to be corrected, not just the most recently touched one; the clearest real example of this is screen sharing and video recording, originally scoped together with recording framed as a "follow-up" to screen sharing, which had to be corrected into two fully independent `TASK_QUEUE.md` entries once the user clarified "both are the different task." Documentation updates travel with the code changes they describe, as part of the same unit of work, not tacked on afterward and never skipped on the reasoning that a change is "just a small one." Small changes accumulate into a documentation record that no longer matches reality just as surely as large ones do.

### II.4 What proactive documentation does not mean

Proactive documentation updates are not the same thing as proactive commits. Keep `BUILD_LOG.md` and `TASK_QUEUE.md` current in the working tree at all times, but do not commit those changes, or any changes, until explicitly asked. See Part III for the full commit discipline. The two rules are not in tension: write the history down as it happens, and separately, wait to be told when to actually commit it.

---

## Part III: Version control workflow

### III.1 Commit and push only on explicit request

Do the requested implementation or documentation work and report status at the end of a turn, but leave the working tree uncommitted by default. Only run `git commit`, in either the local repository or the public one, when the user explicitly asks for it in that turn, however that request is phrased: "commit this," "commit it locally," "update the GitHub," "push it," "put it on GitHub too." This was stated directly, in plain words, after several turns in a row where commits had been made proactively after finishing each discrete unit of work (a chats screen, a files screen, a phase descope) without being asked each time.

This rule overrides whatever general habit or instinct exists toward committing after completing a logical unit of work. It applies specifically and only within this project. Keep building and editing across as many turns as the work takes; the commit step is a distinct, separately-requested action, not an automatic consequence of finishing something.

### III.2 The two-repository model

This project lives in two places with two different sets of rules:

**The local repository**, at `D:\Agora`, on branch `master`. This is the full, unfiltered history of the project: every code file, every internal documentation file (`BUILD_LOG.md`, `TASK_QUEUE.md`, `lan-chat-app-spec.md`, this file), everything. Commits here use normal attribution, including the `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer.

**The public repository**, at `github.com/abdul-wahid-lab/agora`, also on branch `master`. This is a deliberately filtered artifact: real code and real design assets only, with `README.md` as the one documentation file that belongs there because it is public-facing by design rather than an internal planning document. Commits here never carry a `Co-Authored-By` trailer (see III.4).

### III.3 The public repository gets code and design only

When syncing changes to the public repository, never include the internal planning or documentation files: `lan-chat-app-spec.md`, `BUILD_LOG.md`, `TASK_QUEUE.md`, `STRESS_TEST_REPORT.md`, `STRESS_TEST_INSTRUCTIONS.md`, this file, any `ui prompt/*.md` file, or anything of a similar nature. Only real code (`backend/app/*.py` and friends, `frontend/src/**`, `frontend/electron/**`, build configuration) and real design assets (icons, the logo, anything that is actually part of the shipped product) go to the public repository. `README.md` is the sole deliberate exception, because it is the project's own public description of itself, not a window into how the work behind it actually happened.

This was stated explicitly, more than once, right after internal docs were first pushed alongside code in an earlier round of work. The user wants the public repository to read as a clean, professional, code-and-design-only artifact, not a place where someone browsing the repo can see every internal planning note, every half-finished thought, or every piece of commentary about how a feature was built and debugged. This sits alongside the documentation discipline in Part II without any real tension: keep documenting locally, in full, with complete honesty, and simply exclude those documents by default whenever syncing to the public remote. Do not ask for confirmation on this exclusion each time; it is a standing default, not a judgment call to be re-litigated per push.

### III.4 Never a Co-Authored-By trailer on the public repository

Commits pushed to `github.com/abdul-wahid-lab/agora` must never carry a `Co-Authored-By: Claude...` trailer, even though a general Claude Code attribution setting may add one automatically by default for the session.

This rule has a real history worth knowing in full, because the way it was violated once is instructive. The user noticed "claude" listed as a contributor on the public GitHub repository, traced it to the trailer appearing on every past commit, asked for it to be removed, and the fix at the time involved rewriting git history and force-pushing to strip the trailer out of every historical commit, not just future ones. Shortly after that cleanup, a follow-up commit was made that carried the trailer again, purely by oversight: the general attribution instruction active for the session was applied without specifically remembering this repository's own standing exception to it. That second occurrence had to be caught and fixed a second time, again by amending the commit and force-pushing.

The lesson generalizes: a standing project-specific rule can be silently overridden by a more general, session-level default if the general default is applied without checking for a more specific rule first. Whenever a commit is about to be made to this specific public repository, the trailer gets omitted regardless of what the ambient attribution setting for the session would otherwise do. This exception is specific to the public remote; the local-only `D:\Agora` repository's commits keep normal attribution, trailer included, exactly as the session's general instructions specify.

### III.5 The full two-repository commit and push procedure

This is the exact, concrete workflow that has been used repeatedly and should be used again, step by step:

**Step one: commit locally.** From `D:\Agora`, stage every changed file relevant to the work being committed, including the internal documentation files, and commit with a descriptive message ending in the `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. This commit is the complete, honest record.

**Step two: clone the public repository into a scratch directory.** Never work directly inside a second permanent clone sitting around on disk; clone fresh into the session's scratchpad directory each time, to guarantee starting from the actual current state of the public remote rather than a potentially stale local copy. `git clone https://github.com/abdul-wahid-lab/agora.git <scratch path>`.

**Step three: copy over only the code and design files that changed**, explicitly excluding the internal documentation files listed in III.3. This is typically done with targeted `cp` commands for each changed file, mirroring the same relative paths inside the scratch clone, rather than a blanket copy of the whole working tree (which would bring the excluded files along with it).

**Step four: commit inside the scratch clone** with the same descriptive message used for the local commit, but without the `Co-Authored-By` trailer.

**Step five: push directly and explicitly to `master`.** `git push origin master`. Never use a command structure that could fall back to creating or pushing a different branch if the direct push fails for some reason (a chained `push A || push B` pattern caused exactly this kind of problem once before, creating a stray `main` branch on the public remote that then had to be noticed and cleaned up). If a push to `master` fails, stop and investigate why, rather than letting an automatic fallback silently create unwanted remote state.

**Step six: verify.** Confirm the push succeeded cleanly (`git log --oneline -1` in the scratch clone should show the new commit as the tip of `master`), and confirm no stray branch exists on the remote (`gh api repos/abdul-wahid-lab/agora/branches --jq '.[].name'` should list only `master`). Clean up the scratch clone directory afterward; it served its purpose and does not need to persist.

### III.6 General git safety discipline

Beyond the project-specific rules above, the general safety discipline that applies to any git work in this project: never run a destructive operation (`git reset --hard`, `git push --force`, `git checkout --` that would discard uncommitted work, `git clean`, a branch deletion) without explicit instruction to do so, and always check `git status` before any command that could discard uncommitted work, so that anything unexpected sitting in the working tree gets noticed and handled (stashed, committed, or asked about) rather than silently destroyed. Never skip commit hooks with `--no-verify` or bypass signing without being explicitly told to. When staging broadly (such as `git add -A`), review what actually got staged before committing, especially checking that nothing containing secrets or credentials is about to be committed, even if a filename looks innocuous.

---

## Part IV: Writing style

### IV.1 No em-dashes, anywhere, in project writing

Never use the em-dash character in anything written for this project: `README.md`, `BUILD_LOG.md`, `TASK_QUEUE.md`, this file, commit messages, in-app UI copy, all of it, everywhere, without exception. Rewrite with whichever of a period (starting a new sentence), a comma, a colon, or parentheses reads most naturally for that specific sentence. A plain hyphen with a space on each side, used as a dash-like connector between two clauses, is fine and was already the established style in this project's documentation before this feedback was ever given; it was never the problem. The em-dash character specifically, and only, was the problem.

### IV.2 Why this rule exists, and why it is strict

The user said the em-dash character reads as "very AI sloppy" and stated plainly that they did not want it, after noticing it used throughout `README.md`. This is not a one-off complaint about a single file; it is a blanket stylistic preference that applies to every piece of writing produced for this project, present and future. The framing matters: the complaint is specifically about a tic that reads as generic AI-generated prose, not about dashes or pauses in writing as a concept. The fix is not "avoid pauses," it is "stop reaching for this one specific character as a default connector the way typical AI-generated writing style tends to."

### IV.3 How to apply this consistently

Do not reach for an em-dash as an automatic default connector between clauses, the way a lot of default writing style (including a lot of AI-generated writing style specifically) tends to. When editing an existing document for some unrelated reason and an em-dash is encountered along the way, it is worth proactively fixing it as part of that same edit. However, do not go out of the way to sweep the entire repository looking for em-dashes as a standalone task unprompted; if fixing all of them at once would mean touching many unrelated files, ask first before doing that as its own pass.

### IV.4 Broader tone observations worth carrying forward

Beyond the specific em-dash rule, the writing style that has actually been used successfully throughout this project's documentation, and that should be continued, has a few consistent characteristics worth naming explicitly, even though none of them were stated as a formal rule the way the em-dash one was:

Plain, direct sentences over inflated or hedging language. Say what happened, including when something failed or was wrong, without softening it into vague corporate-sounding language. "This did not work, here is why, here is the fix" reads better in this project's documentation than "there were some challenges that were subsequently addressed."

Specificity over generality. "Bob's `track.muted` stayed `false` for over 25 seconds after `replaceTrack(null)`" is a far more useful sentence than "the mute detection was unreliable." Real numbers, real variable names, real file and line references make documentation actually useful to a future reader trying to understand what happened, rather than just a record that something, vaguely, happened.

Honesty about limitations as a first-class citizen of the writing, not an afterthought squeezed in at the end. A sentence like "group-call screen sharing was not live-tested with a real multi-person mesh" belongs in the main body of a writeup, with the same weight as the sentences describing what was verified, not demoted to a footnote.

No invented confidence. If something was not tested, say so in those words, rather than writing around the gap in a way that could be read as implying it was tested. If a tradeoff exists and has not been resolved, name the tradeoff, rather than picking a side silently and writing as though there was never a decision to make.

---

## Part V: Testing and verification methodology

### V.1 The core principle

This is less a single quoted instruction and more the working method that has been consistently expected and rewarded throughout this entire project: a claim that something "works" is backed by actually running the real code and observing the real result, not by reasoning about what the code should do. This principle shows up constantly throughout the project's history and is worth understanding in depth, because it is probably the single most load-bearing habit in how this project has actually been built.

### V.2 What "live testing" has actually meant in practice

Live testing in this project has almost never meant a narrow unit test in isolation. It has consistently meant standing up the real system, or as much of it as is practical, and observing real behavior:

Real, separate backend processes. When testing anything involving two peers (discovery, messaging, calling, file transfer, QR pairing), the standard approach has been to start two genuinely separate Python processes, each running the real `app.api` FastAPI application on its own port, with its own SQLite database file, its own identity, communicating over real localhost sockets exactly as two separate physical machines would communicate over a real LAN. Not two instances of a class inside one process standing in for two devices; two actual operating-system processes.

Real headless Chrome, driven over the real Chrome DevTools Protocol. For frontend and full-stack testing, the pattern has been to launch `chrome.exe --headless=new` with a remote debugging port, connect to it over a raw WebSocket using the DevTools Protocol directly (`Runtime.evaluate`, `Page.navigate`, `Page.addScriptToEvaluateOnNewDocument`), and drive the real React application exactly as a real user's browser would: clicking real buttons found by their real rendered text, reading real `document.body.innerText`, inspecting real DOM state, waiting on real asynchronous events rather than fixed sleeps wherever avoidable. This is not a mocked DOM or a snapshot test; it is the actual compiled application running in an actual browser engine.

Real media devices where media is involved. Testing WebRTC features (calls, screen sharing) has used Chrome's `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream` flags, which produce genuine `MediaStreamTrack` objects with real `readyState`, real `videoWidth`/`videoHeight`, and real frame delivery, auto-approving the permission prompts that would otherwise block headless automation, rather than stubbing out the WebRTC APIs entirely.

Real files with real random content for file-transfer testing, not all-zero buffers, specifically because an all-zero buffer can hide certain classes of corruption that happen to still produce a plausible-looking result; real random bytes make a hash mismatch a trustworthy signal of real corruption.

Real adversarial input at real volume for security and stress testing: real forged UDP broadcast packets with invalid or self-signed signatures, real malformed TCP payloads, real floods of thousands of garbage connections, rather than reasoning abstractly about what "should" happen if such a thing occurred.

### V.3 What to do when an initial assumption turns out wrong

The single clearest example of this project's testing discipline paying off directly: the original design for how a screen-sharing viewer would learn that sharing had started or stopped relied on WebRTC's own native track `mute`/`unmute` events, which looked like a reasonable, zero-extra-messages approach on paper. A real, instrumented, two-browser live test showed this assumption was simply wrong in practice: after a real `replaceTrack(null)` call stopped real frames from flowing, the receiving side's `track.muted` property measurably stayed `false` for over twenty-five seconds, nowhere near responsive enough for a working "stop sharing" indicator. This was caught by testing, not by guessing or by reading documentation more carefully, and it directly caused a real redesign: an explicit `RTCDataChannel` message (`screen_share_start`/`screen_share_stop`) replaced the native-event approach, and the fix was then re-verified with the same live two-browser test, confirming the new approach reverted the UI within about one second.

The general lesson: when a design choice is based on an assumption about how some underlying technology behaves, test that assumption directly and early, with instrumentation specific enough to catch it being wrong (in this case, directly logging the real `track.muted` value over time), rather than building the whole feature on top of the assumption and discovering the problem later, or never discovering it at all because nothing ever checked.

### V.4 Honest accounting of what was and was not tested

Every feature writeup in `BUILD_LOG.md` and `TASK_QUEUE.md` throughout this project includes an explicit account of what was not tested live, and why, rather than letting a successful test of a narrower or easier scenario stand in silently for a different, harder scenario that was never actually exercised. Concrete examples: group-call screen sharing was built using the same per-leg mechanism already proven twice in 1:1 testing, applied in a loop across a real mesh of connections, but was never live-tested with an actual three-or-more-person group call, and every piece of documentation describing that feature says so plainly rather than implying the 1:1 test covered it. The auto-update feature's download-and-install path was fully built and had its surrounding logic (URL validation, repository existence checks, the actual HTTP calls to GitHub's API) tested live and in detail, but the actual end-to-end "download a real newer installer and run it" path was never exercised, because doing so would require a real newer release to already exist on GitHub, which it does not; this gap is stated directly rather than glossed over.

This matters because a gap in testing is information the user needs in order to make good decisions, such as deciding whether to personally verify something before relying on it, or deciding that a particular untested path is risky enough to warrant dedicated testing before shipping. Hiding or softening a testing gap, even implicitly through careful phrasing that avoids lying but also avoids clearly stating the gap, removes that information from the user without their knowledge.

### V.5 Investigating confusing results honestly instead of adjusting the test to pass

When a test produces a result that does not match expectations, the correct response is to investigate the actual cause and report it honestly, including when the cause turns out to be something other than a bug in the code under test, rather than quietly adjusting the test's assertions until it passes without understanding why it originally failed.

The clearest example: an early multi-peer mesh stress test, run with five simulated peers, repeatedly reported each peer seeing seven peers total instead of the expected four others. Rather than loosening the assertion to accept whatever number showed up, the actual cause was investigated: the test's `PeerDiscovery` instances listen on the real network, not an isolated mock network, and real extra devices were active and broadcasting on the real LAN at the time the test was run (consistent with the user mentioning they were about to begin testing on their own physical devices around the same time). The fix that was ultimately applied to the permanent regression test changed the assertion from an exact equality check to an "at least" check, specifically because the real, correct invariant is "every peer sees at least all the other peers in its own test set," not "every peer sees exactly the test set and nothing else," and a real LAN can legitimately have other real traffic on it that does not represent a bug. This distinction, and the reasoning behind it, was written into the test's own code as a comment, not left as tribal knowledge.

### V.6 Stress testing at extreme scale as a deliberate, separate practice from regression testing

This project maintains two different tiers of the same underlying test shapes, deliberately kept separate because they serve different purposes. A smaller, fast-running regression suite (`_test_stress.py`, and the various feature-specific `_test_*.py` files) is sized to run quickly and reliably every time, to catch a real regression in previously-fixed behavior. A separate, deliberately much larger and slower extreme-stress suite (`_test_extreme_stress.py`) is sized specifically to surface entirely new bugs that only manifest under genuinely heavy concurrency or volume, numbers an order of magnitude or more beyond the regression suite's own numbers.

This distinction is not academic. Running the extreme-scale suite for the first time surfaced two genuinely serious, previously-unknown bugs that years of the smaller-scale regression suite passing cleanly had never caught: a SQLite lock-and-rollback bug in `storage.py`'s `check_and_pin_signing_key` that could, under real heavy concurrency, raise a second masking exception that propagated uncaught out of `discovery.py`'s listener callbacks and permanently killed the UDP discovery thread for the remainder of an app session; and a silent, large-scale message-loss bug in `messaging.py` caused by multiple concurrent coroutines writing to the same cached outbound websocket connection without any lock serializing the actual writes, corrupting the frame stream in a way that raised no exception on either side and simply dropped the large majority of messages sent under concurrent load. Both were found only because the stress test pushed concurrency and volume far enough past the regression suite's own numbers to actually trigger the failure mode; both were fixed, and both fixes were re-verified by re-running the exact scenario that originally found the bug. See Part IX's entries for Steps 27 and the post-30 extreme-stress round, and `STRESS_TEST_REPORT.md`, for the full detail of both bugs.

### V.7 A reusable template for a two-process live backend test

The following is the general shape that has been used repeatedly for live-testing any feature involving two peers, extracted as a reusable pattern. It assumes Node.js is available for driving headless Chrome over the DevTools Protocol, and a Python virtual environment at `backend/agora` for running the real backend.

Start two real backend processes on distinct ports, each with its own database file, its own downloads directory, and a fixed `AGORA_PEER_ID` so the test can refer to them by a known, stable identity rather than a randomly generated one:

```bash
AGORA_NAME=Alice AGORA_PORT=8781 AGORA_API_PORT=5881 AGORA_DB=/tmp/alice.db AGORA_DOWNLOADS=/tmp/alice_files AGORA_PEER_ID=alice-test \
  ./agora/Scripts/python.exe -m uvicorn app.api:app --host 127.0.0.1 --port 5881 &
AGORA_NAME=Bob AGORA_PORT=8782 AGORA_API_PORT=5882 AGORA_DB=/tmp/bob.db AGORA_DOWNLOADS=/tmp/bob_files AGORA_PEER_ID=bob-test \
  ./agora/Scripts/python.exe -m uvicorn app.api:app --host 127.0.0.1 --port 5882 &
```

For a pure-backend test (no UI involved), drive the two processes' local HTTP APIs directly with `curl` or an equivalent, exactly as the real desktop app's renderer process would. For a full-stack UI test, additionally start the Vite dev server on a known port, launch headless Chrome twice (once per simulated device, each with its own `--user-data-dir` and its own `window.AGORA_API_BASE` pointed at the matching backend's API port via `Page.addScriptToEvaluateOnNewDocument`), connect to each over its own DevTools WebSocket, and drive the UI by evaluating JavaScript that searches for real rendered elements by their real visible text content, since this application does not use `data-testid` attributes or similar test-only hooks; selectors have to match real production markup. A React-controlled `<input>` requires setting its value through the native property setter (`Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value)`) followed by dispatching a real `input` event, rather than simply assigning `.value` directly, because React's own change-tracking does not observe a direct property assignment the way a real user's keystroke does.

Always clean up: kill both backend processes and any launched Chrome processes at the end of the test, and delete any scratch database or temporary files created, so that repeated test runs do not accumulate state or leave stray processes bound to ports a later test might need.

---

## Part VI: Design decision-making

### VI.1 The principle

When a feature touches Agora's core positioning (Part I) or introduces a real, non-obvious tradeoff of any kind, security, privacy, or otherwise, that tradeoff gets named specifically and surfaced, and where it is genuinely a decision only the user can or should make, it gets left to them rather than resolved silently in whichever direction happens to seem reasonable in the moment.

### VI.2 Worked examples from this project

**Auto-update reaching the internet.** Building any form of automatic update-checking is a real, if narrow, exception to the "Agora never requires or checks for internet" positioning. Rather than deciding unilaterally that this exception was acceptable and building it in however seemed convenient, the tension was named explicitly, and the actual resolution, strictly opt-in automatic checking with the toggle defaulting to off, was arrived at through direct discussion rather than assumed. When the feature later changed in a way that made an existing piece of UI copy ("this is the only thing in Agora that ever talks to the internet, and only when you click this yourself, never automatic, never in the background") no longer accurate, because an opt-in automatic-check toggle had since been added, that copy was caught and corrected rather than left to quietly become a false claim sitting in the shipped application.

**The local-folder update source's weaker trust model.** The GitHub-based update path gets real integrity guarantees from HTTPS in transit and from a host allowlist enforced in the Electron main process before any download is ever attempted. A local-folder update source, added later at the user's request specifically because it is the one path that genuinely needs no internet at all, has neither of those protections: there is no transport to secure and no host to allowlist, only whatever file happens to be sitting in the folder a user chose. This was documented plainly as a different kind of trust, resting entirely on "the user picked this folder and file themselves," rather than implied to be equally guarded, which it is not.

**The absence of a code-signing certificate.** `electron-builder` logs "no signing info identified, signing is skipped" on every packaged build of this project, because no code-signing certificate exists for it. This means an auto-updater that downloads and runs a new installer is doing so without the additional integrity guarantee a real code signature would provide. This gap was documented honestly in both `TASK_QUEUE.md` and `BUILD_LOG.md`, with an explicit note to revisit the decision if a real signing certificate is ever obtained, rather than treated as a minor detail not worth mentioning, or quietly worked around in a way that overstated the feature's actual security posture.

### VI.3 How to apply this going forward

When a design choice carries a real security, privacy, or positioning tradeoff, name the specific tradeoff rather than gesturing vaguely at "there are some tradeoffs here." Either ask directly, when the decision genuinely depends on the user's own priorities or risk tolerance and there is no clearly correct answer from first principles, or make a clearly-labeled recommendation (stating that it is a recommendation, not a decision already made) while leaving explicit room for the user to redirect it. When the user does weigh in or correct the direction taken, treat their answer as the final word for that decision, not as an opening position in a negotiation to be pushed back against.

---

## Part VII: Handling scope corrections

### VII.1 The principle

When the user corrects the scope of something, that correction needs to be carried through every place it actually touches: every relevant file, every relevant document, every piece of UI copy or code that reflected the old, now-incorrect framing. A correction that is only applied to the single most recently discussed instance, while older instances of the same mistake remain uncorrected elsewhere, is an incomplete correction and will resurface the same confusion later.

### VII.2 Worked examples from this project

**Screen sharing and video recording.** These were originally scoped together in `TASK_QUEUE.md`, as one combined feature with video recording framed as a planned "follow-up" to screen sharing once a separate repository with working recording functionality could be integrated. The user corrected this directly: "both are the different task." Applying that correction correctly meant re-splitting the single combined `TASK_QUEUE.md` entry into two fully independent entries, each with its own accurate scope and status, not simply adding a note acknowledging the correction while leaving the old combined entry structurally intact.

**Auto-update's target repository.** The feature was first built, by assumption rather than by being asked, pointed directly at this project's own repository, `abdul-wahid-lab/agora`, as a hardcoded value. The user corrected this: the repository itself needed to be something the user supplies, via a URL they enter, not something assumed on their behalf. Applying that correction properly meant reworking the actual validation flow end to end (parsing a pasted URL, rejecting a malformed one immediately with no network call, verifying a well-formed one actually exists via a real API call before accepting it, and only then persisting it), not simply relabeling the previously-hardcoded string as a variable that happened to still default to the same value with no real path to changing it. The default was later restored, deliberately, once the user clarified that the company's own repository should still be the sensible starting point, but with "Change" always available afterward, which is a meaningfully different outcome from the original unconditional hardcoding.

**The generic "any website" update source.** When a third possible update source was discussed, a fully generic "any URL pointing at any file on any website," the user narrowed this down in conversation to specifically "a GitHub repository that isn't necessarily mine." Correctly applying that narrowing meant recognizing that the already-built, already-working "enter any `github.com/owner/repo` URL" functionality already fully covered this case, and that building a third, separate, more generic mechanism on top of it would have been redundant scope creep rather than a correct response to the actual request. Recognizing when a correction is satisfied by existing functionality, rather than always requiring new code, is itself part of applying a correction precisely.

### VII.3 How to apply this going forward

After any correction, actively check every file, document, or piece of UI copy that reflected the old, now-superseded framing, not only the one most recently in the conversation's immediate context. This often means searching the codebase and documentation for the earlier concept by name or by the values it used, rather than relying on memory of exactly where it was mentioned.

---

## Part VIII: Technical architecture reference

This part is a condensed technical map of the actual system, current as of Step 30 and the post-30 extreme-stress-testing round. It exists so that a future session can understand the real shape of the codebase quickly, without having to rediscover it file by file. For full prose explanations with diagrams, see `README.md`'s own Architecture section; this reference is deliberately denser and more enumerative.

### VIII.1 Backend module map (`backend/app/`)

`api.py`: the local HTTP and WebSocket API, built with FastAPI, that the Electron renderer talks to. Binds to `127.0.0.1` only and is never reachable from other peers on the LAN; the actual peer-to-peer traffic happens on separate, `0.0.0.0`-bound ports owned by `discovery.py` and `messaging.py`. Defines every REST endpoint the frontend calls (`/me`, `/me/qr`, `/peers`, `/peers/add-scanned`, `/messages`, `/files/*`, `/calls/*`, `/groups/*`, and more) and the `/events` WebSocket stream that pushes live updates to the UI rather than requiring it to poll.

`discovery.py`: peer discovery over two independent transports feeding one shared `PeerRegistry`: mDNS (`_lanchat._tcp.local.`, the primary path) and UDP broadcast on port 42424 (the fallback, for networks that filter mDNS). Every announcement, on either transport, is signed with the announcing device's Ed25519 signing key and verified, plus checked against `storage.py`'s trust-on-first-use signing-key pinning, before it is ever allowed to reach the live registry. Also exposes `self_announcement()`, which produces the same signed payload used for live broadcasts, reused by the QR-pairing feature so a scanned code goes through the identical trust path as a real discovery hit.

`messaging.py`: real-time chat messaging over a persistent outbound WebSocket connection per peer, cached and reused across sends (`_out_conns`), with a parallel per-peer `asyncio.Lock` (`_send_locks`, added after the concurrent-write bug described in Part IX) serializing actual writes to each connection. Handles encryption (via `crypto_identity.py`), delivery-status tracking (`pending` to `sent` to `delivered`), and a background flush loop that retries pending messages once a peer becomes visible again. Also the single choke point every other peer-to-peer service (file transfer, calling, groups, deletion, disappearing messages) sends its own control messages through, via `send_control`, so encryption and connection management only need to be implemented once.

`crypto_identity.py`: the cryptographic core. Two distinct keypairs per device: an X25519 keypair for deriving per-peer shared secrets used to encrypt message content, and an Ed25519 signing keypair used exclusively to sign discovery announcements. Directional key derivation (`derive_directional_keys`) produces two distinct symmetric keys per peer pair, not one shared key reused both ways, specifically because a single shared key was found to be a real, exploitable reflection attack during adversarial testing (see Part IX, Step 25). ChaCha20-Poly1305 for message encryption/decryption; `sign_announcement`/`verify_announcement` for the discovery-signing scheme.

`storage.py`: the SQLite-backed persistence layer (`MessageStore`), covering messages, known peers, blocked peers, device identity keys, call history, file-transfer records, group state, and disappearing-message settings. Owns the trust-on-first-use signing-key pinning (`check_and_pin_signing_key`) and encryption-key pinning (`check_and_remember_peer_key`), both capped at `MAX_KNOWN_PEERS` (10,000) with oldest-`last_seen`-evicted-first eviction to prevent unbounded growth under a flood of fake identities. Runs in WAL mode for safer concurrent access.

`filetransfer.py`: peer-to-peer file sending and receiving (`FileTransferService`), including SHA-256 integrity verification (`sha256_file`), resume-from-partial-file support for a transfer interrupted mid-stream, an accept/decline flow for the receiving side, and bandwidth-aware throttling.

`calling.py`: audio and video call signaling and state management (`CallService`), including offer/answer/ICE-candidate relay, one-call-per-peer bookkeeping (`_active_for_peer`) to arbitrate busy/collision scenarios when both sides offer at nearly the same instant, and call-history recording.

`groups.py`: group chat, group calling, and group file/image sharing on top of the same underlying peer-to-peer primitives, fanned out per member rather than relying on any central group-hosting server.

`deletion.py`, `disappearing.py`: delete-for-me/delete-for-everyone message deletion, and per-conversation disappearing-message timers.

`cli_chat.py`, `cli_test.py`: the original CLI-only interface used to prove the transport layer before any UI existed, and a throwaway diagnostic CLI identity used in some manual testing. Not part of the shipped product's UI path.

The various `_test_*.py` files are not part of the shipped application; they are the project's test suites, run directly as scripts rather than through a test runner like `pytest` (which is not installed in this project's virtual environment). See Part V and `STRESS_TEST_INSTRUCTIONS.md` for how they are organized and run.

### VIII.2 Frontend structure (`frontend/src/`)

The frontend is a React application (Vite-built) wrapped in Electron for the desktop build, able to also run as a plain browser tab against a manually-started backend for development.

Top-level: `App.jsx` owns the overall layout and tab state (Nearby, Chats, Calls, Files, Settings) and wires the various hooks and components together. `api.js` is the thin HTTP/WebSocket client for the local backend API, with base-URL resolution that checks `window.AGORA_API_BASE` (set by the Electron preload script), then a Vite env var, then a hardcoded fallback, in that order.

Hooks (`src/hooks/`): `useCall.js` and `useGroupCall.js` own the real WebRTC connection logic for 1:1 and group calls respectively, including the pre-negotiated-transceiver screen-sharing mechanism (see Part X.1). `usePeers.js` polls and live-updates the visible peer list. `useConversations.js`, `useGroups.js` manage chat and group state. `useIsPeerBlocked.js`, `useIdentityWarnings.js`, `useSelfAvatarPhoto.js` handle their respective narrower concerns.

Components (`src/components/`): a large set of screen- and modal-level components, including `PeerList.jsx` and `ScanRadar.jsx` for the Nearby tab, `ChatsListPanel.jsx`/`ConversationPane.jsx`/`GroupConversationPane.jsx` for chat, `CallsScreen.jsx`/`CallOverlay.jsx`/`GroupCallOverlay.jsx` for calling, `FilesScreen.jsx` for file transfer history, `SettingsScreen.jsx` for app settings, `TitleBar.jsx` (the real menu bar: File, Conversation, Network, View, Help, each backed by `DropdownMenu.jsx`) and `TitleBarModals.jsx` (the shared `ModalOverlay` chrome plus most of the Network/File-menu dialogs), `QrPairingModal.jsx` and `ScreenSharePickerModal.jsx` for their respective features, and `UpdatesModal.jsx` for the auto-update feature.

Libraries (`src/lib/`): small, focused, local-storage-backed helpers following a consistent pattern (never synced anywhere, never sent to a peer): `avatar.js` (avatar color/initials), `mute.js` (per-peer notification muting), `chatTheme.js` (per-conversation theme choice), `fileTypes.js` (file-extension-to-icon mapping), `webrtc.js` (the screen-share transceiver helpers), `updateSettings.js` (auto-update preferences: repository, source mode, token, schedule).

### VIII.3 Electron shell (`frontend/electron/`)

`main.cjs`: the Electron main process. Spawns the real Python backend as a child process (the frozen `agora-backend.exe` produced by PyInstaller in a packaged build, or the dev virtual environment's `python.exe` directly in development), writing its data to a proper per-user app-data directory rather than the repository folder. Opens a frameless `BrowserWindow` (the app draws its own custom titlebar) and wires real window controls over IPC. Owns every privileged capability the sandboxed renderer cannot have directly: file pickers, folder pickers, `desktopCapturer`-backed screen-source enumeration for screen sharing (with a custom `setDisplayMediaRequestHandler`, since Electron has no built-in screen-share source picker on Windows), and the auto-update download/install/folder-scan handlers, each with its own host-allowlist or filesystem-scoped safety checks performed in the privileged process itself rather than trusted from the renderer.

`preload.cjs`: the narrow, explicit bridge exposing only specific, named functions from the main process to the renderer via `window.electronAPI`, rather than exposing Node or Electron APIs wholesale.

### VIII.4 Port and transport map

The local API (FastAPI/uvicorn) binds to `127.0.0.1` on a port set by `AGORA_API_PORT` (default 5001 in manual/dev usage; dynamically chosen and communicated to the renderer via `window.AGORA_API_BASE` in the real Electron app). Peer-to-peer discovery and messaging bind to `0.0.0.0` on a port set by `AGORA_PORT` (default 8001), used for both the messaging WebSocket server and as the base for file-transfer and call-media ports. UDP broadcast discovery uses a fixed port, 42424, across all devices, since broadcast discovery requires a port every participant agrees on in advance. Test suites in this project consistently use loopback ports in higher ranges (roughly 22000 to 24000) specifically chosen to avoid colliding with the real application's default ports or with each other when multiple test processes run concurrently.

### VIII.5 The overall architecture: why peer-to-peer, not client-server

Every device in Agora runs the exact same stack: an Electron shell and React UI talking to a local API, which talks to Discovery, Messaging, FileTransfer, and Calling services, which talk to that device's own SQLite file. Two devices on a LAN are peers, full stop - there is no third kind of node, no "server mode" a device can be put into, no special machine anything has to route through.

[DIAGRAM: r_architecture.png | Figure VIII.5.1 - No server anywhere: two peer devices, same stack]

**Why this, and not a client-server model (even a self-hosted one):** a self-hosted server - even one the user runs themselves on their own LAN - is still a single point of failure and a single point of trust that a pure peer-to-peer design doesn't need. It would need to be kept running, kept updated, and kept reachable, and every one of Agora's three pillars (Part I) specifically describes situations where that assumption doesn't hold: a classroom where no one machine is "the server," an emergency where the device that would have been the server might be the one that's gone, a temporary pop-up network with nobody willing to be the one who has to leave their laptop on. A pure peer-to-peer model also means the feature set is uniform - every device can discover, message, call, and transfer files with every other device, with no asymmetry between "server" and "client" capabilities to design around, test twice, or explain to a user.

**Why each device's local API binds only to `127.0.0.1`:** this was a real, deliberate security decision, not an accident of how FastAPI happens to default. A local API reachable from the LAN would mean any other device on the network - not just a paired peer - could potentially call it directly, bypassing whatever trust and encryption the real peer-to-peer protocol enforces. Binding to loopback only means the local API is purely this device's own UI talking to its own backend; every byte that actually crosses the network goes through the separate, `0.0.0.0`-bound sockets that `discovery.py` and `messaging.py` own, which do enforce real cryptographic trust on every frame.

### VIII.6 The discovery system

Discovery is how two devices on the same network find each other without either one needing to know the other's address in advance. It runs over two independent transports feeding one shared live registry, so a peer only needs to be reachable by one of the two to show up.

[DIAGRAM: r_discovery_seq.png | Figure VIII.6.1 - Discovery: mutual mDNS/UDP announcement]

**mDNS (`_lanchat._tcp.local.`) is the primary path.** It is the standard, OS-supported way devices on a LAN advertise and browse for services, used by everything from printers to Chromecasts, which means it is more likely to survive whatever a given router or network's firewall rules were actually designed around.

**UDP broadcast on port 42424 is the fallback**, for the real, observed case of networks that filter or disable mDNS traffic (some corporate and public Wi-Fi networks do this deliberately, to limit device-to-device chatter). A broadcast packet on a well-known fixed port is cruder but more likely to get through exactly where mDNS doesn't.

**Why both, rather than picking the one that seems more modern:** relying on a single discovery transport means a single network misconfiguration or filtering policy makes Agora simply fail to find anyone, with no fallback and no obvious cause for a user to diagnose. Running both costs very little (a second lightweight background thread) and converts a hard failure into a same-functionality fallback.

**QR-code pairing is a third, deliberately different way to add a peer** - for when you'd rather not wait on radar at all, or when a peer genuinely isn't on the same broadcast domain mDNS/UDP can reach. Nearby's QR button shows a code encoding this device's own signed announcement, and scanning someone else's code submits it through the identical signature-verification and key-pinning check real discovery enforces (see Part X.2) - not a separate, weaker path in. This was a real design question settled deliberately rather than assumed: a faster input channel for the same trusted data, not a shortcut around the trust check itself.

Every announcement on either transport is signed with the sender's Ed25519 key and checked against a pinned signing key before it is ever allowed to reach the live peer list - the full mechanism is covered in VIII.8 below, since it is really part of the encryption system, not the discovery system, even though it rides on discovery's own wire format.

### VIII.7 The messaging system

Messaging is direct, device-to-device chat: no server queues a message in between, and a message that cannot be delivered right now is held entirely on the sender's own device until it can be.

[DIAGRAM: r_messaging_seq.png | Figure VIII.7.1 - Messaging: send, deliver, acknowledge]

A message's lifecycle has three states, visible as the delivery tick in the UI: `pending` (saved locally, not yet handed to a connection), `sent` (handed to the peer's connection successfully), and `delivered` (the peer's own explicit acknowledgment came back). If the peer is offline when a message is sent, it simply stays `pending` - there is no error, no retry button needed, no server-side queue holding it elsewhere. A background flush loop notices when a previously-unreachable peer becomes visible again and resends anything still pending for them, in the original order, exactly once.

For the full code-level path, naming the actual functions and wire message types involved end to end:

[DIAGRAM: r_message_full_detail.png | Figure VIII.7.2 - Sending a message, full code-level detail]

**Why a persistent cached connection per peer, not one-connection-per-message:** opening a fresh TCP/WebSocket connection for every single message would mean paying a real handshake cost (including the encryption handshake described in VIII.8) on every send, and would make the ordering and retry logic significantly harder to reason about, since multiple in-flight connections to the same peer would need their own coordination. One connection per peer, reused and cached, kept open as long as the peer stays reachable, makes both the common case fast and the failure/retry case simple: a connection either is or isn't currently open, and if it drops, exactly one piece of code (`_drop_connection`) is responsible for tearing it down cleanly. The real cost of that simplicity, found directly by stress testing rather than assumed, was that a single shared connection needs real serialization against itself under concurrent sends (the per-peer lock from Part IX's Step 31) - a tradeoff worth making deliberately, not a flaw to have avoided by never caching a connection at all.

**Why delivery acknowledgment is a real application-level message, not just relying on the transport's own delivery guarantees:** TCP guarantees bytes arrive in order if the connection stays open, but it says nothing about whether the receiving application actually processed them, and nothing at all about what happens to a message queued for a connection that was never open in the first place. An explicit `ack` message, generated only once `_on_chat_received` has actually run (meaning the message is durably saved on the receiver's own device), is what lets the sender's UI show a delivery tick that means something real, not just "the bytes left my network card."

### VIII.8 The encryption system, in full

This is the part of Agora doing the most unusual engineering work, because there is no central server here to issue TLS certificates from, verify identities, or revoke a compromised key. The design that fits is the one SSH and Signal both independently arrived at instead: every device has its own long-lived identity, any two devices derive a shared secret independently without ever transmitting it, and trust is built up the first time you actually meet someone rather than vouched for by a third party.

**Two separate keypairs, generated once on first launch and never regenerated:**

| Keypair | Algorithm | Used for | Ever leaves the device? |
|---|---|---|---|
| Encryption identity | X25519 | Deriving the shared secret two peers encrypt with | Only the public half, broadcast via discovery |
| Signing identity | Ed25519 | Proving a discovery announcement really came from the peer_id it claims | Only the public half, broadcast via discovery |

[DIAGRAM: r_key_generation.png | Figure VIII.8.1 - Identity key generation and reuse]

**Why two separate keypairs, not one key doing both jobs:** a Diffie-Hellman key (X25519) and a signing key (Ed25519) are different mathematical tools solving different problems, and reusing one key for both purposes is a well-known real cryptographic engineering mistake independent of whether a specific attack has been demonstrated against this exact project - the kind of shortcut that looks harmless until a vulnerability in how one use of the key interacts with the other use is found, sometimes years later, in a context nobody designing the system anticipated. Generating two keys costs essentially nothing; the risk avoided is real.

**1. Signed discovery - proving an announcement is really from who it claims.** Every mDNS TXT record and UDP broadcast packet is signed with the sender's Ed25519 key, over exactly the fields that matter (`peer_id`, `address`, `port`, encryption `public_key`, deliberately not the cosmetic device name, which can legitimately change without being a trust event). A receiver verifies the signature and pins the signing key to that peer_id the first time it is seen, before the announcement is ever allowed to affect the live peer list:

[DIAGRAM: r_signed_discovery_seq.png | Figure VIII.8.2 - Signed discovery: verify, then pin on first sighting]

This is what actually stops a forged broadcast: an attacker can self-sign their own fake announcement with a freshly-generated keypair - the signature itself is perfectly mathematically valid - but they cannot produce a signature that matches a signing key already pinned to someone else's peer_id. Confirmed by directly attacking it, not just reasoned about: a real adversarial test (Part IX, Step 25) flooded exactly this kind of forged packet at a live device, and it was rejected every time.

**Why trust-on-first-use, rather than requiring some kind of pre-shared or centrally-verified identity:** there is no central authority in this system to verify an identity against, by design (Part I) - any scheme requiring one would reintroduce exactly the server dependency Agora exists to avoid. Trust-on-first-use is the same model SSH popularized for exactly this reason: the first contact is inherently a leap of faith (so is meeting someone in person for the first time), but every contact after that is cryptographically verified against what was learned the first time, and a changed identity later is a real, surfaced, dismissible warning rather than something silently trusted or silently blocked outright.

**2. Shared secret and directional keys - what actually encrypts a message.** Once two devices know each other's real, verified X25519 public key, each independently computes the identical shared secret with nobody ever transmitting it, then splits that secret into two separate, labelled keys, one for each direction:

[DIAGRAM: r_directional_keys.png | Figure VIII.8.3 - Directional key derivation (two keys, not one)]

**Why two directional keys, not one shared key used both ways:** a single shared key was tried first, and a real reflection attack confirmed it was exploitable, not merely theoretically weak: a message Alice encrypted for Bob could be captured and bounced straight back at Alice's own connection, and her own side would accept it as genuinely coming from Bob, since the same key validated it either direction. Splitting the secret into two HKDF-labelled directional keys closes this completely - a blob valid in the Alice-to-Bob direction can mathematically never be mistaken for a Bob-to-Alice blob, even between the exact same two devices using the exact same underlying shared secret. This is a case where the "obvious" simpler design (one key) was actually built first, found broken by testing, and replaced - documented here so the reasoning survives, not just the fix.

**3. Every real frame, encrypted and authenticated.** `"hello"` (just an identity announcement, containing no secret) is the only frame ever sent as plaintext. Everything after it - chat messages, delivery acknowledgments, file-transfer chunks, call signaling (SDP/ICE) - is ChaCha20-Poly1305 authenticated encryption, sent as a binary WebSocket frame instead of a plaintext one:

[DIAGRAM: r_encrypted_frame_seq.png | Figure VIII.8.4 - Every real frame: encrypted, authenticated, or dropped]

**Why authenticated encryption, not plain encryption:** confidentiality alone (hiding the content) is not the same guarantee as authentication (proving the content was not tampered with in transit). ChaCha20-Poly1305 provides both in one construction - a tampered or forged frame fails to authenticate and is dropped outright, never partially processed, never accepted with silently-corrupted content. The file-transfer TCP channel (a separate socket from the messaging WebSocket) gets the identical per-chunk treatment, which closes a real gap beyond simple confidentiality: that socket has no identity check of its own otherwise, so without the correct derived key, nothing a third party sends to it will ever successfully decrypt, let alone be accepted as a real file chunk.

**4. Trust-on-first-use for the encryption key itself, separately from signing-key pinning.** `known_peers` also remembers a peer_id's encryption public key the first time real communication happens with them. If that key ever changes later, it is surfaced as a real, dismissible warning in the app (`IdentityWarningBanner.jsx`) rather than silently trusted or silently blocked - the app deliberately does not decide on the user's behalf whether a changed key means a genuine reinstall on the peer's end or someone else now claiming that identity, since only the human on each end can actually know which it is.

**What this does not cover, stated plainly:** WebRTC call media (the actual audio/video) is always DTLS-SRTP encrypted by the browser/Electron engine itself, with no way to turn it off and therefore never a gap Agora's own code needed to close. The residual, honestly-documented gaps that remain are the lack of a code-signing certificate for packaged builds (Part VI.2) and the local-folder update source's weaker trust model (Part X.3) - both already covered in depth earlier in this document.

### VIII.9 The file transfer system

File transfer lets one device send a file directly to another, with the receiving side given a real choice to accept or decline before anything is written to disk.

[DIAGRAM: r_filetransfer_flow.png | Figure VIII.9.1 - File transfer: offer, accept, stream, verify, resume]

The flow: the sender calls `POST /files/send`, which sends an offer to the peer over the existing encrypted messaging connection (file transfer does not duplicate connection-management logic; it rides `send_control`, the same choke point every other peer-to-peer service uses). The receiver gets a real accept/decline choice in the UI. Only on accept does a dedicated connection open for the actual bytes - a separate raw TCP socket from the messaging WebSocket, still with the identical per-chunk ChaCha20-Poly1305 treatment described in VIII.8. The file streams to disk in chunks; once complete, the receiver independently computes a SHA-256 hash and checks it against the hash the sender included in the original offer. If the connection drops partway through, a resume path picks up from the last confirmed byte offset rather than restarting the whole transfer, verified directly by a real test that seeds a receiver-side partial file and confirms `resend()` continues from exactly that offset.

**Why a dedicated connection per transfer, rather than streaming file bytes over the same WebSocket chat and control messages use:** the messaging WebSocket is also carrying real-time chat, delivery acks, and call signaling, all of which are latency-sensitive in a way bulk file data is not. Streaming a large file over that same connection would head-of-line-block everything else sharing it - a chat message typed mid-transfer would have to wait behind however much of the file happened to already be queued ahead of it. A dedicated connection, opened only once a transfer is actually accepted, keeps bulk data physically separate from everything latency-sensitive.

**Why SHA-256 verification on the receiving end, rather than trusting the transport to deliver the file correctly:** TCP already guarantees byte-level integrity in transit (a corrupted TCP segment is retransmitted automatically), so this isn't protecting against a noisy wire - it's protecting against every other way a file can end up wrong: a bug in the chunking/reassembly code, a partial write that wasn't actually complete, a resume that picked up from the wrong offset. An independently-verified hash, computed from the same bytes-on-disk the user will actually open, catches all of those categories at once rather than needing a separate check for each.

**Why resume-from-offset, rather than always restarting a dropped transfer:** on a real LAN, a transfer can be interrupted by something as mundane as a laptop briefly losing Wi-Fi association while walking between rooms. Restarting a large file from zero every time this happens would make file sharing on anything but a rock-solid connection genuinely painful. Resuming from the last confirmed byte, with the final hash-check as the real safety net that an incorrect resume would be caught, is why this project's testing specifically exercises a simulated partial-file-on-disk scenario rather than only testing the uninterrupted happy path.

**Executables and installables get an extra interstitial** - two required checkboxes plus a countdown - before the accept path is even reachable, a deliberate extra speed bump for the single highest-consequence file type a receiver could be tricked into running, layered on top of (not instead of) the hash verification and encrypted transport every file already gets.

### VIII.10 The calling system

Calling provides real-time audio and video between two peers, with signaling (who's calling whom, what the connection parameters are) relayed over the existing messaging connection, and media (the actual audio/video) flowing directly between the two devices.

[DIAGRAM: r_calling_seq.png | Figure VIII.10.1 - Calling: signaling relayed, media direct]

**Why signaling rides the existing messaging WebSocket, rather than a dedicated signaling server or a dedicated signaling connection:** WebRTC's own design always requires some out-of-band channel to exchange an initial offer/answer and ICE candidates before a direct media connection can be established - that's inherent to WebRTC, not an Agora-specific problem. The common solution elsewhere is a dedicated cloud signaling server; Agora has no server to be that, and building a brand-new peer-to-peer signaling channel just for calls when an encrypted, already-open, already-trusted connection to that exact peer already exists for chat would be pure duplication. Riding the existing connection means calling inherits connection management, encryption, and peer-liveness tracking for free.

**Why no STUN/TURN servers:** STUN and TURN exist to help WebRTC peers behind different NATs or restrictive firewalls discover a path to each other, typically by relaying through a third-party server when a direct path isn't possible - again, a server dependency. On the same LAN subnet, which is Agora's entire operating assumption, two devices can always reach each other directly; there is no NAT traversal problem to solve, so there was never a reason to add the server dependency STUN/TURN would represent, even as a fallback.

**One call per peer at a time, arbitrated deterministically.** `CallService` tracks at most one active call per peer (`_active_for_peer`); a second offer to or from a peer already in an active call is treated as a collision, not silently layered on top. A real, deliberate collision-storm stress test (Part IX, Step 31) fired dozens of simultaneous overlapping offers at one pair from both sides at once specifically to confirm this bookkeeping stays in one consistent state under real concurrency, not just in the easy sequential case.

### VIII.11 The storage system

Every device keeps its own SQLite file. There is no shared, synced, or central database anywhere in this system - "my messages" and "your messages" are never the same row in the same table on any machine, because there is no machine both devices' data ever shares.

[DIAGRAM: r_storage_flow.png | Figure VIII.11.1 - Per-device storage, no shared database]

Five tables make up the whole schema: `messages` (one row per sent/received chat message, with its `pending`/`sent`/`delivered`/`received`/`failed` status), `files` (one row per transfer, with its hash and save path), `calls` (one row per call, with media type and duration), `known_peers` (a peer's display name and last-seen time, outliving their live discovery session so a conversation still shows a real name once they've gone offline), and `pending_deletes` (a delete-for-everyone that couldn't reach a peer immediately, retried automatically once they're back, the same durability guarantee a normal held message already gets).

**Why SQLite, not a client-server database engine:** a client-server database (Postgres, MySQL, anything requiring a running server process) would reintroduce exactly the kind of infrastructure dependency Agora's whole premise rejects, for data that is, per device, genuinely low-volume (one person's own message history, not a multi-tenant workload). SQLite is a real, battle-tested, embedded, zero-administration database file that needs nothing running and nothing configured - it is already the correct tool for "one application, one user, one device's worth of data," which is exactly Agora's actual storage shape.

**Why a short-lived connection per operation (`asyncio.to_thread`), not one long-lived shared connection:** SQLite's own concurrency model is simplest and safest when writers don't hold long-lived transactions against each other. Opening a fresh, short connection per read/write, on a worker thread so it never blocks the asyncio event loop, is simple to reason about and - as Part IX's Step 31 found the hard way under genuinely extreme concurrency - still needed real hardening (transaction-state tracking, bounded retry on lock contention) at the edges, but never needed a more complex connection-pooling architecture to be correct at this application's actual real-world scale.

### VIII.12 Desktop packaging

The shipped Windows application is a real Electron process tree, not a browser tab pointed at a web app and not a mockup.

[DIAGRAM: r_packaging_flow.png | Figure VIII.12.1 - The real Electron process tree]

Electron's main process spawns the Python backend as a genuine child process - in a packaged build, the PyInstaller-frozen `agora-backend.exe`, fully self-contained with no dependency on Python being installed on the machine it runs on; in development, the dev virtual environment's `python.exe` directly, for fast iteration without a freeze step on every change. The main process opens a frameless `BrowserWindow` (the app draws its own custom titlebar in React, matching the real design rather than using the OS's native chrome), wired to the backend's loopback-only API and to the main process itself via a narrow preload/contextBridge IPC surface.

**Why a frozen, self-contained backend executable, not a requirement that the user have Python installed:** requiring an end user to separately install a correct, compatible Python interpreter before a desktop chat application would even run is a real adoption barrier most users would reasonably refuse to clear. Freezing the backend into one self-contained executable via PyInstaller means the packaged app is genuinely double-click-and-run, with no hidden prerequisite, which matters directly for Agora's "walk in, use it, leave" temporary-communities pillar (Part I.2) - a tool that needs a development environment installed first fails that use case before it even starts.

**Why a frameless window with a custom-drawn titlebar, rather than the OS's native window chrome:** this was a real design-fidelity decision - the actual UI design calls for a specific titlebar (traffic-light-style window controls plus the real File/Conversation/Network/View/Help menu bar) that needed to look identical across whatever OS theme a user happens to be running, rather than inheriting whatever native chrome Windows happens to draw by default. Frameless-plus-custom-titlebar is the standard Electron pattern for this; the real work was wiring the decorative buttons to genuine window-control IPC calls, not just drawing something that looks like a titlebar.

---

## Part IX: Project history, step by step

This is a condensed chronological index of every numbered step recorded in `BUILD_LOG.md`, kept here as a fast-reference timeline. For full detail on any step, read the corresponding entry in `BUILD_LOG.md` itself; this index exists so a future reader can quickly locate which step covers a given topic without scanning the entire file.

Step 1: the local HTTP/WebSocket API layer connecting the already-working backend services to a future real UI. Step 2: the initial React port of the UI, Nearby and onboarding made live. Step 3: the Chats screen wired to real messaging. Step 4: the Files screen wired to real file transfer. Step 5: the Calls screen wired to real calling, verified on a single machine. Step 6: the Electron shell, backend sidecar-process spawning, and installer packaging, verified across two real machines. Step 7: an exact-match rebuild of the UI against the real design file. Step 8: Nearby scan visualization, quick-win retry fixes, and a real backlog audit. Step 9: delete-for-me, clear-conversation, clear-call-history, and delete-for-everyone. Step 10: forwarding a message or a received file. Step 11: file transfers automatically retrying on reconnect. Step 12: inline image previews in chat. Step 13: settings screens, scoped down to real content only. Step 14: group chat, group calling, and group file/image sharing. Step 15: group calls made to ring for real consent, with three real bugs found and fixed by testing. Step 16: offline delivery for group messages, and delete/forward working inside groups. Step 17: Nearby search, call-history pagination, and adaptive bandwidth throttling. Step 18: a real self-avatar photo picker. Step 19: delete/forward icons replaced by a right-click context menu. Step 20: forwarding made to work to offline contacts too. Step 21: Nearby always opening the radar, with Rescan shown as a real-time overlay. Step 22: the top menu bar made real (File, Conversation, Network, View, Help). Step 23: blocking a peer, plus WhatsApp-reference-style per-chat quick actions. Step 24: real transport encryption and peer identity (Phase 5), the X25519/Ed25519/ChaCha20-Poly1305 foundation described in Part VIII.1. Step 25: a real network wiretap test confirming traffic is actually encrypted on the wire, plus five adversarial attacks, two of which found real vulnerabilities that were fixed (a reflection attack from reusing one shared key both directions, and unsigned discovery broadcasts allowing spoofing). Step 26: signed discovery broadcasts, closing the remaining adversarial finding from Step 25. Step 27: stress-testing the signed-discovery fix at a larger (but still regression-suite) scale, which found two further real bugs: a signing-key pin race condition, and unbounded `known_peers` growth under a flood of fake identities, both fixed. Step 28: screen sharing during any call, audio or video, built with zero backend or wire-protocol changes via pre-negotiated WebRTC transceivers (see Part X.1), with a real design mistake (relying on native track mute events) found and fixed by live testing. Step 29: QR-code peer pairing, reusing the exact same signed-announcement trust path as live discovery rather than inventing a weaker separate one. Step 30: auto-update from GitHub, built as strictly opt-in, with a real bug found (a misleading error message when a repository has zero published releases) and fixed.

After Step 30, two further rounds of work, not yet folded into a numbered `BUILD_LOG.md` step as of this file's writing but recorded in `TASK_QUEUE.md`'s own addenda and in `STRESS_TEST_REPORT.md`: a same-day addendum to the auto-update feature adding a default repository (so a fresh install checks the company's own repository immediately rather than prompting for a URL first) and a second, fully offline update source (a local folder, read by filename convention rather than a manifest); and a dedicated extreme-stress-testing round, deliberately pushed far beyond the existing regression suite's scale, which found and fixed two further genuine concurrency bugs (the SQLite lock/rollback/discovery-thread-death bug, and the concurrent-websocket-write message-loss bug), both described in full in Part V.6 and `STRESS_TEST_REPORT.md`.

---

## Part X: Established implementation patterns (worked recipes)

These are the general, reusable design patterns this project has actually developed and proven out, written up so a similar future problem can reuse the same approach rather than reinventing it, or worse, reinventing a worse version of it.

### X.1 Pre-negotiate, don't renegotiate, for an optional WebRTC media stream added mid-call

**The problem shape:** a call is already in progress, using some initial set of WebRTC tracks (audio, maybe video), and partway through, an additional, optional media stream needs to start flowing (screen sharing is the concrete case this was built for), without disrupting the existing call or requiring new backend signaling.

**The naive approach, and why it was rejected:** renegotiate the connection once the optional stream actually starts, sending a fresh SDP offer/answer. This requires new wire-protocol message types the backend has never seen before, new state to track on both ends, and carries real collision risk, because this project's calling logic already treats a second, unexpected offer arriving for a peer already in an active call as a competing call attempt to be refused, not as a renegotiation of the existing one.

**The actual solution:** every call, from the very start, pre-negotiates a second, initially-empty media slot (an `RTCRtpTransceiver` with no real track attached yet) as part of the one and only offer/answer exchange the call ever performs, added immediately after the call's own real camera/microphone tracks so that it is reliably the last transceiver of its kind in negotiation order on both the offering and answering sides. Starting to actually share is then nothing more than `RTCRtpSender.replaceTrack()` into that already-negotiated, previously-empty slot: no renegotiation, no new SDP round trip, and the backend's calling logic never even knows anything happened, because from its point of view the call's signaling never changed at all.

**The disambiguation trick:** once a second video transceiver exists, the receiving side needs a reliable way to tell "this is the camera" apart from "this is the screen." The rule adopted: the screen transceiver is always the last video-kind transceiver in `pc.getTransceivers()`'s own ordering, computed fresh at the moment a track arrives rather than cached, since that ordering is consistent on both ends of a negotiation as long as the screen transceiver is always added after the camera transceiver on both sides, every time, with no exceptions. A real bug was caught during this project's own build of this pattern: initially the screen transceiver was added inside the shared connection-setup function, before the caller's own camera track was added, which made it the first video transceiver rather than the last, silently breaking the entire disambiguation rule. The fix was to move the screen-transceiver-adding call out of the shared setup function and into each specific call-initiation path, explicitly placed after that path's own media tracks were already added.

**How viewers learn sharing started or stopped:** not via the pre-negotiated track's own native mute/unmute events, which a real live test proved unreliable (see Part V.3). Instead, a second pre-negotiated item, a small `RTCDataChannel`, created as part of the same initial offer/answer, carries explicit `{type: "screen_share_start"}` and `{type: "screen_share_stop"}` JSON messages peer-to-peer, directly over the WebRTC connection, still without ever touching the backend's own signaling.

### X.2 Reuse the existing trust path for a new input channel, rather than inventing a weaker parallel one

**The problem shape:** an existing feature (live peer discovery) has a real, carefully-built trust model (signed announcements, verified, checked against a pinned signing key before being trusted). A new feature (QR-code pairing) wants to let a user add a peer through a different input channel (scanning a code with a camera) than the one that trust model was originally built around (receiving a network broadcast).

**The tempting but wrong approach:** build a separate, simpler trust check specific to the new channel, perhaps reasoning that a QR code scanned at close physical range is inherently more trustworthy than an arbitrary network packet and therefore does not need the same rigor. This quietly creates a second, weaker path into the same trusted state (the live peer registry), undermining the careful work already done on the first path.

**The actual solution:** make the new channel carry literally the same payload the existing trust path already knows how to verify, and route it through the exact same verification function. Concretely, the QR code encodes exactly the same signed announcement structure (`peer_id`, `address`, `port`, `public_key`, `signing_public_key`, `signature`) that a live mDNS or UDP broadcast already carries, produced by a new `self_announcement()` method that is really just the existing signing logic extracted into a reusable form. Scanning a code submits that payload to a new backend endpoint that runs it through the identical `crypto_identity.verify_announcement` signature check and `storage.py`'s `check_and_pin_signing_key` pinning that the live discovery listeners already enforce on every real broadcast. A forged or tampered QR code is rejected by exactly the same logic that would reject a forged network packet, because it is, structurally, the same kind of object being checked by the same code.

**The payoff beyond security:** because the new channel ends at the same `PeerRegistry.upsert()` call a live discovery hit would make, every downstream behavior that already exists for a normally-discovered peer (persisting it to `known_peers`, broadcasting a `peer_joined` event over the UI's WebSocket) comes along for free, with no separate "how does a QR-added peer become a real contact" code path that would need to be built and kept in sync with the normal one.

### X.3 Any exception to "never touches the internet" must be opt-in, visible, and separately decided

**The problem shape:** a genuinely useful feature (checking for software updates) inherently requires, at least sometimes, reaching out over the real internet to a real external server, in a project whose entire identity is built around never requiring or silently using the internet for anything.

**The solution:** the feature is built so that the internet is only ever touched as the direct, immediate consequence of an explicit user action (clicking "Check for Updates," or separately, deliberately toggling on an optional automatic-check setting), never as a default or a side effect of simply opening or using the application. The automatic-check toggle itself defaults to off. Every path that can touch the internet is documented as doing so, in the UI copy itself, not buried in a settings description nobody reads. When this pattern was first built, an earlier piece of UI copy (written when the feature was purely manual) claimed something stronger than what later became true once an opt-in automatic-check toggle was added; the inaccurate copy was caught and corrected rather than left to quietly misstate what the shipped feature actually did. The general principle: a feature that is allowed to be an exception to a core positioning rule still has to respect the spirit of that rule as closely as possible, and any UI claim about the exception's scope has to be re-checked for accuracy every time the feature's actual behavior changes.

### X.4 Validate network-facing input as cheaply as possible first, and never trust a privileged process's input source blindly

**The problem shape:** a user-supplied value (a repository URL, a download URL) needs to be validated before being used, and some of the validation steps are cheap and local (does this even look like the right shape of thing) while others require a real network round trip (does this actually exist).

**The solution:** always perform the cheap, local, no-network check first, and only proceed to the expensive network-dependent check if the cheap one passes. A malformed URL should be rejected instantly, with a clear message, and with zero network traffic generated, rather than being handed to a network call that will predictably fail anyway, wasting time and giving a worse, less specific error message. This project's auto-update repository-entry flow does exactly this: a regular-expression check for a valid `github.com/<owner>/<repo>` shape happens first and fails fast with no network call if it does not match; only a URL that passes this cheap check goes on to a real `GET` request confirming the repository actually exists.

A related, separate principle for the privileged side of this same flow: even though the renderer process is the one that constructs a download URL from data it already received from a trusted API (GitHub's own API response), the privileged Electron main process that actually performs the download does not simply trust that the renderer validated the URL correctly. It re-validates the URL's host against an explicit allowlist itself, at the one point where real filesystem and network access actually happens, specifically because the main process is the privileged one and should not extend blind trust to the sandboxed renderer's own input handling, regardless of how well-behaved that renderer is expected to be in the current version of the code.

### X.5 A loud, specific error is strictly better than a quiet, generic one

**The problem shape:** an operation can fail for more than one distinct underlying reason, and a single generic catch-all error message would technically be accurate for all of them, but would actively mislead the user about which one actually happened.

**The concrete example:** checking a GitHub repository's latest release can fail because there genuinely is no internet connection, or because the repository has simply never had a release published to it yet (a distinct situation that also happens to return an HTTP 404, the same status a missing or unreachable repository would return). The original implementation treated both cases identically, producing a "couldn't reach GitHub, no internet or it's unreachable" message even when the real, true cause was simply that no release had ever been published, a situation where the user's internet connection was working perfectly fine the whole time. This was caught, recognized as actively misleading rather than merely imprecise, and fixed by specifically detecting the 404-with-no-releases case and reporting it with its own accurate message.

**The general rule:** when an error-handling branch is about to produce a message, consider whether that branch is actually reachable by more than one meaningfully different real-world cause, and if so, whether those causes deserve to be told apart in the message rather than collapsed into one generic explanation that happens to be technically consistent with all of them.

### X.6 When a bug is found by extreme-scale testing, fix both the specific bug and the structural fragility that let it cascade

**The problem shape:** an extreme-scale stress test surfaces a real bug, and the immediate, narrow fix for that specific bug is obvious and sufficient to make the specific failing test pass again. The question worth asking afterward: did this bug cascade into a worse failure than it needed to, because of some separate, more general fragility nearby, and if so, should that fragility also be hardened, even though the narrow fix alone would technically satisfy the test?

**The concrete example:** the real underlying bug was a SQLite `ROLLBACK` being attempted when no transaction was actually open, raising a second, masking exception. The narrow fix (track whether the transaction actually started before ever attempting a rollback) would have been sufficient to make the specific failing stress test pass. But investigating further revealed that this masking exception was able to propagate all the way out of `discovery.py`'s UDP listener loop and permanently kill that entire background thread, because that loop's own exception handling only caught three specific, narrower exception types, with no broader safety net around the loop as a whole, and a sibling code path (the mDNS listener callback) had no exception handling around it at all, relying entirely on an undocumented assumption about how a third-party library handles exceptions raised from within a callback it invokes. All three issues were fixed together: the specific SQLite bug, and the two separate structural fragilities in the discovery loops that had turned one transient, recoverable database contention event into a permanent, silent, session-long loss of an entire discovery transport. Fixing only the narrowest bug would have left the two structural fragilities in place, ready to turn some future, entirely different bug into the same kind of cascading, silent failure.

---

## Part XI: Quick-reference appendix

### XI.1 Key file locations

Local-only project documents (never pushed publicly): `BUILD_LOG.md`, `TASK_QUEUE.md`, `lan-chat-app-spec.md`, `STRESS_TEST_REPORT.md`, `STRESS_TEST_INSTRUCTIONS.md`, this file (`INSTRUCTIONS.md`).

Public-facing document (pushed to the public repository): `README.md`.

Backend source: `backend/app/*.py`. Backend test suites: `backend/app/_test_*.py`, run directly via `./agora/Scripts/python.exe -m app._test_<name>` from the `backend/` directory.

Frontend source: `frontend/src/`. Electron shell: `frontend/electron/main.cjs` and `frontend/electron/preload.cjs`. Packaged build output: `frontend/release/` (both an NSIS installer, `Agora Setup <version>.exe`, and a portable no-install build, `Agora <version>.exe`).

### XI.2 Key commands

Run the backend manually for development: `AGORA_NAME=<name> AGORA_PORT=<port> AGORA_API_PORT=<api-port> ./agora/Scripts/python.exe -m uvicorn app.api:app --host 127.0.0.1 --port <api-port>` from `backend/`.

Run the full desktop app in development: `npm run electron:dev` from `frontend/`.

Build the packaged desktop app: `npm run electron:build` from `frontend/` (runs the PyInstaller backend freeze, the Vite production build, and `electron-builder`, in that order).

Run a backend test suite: `./agora/Scripts/python.exe -m app._test_<name>` from `backend/`.

### XI.3 Default ports

Local API: 5001 (manual/dev default; dynamically assigned and communicated via `window.AGORA_API_BASE` in the packaged app). Peer-to-peer messaging/discovery base port: 8001. UDP broadcast discovery: 42424, fixed, shared by convention across all devices. Test suites: loopback ports in the roughly 22000 to 24000 range, chosen to avoid colliding with real application defaults or with each other.

### XI.4 The nine standing rules, in one line each, for fast recall

One, Agora is private serverless local communication, not another messaging app; frame everything around that. Two, update `BUILD_LOG.md`/`TASK_QUEUE.md`/`README.md` proactively, as part of doing the work. Three, commit and push only when explicitly asked. Four, the public repository gets code and design only, never the internal planning documents. Five, never a `Co-Authored-By: Claude` trailer on a public-repository commit. Six, no em-dash character anywhere in project writing. Seven, verify everything by actually running the real code, and state plainly what was not tested. Eight, surface real design tradeoffs rather than resolving them silently. Nine, apply a scope correction everywhere it touches, not just where it was most recently mentioned.

---

## Part XII: Complete feature catalog

Every real, shipped feature, defined in one place. Organized by area, in roughly the order it was built (see Part IX for the step-by-step history behind each one).

### XII.1 Discovery and pairing

**Nearby radar.** The default view after onboarding: every peer currently visible on the LAN, found via mDNS or UDP broadcast, shown with a live presence indicator. Includes a real search field that filters the visible list by name, and a "Rescan" action that forces an immediate re-read of the current peer list rather than waiting for the next automatic poll tick.

**Scan radar overlay.** A real-time animated visualization (not a static list) shown when Nearby has no conversation selected, or during an explicit rescan, giving visual feedback that discovery is actually live and working.

**QR-code peer pairing.** A second way to add a peer: "Your code" shows this device's own signed discovery announcement as a scannable QR code (with an Agora logo in the center, high error-correction so the logo doesn't break scannability); "Scan a code" reads another device's code with the camera and adds it directly, through the identical trust check live discovery uses (Part X.2).

**Known Peers.** Every peer ever seen, not just ones with current message history - backs a "Known Peers" view and a contacts export/import flow for pre-seeding a peer_id with a display name before it's next actually discovered.

**My Device Info.** A real screen showing this device's own identity: peer_id, and a short fingerprint of its real X25519 public key, so a user can in principle read it aloud or compare it with a peer out-of-band.

**Network Diagnostics.** A real diagnostics view for troubleshooting discovery/connectivity issues on the current network.

### XII.2 Messaging

**Direct 1:1 chat**, with real `pending` -> `sent` -> `delivered` status tracking shown as a delivery tick, and automatic retry once an unreachable peer becomes visible again.

**Group chat**, with messages fanned out to every member over their own individual encrypted connections (no shared group channel to compromise), and offline members queued and flushed the same way 1:1 messaging already works.

**Delete for me** (removes a message from this device's own view only) and **delete for everyone** (a real deletion request sent to the peer, queued and retried automatically if they are offline at the time, with the same durability guarantee a normal held message gets).

**Clear conversation** and **clear all chat history** - local, irreversible, scoped to this device only (clearing never affects the other party's own copy, since there is no shared copy to clear).

**Forward a message**, to any peer with existing conversation history or any peer currently live, deduplicated - including forwarding to an offline contact, queued the same way a normal send would be.

**Forward a received file**, the same forwarding logic applied to a file instead of a text message.

**Inline image previews** in the chat timeline itself, not just a filename link.

**Disappearing messages**, a real per-conversation timer after which messages are automatically removed.

**Right-click context menu** on a message bubble (delete/forward/etc.), replacing an earlier icon-based design once real usage showed the icons added visual clutter without adding real functionality.

**Per-chat quick actions**: mute (silences call notifications from that peer; there is no separate message-notification system yet to mute, stated honestly rather than implied), a per-conversation chat theme, and the disappearing-messages timer, bundled into one quick-actions surface per chat.

**Media, Links, and Docs**, a real per-conversation view of everything shared in that conversation, not a hypothetical placeholder.

### XII.3 File transfer

**Send a file**, with the receiver given a genuine accept/decline choice before anything is written to disk, and a distinct, heavier-weight warning interstitial (two required checkboxes plus a countdown) specifically for executable/installable files.

**Resume on reconnect.** A transfer interrupted mid-stream resumes from the last confirmed byte offset rather than restarting, verified directly against a real simulated partial-file scenario, not only the uninterrupted happy path.

**Automatic retry.** A file offer that initially fails because the peer isn't reachable retries automatically once they reconnect, with no manual "resend" action required.

**SHA-256 integrity verification** on every completed transfer, independent of the transport's own guarantees (Part VIII.9).

**Adaptive bandwidth throttling.** File transfer deliberately slows itself down while a call is active on the same connection, so bulk file data does not degrade real-time audio/video quality, lifting automatically once the call ends.

**Group file and image sharing**, fanned out as independent 1:1 transfers per member, each tagged with the shared group_id.

### XII.4 Calling

**1:1 audio and video calls**, signaled over the existing encrypted messaging connection, with media flowing directly peer-to-peer (Part VIII.10).

**Group calling**, mesh-topology (every participant connects directly to every other participant), capped at 4 people, with real ring-for-consent behavior rather than auto-joining, and a deterministic collision-resolution rule when near-simultaneous offers collide.

**Screen sharing during any call**, audio or video, built with zero backend or wire-protocol changes via the pre-negotiated-transceiver pattern (Part X.1) - not gated behind the call already being a video call, since the entire point is sharing a screen without ever needing the camera.

**Call history**, with real pagination, correctly distinguishing `completed`/`declined`/`dropped`/`collision` outcomes, each with accurate duration tracking where one applies.

**Call-history filtering by peer**, reachable directly from a conversation ("View Call History with this Peer").

### XII.5 Security and trust

**Transport encryption** for every real frame after the initial plaintext "hello" (Part VIII.8): ChaCha20-Poly1305 authenticated encryption, directional keys, ever since the project's Phase 5.

**Signed discovery broadcasts**, closing a real, demonstrated spoofing vulnerability (Part IX, Steps 25-26).

**Trust-on-first-use identity warnings**: a peer's encryption key changing after first contact is surfaced as a real, dismissible warning (`IdentityWarningBanner.jsx`), not silently trusted or silently blocked.

**Block a peer**, enforced at the single real choke point every peer-to-peer channel (chat, files, calls, group traffic) rides through, not a UI-only hide.

**A security interstitial for executable files**, described above under file transfer.

### XII.6 Settings, personalization, and app-level features

**Settings screens**: Notifications (the real, honest permission state, not a stub), About (the real app version read from `package.json` at build time, real GitHub links, encryption-status copy corrected to never overclaim what's actually encrypted), deliberately *not* including a network-mode toggle (a design this project's own Phase 4 explicitly and permanently retired - see Part XIV).

**A real top menu bar**: File, Conversation, Network, View, Help, each a genuine dropdown wired to real actions, not a decorative static bar.

**Self-avatar photo picker**, with a real file picker and image processing, not a fixed set of placeholder icons.

**Chat themes**, a per-conversation color/style choice, local to the viewing device.

**Keyboard shortcuts**, documented in a real in-app reference (`Ctrl+1` through `Ctrl+4` for the four main tabs, zoom shortcuts, and more).

**Always on Top**, **Zoom In/Out/Reset** - real `BrowserWindow`-level controls, not CSS tricks, available only in the desktop app (clearly disabled with an explanatory reason in the plain-browser dev view).

**Auto-update**, covering three real source modes: GitHub (defaulting to the project's own repository, changeable to any `github.com/owner/repo`), a local folder (the one source that needs zero internet, reading a version straight from an installer's filename), and an optional, off-by-default automatic-check schedule - full detail in Part X.3 and Part VI.2.

### XII.7 Desktop application essentials

**Electron packaging**: a frameless custom-titlebar window, a self-contained frozen backend executable, both an installer and a portable no-install build (Part VIII.12).

**A real notification for an incoming call**, shown even when the app is not the focused window.

**Per-user app-data storage**: the SQLite database and downloaded files live in a proper OS-standard per-user folder, not inside the installed application's own directory (which may not even be writable, and which an uninstall would delete).

---

## Part XIII: Complete UI reference

Every real screen, panel, and modal in the application, defined. Organized the way a user actually encounters them: the main shell first, then each tab, then the modals reachable from the menu bar.

### XIII.1 The main shell

**TitleBar** (`TitleBar.jsx`). The custom-drawn top bar replacing the OS's native window chrome: the Agora logo, the real File/Conversation/Network/View/Help menu bar (each a `DropdownMenu.jsx` instance), and a right-hand cluster showing connection status, live peer count, and the real window controls (minimize/maximize/close), wired to genuine IPC calls rather than being decorative.

**IconRail** (`IconRail.jsx`). The narrow vertical strip of tab icons (Nearby, Chats, Calls, Files, Settings) that selects which main panel is showing, plus the user's own avatar initial at the bottom.

**StatusBar** (`StatusBar.jsx`). A thin status strip reflecting real connection state.

**IdentityWarningBanner** (`IdentityWarningBanner.jsx`). A dismissible banner surfaced when a known peer's encryption key has changed since it was first pinned - a real security signal, not a generic notice, shown inline rather than buried in a settings page nobody would see in time.

**SecurityGate** (`SecurityGate.jsx`). The real gate a user passes through around sensitive actions (such as opening a received executable), rather than a confirmation dialog that is easy to click through without reading.

### XIII.2 Nearby tab

**PeerList** (`PeerList.jsx`). The left-hand sidebar: a real search field, a "Rescan" pill, the QR-pairing entry point, and the live list of currently-visible peers.

**ScanRadar** (`ScanRadar.jsx`). The animated radar visualization shown when no conversation is selected in Nearby, or during an active rescan.

**QrPairingModal** (`QrPairingModal.jsx`). Two tabs: "Your code" (this device's own scannable signed announcement, rendered with an Agora logo in the center) and "Scan a code" (a live camera view that decodes another device's code and adds it).

### XIII.3 Chats tab

**ChatsListPanel** (`ChatsListPanel.jsx`). The list of conversations with real message history (distinct from Nearby's "everyone currently visible" list), plus group conversations and the group-creation flow.

**ConversationPane** (`ConversationPane.jsx`). The real 1:1 chat view: message bubbles with live delivery ticks, the composer, inline image previews, and the entry points for calling that peer.

**GroupConversationPane** (`GroupConversationPane.jsx`). The group equivalent, showing per-member fan-out status where relevant and the group-calling entry point.

**BubbleContextMenu** (`BubbleContextMenu.jsx`). The right-click menu on a message bubble: delete for me, delete for everyone (when applicable), forward.

**ImagePreview** (`ImagePreview.jsx`). The full-size image viewer opened from an inline chat image.

**FileOpenActions** (`FileOpenActions.jsx`). The accept/decline/open/save-as action set shown on an incoming or completed file transfer inline in the chat.

**InfoSidebar** (`InfoSidebar.jsx`). The right-hand panel showing details about the selected conversation's peer (or group), toggleable via the View menu.

### XIII.4 Calls tab

**CallsScreen** (`CallsScreen.jsx`). The real call history list, paginated, filterable by peer, correctly distinguishing completed/declined/dropped/collision outcomes.

**CallOverlay** (`CallOverlay.jsx`). The full-screen 1:1 call UI: the live video/audio tile, the shared-screen tile when active (`objectFit: contain`, not `cover`, since cropping real screen content is worse than cropping a face), and the controls pill (mute, camera, screen share, hang up).

**GroupCallOverlay** (`GroupCallOverlay.jsx`). The group-call equivalent: a grid of participant tiles plus an extra tile per active screen-sharer, correctly sized into the grid's own column-count logic.

**ScreenSharePickerModal** (`ScreenSharePickerModal.jsx`). The real screen/window picker shown when more than one capturable source exists (auto-selects and skips itself entirely for the common single-monitor case); degrades gracefully to the browser's own native picker outside Electron.

### XIII.5 Files tab

**FilesScreen** (`FilesScreen.jsx`). The real file-transfer history across every conversation, searchable by filename, showing status and allowing direct open/save-as/show-in-folder actions.

### XIII.6 Settings tab

**SettingsScreen** (`SettingsScreen.jsx`). Three real sub-screens: Notifications (the real OS permission state), About (real version, real GitHub links, honest encryption-status copy), and the avatar/display-name editor - deliberately without a network-mode toggle (Part XIV).

### XIII.7 Menu-bar modals (`TitleBarModals.jsx` and standalone files)

**ModalOverlay.** The shared dialog chrome every modal below is built on: a real centered dialog, closeable by backdrop click or an explicit close button, not a fake inline placeholder.

**SendFileModal.** Pick a peer, then a real file, from the File menu.

**ContactsModal.** Export/import the known-peers list.

**DeviceInfoModal.** This device's own identity and fingerprint (also reachable from the Network menu).

**KnownPeersModal.** Every peer ever seen, reachable from the Network menu.

**DiagnosticsModal.** Network diagnostics, reachable from the Network menu.

**ShortcutsModal.** The real keyboard-shortcut reference, reachable from the Help menu.

**MediaLinksDocsModal.** Everything shared in the currently-open conversation.

**DisappearingMessagesModal.** Set or change the current conversation's disappearing-message timer.

**ChatThemeModal.** Pick the current conversation's theme.

**UpdatesModal** (`UpdatesModal.jsx`). The full auto-update surface: a GitHub-source tab (repository entry/validation, check-now, download-and-install) and a Local-Folder-source tab (browse, scan, version-compare, install), plus automatic-check scheduling and release management - reachable from Help > Check for Updates.

### XIII.8 Onboarding

**Onboarding** (`Onboarding.jsx`). The first-launch flow: choosing a display name and avatar before the real app shell appears for the first time, run exactly once per install (per device identity).

---

## Part XIV: Possibilities, limitations, and future directions

A candid accounting of everything considered during this project's life, not only what shipped: what was discussed and built, what was discussed and deliberately not built (and exactly why), what could genuinely still be improved, and what is actually necessary to Agora's core idea versus what is a worthwhile but optional addition on top of it.

### XIV.1 The main theme, restated plainly

Everything in this project serves one idea: communication that needs nothing but the devices already in the room. No server, no account, no internet connection, no third party ever in a position to see, hold, or be compelled to hand over what was said. Every feature decision in this document, built or rejected, was ultimately judged against whether it serves that idea or quietly compromises it.

### XIV.2 What was discussed and built

The full feature set in Part XII, arrived at exactly the way Part IX describes: incrementally, each piece live-tested against real processes before being called done, with real bugs found and fixed along the way rather than assumed away. The single through-line across all of it: discovery, messaging, encryption, file transfer, and calling form the necessary core (XIV.4 below); everything else - groups, screen sharing, QR pairing, auto-update, personalization - is real, finished, tested functionality built on top of that core, not a replacement for any part of it.

### XIV.3 What was discussed and deliberately not built, and why

**A hybrid online/offline mode, with a "sync when internet available" network-mode toggle.** Designed early in the project, then explicitly and permanently retired in Phase 4. Agora's entire value proposition is not needing internet, ever; a hybrid mode would have meant maintaining two real code paths (offline peer-to-peer, and some online-sync alternative) for a capability that directly contradicts the product's own reason to exist. When Settings screens were later built out, this toggle was deliberately skipped again rather than silently resurrected, with the reasoning written down explicitly so the decision would not need to be re-litigated by a future session that did not already know it had been made.

**A generic "any website, any file" auto-update source.** Discussed directly as a possible third update mechanism alongside GitHub and a local folder. Narrowed down in conversation to "a GitHub repository that isn't necessarily mine," which the already-built any-repository-URL support already fully covers - building a separate, more generic mechanism on top would have been redundant scope, not a genuine gap. This is the clearest real example in this project of a possibility being seriously considered, discussed to its actual conclusion, and correctly recognized as already solved rather than built twice.

**Video and call recording.** Requested, scoped as its own genuinely separate feature from screen sharing (Part VII.2's worked example of a scope correction), and deliberately left untouched pending a separate existing repository with working recording functionality the user intends to hand over. No shape or design decisions have been made yet - not what gets recorded (camera, screen, or both), not where a recording is saved, and not the real privacy question of whether the peer being recorded is notified or must consent, which is a question worth deciding deliberately rather than defaulting to silent recording.

**An Android/phone app.** A completely separate project, intentionally not started yet. The discussed stack - Flutter for one codebase across Android/iOS, `nsd`/`multicast_dns` for mDNS discovery matching the desktop's own `zeroconf` approach, `web_socket_channel` for messaging, `sqflite` for local storage, reimplementing the same wire protocol natively rather than running the Python backend on-device - is a real plan, deliberately deferred until the desktop app is fully validated on real hardware first, rather than splitting effort across two unfinished platforms at once.

**A code-signing certificate for packaged builds.** Not rejected as a bad idea, simply not yet obtained - a real cost/process step outside of what code alone can solve. The auto-updater's design (Part X.3, Part VI.2) was built with this gap stated honestly rather than glossed over, specifically so that obtaining a certificate later is a drop-in improvement to an already-sound design, not a redesign.

### XIV.4 What is necessary versus what is valuable but optional

Mapped against the three pillars (Part I.2), the actually load-bearing core of this project is: **discovery** (finding who's there), **messaging** (talking to them), **encryption** (privately), **file transfer** (sharing more than text), and **calling** (real-time, not just text). Remove any one of these and Agora stops being able to deliver on offline/emergency, local/private, or temporary-community use cases - they are not features layered on the idea, they *are* the idea.

Everything else shipped is real, finished, and valuable, but sits a layer above that core rather than inside it: groups extend messaging/calling/files to more than two people, which matters enormously for a classroom or a response team but is not required for the simplest possible two-person case to work. Screen sharing and QR pairing are genuine quality-of-life wins built with real engineering care (Part X.1, X.2), not required for the core promise to hold. Auto-update is explicitly the *one* deliberate, opt-in exception to "never touches the internet" (Part VI.2) - valuable for keeping a deployed fleet of devices current, but Agora's core promise holds completely even if a device never once checks for an update in its entire working life. Personalization (avatars, chat themes) and desktop conveniences (keyboard shortcuts, always-on-top, zoom) make the app pleasant to live in day to day, and are the correct kind of feature to deprioritize first if time or scope ever needed to be cut.

### XIV.5 What could genuinely still be improved

Stated as plainly as every limitation elsewhere in this document, not softened: a **two-device retest** is overdue - the last full real-hardware pass was 2026-09-26, and a great deal of real work (the full encryption rebuild, screen sharing, QR pairing, auto-update, and the extreme-stress-testing fixes) has landed since then without a fresh two-machine pass to confirm none of it regressed anything a single-machine or two-process-on-one-machine test couldn't catch. **Group-call screen sharing** has only been proven as a per-leg mechanism (already verified twice in real 1:1 testing) applied in a loop - it has never been live-tested against a real three-or-more-person mesh, and that gap is noted honestly rather than implied to be covered by the 1:1 tests. The **local-folder update source's trust model** is real but structurally weaker than the GitHub path's HTTPS-plus-allowlist (Part X.3) - acceptable given there is no code-signing certificate either way, but worth revisiting together if a certificate is ever obtained. **Code signing itself** remains the single largest honest gap in the auto-updater's design. Finally, this project's own extreme-stress-testing round (Part IX, Step 31) found real bugs that years of smaller-scale regression testing had never caught - a strong, demonstrated argument for running the extreme suite again periodically, not just once, as the codebase continues to grow.

### XIV.6 What could be added, if the core promise is kept intact

Ideas that surfaced during this project's life but were never formally scoped, offered here as genuine possibilities rather than a committed roadmap: a way to pre-share a trusted contact list across a temporary community's devices before anyone has physically met (carefully, without reintroducing a server - perhaps an exported/imported signed bundle, extending the existing contacts-export mechanism); a lightweight "nearby but not yet mutually added" distinction for networks with many more devices present than a user actually wants to see; and, longer-term, the Android app already discussed, which would make "everyone in the room" a realistic premise rather than one limited to whoever happens to be running the desktop build. None of these are necessary to what Agora already is; they are directions worth having a real conversation about before committing to, exactly the way every feature in Part XII actually got built - discussed, decided deliberately, then implemented and verified, never assumed.
