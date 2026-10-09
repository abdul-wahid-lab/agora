import 'package:flutter/material.dart';

import '../../theme.dart';
import '../../util/time_format.dart';

// Design 5.6 (populated) / 7.4 (empty). Every row is a real stored call
// (MessageStore.listAllCalls) - direction, media, duration and end status
// all come straight from calling.dart's own CallService.finalStatus, never
// guessed from UI state.
class CallListScreen extends StatelessWidget {
  final List<CallRow> calls;
  final String networkName;
  final void Function(String peerId, String peerName) onCallPeer;
  final VoidCallback onGoToNearby;

  const CallListScreen({super.key, required this.calls, required this.networkName, required this.onCallPeer, required this.onGoToNearby});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(22, 0, 22, 14),
          child: Text("Calls", style: TextStyle(fontFamily: serifFamily, fontSize: 34, height: 1, color: AgoraColors.text)),
        ),
        Expanded(child: calls.isEmpty ? _buildEmpty(context) : _buildList(context)),
      ],
    );
  }

  Widget _buildList(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      itemCount: calls.length,
      separatorBuilder: (_, _) => const SizedBox(height: 6),
      itemBuilder: (context, i) {
        final c = calls[i];
        final palette = paletteForPeer(c.peerId);
        final missed = c.status == 'missed' || c.status == 'declined';
        return InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: () => onCallPeer(c.peerId, c.name),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: AgoraColors.borderSoft)),
            child: Row(
              children: [
                CircleAvatar(backgroundColor: palette.bg, radius: 23, child: Text(initialsFor(c.name), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600))),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.name, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5, color: missed ? const Color(0xFFC2352A) : AgoraColors.text)),
                      Text(_describe(c), style: const TextStyle(fontSize: 12.5, color: Color(0xFF8A7F76))),
                    ],
                  ),
                ),
                Text(conversationTimestamp(c.startedAt), style: const TextStyle(fontSize: 12, color: AgoraColors.textMuted)),
              ],
            ),
          ),
        );
      },
    );
  }

  String _describe(CallRow c) {
    final mediaLabel = c.media == 'video' ? 'Video' : 'Audio';
    switch (c.status) {
      case 'missed':
        return c.direction == 'incoming' ? 'Missed $mediaLabel call'.replaceFirst('Missed Audio', 'Missed audio').replaceFirst('Missed Video', 'Missed video') : '$mediaLabel call · no answer';
      case 'declined':
        return c.direction == 'incoming' ? 'Declined' : "$mediaLabel call · declined";
      case 'busy':
        return '$mediaLabel call · busy';
      case 'failed':
        return "$mediaLabel call · couldn't connect";
      case 'dropped':
        return '$mediaLabel · ${_durationText(c.duration)} · dropped, peer left';
      case 'completed':
        return '$mediaLabel · ${_durationText(c.duration)} · on this network';
      default:
        return mediaLabel;
    }
  }

  String _durationText(double? seconds) {
    if (seconds == null) return '0 s';
    final s = seconds.round();
    if (s < 60) return '$s s';
    final m = s ~/ 60;
    final rem = s % 60;
    return rem == 0 ? '$m min' : '$m min ${rem.toString().padLeft(2, '0')} s';
  }

  Widget _buildEmpty(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 44),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Transform.rotate(
            angle: -0.14,
            child: Container(width: 74, height: 74, decoration: BoxDecoration(border: Border.all(color: const Color(0xFFE0D2C4), width: 2.5), borderRadius: const BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24), bottomLeft: Radius.circular(24), bottomRight: Radius.circular(6)))),
          ),
          const SizedBox(height: 22),
          const Text("No call history yet", textAlign: TextAlign.center, style: TextStyle(fontFamily: serifFamily, fontSize: 27, height: 1.15, color: AgoraColors.text)),
          const SizedBox(height: 10),
          const Text("Calls between people on the same network are instant and stay off the internet entirely.", textAlign: TextAlign.center, style: TextStyle(fontSize: 14.5, color: AgoraColors.text2, height: 1.5)),
          const SizedBox(height: 22),
          GestureDetector(
            onTap: onGoToNearby,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
              decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(99)),
              child: const Text("Call someone nearby", style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AgoraColors.onAccent)),
            ),
          ),
        ],
      ),
    );
  }
}

class CallRow {
  final String callId;
  final String peerId;
  final String name;
  final String direction;
  final String media;
  final String status;
  final double startedAt;
  final double? duration;

  const CallRow({
    required this.callId,
    required this.peerId,
    required this.name,
    required this.direction,
    required this.media,
    required this.status,
    required this.startedAt,
    this.duration,
  });
}
