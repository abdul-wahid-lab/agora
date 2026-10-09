import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../backend/latency.dart' as lat;
import '../../theme.dart';
import '../../widgets/connectivity_badge.dart';
import '../../widgets/presence_ring.dart';
import '../../widgets/signal_bars.dart';

// Design screens 3.1 (populated) / 3.1b (empty) in one widget, same split
// ScanRadar.jsx/PeerList.jsx use on the desktop - which state renders is
// purely a function of whether `peers` is empty, driven by real,
// continuously-updating discovery data, not two separately maintained
// mock states.
class NearbyScreen extends StatelessWidget {
  final List<disc.Peer> peers;
  final Map<String, lat.LatencySample> latencyByPeer;
  final String selfInitial;
  final Color selfBg;
  final Color selfText;
  final String networkName;
  final bool rescanning;
  final VoidCallback onRescan;
  final void Function(disc.Peer peer) onPeerTap;
  final VoidCallback onWhyEmpty;

  const NearbyScreen({
    super.key,
    required this.peers,
    required this.latencyByPeer,
    required this.selfInitial,
    required this.selfBg,
    required this.selfText,
    required this.networkName,
    required this.rescanning,
    required this.onRescan,
    required this.onPeerTap,
    required this.onWhyEmpty,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 2, 20, 12),
          child: ConnectivityBadge(networkName: networkName),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 0, 22, 14),
          child: peers.isEmpty
              ? const Text("Nearby", style: TextStyle(fontFamily: serifFamily, fontSize: 34, height: 1, color: AgoraColors.text))
              : Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text("Nearby", style: TextStyle(fontFamily: serifFamily, fontSize: 34, height: 1, color: AgoraColors.text)),
                    _RescanPill(rescanning: rescanning, onTap: onRescan),
                  ],
                ),
        ),
        Expanded(child: peers.isEmpty ? _buildEmpty(context) : _buildList(context)),
      ],
    );
  }

  Widget _buildList(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 10),
          child: Text("${peers.length} REACHABLE NOW", style: const TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted)),
        ),
        ...peers.asMap().entries.map((entry) {
          final i = entry.key;
          final peer = entry.value;
          final palette = paletteForPeer(peer.peerId);
          final quality = qualityFor(latencyByPeer, peer.peerId);
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () => onPeerTap(peer),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: AgoraColors.borderSoft)),
                child: Row(
                  children: [
                    SizedBox(
                      width: 48,
                      height: 48,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          PresenceRings(size: 48, color: AgoraColors.accent, strokeWidth: 2, stagger: Duration(milliseconds: 600 * (i % 3))),
                          CircleAvatar(backgroundColor: palette.bg, radius: 24, child: Text(initialsFor(peer.name), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600))),
                        ],
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(peer.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AgoraColors.text)),
                          Text("${peer.deviceType.isEmpty ? 'Device' : peer.deviceType} · ${signalLabel(quality)}", style: const TextStyle(fontSize: 13, color: Color(0xFF8A7F76))),
                        ],
                      ),
                    ),
                    SignalBars(quality: quality),
                  ],
                ),
              ),
            ),
          );
        }),
        Container(
          margin: const EdgeInsets.only(top: 2, bottom: 16),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(color: const Color(0xFFF5EFE7), borderRadius: BorderRadius.circular(16)),
          child: Row(
            children: [
              Container(width: 7, height: 7, margin: const EdgeInsets.only(right: 10), decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFC7B8AA))),
              const Text("Still scanning for others…", style: TextStyle(fontSize: 13, color: Color(0xFF8A7F76))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEmpty(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 34),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 200,
            height: 200,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Container(width: 200, height: 200, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: const Color(0xFFE0D2C4)))),
                Container(width: 132, height: 132, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: const Color(0xFFE0D2C4)))),
                Container(width: 54, height: 54, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent), alignment: Alignment.center, child: Text(selfInitial, style: const TextStyle(fontFamily: serifFamily, fontSize: 22, color: Color(0xFFFFF8F2)))),
              ],
            ),
          ),
          const SizedBox(height: 26),
          const Text("No one else is on this network yet", textAlign: TextAlign.center, style: TextStyle(fontFamily: serifFamily, fontSize: 28, height: 1.15, color: AgoraColors.text)),
          const SizedBox(height: 10),
          Text("Agora is listening continuously. Anyone who joins $networkName will show up here on their own.", textAlign: TextAlign.center, style: const TextStyle(fontSize: 14.5, color: AgoraColors.text2, height: 1.5)),
          const SizedBox(height: 26),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _RescanOutlined(rescanning: rescanning, onTap: onRescan),
              const SizedBox(width: 10),
              GestureDetector(
                onTap: onWhyEmpty,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
                  decoration: BoxDecoration(color: AgoraColors.shuffleBg, borderRadius: BorderRadius.circular(99)),
                  child: const Text("Why is it empty?", style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AgoraColors.ground)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RescanPill extends StatelessWidget {
  final bool rescanning;
  final VoidCallback onTap;
  const _RescanPill({required this.rescanning, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: rescanning ? null : onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
        decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(99), border: Border.all(color: AgoraColors.border)),
        child: Text(rescanning ? "Scanning…" : "Rescan", style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AgoraColors.textStrong)),
      ),
    );
  }
}

class _RescanOutlined extends StatelessWidget {
  final bool rescanning;
  final VoidCallback onTap;
  const _RescanOutlined({required this.rescanning, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: rescanning ? null : onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
        decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(99), border: Border.all(color: AgoraColors.border)),
        child: Text(rescanning ? "Scanning…" : "Rescan", style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AgoraColors.textStrong)),
      ),
    );
  }
}
