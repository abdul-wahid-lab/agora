// Reimplements frontend/src/hooks/useCall.js + lib/webrtc.js - the actual
// WebRTC media/negotiation layer, which calling.py's Python side never
// touches at all (it only relays signaling). No STUN/TURN by design (see
// calling.py's own docstring): every peer is on the same subnet, so only
// local host ICE candidates are ever needed. Non-trickle ICE, same as the
// desktop: wait for gathering to finish before sending the offer/answer,
// so the call_ice relay isn't required for basic connectivity - skipped
// entirely in this first pass, matching the desktop's own comment that
// it exists for future trickle support, not because today's calls need it.
//
// Screen sharing (the desktop's pre-negotiated extra video transceiver)
// is deliberately not included yet - a real, separate addition once this
// core audio/video path is proven, matching how the desktop app itself
// added it in a later step, not the original call-signaling pass.

import 'dart:async';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'calling.dart' as calling;

final rtcConfig = <String, dynamic>{'iceServers': []};

Future<void> waitForIceGatheringComplete(RTCPeerConnection pc) async {
  if (pc.iceGatheringState == RTCIceGatheringState.RTCIceGatheringStateComplete) return;
  final completer = Completer<void>();
  pc.onIceGatheringState = (state) {
    if (state == RTCIceGatheringState.RTCIceGatheringStateComplete && !completer.isCompleted) {
      completer.complete();
    }
  };
  // Safety net if gathering ever stalls - same 3s bound the desktop uses.
  unawaited(Future.delayed(const Duration(seconds: 3), () {
    if (!completer.isCompleted) completer.complete();
  }));
  await completer.future;
}

Future<MediaStream> getLocalStream(String media) {
  return navigator.mediaDevices.getUserMedia({
    'audio': true,
    'video': media == 'video',
  });
}

class ActiveCall {
  final String callId;
  final RTCPeerConnection pc;
  final MediaStream localStream;
  MediaStream? remoteStream;
  ActiveCall({required this.callId, required this.pc, required this.localStream, this.remoteStream});

  Future<void> dispose() async {
    for (final track in localStream.getTracks()) {
      await track.stop();
    }
    await pc.close();
  }
}

class WebrtcCallManager {
  final calling.CallService callService;
  final void Function(String callId, MediaStream remoteStream)? onRemoteStream;

  final Map<String, ActiveCall> _active = {};

  WebrtcCallManager({required this.callService, this.onRemoteStream}) {
    callService.onCallAnswered = (callId, sdp) => unawaited(_onAnswer(callId, sdp));
    callService.onIncomingCall = (state, sdp) {
      // The UI layer decides whether/when to actually answer (ring first,
      // real human accept) - this manager only exposes the pieces needed
      // to do that, it never auto-answers on its own.
    };
    callService.onCallEnded = (callId, reason) => unawaited(_cleanup(callId));
  }

  /// Places a call: gets the local mic/camera, creates the offer, waits
  /// for ICE gathering, then hands the finished SDP to calling.dart's
  /// signaling relay. Returns the new call_id.
  Future<String> placeCall(String peerId, String media) async {
    final localStream = await getLocalStream(media);
    final pc = await createPeerConnection(rtcConfig);
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        final callId = _callIdForPc(pc);
        if (callId != null) {
          _active[callId]?.remoteStream = event.streams.first;
          onRemoteStream?.call(callId, event.streams.first);
        }
      }
    };
    for (final track in localStream.getTracks()) {
      await pc.addTrack(track, localStream);
    }

    final offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    final localDesc = await pc.getLocalDescription();
    final callId = await callService.startCall(peerId, {'type': localDesc!.type, 'sdp': localDesc.sdp}, media);
    _active[callId] = ActiveCall(callId: callId, pc: pc, localStream: localStream);
    return callId;
  }

  /// Answers a real incoming call (the UI's own Accept button calls
  /// this, after whatever ringing/prompt UX it wants to show first).
  Future<void> answerIncoming(String callId, Map<String, dynamic> offerSdp, String media) async {
    final localStream = await getLocalStream(media);
    final pc = await createPeerConnection(rtcConfig);
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        _active[callId]?.remoteStream = event.streams.first;
        onRemoteStream?.call(callId, event.streams.first);
      }
    };
    // addTrack() queued up before setRemoteDescription, same ordering as
    // the desktop's own fix for this exact bug: the answering side's own
    // transceiver only negotiates sendrecv (not recvonly) when a local
    // track was already queued for it before the remote offer is applied.
    for (final track in localStream.getTracks()) {
      await pc.addTrack(track, localStream);
    }

    await pc.setRemoteDescription(RTCSessionDescription(offerSdp['sdp'] as String, offerSdp['type'] as String));
    final answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc);

    _active[callId] = ActiveCall(callId: callId, pc: pc, localStream: localStream);
    final localDesc = await pc.getLocalDescription();
    await callService.answerCall(callId, {'type': localDesc!.type, 'sdp': localDesc.sdp});
  }

  Future<void> _onAnswer(String callId, Map<String, dynamic> sdp) async {
    final call = _active[callId];
    if (call == null) return;
    await call.pc.setRemoteDescription(RTCSessionDescription(sdp['sdp'] as String, sdp['type'] as String));
  }

  Future<void> hangUp(String callId, {String reason = 'ended'}) async {
    await callService.endCall(callId, reason: reason);
    await _cleanup(callId);
  }

  Future<void> _cleanup(String callId) async {
    final call = _active.remove(callId);
    await call?.dispose();
  }

  /// Exposes the underlying RTCPeerConnection for a call this manager is
  /// tracking - a real UI uses this for connection-quality indicators;
  /// null once the call has ended and been cleaned up.
  RTCPeerConnection? peerConnectionFor(String callId) => _active[callId]?.pc;

  /// Exposes the real local/remote MediaStream objects for a call this
  /// manager is tracking - the call screen polls this to attach them to
  /// its RTCVideoRenderers once each becomes available (the remote one
  /// arrives asynchronously, after the other side's track negotiation
  /// completes). Null once the call has ended and been cleaned up.
  ActiveCall? activeCallFor(String callId) => _active[callId];

  String? _callIdForPc(RTCPeerConnection pc) {
    for (final entry in _active.entries) {
      if (entry.value.pc == pc) return entry.key;
    }
    return null;
  }
}
