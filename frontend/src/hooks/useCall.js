import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { RTC_CONFIG, waitForIceGatheringComplete, getLocalStream, startRingtone, addScreenTransceiver, findScreenTransceiver, getScreenStream } from "../lib/webrtc";
import { isPeerMuted } from "../lib/mute";

// Owns the entire calling lifecycle at the App level (not inside a specific
// screen) so an incoming call is caught no matter which tab is open when it
// arrives - the underlying WS event only ever fires once, live, with no
// replay for a listener that subscribes late. See BUILD_LOG's Phase 3 notes.
export function useCall() {
  const [call, setCall] = useState(null); // { callId, peerId, media, direction, status, offerSdp? } | null
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [remoteSharingScreen, setRemoteSharingScreen] = useState(false);
  // Screen sharing requires the other person's explicit consent before any
  // frame actually goes out, the same "ring for consent" principle group
  // calling already uses for joining - awaitingShareAccept is this side's
  // "asked, waiting on them" state; incomingShareRequest is the other
  // side's "they're asking, show me Accept/Decline" state.
  const [awaitingShareAccept, setAwaitingShareAccept] = useState(false);
  const [incomingShareRequest, setIncomingShareRequest] = useState(false);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callRef = useRef(null);
  callRef.current = call;

  // Screen sharing rides a second video transceiver that's pre-negotiated
  // on every call, audio or video, from the moment it connects - see
  // lib/webrtc.js's own comment for why (no renegotiation, no new wire
  // messages, works whether this call is audio or video).
  const screenTransceiverRef = useRef(null);
  // The screen transceiver's real, negotiated mid - sent explicitly from
  // the offering side to the answering side as a plain extra field on the
  // call offer (the backend relays `sdp` as an opaque dict either way, see
  // api.py's CallOfferBody - this costs nothing to add). Replaces inferring
  // "the screen slot" by assuming it's always the last video-kind
  // transceiver in creation order: that inference turned out not to hold
  // reliably in real two-browser testing (found showing the camera feed in
  // the screen slot, or nothing at all, on the answering side specifically)
  // - mid is the one value WebRTC itself guarantees stays identical for the
  // same m-line on both the offer and the answer, so matching on it instead
  // is unambiguous regardless of transceiver creation order on either side.
  const screenMidRef = useRef(null);
  const screenStreamRef = useRef(null); // this device's own captured screen, while sharing
  const remoteScreenStreamRef = useRef(null); // the peer's shared screen, while they're sharing
  // How the *other* side finds out sharing started/stopped. The original
  // design relied on the screen track's own mute/unmute events (no track
  // attached = muted) - real testing (two live backends, two real
  // browsers) showed this doesn't fire reliably: replaceTrack(null)
  // stopped sending real frames, but the receiver's track.muted stayed
  // false for well over 20 seconds, nowhere near responsive enough for a
  // "stop sharing" button to feel real. A data channel is pre-negotiated
  // the exact same way as the screen transceiver (added before the first
  // offer, so it's part of the initial connection, not a renegotiation),
  // and sending one explicit "started"/"stopped" message over it is
  // immediate and unambiguous - still zero changes to this app's own
  // backend/wire protocol, since it never touches messaging.py/calling.py
  // at all, it rides the WebRTC connection directly, peer to peer.
  const screenChannelRef = useRef(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const remoteScreenVideoRef = useRef(null);

  function cleanupCall() {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    remoteScreenStreamRef.current = null;
    screenTransceiverRef.current = null;
    screenMidRef.current = null;
    screenChannelRef.current?.close();
    screenChannelRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (remoteScreenVideoRef.current) remoteScreenVideoRef.current.srcObject = null;
    setMuted(false);
    setCameraOff(false);
    setSharingScreen(false);
    setRemoteSharingScreen(false);
    setAwaitingShareAccept(false);
    setIncomingShareRequest(false);
  }

  useEffect(() => {
    const stop = connectEvents((evt) => {
      const current = callRef.current;

      if (evt.type === "call_incoming" && evt.group_call_id) {
        // A mesh leg of a group call, not a 1:1 call - useGroupCall.js owns
        // this exclusively. Found by real testing: without this check, the
        // same event also showed a normal 1:1 incoming-call popup
        // alongside the real group consent prompt for the exact same call.
        return;
      }

      if (evt.type === "call_incoming") {
        // If we had our own outgoing call to this peer that just lost the
        // collision tie-break, its call_ended (reason "collision") arrives
        // as a separate event and clears `call` on its own.
        setCall({ callId: evt.call_id, peerId: evt.peer_id, media: evt.media, direction: "incoming", status: "ringing", offerSdp: evt.sdp });
        setError("");
        // WhatsApp-style: bring the app window to the front on its own
        // instead of relying on the user noticing a background OS toast.
        window.electronAPI?.notifyIncomingCall?.();
      } else if (evt.type === "call_answered" && current?.callId === evt.call_id) {
        pcRef.current?.setRemoteDescription(evt.sdp).then(() => {
          setCall((c) => (c && c.callId === evt.call_id ? { ...c, status: "in_call" } : c));
        });
      } else if (evt.type === "call_ice" && current?.callId === evt.call_id) {
        pcRef.current?.addIceCandidate(evt.candidate).catch(() => {});
      } else if (evt.type === "call_ended" && current?.callId === evt.call_id) {
        cleanupCall();
        setCall(null);
        setError(evt.reason === "declined" ? "Call declined" : evt.reason === "collision" ? "" : evt.reason === "busy" ? "Peer is on another call" : "Call ended");
      }
    });
    return stop;
  }, []);

  // Ring + flash the tab title while an incoming call is ringing - both work
  // regardless of window focus, unlike the full-screen overlay which only
  // helps if the window happens to be visible right now.
  useEffect(() => {
    if (!(call?.status === "ringing" && call?.direction === "incoming")) return;

    const stopRing = startRingtone();

    const originalTitle = document.title;
    let flip = false;
    const titleInterval = setInterval(() => {
      document.title = flip ? originalTitle : "Incoming call…";
      flip = !flip;
    }, 1000);

    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted" && !isPeerMuted(call.peerId)) {
      try {
        new Notification("Agora", { body: `Incoming ${call.media} call` });
      } catch {
        // best-effort only - some environments (headless, no notification
        // service running) throw here even with permission "granted"
      }
    }

    return () => {
      stopRing();
      clearInterval(titleInterval);
      document.title = originalTitle;
    };
  }, [call?.status, call?.direction, call?.callId]);

  useEffect(() => {
    if (!call || call.status !== "in_call") return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [call?.status, call?.callId]);

  // Re-attach streams once the in-call <video>/<audio> elements actually
  // exist. They only render once status flips to "in_call" - but ontrack
  // (and, for video, getUserMedia finishing) can happen slightly earlier,
  // while still "ringing", so the ref is still null at that moment and a
  // direct assignment in the event handler would silently do nothing. Every
  // stream is kept in a ref regardless, and this effect re-applies it once
  // the elements exist.
  //
  // remoteSharingScreen is also a real dependency here, not just the two
  // above - a live report found the remote camera tile "stuck" on the last
  // frame of a screen share that had already ended. CallOverlay's ternary
  // swaps between a <video ref={remoteScreenVideoRef}> and a
  // <video ref={remoteVideoRef}> at the exact same tree position, so React
  // reuses the same underlying DOM element across that switch rather than
  // creating a new one - srcObject is a live property this effect sets
  // imperatively, not a declarative JSX attribute, so reusing the node also
  // reuses whatever MediaStream was last assigned to it. Without
  // remoteSharingScreen in this dependency list, nothing ever told that
  // reused element to point back at the real camera stream once sharing
  // stopped, so it just kept rendering the screen share's final, frozen
  // frame forever.
  useEffect(() => {
    if (call?.status !== "in_call") return;
    if (call.media === "video" && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    const remoteTarget = call.media === "video" ? remoteVideoRef.current : remoteAudioRef.current;
    if (remoteTarget && remoteStreamRef.current) {
      remoteTarget.srcObject = remoteStreamRef.current;
    }
  }, [call?.status, call?.media, remoteSharingScreen]);

  // Same re-attach reasoning as above, for the shared-screen tile
  // specifically: it only mounts once remoteSharingScreen flips true (see
  // CallOverlay.jsx), which happens in the exact same tick as the track's
  // onunmute handler tries to set its srcObject - too early for the ref to
  // exist yet. This effect re-applies the already-captured stream once the
  // element actually renders.
  useEffect(() => {
    if (remoteSharingScreen && remoteScreenVideoRef.current && remoteScreenStreamRef.current) {
      remoteScreenVideoRef.current.srcObject = remoteScreenStreamRef.current;
    }
  }, [remoteSharingScreen]);

  useEffect(() => cleanupCall, []); // stop mic/camera if the app ever unmounts mid-call

  function handleScreenChannelMessage(e) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "screen_share_request") setIncomingShareRequest(true);
      else if (msg.type === "screen_share_cancel") setIncomingShareRequest(false);
      else if (msg.type === "screen_share_accept") {
        setAwaitingShareAccept(false);
        beginCapturingScreen();
      } else if (msg.type === "screen_share_decline") {
        setAwaitingShareAccept(false);
        setError("They declined your screen share.");
      } else if (msg.type === "screen_share_start") setRemoteSharingScreen(true);
      else if (msg.type === "screen_share_stop") setRemoteSharingScreen(false);
    } catch {
      // ignore malformed frames rather than crash the call over it
    }
  }

  function setupPeerConnection(media) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.ontrack = (e) => {
      // Matched by mid against screenMidRef (set before setRemoteDescription
      // ever runs - see acceptCall/placeCall), not inferred by transceiver
      // position - real two-browser testing showed the position-based
      // inference didn't hold reliably. Falls back to the old position-
      // based findScreenTransceiver only if screenMidRef was somehow never
      // set (shouldn't happen on a build that sends screenMid, but better
      // than silently misrouting every track if it ever is).
      const isScreen = screenMidRef.current != null ? e.transceiver.mid === screenMidRef.current : e.transceiver === findScreenTransceiver(pc);
      if (isScreen) {
        remoteScreenStreamRef.current = new MediaStream([e.track]);
        return;
      }
      remoteStreamRef.current = e.streams[0];
      const target = media === "video" ? remoteVideoRef.current : remoteAudioRef.current;
      if (target) target.srcObject = e.streams[0];
    };
    // The answering side never calls createDataChannel itself - this is
    // how it receives the channel the offering side created (see
    // placeCall) as part of the same initial negotiation. Never fires on
    // the side that created the channel.
    pc.ondatachannel = (e) => {
      screenChannelRef.current = e.channel;
      e.channel.onmessage = handleScreenChannelMessage;
    };
    pc.oniceconnectionstatechange = () => {
      // "closed" also fires from our own pc.close() during a normal hang up -
      // only "failed"/"disconnected" represent the connection actually
      // dying underneath an active call, which is what "dropped" means.
      if (["failed", "disconnected"].includes(pc.iceConnectionState) && callRef.current?.status === "in_call") {
        hangUp("dropped");
      }
    };
    // Screen transceiver deliberately NOT added here - this needs to
    // happen after the caller's own addTrack() calls (audio, and camera
    // video for a video call), not before, so the screen slot is really
    // the LAST video transceiver in creation order on both the offer and
    // the answer - see findScreenTransceiver's own comment for why that
    // ordering is the whole mechanism. Callers (placeCall/acceptCall) add
    // it themselves right after their own addTrack calls.
    return pc;
  }

  async function placeCall(peerId, media) {
    setError("");
    try {
      const localStream = await getLocalStream(media);
      localStreamRef.current = localStream;

      const pc = setupPeerConnection(media);
      pcRef.current = pc;
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      screenTransceiverRef.current = addScreenTransceiver(pc);
      // Only the offering side calls createDataChannel - the answering
      // side receives this same channel via pc.ondatachannel once the
      // offer negotiates it (see setupPeerConnection). Created before
      // createOffer() below, so it's part of the one and only negotiation
      // this call ever does, not a renegotiation.
      screenChannelRef.current = pc.createDataChannel("agora-screen-share");
      screenChannelRef.current.onmessage = handleScreenChannelMessage;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Real and stable only once a local description has actually been
      // set - mid is assigned by that step, not at addTransceiver time.
      screenMidRef.current = screenTransceiverRef.current.mid;
      await waitForIceGatheringComplete(pc);

      const res = await api.callOffer(peerId, { ...pc.localDescription.toJSON(), screenMid: screenMidRef.current }, media);
      if (res.status === "failed") {
        cleanupCall();
        setError(`Couldn't reach that peer: ${res.reason}`);
        return;
      }
      setCall({ callId: res.call_id, peerId, media, direction: "outgoing", status: "ringing" });
    } catch (e) {
      cleanupCall();
      setError(e.name === "NotAllowedError" ? "Microphone/camera permission was denied." : "Couldn't start the call.");
    }
  }

  async function acceptCall() {
    const incoming = callRef.current;
    if (!incoming) return;
    setError("");
    try {
      const localStream = await getLocalStream(incoming.media);
      localStreamRef.current = localStream;

      const pc = setupPeerConnection(incoming.media);
      pcRef.current = pc;
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

      // Read, and critically, stored into screenMidRef, BEFORE
      // setRemoteDescription runs below - ontrack can fire as part of
      // processing the remote offer itself, so screenMidRef has to already
      // be correct by then, not set afterward. The mid comes straight from
      // the offer the caller sent (see placeCall) - a real, explicit value
      // both sides agree on, not inferred from transceiver creation order
      // the way this used to work (see git history: that inference is what
      // let the answering side's screen end up shown as the camera feed, or
      // not at all, found by real two-browser testing).
      screenMidRef.current = incoming.offerSdp?.screenMid ?? null;
      await pc.setRemoteDescription({ type: incoming.offerSdp.type, sdp: incoming.offerSdp.sdp });
      screenTransceiverRef.current = screenMidRef.current != null ? pc.getTransceivers().find((t) => t.mid === screenMidRef.current) : findScreenTransceiver(pc);
      // The real bug, found by actually driving two real browsers end to
      // end and logging every transceiver's direction (not just reasoning
      // about the SDP on paper): the camera/audio m-lines come back
      // "sendrecv" here because this side already had its own addTrack()
      // calls queued up before setRemoteDescription ran, giving the browser
      // an existing local transceiver to merge the offer into - but the
      // screen m-line has no such local counterpart (nothing was ever
      // addTrack()'d to it, by design - it starts empty), so the browser
      // auto-creates it as "recvonly" by default. That's not a signaling
      // mismatch, it's a real runtime restriction: a sender on a recvonly
      // transceiver silently never transmits, no matter what replaceTrack()
      // puts on it - which is exactly why only the call's *offerer* (whose
      // own addTransceiver call asked for "sendrecv" explicitly) was ever
      // able to share a screen, and the answerer's own share always went
      // out as nothing. Flipping it back to sendrecv here, before this
      // side's own answer is created, fixes it for both directions without
      // any renegotiation - this is still the one and only offer/answer
      // exchange the call ever does.
      if (screenTransceiverRef.current) screenTransceiverRef.current.direction = "sendrecv";
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      await api.callAnswer(incoming.callId, pc.localDescription.toJSON());
      setCall((c) => (c ? { ...c, status: "in_call" } : c));
    } catch (e) {
      cleanupCall();
      setCall(null);
      setError(e.name === "NotAllowedError" ? "Microphone/camera permission was denied." : "Couldn't answer the call.");
      api.callEnd(incoming.callId, "failed").catch(() => {});
    }
  }

  function declineCall() {
    const incoming = callRef.current;
    cleanupCall();
    setCall(null);
    setError("");
    if (incoming) api.callEnd(incoming.callId, "declined").catch(() => {});
  }

  function hangUp(reason = "ended") {
    const current = callRef.current;
    cleanupCall();
    setCall(null);
    setError(reason === "dropped" ? "Connection lost" : "");
    if (current) api.callEnd(current.callId, reason).catch(() => {});
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }

  async function sendOnScreenChannel(payload) {
    const channel = screenChannelRef.current;
    if (!channel) return;
    if (channel.readyState === "open") {
      channel.send(JSON.stringify(payload));
      return;
    }
    // Right after createDataChannel/ondatachannel the channel is still
    // "connecting" until its underlying SCTP association finishes - a real
    // gap found by testing: clicking "Share screen" the instant a call
    // connects can race this. A few hundred ms is generous for a
    // same-subnet connection that's already fully up.
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      channel.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
    if (channel.readyState === "open") channel.send(JSON.stringify(payload));
  }

  // Asking first, not sharing first: this only tells the other side someone
  // wants to share and waits for their explicit answer - nothing is
  // captured yet, the same way an incoming call rings for consent before
  // any media flows rather than connecting straight through.
  async function startScreenShare() {
    if (!screenTransceiverRef.current || sharingScreen || awaitingShareAccept) return;
    setAwaitingShareAccept(true);
    await sendOnScreenChannel({ type: "screen_share_request" });
  }

  function cancelScreenShareRequest() {
    setAwaitingShareAccept(false);
    sendOnScreenChannel({ type: "screen_share_cancel" });
  }

  // Both sides can share at once, Google Meet-style - the one pre-negotiated
  // screen-video transceiver is a real bidirectional RTP pair (one sender,
  // one receiver, independent of each other), so my own outgoing screen and
  // the peer's incoming one were never actually in conflict at the
  // transport level - that was only ever an application-level policy this
  // function used to enforce by stopping your own share the moment you
  // accepted someone else's. The explicit accept/decline step itself stays
  // exactly as it was: this is about whether two *simultaneous* shares are
  // allowed, not about removing the "ask first" consent.
  function acceptScreenShareRequest() {
    setIncomingShareRequest(false);
    sendOnScreenChannel({ type: "screen_share_accept" });
  }

  function declineScreenShareRequest() {
    setIncomingShareRequest(false);
    sendOnScreenChannel({ type: "screen_share_decline" });
  }

  // Runs once the other side has actually accepted - the real capture (and
  // the source picker that comes with it) only ever happens after consent,
  // never before.
  async function beginCapturingScreen() {
    try {
      const stream = await getScreenStream();
      const track = stream.getVideoTracks()[0];
      screenStreamRef.current = stream;
      // Re-resolved fresh right here, by mid when we have one (the real,
      // explicit identifier - see screenMidRef's own comment), rather than
      // trusting whatever screenTransceiverRef was set to back when the
      // call first connected - belt and suspenders against it ever drifting
      // from the connection's real current state by the time an actual
      // share starts, which can be arbitrarily later in a call.
      const pc = pcRef.current;
      const transceiver = pc ? (screenMidRef.current != null ? pc.getTransceivers().find((t) => t.mid === screenMidRef.current) : findScreenTransceiver(pc)) : null;
      if (!transceiver) {
        throw new Error("no screen transceiver found on this connection");
      }
      screenTransceiverRef.current = transceiver;
      await transceiver.sender.replaceTrack(track);
      await sendOnScreenChannel({ type: "screen_share_start" });
      // The browser's own native "you are sharing your screen" bar has a
      // real Stop button - this is the only way to find out if the user
      // used *that* instead of this app's own control.
      track.onended = () => stopScreenShare();
      setSharingScreen(true);
    } catch (e) {
      // NotAllowedError: the user cancelled the source picker, or
      // Electron's own handler declined - not a real error to surface.
      // Anything else (including the "no screen transceiver found" case
      // above) is a real failure worth a visible, specific message rather
      // than silently leaving the other side waiting on a share that's
      // never coming.
      if (e.name !== "NotAllowedError") setError(e.message === "no screen transceiver found on this connection" ? "Couldn't find the screen-sharing connection slot - try leaving and rejoining the call." : "Couldn't start screen sharing.");
      // The other side already accepted and is waiting for a tile that,
      // after a cancelled/failed picker, is now never actually coming.
      sendOnScreenChannel({ type: "screen_share_stop" });
    }
  }

  function stopScreenShare() {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    screenTransceiverRef.current?.sender.replaceTrack(null).catch(() => {});
    sendOnScreenChannel({ type: "screen_share_stop" });
    setSharingScreen(false);
  }

  return {
    call,
    error,
    elapsed,
    muted,
    cameraOff,
    sharingScreen,
    remoteSharingScreen,
    awaitingShareAccept,
    incomingShareRequest,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    remoteScreenVideoRef,
    placeCall,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    toggleCamera,
    startScreenShare,
    cancelScreenShareRequest,
    acceptScreenShareRequest,
    declineScreenShareRequest,
    stopScreenShare,
  };
}
