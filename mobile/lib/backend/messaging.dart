// Reimplements backend/app/messaging.py - same wire protocol exactly:
//   {"type": "hello", "peer_id": ..., "device_name": ...} - the one and
//     only plaintext frame, sent first on any new connection as a TEXT
//     frame (dart:io's WebSocket.add(String) == a text frame, matching
//     the Python side's str vs. bytes distinction exactly - no extra
//     wrapper field needed to tell them apart on the wire).
//   Every other frame ("chat", "ack", and every control message file
//     transfer/calling/groups send via sendControl) is JSON, encrypted
//     with that peer's derived shared key, sent as a BINARY frame
//     (WebSocket.add(List<int>)).
//
// Each device runs its own WebSocket server on its discovery-advertised
// port (dart:io's HttpServer + WebSocketTransformer) - sending to a peer
// means opening (or reusing) a direct client connection to that peer's
// discovered ip:port. No server in between, same as the desktop.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:uuid/uuid.dart';

import 'crypto_identity.dart' as ci;
import 'discovery.dart' as disc;
import 'storage.dart' as storage;

class IncomingMessage {
  final String peerId;
  final String body;
  final double ts;
  IncomingMessage({required this.peerId, required this.body, required this.ts});
}

typedef ControlHandler = Future<void> Function(String mtype, String peerId, Map<String, dynamic> msg);

class MessagingService {
  final disc.PeerDiscovery discovery;
  final storage.MessageStore store;
  final void Function(IncomingMessage)? onMessage;
  final void Function(String peerId, String name)? onIdentityChanged;

  final String peerId;
  final String deviceName;
  final int port;

  Map<String, String> _deviceKeys = {};
  final Map<String, (List<int>, List<int>)> _sharedKeys = {};
  final Map<String, WebSocket> _outConns = {};
  // Every WebSocket this device's own server has accepted (the peer
  // connected to *us*). dart:io's HttpServer.close(force: true) only
  // tears down connections it still tracks at the HTTP layer - an already
  // upgraded WebSocket hands its raw socket off to the WebSocket object
  // itself and is no longer part of that pool, so without tracking these
  // separately, stop() silently left every already-established inbound
  // connection running. Found via a real stress test: after stop(), a
  // peer who had an existing connection to this device could still ping/
  // pong it successfully, because the one socket involved was never
  // actually closed. Python's side doesn't need this - the `websockets`
  // library's own Server.close() already tracks and closes every
  // connection it ever accepted, not just the listening socket.
  final Set<WebSocket> _inConns = {};
  final Map<String, Future> _sendLocks = {};
  final List<ControlHandler> _controlHandlers = [];

  HttpServer? _server;
  Timer? _flushTimer;

  MessagingService({
    required this.discovery,
    required this.store,
    this.onMessage,
    this.onIdentityChanged,
  })  : peerId = discovery.peerId,
        deviceName = discovery.deviceName,
        port = discovery.servicePort;

  void addControlHandler(ControlHandler handler) => _controlHandlers.add(handler);

  // -- encryption ----------------------------------------------------------

  Future<(List<int>, List<int>)?> getDirectionalKeys(String remotePeerId) async {
    final cached = _sharedKeys[remotePeerId];
    if (cached != null) return cached;
    final peer = discovery.registry.list().cast<disc.Peer?>().firstWhere((p) => p!.peerId == remotePeerId, orElse: () => null);
    if (peer == null || peer.publicKey.isEmpty) return null;
    final oldKey = await store.checkAndRememberPeerKey(remotePeerId, peer.name, peer.publicKey);
    if (oldKey != null) onIdentityChanged?.call(remotePeerId, peer.name);
    final keys = await ci.deriveDirectionalKeys(_deviceKeys['private_key']!, peer.publicKey, peerId, remotePeerId);
    _sharedKeys[remotePeerId] = keys;
    return keys;
  }

  Future<List<int>?> getSendKey(String remotePeerId) async {
    final keys = await getDirectionalKeys(remotePeerId);
    return keys?.$1;
  }

  Future<List<int>?> getRecvKey(String remotePeerId) async {
    final keys = await getDirectionalKeys(remotePeerId);
    return keys?.$2;
  }

  Future<List<int>?> _encryptFor(String remotePeerId, Map<String, dynamic> message) async {
    final sendKey = await getSendKey(remotePeerId);
    if (sendKey == null) return null;
    return ci.encrypt(sendKey, utf8.encode(jsonEncode(message)));
  }

  // -- lifecycle -------------------------------------------------------

  Future<void> start() async {
    _deviceKeys = await store.getOrCreateDeviceKeys();
    _server = await HttpServer.bind(InternetAddress.anyIPv4, port);
    _server!.listen((request) async {
      if (!WebSocketTransformer.isUpgradeRequest(request)) {
        request.response.statusCode = HttpStatus.forbidden;
        await request.response.close();
        return;
      }
      final ws = await WebSocketTransformer.upgrade(request);
      ws.pingInterval = const Duration(seconds: 30);
      _inConns.add(ws);
      _handleInbound(ws);
    });
    _flushTimer = Timer.periodic(const Duration(seconds: 2), (_) => _flushPendingTick());
  }

  Future<void> stop() async {
    _flushTimer?.cancel();
    await _server?.close(force: true);
    for (final conn in _outConns.values) {
      await conn.close();
    }
    _outConns.clear();
    for (final conn in _inConns.toList()) {
      await conn.close();
    }
    _inConns.clear();
  }

  // -- inbound (server side) --------------------------------------------

  void _handleInbound(WebSocket ws) {
    String? remotePeerId;
    ws.listen(
      (raw) async {
        if (raw is String) {
          // The one and only plaintext frame type - see the module
          // comment. Anything else arriving as text isn't a frame this
          // protocol ever sends, so it's silently ignored.
          try {
            final msg = jsonDecode(raw) as Map<String, dynamic>;
            if (msg['type'] == 'hello') {
              remotePeerId = msg['peer_id'] as String?;
            }
          } catch (_) {
            // malformed "hello" - ignore, same as the Python side's
            // implicit behavior of only acting on a type it recognizes.
          }
          return;
        }

        // A binary frame (encrypted real frame) arriving before "hello"
        // told us who this is makes no sense - nothing to derive a
        // shared key with yet.
        if (remotePeerId == null) return;
        final rid = remotePeerId!;

        // Checked on every real frame, not just "hello" - a peer already
        // mid-connection when blocked must not keep riding the socket.
        if (await store.isPeerBlocked(rid)) {
          await ws.close();
          return;
        }

        final recvKey = await getRecvKey(rid);
        if (recvKey == null) return; // public key not resolved yet
        List<int> plaintext;
        try {
          plaintext = await ci.decrypt(recvKey, raw as List<int>);
        } on ci.DecryptionError {
          return; // tampered/corrupt/stale-key frame - drop, don't crash
        }
        final msg = jsonDecode(utf8.decode(plaintext)) as Map<String, dynamic>;
        // Fire-and-forget, same reasoning as messaging.py: don't let one
        // message's full processing delay reading the next frame.
        unawaited(_handleDecrypted(ws, rid, msg));
      },
      onDone: () => _inConns.remove(ws),
      onError: (_) => _inConns.remove(ws),
      cancelOnError: false,
    );
  }

  Future<void> _handleDecrypted(WebSocket ws, String remotePeerId, Map<String, dynamic> msg) async {
    final mtype = msg['type'] as String?;
    try {
      if (mtype == 'chat') {
        await _onChatReceived(remotePeerId, msg);
        final ack = await _encryptFor(remotePeerId, {'type': 'ack', 'msg_id': msg['msg_id']});
        if (ack != null) ws.add(ack);
      } else if (mtype == 'ack') {
        await store.updateStatus(msg['msg_id'] as String, 'delivered');
      } else if (mtype != null) {
        await _dispatchControl(mtype, remotePeerId, msg);
      }
    } catch (_) {
      // The connection this frame arrived on may already be closed by
      // the time its ack is ready - the sender's own pending-retry path
      // picks the message back up once a connection exists again.
    }
  }

  Future<void> _onChatReceived(String peerId, Map<String, dynamic> msg) async {
    final ts = (msg['ts'] as num?)?.toDouble() ?? DateTime.now().millisecondsSinceEpoch / 1000.0;
    await store.saveMessage(msgId: msg['msg_id'] as String, peerId: peerId, direction: 'received', body: msg['body'] as String, status: 'received', ts: ts);
    onMessage?.call(IncomingMessage(peerId: peerId, body: msg['body'] as String, ts: ts));
  }

  // -- outbound (client side) -------------------------------------------

  Future<WebSocket?> _getConnection(String remotePeerId) async {
    if (await store.isPeerBlocked(remotePeerId)) return null;

    final existing = _outConns[remotePeerId];
    if (existing != null) {
      // A cheap, synchronous check before trusting the cache: WebSocket
      // .add() is fire-and-forget in dart:io (it returns void, not a
      // Future), unlike Python's `await conn.send()` - a write onto a
      // socket the other end already closed doesn't throw here, it's
      // silently dropped, and the real failure only surfaces later as an
      // async error/done event on the read loop below. readyState catches
      // the gap in between: a peer that already closed, with the read
      // loop's own eviction just not having run yet.
      if (existing.readyState == WebSocket.open) return existing;
      _outConns.remove(remotePeerId);
    }

    final peer = discovery.registry.list().cast<disc.Peer?>().firstWhere((p) => p!.peerId == remotePeerId, orElse: () => null);
    if (peer == null) return null;

    final WebSocket conn;
    try {
      conn = await WebSocket.connect('ws://${peer.address}:${peer.port}');
    } catch (_) {
      return null;
    }
    conn.pingInterval = const Duration(seconds: 30);
    conn.add(jsonEncode({'type': 'hello', 'peer_id': peerId, 'device_name': deviceName}));
    _outConns[remotePeerId] = conn;
    unawaited(_readOutbound(remotePeerId, conn));
    return conn;
  }

  Future<void> _readOutbound(String remotePeerId, WebSocket conn) async {
    try {
      await for (final raw in conn) {
        if (raw is String) continue; // this side never expects a "hello" back
        final recvKey = await getRecvKey(remotePeerId);
        if (recvKey == null) continue;
        List<int> plaintext;
        try {
          plaintext = await ci.decrypt(recvKey, raw as List<int>);
        } on ci.DecryptionError {
          continue;
        }
        final msg = jsonDecode(utf8.decode(plaintext)) as Map<String, dynamic>;
        unawaited(_handleOutboundDecrypted(remotePeerId, msg));
      }
    } catch (_) {
      // connection closed/errored - fall through to cleanup below
    } finally {
      _outConns.remove(remotePeerId);
      _sendLocks.remove(remotePeerId);
    }
  }

  Future<void> _handleOutboundDecrypted(String remotePeerId, Map<String, dynamic> msg) async {
    final mtype = msg['type'] as String?;
    if (mtype == 'ack') {
      await store.updateStatus(msg['msg_id'] as String, 'delivered');
    } else if (mtype != null) {
      await _dispatchControl(mtype, remotePeerId, msg);
    }
  }

  // -- control message fan-out ------------------------------------------

  Future<void> _dispatchControl(String mtype, String remotePeerId, Map<String, dynamic> msg) async {
    for (final handler in _controlHandlers) {
      await handler(mtype, remotePeerId, msg);
    }
  }

  /// Serializes writes to one peer's connection - a send racing another
  /// send on the same WebSocket is a real, confirmed source of silent
  /// frame corruption on the Python side (see messaging.py's own
  /// comment), not a hypothetical concern worth skipping here.
  Future<T> _withSendLock<T>(String remotePeerId, Future<T> Function() body) {
    final previous = _sendLocks[remotePeerId] ?? Future.value();
    final completer = Completer<T>();
    final next = previous.then((_) async {
      try {
        completer.complete(await body());
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    _sendLocks[remotePeerId] = next;
    return completer.future;
  }

  /// Send an arbitrary JSON control message to a peer over the same
  /// connection chat uses - file transfer/calling/groups all go through
  /// this one method, so encrypting here covers all of them at once.
  Future<bool> sendControl(String remotePeerId, Map<String, dynamic> message) async {
    try {
      final conn = await _getConnection(remotePeerId);
      if (conn == null) return false;
      final blob = await _encryptFor(remotePeerId, message);
      if (blob == null) return false;
      await _withSendLock(remotePeerId, () async => conn.add(blob));
      return true;
    } catch (_) {
      _outConns.remove(remotePeerId);
      return false;
    }
  }

  /// Queue+attempt a send. Returns the generated msg_id immediately.
  Future<String> send(String remotePeerId, String body) async {
    final msgId = const Uuid().v4();
    final ts = DateTime.now().millisecondsSinceEpoch / 1000.0;
    await store.saveMessage(msgId: msgId, peerId: remotePeerId, direction: 'sent', body: body, status: 'pending', ts: ts);
    await _tryDeliver(remotePeerId, msgId, body, ts);
    return msgId;
  }

  Future<bool> _tryDeliver(String remotePeerId, String msgId, String body, double ts) async {
    try {
      final conn = await _getConnection(remotePeerId);
      if (conn == null) return false; // peer not currently discoverable - stays 'pending'
      final blob = await _encryptFor(remotePeerId, {'type': 'chat', 'msg_id': msgId, 'body': body, 'ts': ts});
      if (blob == null) return false; // peer's public key not resolved yet - stays 'pending'
      await _withSendLock(remotePeerId, () async => conn.add(blob));
      await store.updateStatus(msgId, 'sent');
      return true;
    } catch (_) {
      _outConns.remove(remotePeerId);
      return false;
    }
  }

  // -- reconnect / flush -------------------------------------------------

  Future<void> _flushPendingTick() async {
    final visibleIds = discovery.registry.list().map((p) => p.peerId).toSet();
    for (final pid in visibleIds) {
      final pending = await store.pendingForPeer(pid);
      for (final m in pending) {
        await _tryDeliver(m.peerId, m.msgId, m.body, m.ts);
      }
    }
  }
}
