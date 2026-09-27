import { useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { RTC_CONFIG, waitForIceGatheringComplete, getLocalStream, startRingtone } from "../lib/webrtc";

// Full mesh, no SFU/relay (see backend/app/groups.py's own module docstring
// for the full design). Mesh formation rule, applied identically on every
// participant's device: after a group_call_start, call every *other*
// member whose peer_id sorts after your own. For 3 members A<B<C: A calls
// B and C; B calls only C; C calls no one (both reach it from the other
// side). This guarantees exactly one connection per pair, decided purely
// by string comparison, no coordination needed - same idea calling.py's
// own 1:1 collision tie-break already uses, just for mesh formation
// instead of resolving a collision.
//
// Consent: everyone except the person who started the call gets a real
// ringing incoming-call prompt (same ringtone as a 1:1 call) and has to
// explicitly join or decline - it was auto-joining silently at first, that
// was wrong, this app never auto-answers a 1:1 call either. A person who
// declines simply never places or accepts any connection for this call;
// everyone else's mesh forms around them missing, same as if they just
// hadn't answered a 1:1 call.
export function useGroupCall(selfPeerId) {
  // null | { groupId, groupCallId, groupName, media, participants: { [peerId]: { name, status, stream } } }
  const [groupCall, setGroupCall] = useState(null);
  // null | { groupId, groupCallId, groupName, media, members } - the ringing prompt, not yet joined
  const [incomingGroupCall, setIncomingGroupCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const groupCallRef = useRef(null);
  groupCallRef.current = groupCall;
  const incomingRef = useRef(null);
  incomingRef.current = incomingGroupCall;
  const pcsRef = useRef(new Map()); // peer_id -> RTCPeerConnection
  const callIdToPeerRef = useRef(new Map()); // call_id -> peer_id, both directions
  const localStreamRef = useRef(null);
  const videoRefs = useRef(new Map()); // peer_id -> <video> element ("local" for self)
  const stopRingRef = useRef(null);
  // Legs that arrive (call_incoming) while a decision is still pending -
  // accepted all at once on Join, declined all at once on Decline.
  const bufferedIncomingRef = useRef([]);
  // Set by startGroupCall right before the broadcast reaches us back -
  // lets the initiator's own device skip the consent prompt for a call it
  // just explicitly started itself, without a separate code path.
  const justInitiatedGroupCallIdRef = useRef(null);
  // A real gap found in testing: mesh legs don't all arrive at once, so a
  // straggler call_incoming for a group_call_id can arrive *after* this
  // device already declined and cleared its state for that same call -
  // without remembering the decline, that straggler looked like a brand
  // new incoming call and got a fresh prompt instead of being auto-
  // declined, and left the caller's side stuck at "Connecting…" forever
  // since nothing ever answered or ended it.
  const declinedGroupCallIdsRef = useRef(new Set());

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

  function stopRinging() {
    stopRingRef.current?.();
    stopRingRef.current = null;
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

  async function acceptMeshLeg(evt) {
    callIdToPeerRef.current.set(evt.call_id, evt.peer_id);
    setParticipant(evt.peer_id, { status: "connecting" });
    try {
      const pc = setupPeerConnection(evt.peer_id);
      await pc.setRemoteDescription(evt.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);
      await api.callAnswer(evt.call_id, pc.localDescription.toJSON());
    } catch {
      setParticipant(evt.peer_id, { status: "unreachable" });
    }
  }

  // Shared by the initiator's own auto-join and joinIncomingGroupCall() -
  // actually sets up the local stream, joins the mesh, and places this
  // device's own outgoing legs per the mesh rule.
  async function doJoin(groupId, groupCallId, groupName, media, members) {
    const localStream = await getLocalStream(media).catch(() => null);
    if (!localStream) return; // permission denied or no device - silently can't join this leg
    localStreamRef.current = localStream;
    setGroupCall({
      groupId,
      groupCallId,
      groupName,
      media,
      participants: Object.fromEntries(members.map((m) => [m.peer_id, { name: m.name, status: "connecting", stream: null }])),
    });
    setTimeout(() => {
      const el = videoRefs.current.get("local");
      if (el) el.srcObject = localStream;
    }, 0);

    const buffered = bufferedIncomingRef.current;
    bufferedIncomingRef.current = [];
    for (const evt of buffered) await acceptMeshLeg(evt);

    const myTargets = members.filter((m) => m.peer_id > selfPeerId).map((m) => m.peer_id);
    for (const targetId of myTargets) callMember(targetId, media, groupCallId);
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

        if (justInitiatedGroupCallIdRef.current === evt.group_call_id) {
          // This is our own call coming back to us via api.py's self-
          // rebroadcast - we already consented by clicking "Start call",
          // no prompt needed.
          justInitiatedGroupCallIdRef.current = null;
          await doJoin(evt.group_id, evt.group_call_id, evt.group_name, evt.media, members);
          return;
        }

        if (incomingRef.current?.groupCallId === evt.group_call_id) {
          // A stray mesh leg beat this broadcast here (real, possible race -
          // two different senders, no shared ordering) and already started
          // the prompt with partial info - backfill the real group name and
          // full member list onto it now.
          setIncomingGroupCall((prev) => (prev ? { ...prev, groupId: evt.group_id, groupName: evt.group_name, members } : prev));
          return;
        }

        if (groupCallRef.current || incomingRef.current) return; // already on/considering a different call

        setIncomingGroupCall({ groupId: evt.group_id, groupCallId: evt.group_call_id, groupName: evt.group_name, media: evt.media, members });
        stopRingRef.current = startRingtone();
        return;
      }

      if (evt.type === "call_incoming" && evt.group_call_id) {
        if (declinedGroupCallIdsRef.current.has(evt.group_call_id)) {
          // A straggler leg for a call already declined (mesh legs don't
          // all arrive at once) - auto-decline it too instead of either
          // showing a fresh prompt or silently leaving the caller ringing
          // forever with nothing to answer or end it.
          api.callEnd(evt.call_id, "declined").catch(() => {});
          return;
        }
        if (groupCallRef.current?.groupCallId === evt.group_call_id) {
          // Already joined this exact call (e.g. someone else joins after
          // us) - accept this new leg immediately, no re-prompting.
          await acceptMeshLeg(evt);
          return;
        }
        if (incomingRef.current?.groupCallId === evt.group_call_id) {
          // Prompt already showing for this call - hold this leg until decided.
          bufferedIncomingRef.current.push(evt);
          return;
        }
        if (!groupCallRef.current && !incomingRef.current) {
          // A mesh leg arrived before (or without ever receiving) a
          // group_call_start broadcast - still show the same consent
          // prompt, using what little info this single offer carries;
          // group_call_start arriving later (see above) backfills the rest.
          bufferedIncomingRef.current.push(evt);
          setIncomingGroupCall({ groupId: null, groupCallId: evt.group_call_id, groupName: "a group", media: evt.media, members: [] });
          stopRingRef.current = startRingtone();
          return;
        }
        // Busy with a genuinely different call already - leave it
        // unanswered, same as calling.py's own "busy" semantics from the
        // caller's perspective (it isn't consulted here for a decline
        // since there's no single obvious call_id to end from this state).
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

  useEffect(() => () => {
    stopRinging();
    cleanup();
  }, []);

  async function startGroupCall(group, media) {
    // Generated here, before the request even goes out, and not after
    // awaiting the response - a real race was found in testing: the
    // WebSocket broadcast of group_call_start can reach this same device
    // *before* the HTTP response does, and if this ref weren't already set
    // by then, the initiator would see a consent prompt for the call it
    // just started itself.
    const groupCallId = crypto.randomUUID();
    justInitiatedGroupCallIdRef.current = groupCallId;
    const res = await api.startGroupCall(group.group_id, media, groupCallId);
    if (res.status === "failed") {
      justInitiatedGroupCallIdRef.current = null;
      return res; // e.g. over the MAX_GROUP_CALL_MEMBERS cap - see groups.py
    }
    // The actual join happens via the group_call_start event above, fired
    // right back at us too by api.py's own rebroadcast.
    return res;
  }

  async function joinIncomingGroupCall() {
    const incoming = incomingRef.current;
    if (!incoming) return;
    stopRinging();
    setIncomingGroupCall(null);
    await doJoin(incoming.groupId, incoming.groupCallId, incoming.groupName, incoming.media, incoming.members);
  }

  function declineIncomingGroupCall() {
    const incoming = incomingRef.current;
    stopRinging();
    setIncomingGroupCall(null);
    if (incoming) declinedGroupCallIdsRef.current.add(incoming.groupCallId);
    const buffered = bufferedIncomingRef.current;
    bufferedIncomingRef.current = [];
    for (const evt of buffered) api.callEnd(evt.call_id, "declined").catch(() => {});
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

  return {
    groupCall,
    incomingGroupCall,
    muted,
    cameraOff,
    startGroupCall,
    joinIncomingGroupCall,
    declineIncomingGroupCall,
    hangUpGroupCall,
    toggleMute,
    toggleCamera,
    registerVideoRef,
  };
}
