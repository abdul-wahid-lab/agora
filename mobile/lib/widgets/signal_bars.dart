import 'package:flutter/material.dart';

import '../backend/latency.dart' as lat;
import '../theme.dart';

// No real WiFi RSSI to read here (a LAN software connection, not a radio
// link) - same reasoning the desktop's own ConnectionQualityDot uses.
// Bars filled is driven by latency.dart's real measured round-trip
// quality, not a fabricated signal icon with nothing behind it. null
// quality (not pinged yet) renders all bars muted.
class SignalBars extends StatelessWidget {
  final String? quality; // excellent | good | fair | weak | unreachable | null
  final double height;

  const SignalBars({super.key, this.quality, this.height = 18});

  int get _filled {
    switch (quality) {
      case 'excellent':
        return 4;
      case 'good':
        return 3;
      case 'fair':
        return 2;
      case 'weak':
        return 1;
      default:
        return 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final heights = [height * 0.39, height * 0.61, height * 0.83, height];
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List.generate(4, (i) {
        return Padding(
          padding: EdgeInsets.only(right: i == 3 ? 0 : 3),
          child: Container(
            width: 3,
            height: heights[i],
            decoration: BoxDecoration(
              color: i < _filled ? AgoraColors.accent : AgoraColors.signalMuted,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        );
      }),
    );
  }
}

String signalLabel(String? quality) {
  switch (quality) {
    case 'excellent':
    case 'good':
      return 'strong signal';
    case 'fair':
      return 'fair signal';
    case 'weak':
      return 'weak signal';
    case 'unreachable':
      return 'unreachable';
    default:
      return 'checking…';
  }
}

String? qualityFor(Map<String, lat.LatencySample> latest, String peerId) => latest[peerId]?.quality;
