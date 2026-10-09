// Reimplements backend/app/discovery.py - two independent discovery paths
// feeding one registry, exactly matching the desktop's own behavior so a
// phone and a PC can actually find each other:
//   1. mDNS (primary) - service type _lanchat._tcp, via the `nsd` package
//      (Android NsdManager under the hood).
//   2. UDP broadcast (fallback) - dart:io's own RawDatagramSocket, no
//      package needed, same wire format as discovery.py's UDP path.
//
// Every announcement (either path) carries the exact same signed fields
// as the Python side and goes through the identical verify-and-pin check
// before ever reaching the live registry - see crypto_identity.dart.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:nsd/nsd.dart' as nsd;

import 'crypto_identity.dart' as ci;

const serviceType = '_lanchat._tcp';
const udpBroadcastPort = 42424;
const udpAnnounceIntervalSec = 3;
const peerTtlSec = 10.0;

/// A real, honest label ("Android phone"), not a fabricated specific model
/// name - same reasoning as discovery.py's own detect_device_type: there's
/// no portable way to read a precise marketing model name, so this reports
/// what it genuinely knows.
String detectDeviceType() => 'Android phone';

class Peer {
  final String peerId;
  final String name;
  final String address;
  final int port;
  final String source; // "mdns" or "udp"
  double lastSeen;
  final String publicKey;
  final String deviceType;

  Peer({
    required this.peerId,
    required this.name,
    required this.address,
    required this.port,
    required this.source,
    double? lastSeen,
    this.publicKey = '',
    this.deviceType = '',
  }) : lastSeen = lastSeen ?? DateTime.now().millisecondsSinceEpoch / 1000.0;

  bool isExpired([double? now]) {
    final n = now ?? DateTime.now().millisecondsSinceEpoch / 1000.0;
    return (n - lastSeen) > peerTtlSec;
  }
}

/// Mirrors storage.py's thread-safe store - Dart is single-threaded per
/// isolate so no lock is needed, but the same dedupe-by-peer_id and
/// on_change notification shape carries over directly.
class PeerRegistry {
  final Map<String, Peer> _peers = {};
  final void Function()? onChange;

  PeerRegistry({this.onChange});

  void upsert(Peer peer) {
    _peers[peer.peerId] = peer;
    onChange?.call();
  }

  void remove(String peerId) {
    if (_peers.remove(peerId) != null) {
      onChange?.call();
    }
  }

  List<String> sweepExpired() {
    final now = DateTime.now().millisecondsSinceEpoch / 1000.0;
    final removed = <String>[];
    _peers.removeWhere((id, peer) {
      if (peer.isExpired(now)) {
        removed.add(id);
        return true;
      }
      return false;
    });
    if (removed.isNotEmpty) onChange?.call();
    return removed;
  }

  List<Peer> list() {
    final values = _peers.values.toList();
    values.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return values;
  }
}

typedef VerifySigningKey = Future<bool> Function(String peerId, String signingPublicKey);

class PeerDiscovery {
  final String deviceName;
  final int servicePort;
  final String peerId;
  final String publicKey;
  final String signingPrivateKey;
  final String signingPublicKey;
  final VerifySigningKey? onVerifySigningKey;
  final String mode; // "auto" | "mdns" | "udp"
  final PeerRegistry registry;

  nsd.Discovery? _discovery;
  nsd.Registration? _registration;
  nsd.ServiceListener? _serviceListener;
  RawDatagramSocket? _udpSocket;
  Timer? _udpAnnounceTimer;
  Timer? _sweepTimer;

  // Every genuinely verified announcement received (mDNS or UDP), regardless
  // of whether its pin check then accepted or rejected it - real evidence
  // that signals are actually arriving on this network, backing the
  // Troubleshooting screen's "what Agora sees" diagnostic box (design 3.3)
  // instead of a fabricated status line.
  final List<DateTime> _recentAnnouncements = [];

  int repliesInLastSeconds(int seconds) {
    final cutoff = DateTime.now().subtract(Duration(seconds: seconds));
    _recentAnnouncements.removeWhere((t) => t.isBefore(cutoff));
    return _recentAnnouncements.length;
  }

  PeerDiscovery({
    required this.deviceName,
    required this.servicePort,
    required this.peerId,
    this.publicKey = '',
    this.signingPrivateKey = '',
    this.signingPublicKey = '',
    this.onVerifySigningKey,
    String mode = 'auto',
    void Function()? onRegistryChange,
  })  : mode = (mode == 'mdns' || mode == 'udp') ? mode : 'auto',
        registry = PeerRegistry(onChange: onRegistryChange);

  Future<void> start() async {
    if (mode == 'auto' || mode == 'mdns') {
      await _startMdns();
    }
    if (mode == 'auto' || mode == 'udp') {
      await _startUdpFallback();
    }
    _sweepTimer = Timer.periodic(Duration(milliseconds: (peerTtlSec / 2 * 1000).round()), (_) {
      registry.sweepExpired();
    });
  }

  Future<void> stop() async {
    _sweepTimer?.cancel();
    _udpAnnounceTimer?.cancel();
    _udpSocket?.close();
    if (_discovery != null) {
      if (_serviceListener != null) _discovery!.removeServiceListener(_serviceListener!);
      await nsd.stopDiscovery(_discovery!);
    }
    if (_registration != null) {
      await nsd.unregister(_registration!);
    }
  }

  /// Same shape as discovery.py's self_announcement() - backs QR pairing
  /// so a scanned code and a live radar hit carry the identical payload.
  Future<Map<String, dynamic>> selfAnnouncement() async {
    final localIp = await _getLocalIp();
    final payload = <String, dynamic>{
      'peer_id': peerId,
      'device_name': deviceName,
      'address': localIp,
      'port': servicePort,
      'public_key': publicKey,
      'device_type': detectDeviceType(),
    };
    if (signingPrivateKey.isNotEmpty) {
      payload['signing_public_key'] = signingPublicKey;
      payload['signature'] = await ci.signAnnouncement(signingPrivateKey, peerId, localIp, servicePort, publicKey);
    }
    return payload;
  }

  // -- visibility (Settings > Privacy & security's "Show me in Nearby") ---

  bool _visible = true;
  bool get visible => _visible;

  /// Real stealth mode: false stops this device from announcing itself at
  /// all (mDNS unregistered, UDP announce timer cancelled) while browsing
  /// for *other* peers keeps running completely unaffected - the two were
  /// always independent halves of each start method below, this just
  /// re-exposes that split as a live toggle instead of only an at-start
  /// decision.
  Future<void> setVisible(bool value) async {
    if (value == _visible) return;
    _visible = value;
    if (!value) {
      if (_registration != null) {
        await nsd.unregister(_registration!);
        _registration = null;
      }
      _udpAnnounceTimer?.cancel();
      _udpAnnounceTimer = null;
    } else {
      if (mode == 'auto' || mode == 'mdns') await _registerMdnsService();
      if ((mode == 'auto' || mode == 'udp') && _udpSocket != null) await _startUdpAnnounce();
    }
  }

  // -- mDNS --------------------------------------------------------------

  Future<void> _registerMdnsService() async {
    final localIp = await _getLocalIp();
    final txt = <String, Uint8List?>{
      'peer_id': Uint8List.fromList(utf8.encode(peerId)),
      'device_name': Uint8List.fromList(utf8.encode(deviceName)),
      'public_key': Uint8List.fromList(utf8.encode(publicKey)),
      'device_type': Uint8List.fromList(utf8.encode(detectDeviceType())),
    };
    if (signingPrivateKey.isNotEmpty) {
      final signature = await ci.signAnnouncement(signingPrivateKey, peerId, localIp, servicePort, publicKey);
      txt['signing_public_key'] = Uint8List.fromList(utf8.encode(signingPublicKey));
      txt['signature'] = Uint8List.fromList(utf8.encode(signature));
    }
    try {
      _registration = await nsd.register(nsd.Service(
        name: peerId,
        type: serviceType,
        port: servicePort,
        txt: txt,
      ));
    } catch (e) {
      // mDNS registration can genuinely fail (no multicast-capable
      // interface, permission denied) - the UDP fallback (if mode allows
      // it) still gives this device a way to be found, same as the
      // desktop side treating each path as independent.
      // ignore: avoid_print
      print('mDNS register failed: $e');
    }
  }

  Future<void> _startMdns() async {
    if (_visible) await _registerMdnsService();

    try {
      _discovery = await nsd.startDiscovery(serviceType);
      _serviceListener = (service, status) async {
        if (status != nsd.ServiceStatus.found) return;
        await _handleMdnsService(service);
      };
      _discovery!.addServiceListener(_serviceListener!);
    } catch (e) {
      // ignore: avoid_print
      print('mDNS discovery failed: $e');
    }
  }

  Future<void> _handleMdnsService(nsd.Service service) async {
    try {
      final txt = service.txt;
      if (txt == null) return;
      String field(String key) {
        final bytes = txt[key];
        return bytes == null ? '' : utf8.decode(bytes);
      }

      final discoveredPeerId = field('peer_id');
      if (discoveredPeerId.isEmpty || discoveredPeerId == peerId) return;
      if (service.addresses == null || service.addresses!.isEmpty) return;
      final address = service.addresses!.first.address;
      final port = service.port;
      if (port == null) return;
      final discoveredPublicKey = field('public_key');

      // Same unconditional verify-and-pin as the Python side - an
      // announcement missing a signature, or one that doesn't verify, or
      // one whose signing key conflicts with what's already pinned, is
      // dropped outright rather than ever reaching the live registry.
      final signingPublicKeyField = field('signing_public_key');
      final signature = field('signature');
      if (signingPublicKeyField.isEmpty || signature.isEmpty) return;
      final valid = await ci.verifyAnnouncement(signingPublicKeyField, signature, discoveredPeerId, address, port, discoveredPublicKey);
      if (!valid) return;
      _recentAnnouncements.add(DateTime.now());
      if (onVerifySigningKey != null && !(await onVerifySigningKey!(discoveredPeerId, signingPublicKeyField))) return;

      registry.upsert(Peer(
        peerId: discoveredPeerId,
        name: field('device_name').isEmpty ? discoveredPeerId : field('device_name'),
        address: address,
        port: port,
        source: 'mdns',
        publicKey: discoveredPublicKey,
        deviceType: field('device_type'),
      ));
    } catch (e) {
      // One malformed/unlucky announcement dropping is correct and
      // silent; the whole listener staying alive for the rest of the
      // session is what matters - mirrors discovery.py's own broad catch.
      // ignore: avoid_print
      print('mDNS announcement dropped due to an unexpected error: $e');
    }
  }

  // -- UDP broadcast fallback ---------------------------------------------

  Future<void> _startUdpFallback() async {
    final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, udpBroadcastPort, reuseAddress: true);
    socket.broadcastEnabled = true;
    _udpSocket = socket;

    socket.listen((event) {
      if (event != RawSocketEvent.read) return;
      final datagram = socket.receive();
      if (datagram == null) return;
      _handleUdpPacket(datagram.data);
    });

    if (_visible) await _startUdpAnnounce();
  }

  Future<void> _startUdpAnnounce() async {
    final socket = _udpSocket;
    if (socket == null) return;
    final localIp = await _getLocalIp();
    final message = <String, dynamic>{
      'peer_id': peerId,
      'device_name': deviceName,
      'address': localIp,
      'port': servicePort,
      'public_key': publicKey,
      'device_type': detectDeviceType(),
    };
    if (signingPrivateKey.isNotEmpty) {
      message['signing_public_key'] = signingPublicKey;
      message['signature'] = await ci.signAnnouncement(signingPrivateKey, peerId, localIp, servicePort, publicKey);
    }
    final payload = utf8.encode(jsonEncode(message));

    void sendOnce() {
      try {
        socket.send(payload, InternetAddress('255.255.255.255'), udpBroadcastPort);
      } catch (_) {
        // A send can transiently fail (interface change, no network) -
        // the next periodic tick just tries again, same as the Python
        // side's own bare `except OSError: pass`.
      }
    }

    sendOnce();
    _udpAnnounceTimer = Timer.periodic(Duration(seconds: udpAnnounceIntervalSec), (_) => sendOnce());
  }

  Future<void> _handleUdpPacket(List<int> data) async {
    try {
      final msg = jsonDecode(utf8.decode(data)) as Map<String, dynamic>;
      final discoveredPeerId = msg['peer_id'] as String?;
      if (discoveredPeerId == null || discoveredPeerId == peerId) return;
      final address = msg['address'] as String?;
      final port = msg['port'] as int?;
      if (address == null || port == null) return;
      final discoveredPublicKey = (msg['public_key'] as String?) ?? '';
      final signingPublicKeyField = (msg['signing_public_key'] as String?) ?? '';
      final signature = (msg['signature'] as String?) ?? '';
      if (signingPublicKeyField.isEmpty || signature.isEmpty) return;
      final valid = await ci.verifyAnnouncement(signingPublicKeyField, signature, discoveredPeerId, address, port, discoveredPublicKey);
      if (!valid) return;
      _recentAnnouncements.add(DateTime.now());
      if (onVerifySigningKey != null && !(await onVerifySigningKey!(discoveredPeerId, signingPublicKeyField))) return;

      registry.upsert(Peer(
        peerId: discoveredPeerId,
        name: (msg['device_name'] as String?) ?? discoveredPeerId,
        address: address,
        port: port,
        source: 'udp',
        publicKey: discoveredPublicKey,
        deviceType: (msg['device_type'] as String?) ?? '',
      ));
    } catch (e) {
      // Broadened catch mirrors discovery.py's own: one bad packet should
      // be dropped, not take down the whole UDP listener for the rest of
      // the app session.
      // ignore: avoid_print
      print('UDP announcement dropped due to an unexpected error: $e');
    }
  }
}

/// Best-effort LAN IP (not loopback) without needing external
/// connectivity - mirrors discovery.py's _get_local_ip, but on Android we
/// just enumerate real network interfaces instead of the UDP-connect
/// trick (a sandboxed/metered interface can make that trick behave
/// differently on mobile than it does on desktop).
Future<String> _getLocalIp() async {
  try {
    final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4, includeLoopback: false);
    for (final iface in interfaces) {
      for (final addr in iface.addresses) {
        if (!addr.isLoopback) return addr.address;
      }
    }
  } catch (_) {
    // fall through to loopback below
  }
  return '127.0.0.1';
}
