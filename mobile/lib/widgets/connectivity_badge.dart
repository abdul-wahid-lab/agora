import 'package:flutter/material.dart';

import '../theme.dart';

// The persistent "On this network" pill (design 3.1/3.1b/3.2's own header
// chrome) - the project's one non-negotiable always-visible signal per the
// original spec: "Connectivity state must always be visible." A pulsing
// dot (agPulse: scale 1->1.8, opacity 0.9->0, matching index.css's own
// reverse-engineered keyframe) plus the real network name when known.
class ConnectivityBadge extends StatelessWidget {
  final String networkName;

  const ConnectivityBadge({super.key, required this.networkName});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFEAD9C9))),
      child: Row(
        children: [
          const _PulseDot(),
          const SizedBox(width: 9),
          const Text("On this network", style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5, color: AgoraColors.textStrong)),
          const Spacer(),
          Text(networkName, style: const TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w500, color: AgoraColors.textMuted)),
        ],
      ),
    );
  }
}

class _PulseDot extends StatefulWidget {
  const _PulseDot();
  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 8,
      height: 8,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final t = _controller.value;
          final scale = 1 + 0.8 * t;
          final opacity = (0.9 * (1 - t)).clamp(0.0, 1.0);
          return Stack(
            alignment: Alignment.center,
            children: [
              Opacity(
                opacity: opacity,
                child: Transform.scale(scale: scale, child: Container(width: 8, height: 8, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent))),
              ),
              Container(width: 8, height: 8, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent)),
            ],
          );
        },
      ),
    );
  }
}
