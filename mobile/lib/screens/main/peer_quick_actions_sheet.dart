import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../theme.dart';
import '../../widgets/presence_ring.dart';
import '../../widgets/signal_bars.dart';

// Design screen 3.2. Shown via showModalBottomSheet (the design's own
// dark-scrim-behind-a-light-sheet treatment, not a full-screen push).
class PeerQuickActionsSheet extends StatelessWidget {
  final disc.Peer peer;
  final double? rttMs;
  final String? quality;
  final VoidCallback onMessage;
  final VoidCallback onCall;
  final VoidCallback onVideo;
  final VoidCallback onViewProfile;

  const PeerQuickActionsSheet({
    super.key,
    required this.peer,
    required this.rttMs,
    required this.quality,
    required this.onMessage,
    required this.onCall,
    required this.onVideo,
    required this.onViewProfile,
  });

  static Future<void> show(
    BuildContext context, {
    required disc.Peer peer,
    required double? rttMs,
    required String? quality,
    required VoidCallback onMessage,
    required VoidCallback onCall,
    required VoidCallback onVideo,
    required VoidCallback onViewProfile,
  }) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      barrierColor: AgoraColors.scrimDark,
      builder: (context) => PeerQuickActionsSheet(peer: peer, rttMs: rttMs, quality: quality, onMessage: onMessage, onCall: onCall, onVideo: onVideo, onViewProfile: onViewProfile),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = paletteForPeer(peer.peerId);
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 14, 24, 38),
      decoration: const BoxDecoration(
        color: Color(0xFFFDFAF6),
        borderRadius: BorderRadius.only(topLeft: Radius.circular(32), topRight: Radius.circular(32), bottomLeft: Radius.circular(40), bottomRight: Radius.circular(40)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 44, height: 5, decoration: BoxDecoration(color: const Color(0xFFE0D2C4), borderRadius: BorderRadius.circular(99))),
          const SizedBox(height: 22),
          Row(
            children: [
              SizedBox(
                width: 64,
                height: 64,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    PresenceRings(size: 64, color: AgoraColors.accent, strokeWidth: 2),
                    CircleAvatar(backgroundColor: palette.bg, radius: 32, child: Text(initialsFor(peer.name), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600, fontSize: 22))),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(peer.name, style: const TextStyle(fontFamily: serifFamily, fontSize: 27, height: 1, color: AgoraColors.text)),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        Container(width: 7, height: 7, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent)),
                        const SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            "On this network${peer.deviceType.isEmpty ? '' : ' · ${peer.deviceType}'}",
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 13.5, color: AgoraColors.text2, fontWeight: FontWeight.w500),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
          Row(
            children: [
              Expanded(child: _ActionButton(label: "Message", filled: true, icon: _messageIcon, onTap: onMessage)),
              const SizedBox(width: 10),
              Expanded(child: _ActionButton(label: "Call", filled: false, icon: _callIcon, onTap: onCall)),
              const SizedBox(width: 10),
              Expanded(child: _ActionButton(label: "Video", filled: false, icon: _videoIcon, onTap: onVideo)),
            ],
          ),
          const SizedBox(height: 22),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text("Local connection", style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: AgoraColors.textStrong)),
                      const SizedBox(height: 3),
                      Text(
                        rttMs != null ? "${rttMs!.round()} ms" : "measuring…",
                        style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, fontWeight: FontWeight.w500, color: AgoraColors.textMuted),
                      ),
                    ],
                  ),
                ),
                SignalBars(quality: quality, height: 20),
              ],
            ),
          ),
          const SizedBox(height: 22),
          GestureDetector(
            onTap: onViewProfile,
            child: const Text("View profile", style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)),
          ),
        ],
      ),
    );
  }

  static Widget _messageIcon(Color color) => Container(width: 22, height: 19, decoration: BoxDecoration(borderRadius: BorderRadius.circular(7), border: Border.all(color: color, width: 2.5)));
  static Widget _callIcon(Color color) => Transform.rotate(angle: -0.14, child: Container(width: 21, height: 21, decoration: BoxDecoration(borderRadius: const BorderRadius.only(topLeft: Radius.circular(7), topRight: Radius.circular(7), bottomLeft: Radius.circular(7), bottomRight: Radius.circular(2)), border: Border.all(color: color, width: 2.5))));
  static Widget _videoIcon(Color color) => Container(width: 24, height: 16, decoration: BoxDecoration(borderRadius: BorderRadius.circular(5), border: Border.all(color: color, width: 2.5)));
}

class _ActionButton extends StatelessWidget {
  final String label;
  final bool filled;
  final Widget Function(Color) icon;
  final VoidCallback onTap;

  const _ActionButton({required this.label, required this.filled, required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final color = filled ? AgoraColors.onAccent : AgoraColors.textStrong;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 78,
        decoration: BoxDecoration(
          color: filled ? AgoraColors.accent : AgoraColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: filled ? null : Border.all(color: AgoraColors.border),
        ),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            icon(color),
            const SizedBox(height: 8),
            Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: color)),
          ],
        ),
      ),
    );
  }
}
