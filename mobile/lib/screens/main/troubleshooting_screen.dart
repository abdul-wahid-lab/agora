import 'dart:async';

import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../theme.dart';

// Design screen 3.3. The "WHAT AGORA SEES" box is wired to real state only:
// discovery.mode (which path is actually active) and
// discovery.repliesInLastSeconds(45) (genuinely verified announcements
// received in the last 45s, counted in discovery.dart) - no fabricated
// SSID, no guessed "802.11ax" detail, no invented AP-isolation verdict.
class TroubleshootingScreen extends StatefulWidget {
  final disc.PeerDiscovery discovery;
  final VoidCallback onBack;
  final VoidCallback onRescan;

  const TroubleshootingScreen({super.key, required this.discovery, required this.onBack, required this.onRescan});

  @override
  State<TroubleshootingScreen> createState() => _TroubleshootingScreenState();
}

class _TroubleshootingScreenState extends State<TroubleshootingScreen> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 2), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final replies = widget.discovery.repliesInLastSeconds(45);
    final modeLabel = switch (widget.discovery.mode) {
      'mdns' => 'mDNS only',
      'udp' => 'UDP broadcast only',
      _ => 'mDNS + UDP broadcast',
    };
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 20, 4),
              child: Row(
                children: [
                  IconButton(onPressed: widget.onBack, icon: const Icon(Icons.chevron_left, color: AgoraColors.text, size: 28)),
                  const SizedBox(width: 2),
                  const Text("Troubleshooting", style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AgoraColors.text)),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(24, 10, 24, 32),
                children: [
                  const Text("No one else showing up?", style: TextStyle(fontFamily: serifFamily, fontSize: 30, height: 1.1, color: AgoraColors.text)),
                  const SizedBox(height: 8),
                  const Text(
                    "Agora only finds devices on the exact same local network. A few things commonly block that.",
                    style: TextStyle(fontSize: 14.5, color: AgoraColors.text2, height: 1.5),
                  ),
                  const SizedBox(height: 24),
                  const Text("THREE THINGS TO CHECK", style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted)),
                  const SizedBox(height: 12),
                  const _StepCard(number: "1", title: "Same network, not just same WiFi name", body: "Some routers (common in offices, hotels, and campuses) run guest and main WiFi on names that look identical but keep devices isolated from each other."),
                  const SizedBox(height: 10),
                  const _StepCard(number: "2", title: "AP / client isolation", body: "Many routers have a setting that deliberately stops devices on the same network from reaching each other directly, usually for guest-network security. If you can enable it, turning this off on your router fixes most cases."),
                  const SizedBox(height: 10),
                  const _StepCard(number: "3", title: "VPN or mobile data", body: "A VPN or cellular data connection routes you off the local network entirely, so nearby discovery can't work at all until it's off."),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFEAD9C9))),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text("WHAT AGORA SEES", style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.tipHeading)),
                        const SizedBox(height: 10),
                        _InfoRow(label: "Discovery mode", value: modeLabel),
                        const SizedBox(height: 7),
                        _InfoRow(label: "Replies seen", value: "$replies in last 45s"),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  GestureDetector(
                    onTap: widget.onRescan,
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 15),
                      decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(99)),
                      alignment: Alignment.center,
                      child: const Text("Rescan network", style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AgoraColors.onAccent)),
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
}

class _StepCard extends StatelessWidget {
  final String number;
  final String title;
  final String body;
  const _StepCard({required this.number, required this.title, required this.body});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.borderSoft)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.stepChipBg),
            alignment: Alignment.center,
            child: Text(number, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AgoraColors.stepChipText)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: AgoraColors.textStrong)),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(fontSize: 13, color: AgoraColors.text2, height: 1.45)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(fontSize: 13.5, color: AgoraColors.textStrong, fontWeight: FontWeight.w500)),
        Text(value, style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, color: AgoraColors.textMuted)),
      ],
    );
  }
}
