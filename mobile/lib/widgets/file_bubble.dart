import 'package:flutter/material.dart';

import '../backend/storage.dart' as storage;
import '../theme.dart';
import '../util/file_display.dart';

// Design 8.2/8.3 - one widget covering every state filetransfer.dart's own
// FileRecord.status actually produces (awaiting_accept, offered,
// accepted, transferring, completed, failed, cancelled, declined). No
// "paused" state is rendered - the wire protocol has no pause message, so
// a paused-looking bubble here would be showing something that can't
// really happen.
class FileBubble extends StatelessWidget {
  final storage.FileRecord record;
  final bool mine;
  final Map<String, num?>? liveStats; // speed_bps/eta_sec while transferring
  final String? completionCaption; // "complete in 3 s · 78 MB/s", if captured live
  final VoidCallback? onAccept;
  final VoidCallback? onDecline;
  final VoidCallback? onCancel;
  final VoidCallback? onRetry;
  final VoidCallback? onSendAgain;
  final VoidCallback? onOpen;

  const FileBubble({
    super.key,
    required this.record,
    required this.mine,
    this.liveStats,
    this.completionCaption,
    this.onAccept,
    this.onDecline,
    this.onCancel,
    this.onRetry,
    this.onSendAgain,
    this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    final align = mine ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: align,
        children: [
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
            child: _buildCard(context),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(BuildContext context) {
    switch (record.status) {
      case 'awaiting_accept':
        return _offerCard();
      case 'offered':
      case 'accepted':
      case 'transferring':
        return _progressCard();
      case 'completed':
        return _completedCard();
      case 'failed':
        return _failedCard();
      case 'declined':
      case 'cancelled':
        return _endedCard();
      default:
        return _progressCard();
    }
  }

  Widget _badge({Color? bg, Color? fg}) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(color: bg ?? AgoraColors.surface2, borderRadius: BorderRadius.circular(13)),
      alignment: Alignment.center,
      child: Text(fileTypeBadge(record.filename), style: TextStyle(fontFamily: monoFamily, fontSize: 9, fontWeight: FontWeight.w600, color: fg ?? AgoraColors.accentStrong)),
    );
  }

  Widget _offerCard() {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.borderSoft)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _badge(),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(record.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                    Text('${humanFileSize(record.size)} · wants to send this', style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFF9A8C81))),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              GestureDetector(
                onTap: onAccept,
                child: Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8), decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(99)), child: const Text('Accept', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AgoraColors.onAccent))),
              ),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: onDecline,
                child: Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8), decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(99)), child: const Text('Decline', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AgoraColors.textStrong))),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _progressCard() {
    final speed = liveStats?['speed_bps'];
    final eta = liveStats?['eta_sec'];
    final progress = _liveProgress();
    final pct = (progress * 100).round();
    final sub = record.status == 'offered'
        ? (mine ? 'waiting for them to accept' : 'offering…')
        : record.status == 'accepted'
            ? 'starting…'
            : '${humanFileSize(record.size)} · ${mine ? 'sending' : 'receiving'}${speed != null ? ' · ${humanSpeed(speed)}' : ''}';
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.borderSoft)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _badge(),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(child: Text(record.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                        if (record.status == 'transferring') Text('$pct%', style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFF9A8C81))),
                      ],
                    ),
                    Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFF9A8C81))),
                  ],
                ),
              ),
              if (onCancel != null) GestureDetector(onTap: onCancel, child: const Padding(padding: EdgeInsets.only(left: 6), child: Text('×', style: TextStyle(fontSize: 18, color: Color(0xFF9A8C81))))),
            ],
          ),
          if (record.status == 'transferring') ...[
            const SizedBox(height: 9),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(value: progress, minHeight: 5, backgroundColor: AgoraColors.surface2, valueColor: const AlwaysStoppedAnimation(AgoraColors.accent)),
            ),
            if (eta != null) ...[
              const SizedBox(height: 5),
              Text(humanEta(eta), style: const TextStyle(fontFamily: monoFamily, fontSize: 11, color: Color(0xFF9A8C81))),
            ],
          ],
        ],
      ),
    );
  }

  double _liveProgress() {
    final speed = liveStats?['speed_bps'];
    final eta = liveStats?['eta_sec'];
    if (speed == null || eta == null || record.size <= 0) return 0;
    final elapsed = eta <= 0 ? record.size.toDouble() : (record.size - speed * eta);
    return (elapsed / record.size).clamp(0.0, 1.0);
  }

  Widget _completedCard() {
    return GestureDetector(
      onTap: onOpen,
      child: Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.borderSoft)),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(color: const Color(0xFFE8EEE4), borderRadius: BorderRadius.circular(12)),
              alignment: Alignment.center,
              child: const Icon(Icons.check, size: 18, color: Color(0xFF4C6B43)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(record.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  Text(
                    completionCaption != null ? '${humanFileSize(record.size)} · $completionCaption' : humanFileSize(record.size),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFF9A8C81)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _failedCard() {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFF0CFC6))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _badge(bg: const Color(0xFFF9E3DE), fg: const Color(0xFFA83F30)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(record.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    const Text('Transfer failed', style: TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFFA83F30))),
                  ],
                ),
              ),
            ],
          ),
          if (mine && onRetry != null) ...[
            const SizedBox(height: 10),
            GestureDetector(
              onTap: onRetry,
              child: Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8), decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(99)), child: const Text('Retry', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AgoraColors.onAccent))),
            ),
          ],
        ],
      ),
    );
  }

  Widget _endedCard() {
    final label = record.status == 'cancelled' ? (mine ? 'Cancelled by you' : 'Cancelled by them') : 'Declined';
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: const Color(0xFFFAF5EF), borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFEEE5DB))),
      child: Opacity(
        opacity: 0.8,
        child: Row(
          children: [
            _badge(bg: const Color(0xFFEFE7DD), fg: const Color(0xFFA2968B)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(record.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: Color(0xFF8A7F76), decoration: TextDecoration.lineThrough)),
                  Text(label, style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFFA2968B))),
                ],
              ),
            ),
            if (mine && record.status == 'cancelled' && onSendAgain != null)
              GestureDetector(
                onTap: onSendAgain,
                child: Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(99), border: Border.all(color: AgoraColors.border)), child: const Text('Send again', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AgoraColors.textStrong))),
              ),
          ],
        ),
      ),
    );
  }
}
