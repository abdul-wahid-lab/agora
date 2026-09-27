import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { RTC_CONFIG, waitForIceGatheringComplete, getLocalStream } from "../lib/webrtc";

// Full mesh, no SFU/relay (see backend/app/groups.py's own module docstring
// for the full design). Mesh formation rule, applied identically on every
// participant's device: after a group_call_start, call every *other*
// member whose peer_id sorts after your own. For 3 members A<B<C: A calls
// B and C; B calls only C; C calls no one (both reach it from the other
// side). This guarantees exactly one connection per pair, decided purely
// by string comparison, no coordination needed - same idea calling.py's
// own 1:1 collision tie-break already uses, just for mesh formation
// instead of resolving a collision.
export function useGroupCall(selfPeerId) {
  // null | { groupId, groupCallId, groupName, media, participants: { [peerId]: { name, status, stream } } }
  const [groupCall, setGroupCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const groupCallRef = useRef(null);
  groupCallRef.current = groupCall;
  const pcsRef = useRef(new Map()); // peer_id -> RTCPeerConnection
  const callIdToPeerRef = useRef(new Map()); // call_id -> peer_id, both directions
  const localStreamRef = useRef(null);
  const videoRefs = useRef(new Map()); // peer_id -> <video> element ("local" for self)

  function registerVideoRef(peerId, el) {
    if (el) videoRefs.current.set(peerId, el);
    else videoRefs.current.delete(peerId);
    const stream = peerId === "local" ? localStreamRef.current : groupCallRef.current?.participants[peerId]?.stream;
    if (el && stream) el.srcObject = stream;
  }

  function setParticipant(peerId, patch) {
    setGroupCall((gc) => {
      if (!gc) return gc;
      const existing = gc.participants[peerId] || { name: peerId, status: "connecting", stream: null };
      return { ...gc, participants: { ...gc.participants, [peerId]: { ...existing, ...patch } } };
    });
  }

  function cleanup() {
    for (const pc of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    callIdToPeerRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    videoRefs.current.clear();
    setMuted(false);
    setCameraOff(false);
  }

  function setupPeerConnection(peerId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.ontrack = (e) => {
      setParticipant(peerId, { stream: e.streams[0], status: "connected" });
      const el = videoRefs.current.get(peerId);
      if (el) el.srcObject = e.streams[0];
    };
    pc.oniceconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState)) {
        setParticipant(peerId, { status: "left" });
      }
    };
    localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));
    pcsRef.current.set(peerId, pc);
    return pc;
  }

  async function callMember(peerId, media, groupCallId) {
    setParticipant(peerId, { status: "connecting" });
    try {
      const pc = setupPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      const res = await api.callOffer(peerId, pc.localDescription.toJSON(), media, groupCallId);
      if (res.status === "failed") {
        setParticipant(peerId, { status: "unreachable" });
        return;
      }
      callIdToPeerRef.current.set(res.call_id, peerId);
    } catch {
      setParticipant(peerId, { status: "unreachable" });
    }
  }

  // Temporary debug hook, safe to leave (no-op unless something reads it
  // from the console) - lets a live session inspect real RTCPeerConnection
  // state per mesh leg without needing React devtools.
  useEffect(() => {
    window.__agoraGroupCallDebug = () =>
      Object.fromEntries([...pcsRef.current.entries()].map(([pid, pc]) => [pid, { iceConnectionState: pc.iceConnectionState, connectionState: pc.connectionState, signalingState: pc.signalingState, senders: pc.getSenders().length, receivers: pc.getReceivers().length }]));
  }, []);

  useEffect(() => {
    const stop = connectEvents(async (evt) => {
      if (evt.type === "group_call_start") {
        const members = evt.members.filter((m) => m.peer_id !== selfPeerId);
        const localStream = await getLocalStream(evt.media).catch(() => null);
        if (!localStream) return; // permission denied or no device - silently can't join this leg
        localStreamRef.current = localStream;
        setGroupCall({
          groupId: evt.group_id,
          groupCallId: evt.group_call_id,
          groupName: evt.group_name,
          media: evt.media,
          participants: Object.fromEntries(members.map((m) => [m.peer_id, { name: m.name, status: "connecting", stream: null }])),
        });
        setTimeout(() => {
          const el = videoRefs.current.get("local");
          if (el) el.srcObject = localStream;
        }, 0);

        const myTargets = members.filter((m) => m.peer_id > selfPeerId).map((m) => m.peer_id);
        for (const targetId of myTargets) callMember(targetId, evt.media, evt.group_call_id);
        return;
      }

      if (evt.type === "call_incoming" && evt.group_call_id) {
        // Any incoming call tagged with a group_call_id is a mesh leg from
        // another member - auto-accept it unconditionally rather than
        // showing a 1:1 popup. This also covers the (real, possible) race
        // where a mesh peer's call_offer arrives over their own connection
        // before this device's group_call_start broadcast (a separate
        // connection, from the initiator) has arrived yet: there's no
        // "have I joined this group call" check here on purpose.
        callIdToPeerRef.current.set(evt.call_id, evt.peer_id);
        setParticipant(evt.peer_id, { status: "connecting" });
        try {
          if (!localStreamRef.current) {
            const localStream = await getLocalStream(evt.media).catch(() => null);
            if (!localStream) return;
            localStreamRef.current = localStream;
          }
          const pc = setupPeerConnection(evt.peer_id);
          await pc.setRemoteDescription(evt.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForIceGatheringComplete(pc);
          await api.callAnswer(evt.call_id, pc.localDescription.toJSON());
        } catch {
          setParticipant(evt.peer_id, { status: "unreachable" });
        }
        return;
      }

      if (evt.type === "call_answered") {
        const pid = callIdToPeerRef.current.get(evt.call_id);
        const pc = pid && pcsRef.current.get(pid);
        if (pc) pc.setRemoteDescription(evt.sdp).then(() => setParticipant(pid, { status: "connected" }));
        return;
      }

      if (evt.type === "call_ice") {
        const pid = callIdToPeerRef.current.get(evt.call_id);
        const pc = pid && pcsRef.current.get(pid);
        pc?.addIceCandidate(evt.candidate).catch(() => {});
        return;
      }

      if (evt.type === "call_ended") {
        const pid = callIdToPeerRef.current.get(evt.call_id);
        if (pid) {
          pcsRef.current.get(pid)?.close();
          pcsRef.current.delete(pid);
          setParticipant(pid, { status: "left" });
        }
      }
    });
    return stop;
  }, [selfPeerId]);

  useEffect(() => cleanup, []);

  async function startGroupCall(group, media) {
    const res = await api.startGroupCall(group.group_id, media);
    if (res.status === "failed") return res; // e.g. over the MAX_GROUP_CALL_MEMBERS cap - see groups.py
    // Otherwise the actual join happens via the group_call_start event
    // above, fired right back at us too by api.py's own rebroadcast -
    // symmetric with every other member, no separate "I'm the initiator"
    // code path.
    return res;
  }

  function hangUpGroupCall() {
    // Closing every RTCPeerConnection directly (rather than calling
    // api.callEnd per call_id) triggers oniceconnectionstatechange on the
    // other end regardless, which is what actually matters for the other
    // side to notice - this hook never needs its own list of call_ids for
    // that beyond what pcsRef already tracks by peer_id.
    for (const pc of pcsRef.current.values()) pc.close();
    cleanup();
    setGroupCall(null);
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

  return { groupCall, muted, cameraOff, startGroupCall, hangUpGroupCall, toggleMute, toggleCamera, registerVideoRef };
}
