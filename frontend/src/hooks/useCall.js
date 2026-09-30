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
  useEffect(() => {
    if (call?.status !== "in_call") return;
    if (call.media === "video" && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    const remoteTarget = call.media === "video" ? remoteVideoRef.current : remoteAudioRef.current;
    if (remoteTarget && remoteStreamRef.current) {
      remoteTarget.srcObject = remoteStreamRef.current;
    }
  }, [call?.status, call?.media]);

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
      if (msg.type === "screen_share_start") setRemoteSharingScreen(true);
      else if (msg.type === "screen_share_stop") setRemoteSharingScreen(false);
    } catch {
      // ignore malformed frames rather than crash the call over it
    }
  }

  function setupPeerConnection(media) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.ontrack = (e) => {
      // The screen-share slot is a real, separate transceiver, never mixed
      // into the same stream as the camera/mic - see findScreenTransceiver's
      // own comment for why comparing against it (recomputed fresh, not a
      // stale stored reference) correctly identifies this event regardless
      // of which transceiver's track fires ontrack first.
      if (e.transceiver === findScreenTransceiver(pc)) {
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
      await waitForIceGatheringComplete(pc);

      const res = await api.callOffer(peerId, pc.localDescription.toJSON(), media);
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
      // Same relative order as placeCall's offer side (own media first,
      // screen slot last) - see setupPeerConnection's own comment for why
      // that symmetry is what makes findScreenTransceiver's "last video
      // transceiver" rule land on the same slot for both sides.
      screenTransceiverRef.current = addScreenTransceiver(pc);

      await pc.setRemoteDescription(incoming.offerSdp);
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

  async function startScreenShare() {
    if (!screenTransceiverRef.current || sharingScreen) return;
    try {
      const stream = await getScreenStream();
      const track = stream.getVideoTracks()[0];
      screenStreamRef.current = stream;
      await screenTransceiverRef.current.sender.replaceTrack(track);
      await sendOnScreenChannel({ type: "screen_share_start" });
      // The browser's own native "you are sharing your screen" bar has a
      // real Stop button - this is the only way to find out if the user
      // used *that* instead of this app's own control.
      track.onended = () => stopScreenShare();
      setSharingScreen(true);
    } catch (e) {
      // NotAllowedError: the user cancelled the source picker, or
      // Electron's own handler declined - not a real error to surface.
      if (e.name !== "NotAllowedError") setError("Couldn't start screen sharing.");
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
    stopScreenShare,
  };
}
