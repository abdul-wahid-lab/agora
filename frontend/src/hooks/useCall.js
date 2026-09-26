import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";

// No STUN/TURN servers - by design (see backend/app/calling.py). Both peers
// are always on the same subnet, so only local host ICE candidates are ever
// needed, and there's never a NAT to traverse.
const RTC_CONFIG = { iceServers: [] };

// Non-trickle ICE for this first pass: wait for gathering to finish before
// sending the offer/answer, so the SDP already contains every candidate and
// the existing call_ice relay isn't required for basic connectivity to work.
// Simpler to get right than trickling candidates through separate messages;
// on a LAN, gathering only host candidates is fast anyway. See BUILD_LOG.
function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(resolve, 3000); // safety net if gathering ever stalls
  });
}

// A plain two-tone ring, synthesized rather than shipped as an audio file -
// no asset to load, and it plays regardless of window focus (unlike the
// full-screen overlay, which only helps if the window is actually visible).
// Electron (Step 6) can add a real system notification/taskbar flash on top
// of this once it has access to real OS notification APIs.
function startRingtone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Starts "suspended" if the page hasn't registered a user gesture recently
  // enough for Chrome's autoplay policy - resume() is a no-op if it's
  // already running, and harmless (silently stays suspended) if the
  // browser refuses; real usage almost always has plenty of prior clicks
  // (onboarding, nav) before a call could arrive, so this is a safety net
  // more than the primary mechanism.
  ctx.resume().catch(() => {});
  let stopped = false;

  function ring() {
    if (stopped) return;
    for (const delay of [0, 0.3]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + delay + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    }
  }

  ring();
  const interval = setInterval(ring, 1800);
  return () => {
    stopped = true;
    clearInterval(interval);
    ctx.close().catch(() => {});
  };
}

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

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callRef = useRef(null);
  callRef.current = call;

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  function cleanupCall() {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setMuted(false);
    setCameraOff(false);
  }

  useEffect(() => {
    const stop = connectEvents((evt) => {
      const current = callRef.current;

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

    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
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

  useEffect(() => cleanupCall, []); // stop mic/camera if the app ever unmounts mid-call

  function setupPeerConnection(media) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.ontrack = (e) => {
      remoteStreamRef.current = e.streams[0];
      const target = media === "video" ? remoteVideoRef.current : remoteAudioRef.current;
      if (target) target.srcObject = e.streams[0];
    };
    pc.oniceconnectionstatechange = () => {
      // "closed" also fires from our own pc.close() during a normal hang up -
      // only "failed"/"disconnected" represent the connection actually
      // dying underneath an active call, which is what "dropped" means.
      if (["failed", "disconnected"].includes(pc.iceConnectionState) && callRef.current?.status === "in_call") {
        hangUp("dropped");
      }
    };
    return pc;
  }

  // Some Windows laptops expose a second "camera" purely for Windows Hello
  // face login (infrared) alongside the real one - it enumerates like any
  // other video device, but outside Hello's own IR-illuminated face-scan it
  // just produces solid black. `getUserMedia({video: true})` with no device
  // preference has no way to know that and can end up grabbing it first.
  // Prefer whichever enumerated camera doesn't look IR-labeled; if there's
  // only one camera, or labels aren't available yet, this is a no-op and
  // falls back to the exact previous unconstrained behavior.
  async function pickCameraDeviceId() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === "videoinput");
      if (cameras.length <= 1) return undefined;
      const nonIr = cameras.filter((d) => !/infrared|\bir\b|hello/i.test(d.label));
      return (nonIr[0] || cameras[0]).deviceId || undefined;
    } catch {
      return undefined;
    }
  }

  async function getLocalStream(media) {
    const videoDeviceId = media === "video" ? await pickCameraDeviceId() : undefined;
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media !== "video" ? false : videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
    });
  }

  async function placeCall(peerId, media) {
    setError("");
    try {
      const localStream = await getLocalStream(media);
      localStreamRef.current = localStream;

      const pc = setupPeerConnection(media);
      pcRef.current = pc;
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

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

  return {
    call,
    error,
    elapsed,
    muted,
    cameraOff,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    placeCall,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    toggleCamera,
  };
}
