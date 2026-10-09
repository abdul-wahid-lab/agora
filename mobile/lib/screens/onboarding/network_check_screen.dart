import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../theme.dart';

// Design screen 1.4 "Network check (first run)". Two of the design's three
// states are wired to real, live discovery data here (1.4a "found" /
// 1.4b "empty"); the third (1.4c "blocked" - AP/client isolation) is
// deliberately not included in this pass. Detecting it for real (rather
// than guessing from a timeout) needs a genuine signal: peers visible in
// discovery but every connection to them consistently failing - exactly
// what latency.dart's own per-peer "unreachable" quality already tracks,
// and exactly what design screen 7.2 "Router isolation" independently
// covers for the same condition once already in the app. Wiring that in
// here too is a real next step, not forgotten, just not worth a second,
// separate, weaker heuristic for the same thing onboarding would only
// ever see for a few seconds anyway.
class NetworkCheckScreen extends StatelessWidget {
  final List<disc.Peer> peers;
  final String selfInitial;
  final Color selfBg;
  final Color selfText;
  final String networkName;
  final VoidCallback onRescan;
  final VoidCallback onContinue;

  const NetworkCheckScreen({
    super.key,
    required this.peers,
    required this.selfInitial,
    required this.selfBg,
    required this.selfText,
    required this.networkName,
    required this.onRescan,
    required this.onContinue,
  });

  @override
  Widget build(BuildContext context) {
    final found = peers.isNotEmpty;
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(26, 40, 26, 0),
                child: Column(
                  children: [
                    SizedBox(
                      width: 250,
                      height: 250,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          Container(
                            width: 250,
                            height: 250,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: found ? const Color(0xFFEAD9C9) : const Color(0xFFE0D2C4), width: 1),
                            ),
                          ),
                          Container(
                            width: 170,
                            height: 170,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: found ? const Color(0xFFEAD9C9) : const Color(0xFFE0D2C4), width: 1),
                            ),
                          ),
                          _SweepPulse(color: found ? const Color(0xFFF7D7C1) : const Color(0xFFEFE2D5)),
                          Container(
                            width: 66,
                            height: 66,
                            decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent),
                            alignment: Alignment.center,
                            child: Text(selfInitial, style: const TextStyle(fontFamily: serifFamily, fontSize: 26, color: Color(0xFFFFF8F2))),
                          ),
                          ..._peerBlips(peers),
                        ],
                      ),
                    ),
                    const SizedBox(height: 30),
                    Text(
                      found ? _foundHeading(peers.length) : "Still scanning…",
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontFamily: serifFamily, fontSize: 34, height: 1.1, color: AgoraColors.text),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      found ? _foundSubtitle(peers) : "No one else is on $networkName yet. Agora keeps looking in the background.",
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 15, color: AgoraColors.text2, height: 1.5),
                    ),
                    if (!found) ...[
                      const SizedBox(height: 30),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(18)),
                        child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text("Tip", style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AgoraColors.textStrong)),
                            SizedBox(height: 6),
                            Text(
                              "Ask the other person to join the same WiFi — guest networks are usually separate.",
                              style: TextStyle(fontSize: 13.5, color: AgoraColors.text2, height: 1.5),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(26, 16, 26, 34),
              child: found
                  ? SizedBox(
                      width: double.infinity,
                      height: 54,
                      child: ElevatedButton(
                        onPressed: onContinue,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AgoraColors.accent,
                          foregroundColor: AgoraColors.onAccent,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                          elevation: 0,
                        ),
                        child: const Text("See who's nearby", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                      ),
                    )
                  : Column(
                      children: [
                        SizedBox(
                          width: double.infinity,
                          height: 54,
                          child: OutlinedButton(
                            onPressed: onRescan,
                            style: OutlinedButton.styleFrom(
                              backgroundColor: AgoraColors.surface,
                              side: const BorderSide(color: AgoraColors.border),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                            ),
                            child: const Text("Rescan", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AgoraColors.textStrong)),
                          ),
                        ),
                        const SizedBox(height: 10),
                        TextButton(
                          onPressed: onContinue,
                          child: const Text("Continue anyway", style: TextStyle(fontSize: 14, color: AgoraColors.textMuted, fontWeight: FontWeight.w500)),
                        ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  String _foundHeading(int count) {
    if (count == 1) return "1 person is on this network";
    return "$count people are on this network";
  }

  String _foundSubtitle(List<disc.Peer> peers) {
    final names = peers.take(3).map((p) => p.name.split(' ').first).toList();
    final joined = names.length == 1 ? names[0] : "${names.sublist(0, names.length - 1).join(', ')} and ${names.last}";
    return "$joined ${names.length == 1 ? 'is' : 'are'} reachable right now — no internet involved.";
  }

  List<Widget> _peerBlips(List<disc.Peer> peers) {
    // Deterministic placement by peer_id, same spirit as the desktop's own
    // ScanRadar.jsx - a peer's blip doesn't jump around on rebuild.
    final positions = <Alignment>[
      const Alignment(-0.65, -0.62),
      const Alignment(0.7, 0.45),
      const Alignment(-0.25, 0.7),
    ];
    final widgets = <Widget>[];
    for (var i = 0; i < peers.length && i < 3; i++) {
      final peer = peers[i];
      final palette = paletteForPeer(peer.peerId);
      final size = i == 2 ? 38.0 : 44.0;
      widgets.add(Align(
        alignment: positions[i],
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(shape: BoxShape.circle, color: palette.bg),
          alignment: Alignment.center,
          child: Text(initialsFor(peer.name), style: TextStyle(fontWeight: FontWeight.w600, fontSize: i == 2 ? 13 : 14, color: palette.text)),
        ),
      ));
    }
    return widgets;
  }
}

class _SweepPulse extends StatefulWidget {
  final Color color;
  const _SweepPulse({required this.color});
  @override
  State<_SweepPulse> createState() => _SweepPulseState();
}

class _SweepPulseState extends State<_SweepPulse> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 3))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = _controller.value;
        final scale = 0.6 + 0.4 * t;
        final opacity = t < 0.4 ? t / 0.4 : (1 - (t - 0.4) / 0.6);
        return Opacity(
          opacity: opacity.clamp(0.0, 1.0),
          child: Transform.scale(
            scale: scale,
            child: Container(
              width: 250,
              height: 250,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(colors: [widget.color, widget.color.withValues(alpha: 0)]),
              ),
            ),
          ),
        );
      },
    );
  }
}
