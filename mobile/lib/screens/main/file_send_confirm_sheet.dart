import 'dart:io';

import 'package:flutter/material.dart';

import '../../theme.dart';
import '../../util/file_display.dart';

// Design 8.1. No fabricated "about 24 seconds" ETA - there's no real speed
// baseline before a transfer has actually started, so the honest version
// of this screen just states the real, always-true facts: direct device-
// to-device delivery, nothing uploaded anywhere.
class FileSendConfirmSheet extends StatefulWidget {
  final List<File> files;
  final String peerName;
  final void Function(List<File> files) onSend;

  const FileSendConfirmSheet({super.key, required this.files, required this.peerName, required this.onSend});

  static Future<void> show(BuildContext context, {required List<File> files, required String peerName, required void Function(List<File> files) onSend}) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => FileSendConfirmSheet(files: files, peerName: peerName, onSend: onSend),
    );
  }

  @override
  State<FileSendConfirmSheet> createState() => _FileSendConfirmSheetState();
}

class _FileSendConfirmSheetState extends State<FileSendConfirmSheet> {
  final List<File> _files = [];

  @override
  void initState() {
    super.initState();
    _files.addAll(widget.files);
  }

  @override
  Widget build(BuildContext context) {
    final totalBytes = _files.fold<int>(0, (sum, f) => sum + f.lengthSync());
    return Container(
      padding: const EdgeInsets.fromLTRB(22, 14, 22, 34),
      decoration: const BoxDecoration(color: Color(0xFFFDFAF6), borderRadius: BorderRadius.only(topLeft: Radius.circular(32), topRight: Radius.circular(32))),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 44, height: 5, decoration: BoxDecoration(color: const Color(0xFFE0D2C4), borderRadius: BorderRadius.circular(99))),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(_files.length == 1 ? 'Send 1 file' : 'Send ${_files.length} files', style: const TextStyle(fontFamily: serifFamily, fontSize: 26, height: 1, color: AgoraColors.text)),
              Text(humanFileSize(totalBytes), style: const TextStyle(fontFamily: monoFamily, fontSize: 13, color: Color(0xFF8A7F76))),
            ],
          ),
          const SizedBox(height: 18),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 280),
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: _files.length,
              separatorBuilder: (_, _) => const SizedBox(height: 9),
              itemBuilder: (context, i) {
                final f = _files[i];
                final name = f.path.split(Platform.pathSeparator).last;
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                  decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.borderSoft)),
                  child: Row(
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(13)),
                        alignment: Alignment.center,
                        child: Text(fileTypeBadge(name), style: const TextStyle(fontFamily: monoFamily, fontSize: 10, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)),
                      ),
                      const SizedBox(width: 13),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                            Text(humanFileSize(f.lengthSync()), style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFF9A8C81))),
                          ],
                        ),
                      ),
                      GestureDetector(
                        onTap: () {
                          setState(() => _files.removeAt(i));
                          if (_files.isEmpty) Navigator.of(context).pop();
                        },
                        child: const Padding(padding: EdgeInsets.all(4), child: Text('×', style: TextStyle(fontSize: 17, color: Color(0xFFC9BCB0)))),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
            decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                Icon(Icons.bolt, size: 18, color: AgoraColors.accent),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    "Direct to ${widget.peerName}'s device over this network. Nothing is uploaded.",
                    style: const TextStyle(fontSize: 13, color: Color(0xFF6B5C50), height: 1.45),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  height: 54,
                  decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.border)),
                  alignment: Alignment.center,
                  child: const Text('Cancel', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: AgoraColors.textStrong)),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: GestureDetector(
                  onTap: () {
                    Navigator.of(context).pop();
                    widget.onSend(_files);
                  },
                  child: Container(
                    height: 54,
                    decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(18)),
                    alignment: Alignment.center,
                    child: Text(_files.length == 1 ? 'Send 1 file' : 'Send ${_files.length} files', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AgoraColors.onAccent)),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
