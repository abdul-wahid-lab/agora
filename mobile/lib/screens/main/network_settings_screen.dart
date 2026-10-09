import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../backend/discovery.dart' as disc;
import '../../theme.dart';

// Design 6.2. "Sync when internet is available" is shown honestly
// disabled - there is no cloud relay anywhere in this codebase, so a
// working-looking toggle for it would be fiction. Everything else here is
// read straight from the real PeerDiscovery/registry: subnet is omitted
// in favor of the real local address (Dart's NetworkInterface can't give
// a reliable prefix length cross-platform, so a guessed "/24" would
// sometimes just be wrong).
class NetworkSettingsScreen extends StatefulWidget {
  final disc.PeerDiscovery discovery;
  final String networkName;
  final VoidCallback onBack;
  final Future<void> Function() onRescan;

  const NetworkSettingsScreen({super.key, required this.discovery, required this.networkName, required this.onBack, required this.onRescan});

  @override
  State<NetworkSettingsScreen> createState() => _NetworkSettingsScreenState();
}

class _NetworkSettingsScreenState extends State<NetworkSettingsScreen> {
  String? _localAddress;
  bool _scanning = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadAddress());
  }

  Future<void> _loadAddress() async {
    try {
      final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4, includeLoopback: false);
      for (final iface in interfaces) {
        for (final addr in iface.addresses) {
          if (!addr.isLoopback) {
            if (mounted) setState(() => _localAddress = addr.address);
            return;
          }
        }
      }
    } catch (_) {
      // leave null - shown as "unknown" below
    }
  }

  Future<void> _rescan() async {
    setState(() => _scanning = true);
    await widget.onRescan();
    if (mounted) setState(() => _scanning = false);
  }

  void _copyDiagnostics() {
    final peers = widget.discovery.registry.list();
    final udpActive = peers.any((p) => p.source == 'udp');
    final text = StringBuffer()
      ..writeln('Agora network diagnostics')
      ..writeln('device id: ${widget.discovery.peerId}')
      ..writeln('discovery mode: ${widget.discovery.mode}')
      ..writeln('fallback: UDP broadcast (${udpActive ? 'active' : 'idle'})')
      ..writeln('local address: ${_localAddress ?? 'unknown'}')
      ..writeln('peers visible: ${peers.length}');
    for (final p in peers) {
      text.writeln('  ${p.name}  ${p.address}  via ${p.source}');
    }
    Clipboard.setData(ClipboardData(text: text.toString()));
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Diagnostics copied to clipboard.')));
  }

  @override
  Widget build(BuildContext context) {
    final peers = widget.discovery.registry.list();
    final udpActive = peers.any((p) => p.source == 'udp');
    final shortId = widget.discovery.peerId.length > 10 ? widget.discovery.peerId.substring(0, 10) : widget.discovery.peerId;

    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [IconButton(onPressed: widget.onBack, icon: const Icon(Icons.chevron_left, size: 26, color: AgoraColors.textStrong)), const Text('Network', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AgoraColors.text))]),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 30),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: AgoraColors.borderSoft)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('LAN-only mode', style: TextStyle(fontFamily: serifFamily, fontSize: 22, color: AgoraColors.text)),
                        const SizedBox(height: 8),
                        Text('Connected to ${widget.networkName}. ${peers.length} peer${peers.length == 1 ? '' : 's'} visible. No traffic leaves this router.', style: const TextStyle(fontSize: 13.5, color: AgoraColors.text2, height: 1.5)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    decoration: BoxDecoration(color: AgoraColors.surface, border: Border.all(color: AgoraColors.borderSoft), borderRadius: BorderRadius.circular(20)),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFF1E7DC)))),
                          child: Opacity(
                            opacity: 0.55,
                            child: Row(
                              children: [
                                const Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('Sync when internet is available', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                                      SizedBox(height: 2),
                                      Text('Not available in this build', style: TextStyle(fontSize: 12.5, color: Color(0xFF8A7F76))),
                                    ],
                                  ),
                                ),
                                const Switch(value: false, onChanged: null),
                              ],
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                          child: Row(
                            children: [
                              const Expanded(child: Text('Rescan network', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
                              GestureDetector(
                                onTap: _scanning ? null : () => unawaited(_rescan()),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                                  decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(99)),
                                  child: Text(_scanning ? 'Scanning…' : 'Scan now', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Padding(padding: EdgeInsets.only(left: 4, bottom: 8), child: Text('ADVANCED', style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted))),
                  Container(
                    padding: const EdgeInsets.all(15),
                    decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('device id  $shortId', style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.8, color: Color(0xFF6B5C50))),
                        Text('discovery  ${widget.discovery.mode}', style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.8, color: Color(0xFF6B5C50))),
                        Text('fallback   UDP broadcast (${udpActive ? 'active' : 'idle'})', style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.8, color: Color(0xFF6B5C50))),
                        Text('address    ${_localAddress ?? 'unknown'}', style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.8, color: Color(0xFF6B5C50))),
                        const SizedBox(height: 8),
                        const Text('PEERS VISIBLE NOW', style: TextStyle(fontFamily: monoFamily, fontSize: 10.5, fontWeight: FontWeight.w600, letterSpacing: 1, color: AgoraColors.textMuted)),
                        const SizedBox(height: 4),
                        if (peers.isEmpty) const Text('none', style: TextStyle(fontFamily: monoFamily, fontSize: 12.5, color: Color(0xFF9A8C81))),
                        ...peers.map((p) => Text('${p.name.padRight(14)} ${p.address.padRight(16)} now', style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.8, color: Color(0xFF6B5C50)))),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Center(child: GestureDetector(onTap: _copyDiagnostics, child: const Text('Copy diagnostics', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
