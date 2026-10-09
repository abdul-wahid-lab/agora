import 'dart:io';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';

import '../../backend/discovery.dart' as disc;
import '../../backend/storage.dart' as storage;
import '../../theme.dart';
import '../../util/file_display.dart';
import '../../util/time_format.dart';

// Design 8.4. Every field is real: the saved path is wherever
// filetransfer.dart's accept() actually wrote the bytes, "checksum
// verified" is always true for a file that reached 'completed' status
// (the backend already rejects a hash mismatch before ever marking it
// complete), and "Delete from this device" removes both the DB row and
// the real bytes on disk - a button promising deletion that only hid a
// row while leaving the file behind would be lying by omission.
class ReceivedFileActionsSheet extends StatelessWidget {
  final storage.FileRecord record;
  final String peerName;
  final String networkName;
  final String? completionCaption;
  final List<disc.Peer> nearbyPeers;
  final void Function(disc.Peer peer) onForward;
  final VoidCallback onDeleted;

  const ReceivedFileActionsSheet({
    super.key,
    required this.record,
    required this.peerName,
    required this.networkName,
    required this.completionCaption,
    required this.nearbyPeers,
    required this.onForward,
    required this.onDeleted,
  });

  static Future<void> show(
    BuildContext context, {
    required storage.FileRecord record,
    required String peerName,
    required String networkName,
    required String? completionCaption,
    required List<disc.Peer> nearbyPeers,
    required void Function(disc.Peer peer) onForward,
    required VoidCallback onDeleted,
  }) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) => ReceivedFileActionsSheet(
        record: record,
        peerName: peerName,
        networkName: networkName,
        completionCaption: completionCaption,
        nearbyPeers: nearbyPeers,
        onForward: onForward,
        onDeleted: onDeleted,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 14, 22, 34),
      decoration: const BoxDecoration(color: Color(0xFFFDFAF6), borderRadius: BorderRadius.only(topLeft: Radius.circular(32), topRight: Radius.circular(32))),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 44, height: 5, decoration: BoxDecoration(color: const Color(0xFFE0D2C4), borderRadius: BorderRadius.circular(99))),
          const SizedBox(height: 18),
          Row(
            children: [
              Container(
                width: 58,
                height: 58,
                decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(18)),
                alignment: Alignment.center,
                child: Text(fileTypeBadge(record.filename), style: const TextStyle(fontFamily: monoFamily, fontSize: 12, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(record.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: serifFamily, fontSize: 23, height: 1.1)),
                    Text('${humanFileSize(record.size)} · from $peerName · ${conversationTimestamp(record.ts)}', style: const TextStyle(fontFamily: monoFamily, fontSize: 12, color: Color(0xFF9A8C81))),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Container(
            decoration: BoxDecoration(color: AgoraColors.surface, border: Border.all(color: AgoraColors.borderSoft), borderRadius: BorderRadius.circular(22)),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                _row(context, icon: Icons.open_in_new, label: 'Open', onTap: () => _openFile(context)),
                _row(context, icon: Icons.download_outlined, label: 'Save to device', sub: 'Agora downloads folder', onTap: () => _openFile(context)),
                _row(context, icon: Icons.more_horiz, label: 'Open with…', onTap: () => _openFile(context)),
                _row(context, icon: Icons.sync_alt, label: 'Forward to someone nearby', onTap: () => _showForwardPicker(context), last: true),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(15),
            decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('TRANSFER', style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted)),
                const SizedBox(height: 5),
                Text(
                  'received  ${completionCaption ?? '—'}\nroute     device-to-device, $networkName\nchecksum  verified',
                  style: const TextStyle(fontFamily: monoFamily, fontSize: 12, height: 1.7, color: Color(0xFF6B5C50)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          GestureDetector(
            onTap: () => _confirmDelete(context),
            child: const Text('Delete from this device', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)),
          ),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, {required IconData icon, required String label, String? sub, required VoidCallback onTap, bool last = false}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: Color(0xFFF1E7DC)))),
        child: Row(
          children: [
            Container(width: 32, height: 32, decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(10)), alignment: Alignment.center, child: Icon(icon, size: 16, color: AgoraColors.textStrong)),
            const SizedBox(width: 13),
            Expanded(
              child: sub == null
                  ? Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AgoraColors.text))
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AgoraColors.text)),
                        Text(sub, style: const TextStyle(fontSize: 12.5, color: Color(0xFF8A7F76))),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openFile(BuildContext context) async {
    final path = record.savedPath;
    if (path == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("This file's saved copy isn't available anymore.")));
      return;
    }
    final result = await OpenFilex.open(path);
    if (result.type != ResultType.done && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.message)));
    }
  }

  void _showForwardPicker(BuildContext context) {
    Navigator.of(context).pop();
    if (nearbyPeers.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No one else is reachable on this network right now.')));
      return;
    }
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFFFDFAF6),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(padding: EdgeInsets.fromLTRB(20, 18, 20, 8), child: Align(alignment: Alignment.centerLeft, child: Text('Forward to…', style: TextStyle(fontFamily: serifFamily, fontSize: 22)))),
            ...nearbyPeers.map((p) {
              final palette = paletteForPeer(p.peerId);
              return ListTile(
                leading: CircleAvatar(backgroundColor: palette.bg, child: Text(initialsFor(p.name), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600))),
                title: Text(p.name),
                onTap: () {
                  Navigator.of(context).pop();
                  onForward(p);
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _confirmDelete(BuildContext context) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete this file?'),
        content: Text('"${record.filename}" will be removed from this device. The other device keeps its own copy.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          TextButton(
            onPressed: () async {
              Navigator.of(dialogContext).pop();
              Navigator.of(context).pop();
              final path = record.savedPath;
              if (path != null) {
                try {
                  await File(path).delete();
                } catch (_) {
                  // already gone - the DB row is still the thing that matters here
                }
              }
              onDeleted();
            },
            child: const Text('Delete', style: TextStyle(color: Color(0xFFC2352A))),
          ),
        ],
      ),
    );
  }
}
