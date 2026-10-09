import 'dart:async';

import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../backend/groups.dart' as groups;
import '../../backend/storage.dart' as storage;
import '../../theme.dart';

// Design 4.3. No "Seen by N" receipt - group_message has no read-receipt
// wire message (see groups.dart), so that count would be fabricated. The
// "X aren't on this network" system note is real: it's the live
// difference between group.members and discovery's current registry.
class GroupChatScreen extends StatefulWidget {
  final storage.MessageStore store;
  final groups.GroupService groupService;
  final disc.PeerDiscovery discovery;
  final String groupId;
  final String selfPeerId;
  final VoidCallback onBack;

  const GroupChatScreen({
    super.key,
    required this.store,
    required this.groupService,
    required this.discovery,
    required this.groupId,
    required this.selfPeerId,
    required this.onBack,
  });

  @override
  State<GroupChatScreen> createState() => _GroupChatScreenState();
}

class _GroupChatScreenState extends State<GroupChatScreen> {
  storage.Group? _group;
  List<storage.GroupMessage> _messages = [];
  Timer? _ticker;
  final _controller = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
    _ticker = Timer.periodic(const Duration(seconds: 2), (_) => unawaited(_refresh()));
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final group = await widget.store.getGroup(widget.groupId);
    final messages = await widget.store.groupHistory(widget.groupId, limit: 500);
    if (!mounted) return;
    setState(() {
      _group = group;
      _messages = messages;
    });
  }

  Future<void> _send() async {
    final body = _controller.text.trim();
    if (body.isEmpty) return;
    _controller.clear();
    await widget.groupService.sendGroupMessage(widget.groupId, body);
    await _refresh();
    if (_scrollController.hasClients) {
      unawaited(_scrollController.animateTo(_scrollController.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut));
    }
  }

  @override
  Widget build(BuildContext context) {
    final group = _group;
    if (group == null) return const Scaffold(backgroundColor: AgoraColors.ground, body: SizedBox.shrink());

    final onlineIds = widget.discovery.registry.list().map((p) => p.peerId).toSet();
    final otherMembers = group.members.where((m) => m.peerId != widget.selfPeerId).toList();
    final onlineCount = otherMembers.where((m) => onlineIds.contains(m.peerId)).length + 1; // +1 for self, always "here"
    final offlineMembers = otherMembers.where((m) => !onlineIds.contains(m.peerId)).toList();

    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(10, 4, 18, 12),
              decoration: const BoxDecoration(color: Color(0xFFFDFAF6), border: Border(bottom: BorderSide(color: Color(0xFFEEE3D8)))),
              child: Row(
                children: [
                  IconButton(onPressed: widget.onBack, icon: const Icon(Icons.chevron_left, color: AgoraColors.textStrong, size: 26)),
                  SizedBox(
                    width: 64,
                    height: 36,
                    child: Stack(
                      children: [
                        for (var i = 0; i < otherMembers.length.clamp(0, 3); i++)
                          Positioned(
                            left: i * 18.0,
                            child: CircleAvatar(backgroundColor: paletteForPeer(otherMembers[i].peerId).bg, radius: 18, child: Text(initialsFor(otherMembers[i].name), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: paletteForPeer(otherMembers[i].peerId).text))),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(group.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AgoraColors.text)),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(width: 6, height: 6, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent)),
                            const SizedBox(width: 6),
                            Text('$onlineCount of ${group.members.length} nearby right now', style: const TextStyle(fontSize: 12.5, color: AgoraColors.text2, fontWeight: FontWeight.w500)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _messages.isEmpty
                  ? Center(child: Text('Say hello to ${group.name}', style: const TextStyle(fontFamily: serifFamily, fontSize: 20, color: AgoraColors.text3)))
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(18),
                      itemCount: _messages.length + (offlineMembers.isEmpty ? 0 : 1),
                      itemBuilder: (context, i) {
                        if (i == _messages.length) {
                          final names = offlineMembers.map((m) => m.name).join(' and ');
                          return Container(
                            alignment: Alignment.center,
                            margin: const EdgeInsets.only(top: 6),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                            decoration: BoxDecoration(color: const Color(0xFFF5EFE7), borderRadius: BorderRadius.circular(14)),
                            child: Text(
                              "${offlineMembers.length == 1 ? '$names isn\'t' : '$names aren\'t'} on this network — they'll get these when they rejoin.",
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 13, color: AgoraColors.text2, height: 1.45),
                            ),
                          );
                        }
                        final m = _messages[i];
                        final mine = m.senderPeerId == widget.selfPeerId;
                        return _GroupBubble(message: m, mine: mine);
                      },
                    ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
              decoration: const BoxDecoration(color: Color(0xFFFDFAF6), border: Border(top: BorderSide(color: Color(0xFFEEE3D8)))),
              child: Row(
                children: [
                  Expanded(
                    child: Container(
                      height: 46,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: AgoraColors.border)),
                      child: TextField(
                        controller: _controller,
                        onSubmitted: (_) => unawaited(_send()),
                        textInputAction: TextInputAction.send,
                        decoration: const InputDecoration(border: InputBorder.none, hintText: 'Message the group…', hintStyle: TextStyle(color: AgoraColors.textMuted, fontSize: 15)),
                        style: const TextStyle(fontSize: 15, color: AgoraColors.text),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  GestureDetector(
                    onTap: () => unawaited(_send()),
                    child: Container(width: 46, height: 46, decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(16)), alignment: Alignment.center, child: const Icon(Icons.arrow_forward, color: AgoraColors.onAccent, size: 20)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupBubble extends StatelessWidget {
  final storage.GroupMessage message;
  final bool mine;
  const _GroupBubble({required this.message, required this.mine});

  @override
  Widget build(BuildContext context) {
    final bubble = Container(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
      decoration: BoxDecoration(
        color: mine ? AgoraColors.accent : AgoraColors.surface,
        border: mine ? null : Border.all(color: AgoraColors.borderSoft),
        borderRadius: BorderRadius.only(topLeft: const Radius.circular(20), topRight: const Radius.circular(20), bottomLeft: Radius.circular(mine ? 20 : 6), bottomRight: Radius.circular(mine ? 6 : 20)),
      ),
      child: Text(message.body, style: TextStyle(fontSize: 15, height: 1.45, color: mine ? AgoraColors.onAccent : AgoraColors.text)),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          if (!mine) Padding(padding: const EdgeInsets.only(left: 4, bottom: 3), child: Text(message.senderName, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AgoraColors.text2))),
          ConstrainedBox(constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.76), child: bubble),
        ],
      ),
    );
  }
}
