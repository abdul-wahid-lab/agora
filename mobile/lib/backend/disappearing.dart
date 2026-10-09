// Disappearing messages - exact port of backend/app/disappearing.py.
//
// A per-conversation setting: messages older than a chosen duration get
// deleted automatically. Deliberately **local-only**: this device sweeps
// its own copy of the conversation, nothing is sent to the peer telling
// them to do the same. Real "both sides vanish together" disappearing
// messages would need a new wire message, the peer's own device enforcing
// it independently, and a real answer for what happens to a setting change
// mid-conversation - deliberately out of scope here, same as the Python
// side, and the UI should say "on this device" plainly rather than imply a
// guarantee this doesn't provide.
//
// No new wire protocol, no new socket: a lightweight periodic sweep against
// storage.dart's own messages table, the same start()/stop()/background-
// timer shape messaging.dart's pending-flush loop and deletion.dart's own
// loop already use.

import 'dart:async';

import 'storage.dart' as storage;

const disappearingSweepIntervalSeconds = 30;

class DisappearingMessagesService {
  final storage.MessageStore store;
  final void Function(String peerId, int count)? onSwept;

  Timer? _timer;

  DisappearingMessagesService({required this.store, this.onSwept});

  void start() {
    _timer = Timer.periodic(const Duration(seconds: disappearingSweepIntervalSeconds), (_) => unawaited(_sweepOnce()));
  }

  void stop() {
    _timer?.cancel();
  }

  Future<void> _sweepOnce() async {
    for (final setting in await store.listDisappearingSettings()) {
      final peerId = setting['peer_id'] as String;
      final durationSeconds = setting['duration_seconds'] as int;
      final cutoff = (DateTime.now().millisecondsSinceEpoch / 1000.0) - durationSeconds;
      final deleted = await store.deleteExpiredMessages(peerId, cutoff);
      if (deleted > 0) onSwept?.call(peerId, deleted);
    }
  }
}
