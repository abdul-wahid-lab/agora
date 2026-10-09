import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../theme.dart';

// Design 6.5. Version/build are read from the real installed package
// (package_info_plus), not hand-typed - the design's "1.4.0 · build 388"
// was placeholder copy, not this build's actual identity.
class AboutScreen extends StatefulWidget {
  final VoidCallback onBack;
  final VoidCallback onOpenTroubleshooting;
  final VoidCallback onOpenWhatAgoraStores;
  final String diagnosticsText;

  const AboutScreen({
    super.key,
    required this.onBack,
    required this.onOpenTroubleshooting,
    required this.onOpenWhatAgoraStores,
    required this.diagnosticsText,
  });

  @override
  State<AboutScreen> createState() => _AboutScreenState();
}

class _AboutScreenState extends State<AboutScreen> {
  String _version = '…';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final info = await PackageInfo.fromPlatform();
    if (mounted) setState(() => _version = 'version ${info.version} · build ${info.buildNumber}');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [IconButton(onPressed: widget.onBack, icon: const Icon(Icons.chevron_left, size: 26, color: AgoraColors.textStrong)), const Text('About & help', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AgoraColors.text))]),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(24, 6, 24, 30),
                children: [
                  Center(
                    child: Column(
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent.withValues(alpha: 0.14)),
                          alignment: Alignment.center,
                          child: Container(width: 36, height: 36, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent)),
                        ),
                        const SizedBox(height: 12),
                        const Text('Agora', style: TextStyle(fontFamily: serifFamily, fontSize: 28, color: AgoraColors.text)),
                        const SizedBox(height: 4),
                        Text(_version, style: const TextStyle(fontFamily: monoFamily, fontSize: 12, color: AgoraColors.textMuted)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 22),
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: AgoraColors.borderSoft)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('How Agora works', style: TextStyle(fontFamily: serifFamily, fontSize: 21, color: AgoraColors.text)),
                        const SizedBox(height: 12),
                        _step('1', "Your phone announces itself on the WiFi you're already on. No servers in the middle."),
                        _step('2', 'Messages and calls travel device-to-device, encrypted, at local speed.'),
                        _step('3', 'Your history stays on your device. Nothing syncs anywhere in this build.'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    decoration: BoxDecoration(color: AgoraColors.surface, border: Border.all(color: AgoraColors.borderSoft), borderRadius: BorderRadius.circular(20)),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        _row('Network troubleshooting guide', widget.onOpenTroubleshooting),
                        _row('What Agora stores', widget.onOpenWhatAgoraStores),
                        _row('Copy diagnostics', () {
                          Clipboard.setData(ClipboardData(text: widget.diagnosticsText));
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Diagnostics copied - paste them wherever you need to send them.')));
                        }, last: true),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _step(String n, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(width: 22, height: 22, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.stepChipBg), alignment: Alignment.center, child: Text(n, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AgoraColors.stepChipText))),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13.5, color: AgoraColors.text2, height: 1.5))),
        ],
      ),
    );
  }

  Widget _row(String label, VoidCallback onTap, {bool last = false}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: Color(0xFFF1E7DC)))),
        child: Row(children: [Expanded(child: Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))), const Icon(Icons.chevron_right, size: 18, color: Color(0xFF9A8C81))]),
      ),
    );
  }
}
