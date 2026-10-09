// Per-peer latency and connection-quality - exact port of
// backend/app/latency.py. Real round-trip measurement, not a decoration: a
// ping/pong control message pair rides the same live connection
// messaging.dart already keeps open per peer, so the number shown is the
// actual time a real frame takes to reach that peer and come back right
// now, not a synthetic or cached value.
//
// "Signal strength" has no real meaning here the way WiFi RSSI would (this
// is a LAN software connection, not a radio link), so quality is
// approximated from the measured round-trip time and whether the last
// attempt even succeeded, rather than faking a signal-bars icon with
// nothing real behind it.

import 'dart:async';
import 'dart:math';

import 'discovery.dart' as disc;
import 'messaging.dart' as msging;

const pingIntervalSec = 5.0;
const pingTimeoutSec = 3.0;

String qualityForRtt(double? rttMs) {
  if (rttMs == null) return 'unreachable';
  if (rttMs <= 30) return 'excellent';
  if (rttMs <= 80) return 'good';
  if (rttMs <= 200) return 'fair';
  return 'weak';
}

class LatencySample {
  final double? rttMs;
  final String quality;
  final double measuredAt;
  const LatencySample({required this.rttMs, required this.quality, required this.measuredAt});
}

class LatencyService {
  final disc.PeerDiscovery discovery;
  final msging.MessagingService messaging;

  final Map<String, LatencySample> latest = {};
  final Map<String, Completer<double>> _waiters = {};
  Timer? _loopTimer;
  bool _looping = false;

  LatencyService({required this.discovery, required this.messaging}) {
    messaging.addControlHandler(_onControl);
  }

  void start() {
    _looping = true;
    unawaited(_pingLoop());
  }

  void stop() {
    _looping = false;
    _loopTimer?.cancel();
  }

  Future<void> _onControl(String mtype, String peerId, Map<String, dynamic> msg) async {
    if (mtype == 'ping') {
      await messaging.sendControl(peerId, {'type': 'pong', 'nonce': msg['nonce'], 'echoed_sent_at': msg['sent_at']});
    } else if (mtype == 'pong') {
      final completer = _waiters.remove(msg['nonce'] as String);
      if (completer != null && !completer.isCompleted) {
        completer.complete((msg['echoed_sent_at'] as num).toDouble());
      }
    }
  }

  /// One real round trip to peerId, in milliseconds - null if it timed out
  /// or couldn't even be sent (peer not currently reachable).
  Future<double?> ping(String peerId) async {
    final nonce = _randomNonce();
    final sentAt = DateTime.now().millisecondsSinceEpoch / 1000.0;
    final completer = Completer<double>();
    _waiters[nonce] = completer;
    final ok = await messaging.sendControl(peerId, {'type': 'ping', 'nonce': nonce, 'sent_at': sentAt});
    if (!ok) {
      _waiters.remove(nonce);
      return null;
    }
    try {
      await completer.future.timeout(const Duration(milliseconds: 3000));
    } catch (_) {
      _waiters.remove(nonce);
      return null;
    }
    return (DateTime.now().millisecondsSinceEpoch / 1000.0 - sentAt) * 1000;
  }

  Future<void> _pingLoop() async {
    while (_looping) {
      for (final peer in discovery.registry.list()) {
        final rttMs = await ping(peer.peerId);
        latest[peer.peerId] = LatencySample(
          rttMs: rttMs != null ? double.parse(rttMs.toStringAsFixed(1)) : null,
          quality: qualityForRtt(rttMs),
          measuredAt: DateTime.now().millisecondsSinceEpoch / 1000.0,
        );
      }
      await Future.delayed(const Duration(milliseconds: 5000));
    }
  }

  String _randomNonce() {
    final rand = Random.secure();
    return List.generate(32, (_) => rand.nextInt(16).toRadixString(16)).join();
  }
}
