// Reimplements backend/app/filetransfer.py - same wire protocol exactly:
//   file_offer          {transfer_id, filename, size, sha256, is_executable}
//   file_offer_response {transfer_id, accept, port, resume_at}
//   file_complete       {transfer_id}
//   file_failed         {transfer_id, reason}
// over the existing messaging control channel, with the actual bytes
// moving over a *separate* raw TCP socket, each chunk length-prefixed
// (4-byte big-endian) and encrypted with the same per-peer shared key
// messaging.dart derives - byte-for-byte the same framing as the Python
// side, so a transfer works in either direction between a phone and a
// desktop. Voice-message read receipts (file_played) and the call-active
// bandwidth throttle (see throttleSleepSeconds) now both ported too, since
// calling.dart exists on mobile - wired the same way api.py wires them on
// the desktop: onPlayed/isCallActive are plain callbacks the app layer
// supplies, this module has no idea what a "call" or a "voice message UI"
// actually is.

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' show sha256;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'crypto_identity.dart' as ci;
import 'discovery.dart' as disc;
import 'messaging.dart' as msging;
import 'storage.dart' as storage;

const chunkSize = 256 * 1024;
// A real chunk is at most chunkSize plaintext bytes + 12-byte nonce +
// 16-byte AEAD tag. Anything claiming to be bigger than that is either a
// protocol bug or someone connected to this listener claiming an absurd
// length - see filetransfer.py's own comment on the real slow-loris hang
// this cap closes.
const maxEncryptedChunkLen = chunkSize + 64;
const chunkReadTimeout = Duration(seconds: 60);
const executableExts = {'apk', 'exe', 'msi', 'bat', 'cmd', 'com', 'sh', 'jar', 'appimage', 'ps1'};

// Bandwidth-sharing throttle (see _streamToPeer's isCallActive branch).
// baseThrottleSleep is a flat policy floor: whenever a call is active,
// back off by at least this much per chunk, regardless of anything
// measured, so call quality always gets *some* deliberate headroom. On top
// of that floor, adaptiveFactor scales in a real measured signal: how long
// this same socket's write+flush just took - an elevated flush time is a
// genuine sign something (the call's own media traffic included) is
// actually competing for the link right now. maxExtraThrottleSleep caps
// the top-up so one unusually slow chunk can't stall a transfer
// indefinitely.
const baseThrottleSleep = 0.2;
const adaptiveFactor = 4.0;
const maxExtraThrottleSleep = 1.0;

double throttleSleepSeconds(double writeElapsedSec) {
  final extra = writeElapsedSec * adaptiveFactor;
  return baseThrottleSleep + (extra < maxExtraThrottleSleep ? extra : maxExtraThrottleSleep);
}

bool isExecutableFile(String filename) {
  final ext = p.extension(filename).replaceFirst('.', '').toLowerCase();
  return executableExts.contains(ext);
}

Future<String> sha256File(File file) async {
  final digest = await sha256.bind(file.openRead()).first;
  return digest.toString();
}

class IncomingFileOffer {
  final String transferId;
  final String peerId;
  final String filename;
  final int size;
  final bool isExecutable;
  final String? groupId;
  IncomingFileOffer({required this.transferId, required this.peerId, required this.filename, required this.size, required this.isExecutable, this.groupId});
}

class TransferCancelled implements Exception {}

class FileTransferService {
  final disc.PeerDiscovery discovery;
  final msging.MessagingService messaging;
  final storage.MessageStore store;
  final Directory downloadsDir;
  late final Directory incomingDir;

  final void Function(IncomingFileOffer)? onOffer;
  final void Function(String transferId, int bytesSoFar, int total)? onProgress;
  final void Function(String transferId, String status, String? savedPath)? onReceived;
  // The *sender's* own row was just marked played, see markPlayed() below.
  final void Function(String transferId)? onPlayed;
  // Read fresh on every chunk, not cached - lets a call that starts or
  // ends mid-transfer change the throttling in real time.
  final bool Function() isCallActive;

  final Map<String, Completer<Map<String, dynamic>>> _offerWaiters = {};
  final Map<String, Completer<Map<String, dynamic>>> _resultWaiters = {};
  final Map<String, String> _outgoingPaths = {};
  final Map<String, ServerSocket> _listeners = {};
  final Set<String> _cancelled = {};
  final Map<String, _ProgressStats> _progressStats = {};
  double _peakSpeedBps = 0;
  Timer? _flushTimer;

  FileTransferService({
    required this.discovery,
    required this.messaging,
    required this.store,
    required this.downloadsDir,
    this.onOffer,
    this.onProgress,
    this.onReceived,
    this.onPlayed,
    bool Function()? isCallActive,
  }) : isCallActive = isCallActive ?? (() => false) {
    incomingDir = Directory(p.join(downloadsDir.path, '.incoming'));
    messaging.addControlHandler(_onControl);
  }

  Future<void> start() async {
    await downloadsDir.create(recursive: true);
    await incomingDir.create(recursive: true);
    _flushTimer = Timer.periodic(const Duration(seconds: 2), (_) => _flushPendingTick());
  }

  Future<void> stop() async {
    _flushTimer?.cancel();
  }

  void _recordProgress(String transferId, int bytesSoFar, int total) {
    final stats = _progressStats[transferId];
    if (stats == null) {
      _progressStats[transferId] = _ProgressStats(startedAt: DateTime.now(), bytesSoFar: bytesSoFar, total: total);
    } else {
      stats.bytesSoFar = bytesSoFar;
      stats.total = total;
    }
  }

  /// speed_bps/eta_sec for a live Transfers-style view - average
  /// throughput since this transfer started, not a jittery instantaneous
  /// per-chunk rate. Null once no longer actively tracked here.
  Map<String, num?>? getTransferStats(String transferId) {
    final stats = _progressStats[transferId];
    if (stats == null) return null;
    final elapsedSec = DateTime.now().difference(stats.startedAt).inMilliseconds / 1000.0;
    if (elapsedSec <= 0 || stats.bytesSoFar <= 0) return {'speed_bps': 0, 'eta_sec': null};
    final speedBps = stats.bytesSoFar / elapsedSec;
    final remaining = stats.total - stats.bytesSoFar;
    final etaSec = speedBps > 0 ? remaining / speedBps : null;
    _peakSpeedBps = _peakSpeedBps > speedBps ? _peakSpeedBps : speedBps;
    return {'speed_bps': speedBps.round(), 'eta_sec': etaSec};
  }

  int getPeakSpeedBps() => _peakSpeedBps.round();

  // -- sending -----------------------------------------------------------

  Future<String> sendFile(String peerId, File file, {String? groupId, bool keepSenderCopy = false}) async {
    if (!await file.exists()) throw ArgumentError('no such file: ${file.path}');
    final transferId = const Uuid().v4();
    final size = await file.length();
    final digest = await sha256File(file);
    final executable = isExecutableFile(file.path);

    // Every other sent file leaves savedPath unset on purpose - a sent
    // file's bytes are never guaranteed to still be at the original path
    // later, so only a receiver's own permanent download gets one.
    // keepSenderCopy is the deliberate exception for a voice note, once
    // that feature exists on mobile.
    await store.saveFile(
      transferId: transferId,
      peerId: peerId,
      direction: 'sent',
      filename: p.basename(file.path),
      size: size,
      sha256: digest,
      isExecutable: executable,
      status: 'offered',
      savedPath: keepSenderCopy ? file.path : null,
      groupId: groupId,
    );
    _outgoingPaths[transferId] = file.path;
    return _offerAndStream(transferId, peerId, file.path, p.basename(file.path), size, digest, executable, groupId);
  }

  /// Retry a transfer that stalled (peer dropped mid-stream). Reuses the
  /// same transfer_id, so the receiver's already-partial file (if any)
  /// resumes from its actual byte offset instead of restarting.
  Future<String> resend(String transferId) async {
    final record = await store.getFile(transferId);
    if (record == null || record.direction != 'sent') {
      throw ArgumentError('no outgoing transfer $transferId');
    }
    final path = _outgoingPaths[transferId];
    if (path == null) {
      throw StateError("original file path isn't available to resend (process may have restarted)");
    }
    return _offerAndStream(transferId, record.peerId, path, record.filename, record.size, record.sha256, record.isExecutable, record.groupId);
  }

  Future<void> _flushPendingTick() async {
    final visibleIds = discovery.registry.list().map((p) => p.peerId).toSet();
    for (final transferId in _outgoingPaths.keys.toList()) {
      final record = await store.getFile(transferId);
      if (record == null || record.status != 'failed' || !visibleIds.contains(record.peerId)) continue;
      try {
        await resend(transferId);
      } catch (_) {
        // still not reachable, or path already gone - next tick tries again
      }
    }
  }

  Future<String> _offerAndStream(String transferId, String peerId, String path, String filename, int size, String digest, bool executable, String? groupId) async {
    final offerCompleter = Completer<Map<String, dynamic>>();
    _offerWaiters[transferId] = offerCompleter;

    final offer = <String, dynamic>{'type': 'file_offer', 'transfer_id': transferId, 'filename': filename, 'size': size, 'sha256': digest, 'is_executable': executable};
    if (groupId != null) offer['group_id'] = groupId;
    final sent = await messaging.sendControl(peerId, offer);
    if (!sent) {
      _offerWaiters.remove(transferId);
      await store.updateFileStatus(transferId, 'failed');
      throw StateError('peer $peerId not reachable');
    }

    Map<String, dynamic> response;
    try {
      // Generous safety-net timeout, not a UX countdown - a real human
      // can take as long as they want to accept/decline; this just
      // catches the peer's connection tearing down between hello and
      // this offer actually being processed.
      response = await offerCompleter.future.timeout(const Duration(seconds: 60));
    } on TimeoutException {
      _offerWaiters.remove(transferId);
      await store.updateFileStatus(transferId, 'failed');
      throw StateError('peer $peerId never responded to the file offer');
    }
    if (response['accept'] != true) {
      final status = _cancelled.remove(transferId) ? 'cancelled' : 'declined';
      await store.updateFileStatus(transferId, status);
      return transferId;
    }

    final peer = discovery.registry.list().cast<disc.Peer?>().firstWhere((p) => p!.peerId == peerId, orElse: () => null);
    if (peer == null) {
      await store.updateFileStatus(transferId, 'failed');
      throw StateError('peer $peerId no longer visible');
    }

    final resultCompleter = Completer<Map<String, dynamic>>();
    _resultWaiters[transferId] = resultCompleter;
    await store.updateFileStatus(transferId, 'transferring');

    final sendKey = await messaging.getSendKey(peerId);
    if (sendKey == null) {
      await store.updateFileStatus(transferId, 'failed');
      throw StateError("peer $peerId's key isn't resolved - can't encrypt this transfer");
    }

    try {
      await _streamToPeer(peer.address, response['port'] as int, path, (response['resume_at'] as int?) ?? 0, transferId, size, sendKey);
    } on TransferCancelled {
      _cancelled.remove(transferId);
      _resultWaiters.remove(transferId);
      _progressStats.remove(transferId);
      await store.updateFileStatus(transferId, 'cancelled');
      onReceived?.call(transferId, 'cancelled', null);
      return transferId;
    } on SocketException {
      // A real connection drop and the receiver explicitly cancelling
      // look identical at the TCP level - the receiver's own
      // file_failed(reason:"cancelled") control message, on the
      // already-open messaging connection, is what actually
      // distinguishes them, and can arrive a beat after this exception
      // fires. A short bounded wait resolves it almost every time.
      try {
        final result = await resultCompleter.future.timeout(const Duration(seconds: 2));
        _progressStats.remove(transferId);
        await store.updateFileStatus(transferId, result['status'] as String);
        onReceived?.call(transferId, result['status'] as String, null);
        return transferId;
      } on TimeoutException {
        // genuine drop with no explanation - leave it 'offered', resend() picks up from here
        _resultWaiters.remove(transferId);
        await store.updateFileStatus(transferId, 'offered');
        rethrow;
      }
    }

    final result = await resultCompleter.future;
    _progressStats.remove(transferId);
    await store.updateFileStatus(transferId, result['status'] as String);
    return transferId;
  }

  Future<void> _streamToPeer(String host, int port, String filePath, int resumeAt, String transferId, int totalSize, List<int> sharedKey) async {
    final socket = await Socket.connect(host, port);
    try {
      final file = File(filePath).openSync();
      try {
        file.setPositionSync(resumeAt);
        var sent = resumeAt;
        while (true) {
          final chunk = file.readSync(chunkSize);
          if (chunk.isEmpty) break;
          final blob = await ci.encrypt(sharedKey, chunk);
          final prefix = ByteData(4)..setUint32(0, blob.length, Endian.big);
          final writeStart = DateTime.now();
          socket.add(prefix.buffer.asUint8List());
          socket.add(blob);
          await socket.flush();
          final writeElapsedSec = DateTime.now().difference(writeStart).inMicroseconds / 1e6;
          sent += chunk.length;
          _recordProgress(transferId, sent, totalSize);
          onProgress?.call(transferId, sent, totalSize);
          if (_cancelled.contains(transferId)) throw TransferCancelled();
          if (isCallActive()) {
            // Throttle, don't stop - a call in progress means the LAN
            // link matters more for voice/video than transfer speed.
            await Future.delayed(Duration(milliseconds: (throttleSleepSeconds(writeElapsedSec) * 1000).round()));
          }
        }
      } finally {
        file.closeSync();
      }
    } finally {
      await socket.close();
    }
  }

  // -- receiving -----------------------------------------------------------

  Future<void> _onControl(String mtype, String peerId, Map<String, dynamic> msg) async {
    if (mtype == 'file_offer') {
      await _handleOffer(peerId, msg);
    } else if (mtype == 'file_offer_response') {
      final fut = _offerWaiters.remove(msg['transfer_id'] as String);
      if (fut != null && !fut.isCompleted) fut.complete(msg);
    } else if (mtype == 'file_complete' || mtype == 'file_failed') {
      final fut = _resultWaiters.remove(msg['transfer_id'] as String);
      if (fut != null && !fut.isCompleted) {
        String status;
        if (mtype == 'file_complete') {
          status = 'completed';
        } else if (msg['reason'] == 'cancelled') {
          status = 'cancelled';
        } else {
          status = 'failed';
        }
        fut.complete({'status': status, 'reason': msg['reason']});
      }
    } else if (mtype == 'file_played') {
      final transferId = msg['transfer_id'] as String;
      await store.markFilePlayed(transferId);
      onPlayed?.call(transferId);
    }
  }

  /// Called on the *receiving* side once it actually plays a voice message
  /// back, to let the sender show "Played by {name}". A no-op if the
  /// record is missing or this side was actually the sender - only the
  /// receiver's playback counts as a read receipt.
  Future<void> markPlayed(String transferId) async {
    final record = await store.getFile(transferId);
    if (record == null || record.direction != 'received') return;
    await messaging.sendControl(record.peerId, {'type': 'file_played', 'transfer_id': transferId});
  }

  Future<void> _handleOffer(String peerId, Map<String, dynamic> msg) async {
    final transferId = msg['transfer_id'] as String;
    final groupId = msg['group_id'] as String?;
    await store.saveFile(
      transferId: transferId,
      peerId: peerId,
      direction: 'received',
      filename: msg['filename'] as String,
      size: msg['size'] as int,
      sha256: msg['sha256'] as String,
      isExecutable: (msg['is_executable'] as bool?) ?? false,
      status: 'awaiting_accept',
      groupId: groupId,
    );
    onOffer?.call(IncomingFileOffer(
      transferId: transferId,
      peerId: peerId,
      filename: msg['filename'] as String,
      size: msg['size'] as int,
      isExecutable: (msg['is_executable'] as bool?) ?? false,
      groupId: groupId,
    ));
  }

  Future<void> decline(String transferId) async {
    final record = await store.getFile(transferId);
    if (record == null) return;
    await store.updateFileStatus(transferId, 'declined');
    await messaging.sendControl(record.peerId, {'type': 'file_offer_response', 'transfer_id': transferId, 'accept': false});
  }

  /// Cancel, for either direction and at any stage. Never tears down an
  /// in-progress stream directly from here - the file handle it's
  /// writing to may still be open on the receiving side - only ever sets
  /// a flag or resolves a pending future; whichever loop is actually
  /// running right now notices on its own next step and does the real
  /// cleanup from there.
  Future<void> cancel(String transferId) async {
    final record = await store.getFile(transferId);
    if (record == null) return;
    if (record.status == 'awaiting_accept' && record.direction == 'received') {
      await decline(transferId);
      return;
    }
    if (record.status == 'offered' && record.direction == 'sent') {
      _cancelled.add(transferId);
      final fut = _offerWaiters.remove(transferId);
      if (fut != null && !fut.isCompleted) fut.complete({'accept': false});
      return;
    }
    if (record.status == 'transferring' || record.status == 'accepted') {
      _cancelled.add(transferId);
    }
  }

  /// Explicit human decision required before this is ever called -
  /// nothing here auto-accepts. Opens a fresh TCP listener just for this
  /// transfer and tells the sender which port to connect to.
  Future<void> accept(String transferId) async {
    final record = await store.getFile(transferId);
    if (record == null) throw ArgumentError('no such transfer $transferId');

    final partPath = File(p.join(incomingDir.path, '$transferId.part'));
    final resumeAt = await partPath.exists() ? await partPath.length() : 0;

    final recvKey = await messaging.getRecvKey(record.peerId);
    if (recvKey == null) {
      await store.updateFileStatus(transferId, 'failed');
      throw StateError("peer ${record.peerId}'s key isn't resolved - can't decrypt this transfer");
    }

    final server = await ServerSocket.bind(InternetAddress.anyIPv4, 0);
    _listeners[transferId] = server;
    server.listen((client) {
      unawaited(_receive(client, transferId, record, partPath, resumeAt, recvKey));
    });

    await store.updateFileStatus(transferId, 'accepted');
    await messaging.sendControl(record.peerId, {
      'type': 'file_offer_response',
      'transfer_id': transferId,
      'accept': true,
      'port': server.port,
      'resume_at': resumeAt,
    });
  }

  Future<void> _receive(Socket client, String transferId, storage.FileRecord record, File partPath, int resumeAt, List<int> sharedKey) async {
    final server = _listeners.remove(transferId);
    var untrustedStream = false;
    var cancelledStream = false;
    var received = resumeAt;
    final sink = partPath.openWrite(mode: resumeAt > 0 ? FileMode.append : FileMode.write);

    final buffer = BytesBuilder();
    final chunkController = StreamController<Uint8List>();
    client.listen(
      (data) => chunkController.add(Uint8List.fromList(data)),
      onDone: () => chunkController.close(),
      onError: (_) => chunkController.close(),
      cancelOnError: true,
    );

    Future<Uint8List?> readExactly(int n) async {
      while (buffer.length < n) {
        Uint8List? next;
        try {
          next = await chunkController.stream.first.timeout(chunkReadTimeout);
        } on TimeoutException {
          return null;
        } catch (_) {
          return null; // stream closed - clean or dropped end of stream
        }
        buffer.add(next);
      }
      final all = buffer.toBytes();
      final result = all.sublist(0, n);
      buffer.clear();
      if (all.length > n) buffer.add(all.sublist(n));
      return result;
    }

    try {
      while (true) {
        if (_cancelled.contains(transferId)) {
          cancelledStream = true;
          break;
        }
        final prefix = await readExactly(4);
        if (prefix == null) break; // clean end of stream or mid-chunk drop
        final blobLen = ByteData.sublistView(prefix).getUint32(0, Endian.big);
        if (blobLen > maxEncryptedChunkLen) {
          untrustedStream = true;
          break;
        }
        final blob = await readExactly(blobLen);
        if (blob == null) break;
        List<int> chunk;
        try {
          chunk = await ci.decrypt(sharedKey, blob);
        } on ci.DecryptionError {
          untrustedStream = true;
          break;
        }
        sink.add(chunk);
        received += chunk.length;
        _recordProgress(transferId, received, record.size);
        onProgress?.call(transferId, received, record.size);
      }
    } finally {
      await sink.flush();
      await sink.close();
      server?.close();
      await client.close();
      _progressStats.remove(transferId);
    }

    if (cancelledStream) {
      _cancelled.remove(transferId);
      await partPath.delete().catchError((_) => partPath);
      await store.updateFileStatus(transferId, 'cancelled');
      await messaging.sendControl(record.peerId, {'type': 'file_failed', 'transfer_id': transferId, 'reason': 'cancelled'});
      onReceived?.call(transferId, 'cancelled', null);
      return;
    }

    if (untrustedStream) {
      await partPath.delete().catchError((_) => partPath);
      await store.updateFileStatus(transferId, 'failed');
      onReceived?.call(transferId, 'failed', null);
      return;
    }

    if (received != record.size) {
      // Dropped before the full file arrived. Leave the .part file as-is
      // - its size on disk is the real resume point next time accept()
      // (or the sender's resend()) runs.
      await store.updateFileStatus(transferId, 'awaiting_accept');
      return;
    }

    final digest = await sha256File(partPath);
    if (digest != record.sha256) {
      await partPath.delete().catchError((_) => partPath);
      await store.updateFileStatus(transferId, 'failed');
      await messaging.sendControl(record.peerId, {'type': 'file_failed', 'transfer_id': transferId, 'reason': 'hash_mismatch'});
      onReceived?.call(transferId, 'failed', null);
      return;
    }

    final destDir = Directory(p.join(downloadsDir.path, record.peerId));
    await destDir.create(recursive: true);
    final destPath = p.join(destDir.path, record.filename);
    await partPath.rename(destPath);

    await store.updateFileStatus(transferId, 'completed', savedPath: destPath);
    await messaging.sendControl(record.peerId, {'type': 'file_complete', 'transfer_id': transferId});
    onReceived?.call(transferId, 'completed', destPath);
  }

  static Future<Directory> defaultDownloadsDir() async {
    final dir = await getApplicationDocumentsDirectory();
    return Directory(p.join(dir.path, 'downloads'));
  }
}

class _ProgressStats {
  final DateTime startedAt;
  int bytesSoFar;
  int total;
  _ProgressStats({required this.startedAt, required this.bytesSoFar, required this.total});
}
