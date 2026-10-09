// "Delete for everyone" - exact port of backend/app/deletion.py.
//
// Rides the same control-message mechanism file transfer and calling
// already use (MessagingService.addControlHandler/sendControl) - no new
// socket, no change to messaging.dart's core chat/ack protocol.
//
// Wire message: {"type": "delete", "msg_id": ...}
//
// Offline handling mirrors messaging.dart's own pending-flush loop: if the
// peer isn't reachable the moment you delete, the intent is remembered in
// storage's pending_deletes table and a background loop retries it, in
// original order, the next time that peer is visible to discovery - never
// silently dropped.
//
// No time window (unlike WhatsApp's ~1 hour), same reasoning as the Python
// side: deleting your own local copy always happens immediately and
// unconditionally; only notifying the peer is subject to retry-until-
// delivered.

import 'dart:async';

import 'discovery.dart' as disc;
import 'messaging.dart' as msging;
import 'storage.dart' as storage;

class DeleteService {
  final disc.PeerDiscovery discovery;
  final msging.MessagingService messaging;
  final storage.MessageStore store;
  final void Function(String peerId, String msgId)? onRemoteDelete;

  Timer? _flushTimer;

  DeleteService({required this.discovery, required this.messaging, required this.store, this.onRemoteDelete}) {
    messaging.addControlHandler(_onControl);
  }

  void start() {
    _flushTimer = Timer.periodic(const Duration(seconds: 2), (_) => unawaited(_flushPendingTick()));
  }

  void stop() {
    _flushTimer?.cancel();
  }

  /// Deletes the local copy immediately (same effect as "delete for me"),
  /// then best-effort notifies the peer. If unreachable right now, the
  /// notification is queued for automatic retry rather than lost.
  Future<void> deleteForEveryone(String peerId, String msgId) async {
    await store.deleteMessage(msgId);
    final sent = await messaging.sendControl(peerId, {'type': 'delete', 'msg_id': msgId});
    if (!sent) {
      await store.savePendingDelete(msgId, peerId);
    }
  }

  Future<void> _onControl(String mtype, String peerId, Map<String, dynamic> msg) async {
    if (mtype != 'delete') return; // not ours - file transfer/calling's own handlers take the rest
    final msgId = msg['msg_id'] as String;
    await store.deleteMessage(msgId);
    onRemoteDelete?.call(peerId, msgId);
  }

  Future<void> _flushPendingTick() async {
    final visibleIds = discovery.registry.list().map((p) => p.peerId).toSet();
    for (final peerId in visibleIds) {
      for (final msgId in await store.pendingDeletesForPeer(peerId)) {
        final sent = await messaging.sendControl(peerId, {'type': 'delete', 'msg_id': msgId});
        if (sent) await store.removePendingDelete(msgId);
      }
    }
  }
}
