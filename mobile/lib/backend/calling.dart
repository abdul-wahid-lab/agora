// Reimplements backend/app/calling.py exactly - this module does NOT
// implement WebRTC itself (see webrtc_call.dart for that, the Dart
// equivalent of frontend/src/hooks/useCall.js - calling.py's own Python
// side never touches WebRTC either, the browser/Electron engine does).
// This module's only job is relaying signaling over the existing
// messaging control channel, tracking call state, and resolving
// collision (both peers calling each other at the same instant) -
// exactly mirroring the Python side's own logic, field for field.
//
// Wire protocol (same as calling.py):
//   {"type": "call_offer",  "call_id", "sdp", "media"}
//   {"type": "call_answer", "call_id", "sdp"}
//   {"type": "call_ice",    "call_id", "candidate"}
//   {"type": "call_end",    "call_id", "reason"}

import 'messaging.dart' as msging;
import 'storage.dart' as storage;

class CallState {
  final String callId;
  final String peerId;
  final String direction; // "outgoing" | "incoming"
  final String media; // "audio" | "video"
  String status; // "ringing" | "in_call" | "ended"
  final double startedAt;
  double? connectedAt;
  String? endReason;
  final String? groupCallId;

  CallState({
    required this.callId,
    required this.peerId,
    required this.direction,
    required this.media,
    required this.status,
    double? startedAt,
    this.connectedAt,
    this.endReason,
    this.groupCallId,
  }) : startedAt = startedAt ?? DateTime.now().millisecondsSinceEpoch / 1000.0;
}

/// Maps a raw end reason to the status stored in call history - a call
/// that actually connected keeps that distinction even in how it ended
/// ('dropped' vs. 'completed'); one that never connected is recorded by
/// its specific reason, or 'missed' otherwise.
String finalStatus(CallState state, String reason) {
  if (state.connectedAt != null) {
    return reason == 'dropped' ? 'dropped' : 'completed';
  }
  if (['declined', 'busy', 'collision', 'failed'].contains(reason)) return reason;
  return 'missed';
}

class CallService {
  final String selfPeerId;
  final msging.MessagingService messaging;
  final storage.MessageStore store;

  // Mutable, not constructor-only: webrtc_call.dart wires its own
  // listeners onto an already-constructed CallService (it needs the
  // service to exist first, to call startCall/answerCall/endCall on),
  // the same "attach after construction" shape messaging.dart's own
  // addControlHandler already uses.
  void Function(CallState state, Map<String, dynamic> sdp)? onIncomingCall;
  void Function(String callId, Map<String, dynamic> sdp)? onCallAnswered;
  void Function(String callId, Map<String, dynamic> candidate)? onIceCandidate;
  void Function(String callId, String reason)? onCallEnded;
  void Function(String callId)? onCollisionYield;

  final Map<String, CallState> _calls = {};
  final Map<String, String> _activeForPeer = {};

  CallService({
    required this.selfPeerId,
    required this.messaging,
    required this.store,
    this.onIncomingCall,
    this.onCallAnswered,
    this.onIceCandidate,
    this.onCallEnded,
    this.onCollisionYield,
  }) {
    messaging.addControlHandler(_onControl);
  }

  Future<void> _finalize(CallState state, String reason) async {
    state.status = 'ended';
    state.endReason = reason;
    _activeForPeer.remove(state.peerId);
    final duration = state.connectedAt != null ? (DateTime.now().millisecondsSinceEpoch / 1000.0) - state.connectedAt! : null;
    await store.updateCallEnd(state.callId, finalStatus(state, reason), duration: duration);
  }

  CallState? get(String callId) => _calls[callId];

  /// Real signal for filetransfer.dart's own bandwidth-sharing throttle
  /// (see its isCallActive param) - true only while a call has actually
  /// connected, not merely ringing, so a transfer isn't throttled for a
  /// call that never answers.
  bool get hasActiveCall => _calls.values.any((c) => c.status == 'in_call');

  // -- originating a call --------------------------------------------------

  Future<String> startCall(String peerId, Map<String, dynamic> sdp, String media, {String? groupCallId}) async {
    if (_activeForPeer.containsKey(peerId)) {
      throw StateError('already have an active call with $peerId');
    }
    // Device-wide busy check (mirrors calling.py's own), with the same
    // group-call exception: parallel legs sharing one group_call_id are
    // the mesh feature working, not a conflict.
    for (final otherCallId in _activeForPeer.values) {
      final other = _calls[otherCallId];
      if (other == null || !['ringing', 'in_call'].contains(other.status)) continue;
      if (groupCallId != null && other.groupCallId == groupCallId) continue;
      throw StateError('already have an active call with ${other.peerId}');
    }

    final callId = DateTime.now().microsecondsSinceEpoch.toString();
    final state = CallState(callId: callId, peerId: peerId, direction: 'outgoing', media: media, status: 'ringing', groupCallId: groupCallId);
    _calls[callId] = state;
    _activeForPeer[peerId] = callId;
    await store.saveCallStart(callId: callId, peerId: peerId, direction: 'outgoing', media: media, startedAt: state.startedAt);

    final offer = <String, dynamic>{'type': 'call_offer', 'call_id': callId, 'sdp': sdp, 'media': media};
    if (groupCallId != null) offer['group_call_id'] = groupCallId;
    final sent = await messaging.sendControl(peerId, offer);
    if (!sent) {
      await _finalize(state, 'failed');
      throw StateError('peer $peerId not reachable');
    }
    return callId;
  }

  // -- answering / declining / hanging up ----------------------------------

  Future<void> answerCall(String callId, Map<String, dynamic> sdp) async {
    final state = _calls[callId];
    if (state == null) throw ArgumentError('no such call $callId');
    state.status = 'in_call';
    state.connectedAt = DateTime.now().millisecondsSinceEpoch / 1000.0;
    await messaging.sendControl(state.peerId, {'type': 'call_answer', 'call_id': callId, 'sdp': sdp});
  }

  Future<void> sendIceCandidate(String callId, Map<String, dynamic> candidate) async {
    final state = _calls[callId];
    if (state == null) return;
    await messaging.sendControl(state.peerId, {'type': 'call_ice', 'call_id': callId, 'candidate': candidate});
  }

  Future<void> endCall(String callId, {String reason = 'ended'}) async {
    final state = _calls[callId];
    if (state == null) return;
    await _finalize(state, reason);
    await messaging.sendControl(state.peerId, {'type': 'call_end', 'call_id': callId, 'reason': reason});
  }

  // -- inbound control messages -------------------------------------------

  Future<void> _onControl(String mtype, String peerId, Map<String, dynamic> msg) async {
    if (mtype == 'call_offer') {
      await _handleOffer(peerId, msg);
    } else if (mtype == 'call_answer') {
      final state = _calls[msg['call_id'] as String];
      if (state != null) {
        state.status = 'in_call';
        state.connectedAt = DateTime.now().millisecondsSinceEpoch / 1000.0;
      }
      onCallAnswered?.call(msg['call_id'] as String, msg['sdp'] as Map<String, dynamic>);
    } else if (mtype == 'call_ice') {
      onIceCandidate?.call(msg['call_id'] as String, msg['candidate'] as Map<String, dynamic>);
    } else if (mtype == 'call_end') {
      final state = _calls[msg['call_id'] as String];
      final reason = (msg['reason'] as String?) ?? 'ended';
      if (state != null) await _finalize(state, reason);
      onCallEnded?.call(msg['call_id'] as String, reason);
    }
  }

  Future<void> _handleOffer(String peerId, Map<String, dynamic> msg) async {
    final callId = msg['call_id'] as String;
    final incomingGroupCallId = msg['group_call_id'] as String?;

    for (final entry in _activeForPeer.entries) {
      if (entry.key == peerId) continue;
      final other = _calls[entry.value];
      if (other == null || !['ringing', 'in_call'].contains(other.status)) continue;
      if (incomingGroupCallId != null && other.groupCallId == incomingGroupCallId) continue;
      await messaging.sendControl(peerId, {'type': 'call_end', 'call_id': callId, 'reason': 'busy'});
      return;
    }

    final existingId = _activeForPeer[peerId];
    if (existingId != null) {
      final existing = _calls[existingId];
      if (existing != null && existing.direction == 'outgoing' && existing.status == 'ringing') {
        // Collision: resolved deterministically by peer_id, both sides
        // run this same comparison independently.
        if (selfPeerId.compareTo(peerId) < 0) {
          return; // we win - our own offer proceeds, silently ignore theirs
        } else {
          await _finalize(existing, 'collision');
          onCollisionYield?.call(existingId);
        }
      } else {
        await messaging.sendControl(peerId, {'type': 'call_end', 'call_id': callId, 'reason': 'busy'});
        return;
      }
    }

    final state = CallState(
      callId: callId,
      peerId: peerId,
      direction: 'incoming',
      media: (msg['media'] as String?) ?? 'audio',
      status: 'ringing',
      groupCallId: incomingGroupCallId,
    );
    _calls[callId] = state;
    _activeForPeer[peerId] = callId;
    await store.saveCallStart(callId: callId, peerId: peerId, direction: 'incoming', media: state.media, startedAt: state.startedAt);
    onIncomingCall?.call(state, msg['sdp'] as Map<String, dynamic>);
  }
}
