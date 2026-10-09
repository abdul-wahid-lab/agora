// Avatar photo sync - exact port of backend/app/photos.py. A peer's photo
// only ever needs to cross the network once per actual change, not once
// per sighting.
//
// Deliberately does NOT touch the signed discovery announcement or
// crypto_identity.dart's verification path at all - that path is
// adversarially tested, and casually extending it with a new field is a
// real way to introduce a subtle bug in something security-critical.
// Instead, a peer's current photo is asked for lazily, over the same
// encrypted control-message channel every other peer-to-peer exchange
// (file transfer, calling) already rides, the same request/response-with-
// a-Future pattern filetransfer.dart's offer/response uses.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

import 'messaging.dart' as msging;

/// Plain file-cache layer: this device's own photo (served to peers on
/// request) plus whatever photos have actually been fetched from peers so
/// far. No database table for the bytes themselves - a file on disk is the
/// simplest thing that works for what's fundamentally a small blob cache.
class PhotoStore {
  final Directory dir;
  final Directory peersDir;
  final File selfFile;

  PhotoStore._(this.dir, this.peersDir, this.selfFile);

  static Future<PhotoStore> open(String dataDir) async {
    final dir = Directory('$dataDir/photos');
    final peersDir = Directory('${dir.path}/peers');
    await peersDir.create(recursive: true);
    return PhotoStore._(dir, peersDir, File('${dir.path}/self.jpg'));
  }

  Future<String> setSelfPhoto(Uint8List data) async {
    await selfFile.writeAsBytes(data, flush: true);
    return crypto.sha256.convert(data).toString();
  }

  Future<void> clearSelfPhoto() async {
    if (await selfFile.exists()) await selfFile.delete();
  }

  Future<Uint8List?> getSelfPhoto() async {
    if (!await selfFile.exists()) return null;
    return selfFile.readAsBytes();
  }

  // peer_id is this app's own opaque generated identifier (see
  // crypto_identity.dart) - never attacker-chosen text that could escape
  // this directory via a path-traversal filename.
  File _peerFile(String peerId) => File('${peersDir.path}/$peerId.jpg');

  Future<Uint8List?> getPeerPhoto(String peerId) async {
    final f = _peerFile(peerId);
    if (!await f.exists()) return null;
    return f.readAsBytes();
  }

  Future<String> setPeerPhoto(String peerId, Uint8List data) async {
    await _peerFile(peerId).writeAsBytes(data, flush: true);
    return crypto.sha256.convert(data).toString();
  }

  Future<void> clearPeerPhoto(String peerId) async {
    final f = _peerFile(peerId);
    if (await f.exists()) await f.delete();
  }
}

/// The request/response half, registered as a messaging.dart control
/// handler exactly like filetransfer.dart and calling.dart already are.
class PhotoExchange {
  final msging.MessagingService messaging;
  final PhotoStore store;
  final Map<String, Completer<String?>> _waiters = {};

  PhotoExchange({required this.messaging, required this.store}) {
    messaging.addControlHandler(_onControl);
  }

  Future<void> _onControl(String mtype, String peerId, Map<String, dynamic> msg) async {
    if (mtype == 'photo_request') {
      final data = await store.getSelfPhoto();
      await messaging.sendControl(peerId, {'type': 'photo_response', 'photo_b64': data != null ? base64Encode(data) : null});
    } else if (mtype == 'photo_response') {
      final completer = _waiters.remove(peerId);
      if (completer != null && !completer.isCompleted) {
        completer.complete(msg['photo_b64'] as String?);
      }
    }
  }

  /// Asks peerId for their current photo right now. Returns the raw bytes,
  /// or null if they genuinely have no photo set. Throws StateError if
  /// they're not reachable at all, or TimeoutException if they don't
  /// answer in time.
  ///
  /// A real, not just theoretical, race: two widgets rendering the same
  /// peer's avatar at once can both ask for a fresh photo back to back
  /// before either resolves. Without reusing an in-flight request here,
  /// the second caller's fresh Completer would silently replace the
  /// first's in `_waiters`, and the peer's one real response would only
  /// ever resolve the second - piggybacking both callers on the same
  /// in-flight Future avoids that, and avoids a redundant second request.
  Future<Uint8List?> fetch(String peerId, {Duration timeout = const Duration(seconds: 5)}) async {
    final existing = _waiters[peerId];
    if (existing != null && !existing.isCompleted) {
      final b64Shared = await existing.future.timeout(timeout);
      return b64Shared != null ? base64Decode(b64Shared) : null;
    }

    final completer = Completer<String?>();
    _waiters[peerId] = completer;
    final sent = await messaging.sendControl(peerId, {'type': 'photo_request'});
    if (!sent) {
      _waiters.remove(peerId);
      throw StateError('peer $peerId not reachable');
    }
    String? b64;
    try {
      b64 = await completer.future.timeout(timeout);
    } on TimeoutException {
      _waiters.remove(peerId);
      rethrow;
    }
    return b64 != null ? base64Decode(b64) : null;
  }
}
