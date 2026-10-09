import 'dart:async';

import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../backend/storage.dart' as storage;
import '../../theme.dart';
import '../../util/time_format.dart';
import '../../widgets/file_bubble.dart';

// Design 4.5. "Mute notifications" is deliberately omitted - there is no
// local-notification system anywhere in this app yet, so a toggle
// promising to mute something that can't ring in the first place would be
// decorative. "Keep history on this device" is real: it's disappearing.dart's
// own per-conversation setting (null duration = keep forever, toggled off
// enables a real 7-day sweep - the only duration this screen offers,
// disappearing.dart's own sweep loop does the rest for real).
class ChatInfoScreen extends StatefulWidget {
  final storage.MessageStore store;
  final disc.PeerDiscovery discovery;
  final String peerId;
  final String peerName;
  final VoidCallback onBack;
  final VoidCallback onConversationCleared;

  const ChatInfoScreen({
    super.key,
    required this.store,
    required this.discovery,
    required this.peerId,
    required this.peerName,
    required this.onBack,
    required this.onConversationCleared,
  });

  @override
  State<ChatInfoScreen> createState() => _ChatInfoScreenState();
}

class _ChatInfoScreenState extends State<ChatInfoScreen> {
  List<storage.FileRecord> _files = [];
  bool _keepHistory = true;
  double? _lastSeen;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final files = await widget.store.listFiles(widget.peerId);
    final duration = await widget.store.getDisappearingDuration(widget.peerId);
    final known = await widget.store.listKnownPeers();
    final row = known.cast<Map<String, Object?>?>().firstWhere((r) => r!['peer_id'] == widget.peerId, orElse: () => null);
    if (!mounted) return;
    setState(() {
      _files = files;
      _keepHistory = duration == null;
      _lastSeen = row == null ? null : (row['last_seen'] as num).toDouble();
    });
  }

  Future<void> _toggleKeepHistory(bool value) async {
    setState(() => _keepHistory = value);
    if (value) {
      await widget.store.setDisappearingDuration(widget.peerId, null);
    } else {
      await widget.store.setDisappearingDuration(widget.peerId, 7 * 24 * 3600);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Messages older than 7 days will be cleared automatically on this device.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final online = widget.discovery.registry.list().any((p) => p.peerId == widget.peerId);
    final peer = widget.discovery.registry.list().cast<disc.Peer?>().firstWhere((p) => p!.peerId == widget.peerId, orElse: () => null);
    final palette = paletteForPeer(widget.peerId);
    final shortId = widget.peerId.length > 10 ? widget.peerId.substring(0, 10) : widget.peerId;

    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 20, 0),
              child: Row(
                children: [
                  IconButton(onPressed: widget.onBack, icon: const Icon(Icons.chevron_left, size: 26, color: AgoraColors.textStrong)),
                  const Text('Conversation info', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AgoraColors.text)),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(24, 10, 24, 30),
                children: [
                  Center(
                    child: Column(
                      children: [
                        CircleAvatar(backgroundColor: palette.bg, radius: 42, child: Text(initialsFor(widget.peerName), style: TextStyle(fontFamily: serifFamily, fontSize: 30, color: palette.text))),
                        const SizedBox(height: 14),
                        Text(widget.peerName, style: const TextStyle(fontFamily: serifFamily, fontSize: 26, color: AgoraColors.text)),
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
                          decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(99)),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(width: 7, height: 7, decoration: BoxDecoration(shape: BoxShape.circle, color: online ? AgoraColors.accent : const Color(0xFFB5A89C))),
                              const SizedBox(width: 7),
                              Text(
                                online ? 'On this network${peer != null && peer.deviceType.isNotEmpty ? ' · ${peer.deviceType}' : ''}' : (_lastSeen != null ? 'Last seen ${conversationTimestamp(_lastSeen!)}' : 'Not on this network'),
                                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AgoraColors.textStrong),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 26),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('SHARED FILES · ${_files.length}', style: const TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted)),
                      if (_files.length > 3)
                        GestureDetector(
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => _SharedFilesScreen(files: _files, peerName: widget.peerName))),
                          child: const Text('See all', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  if (_files.isEmpty)
                    const Text('No files shared yet.', style: TextStyle(fontSize: 13.5, color: AgoraColors.text2))
                  else
                    ..._files.reversed.take(3).map((f) => Padding(padding: const EdgeInsets.only(bottom: 8), child: FileBubble(record: f, mine: f.direction == 'sent'))),
                  const SizedBox(height: 10),
                  Container(
                    decoration: BoxDecoration(color: AgoraColors.surface, border: Border.all(color: AgoraColors.borderSoft), borderRadius: BorderRadius.circular(20)),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0xFFF1E7DC)))),
                          child: Row(
                            children: [
                              const Expanded(child: Text('Keep history on this device', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
                              Switch(value: _keepHistory, onChanged: (v) => unawaited(_toggleKeepHistory(v)), activeThumbColor: AgoraColors.accent),
                            ],
                          ),
                        ),
                        InkWell(
                          onTap: () => _confirmClear(context),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                            child: Row(children: [Expanded(child: Text('Clear this conversation', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFFC2562A)))), Icon(Icons.chevron_right, size: 18, color: Color(0xFFC2562A))]),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(15),
                    decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('DEVICE', style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted)),
                        const SizedBox(height: 5),
                        Text('id    $shortId', style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.7, color: Color(0xFF6B5C50))),
                        Text(online ? 'seen  online now' : (_lastSeen != null ? 'seen  ${conversationTimestamp(_lastSeen!)}' : 'seen  unknown'), style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.7, color: Color(0xFF6B5C50))),
                      ],
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

  void _confirmClear(BuildContext context) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Clear this conversation?'),
        content: const Text('Messages on this device will be removed. This only affects your copy.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          TextButton(
            onPressed: () async {
              Navigator.of(dialogContext).pop();
              await widget.store.clearConversation(widget.peerId);
              widget.onConversationCleared();
              if (context.mounted) Navigator.of(context).pop();
            },
            child: const Text('Clear', style: TextStyle(color: Color(0xFFC2352A))),
          ),
        ],
      ),
    );
  }
}

class _SharedFilesScreen extends StatelessWidget {
  final List<storage.FileRecord> files;
  final String peerName;
  const _SharedFilesScreen({required this.files, required this.peerName});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      appBar: AppBar(backgroundColor: AgoraColors.ground, elevation: 0, title: Text('Files with $peerName')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: files.reversed.map((f) => FileBubble(record: f, mine: f.direction == 'sent')).toList(),
      ),
    );
  }
}
