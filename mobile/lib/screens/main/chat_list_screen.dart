import 'package:flutter/material.dart';

import '../../theme.dart';
import '../../util/time_format.dart';

// Design 4.1 (populated) / 4.1b (empty). Each row comes straight from
// MessageStore.listConversations() (one row per peer ever messaged, with
// its own most recent message) joined against live discovery for the
// online dot - no unread-count badge, since the backend has no "unread"
// concept to back one (status is pending|sent|delivered|received|failed,
// not a read flag) and a fabricated number would be worse than none.
class ChatListScreen extends StatelessWidget {
  final List<ConversationRow> conversations;
  final int onlinePeerCount;
  final String networkName;
  final void Function(ConversationRow row) onOpenRow;
  final VoidCallback onNewChat;
  final VoidCallback onGoToNearby;

  const ChatListScreen({
    super.key,
    required this.conversations,
    required this.onlinePeerCount,
    required this.networkName,
    required this.onOpenRow,
    required this.onNewChat,
    required this.onGoToNearby,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 0, 22, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text("Chats", style: TextStyle(fontFamily: serifFamily, fontSize: 34, height: 1, color: AgoraColors.text)),
              if (conversations.isNotEmpty)
                GestureDetector(
                  onTap: onNewChat,
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(12)),
                    alignment: Alignment.center,
                    child: const Text("+", style: TextStyle(fontSize: 21, fontWeight: FontWeight.w500, color: AgoraColors.onAccent)),
                  ),
                ),
            ],
          ),
        ),
        Expanded(child: conversations.isEmpty ? _buildEmpty(context) : _buildList(context)),
      ],
    );
  }

  Widget _buildList(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      itemCount: conversations.length,
      separatorBuilder: (_, _) => const SizedBox(height: 6),
      itemBuilder: (context, i) {
        final c = conversations[i];
        final palette = paletteForPeer(c.peerId);
        final subtitle = c.isGroup ? c.lastBody : (c.online ? c.lastBody : "Left the network");
        return InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: () => onOpenRow(c),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            decoration: BoxDecoration(
              color: c.online || c.isGroup ? AgoraColors.surface : const Color(0xFFFAF5EF),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: c.online || c.isGroup ? AgoraColors.borderSoft : const Color(0xFFEEE5DB)),
            ),
            child: Opacity(
              opacity: c.online || c.isGroup ? 1 : 0.75,
              child: Row(
                children: [
                  SizedBox(
                    width: 50,
                    height: 50,
                    child: c.isGroup
                        ? Container(decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)), alignment: Alignment.center, child: Text(initialsFor(c.name), style: const TextStyle(fontWeight: FontWeight.w600, color: AgoraColors.accentStrong)))
                        : Stack(
                            clipBehavior: Clip.none,
                            children: [
                              CircleAvatar(backgroundColor: palette.bg, radius: 25, child: Text(initialsFor(c.name), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600))),
                              Positioned(
                                right: 0,
                                bottom: 1,
                                child: Container(
                                  width: 13,
                                  height: 13,
                                  decoration: BoxDecoration(shape: BoxShape.circle, color: c.online ? AgoraColors.accent : const Color(0xFFCBBFB3), border: Border.all(color: c.online ? AgoraColors.surface : const Color(0xFFFAF5EF), width: 2.5)),
                                ),
                              ),
                            ],
                          ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(child: Text(c.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AgoraColors.text))),
                            Text(conversationTimestamp(c.lastTs), style: const TextStyle(fontSize: 12, color: AgoraColors.textMuted)),
                          ],
                        ),
                        Text(
                          subtitle,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13.5, color: c.online || c.isGroup ? AgoraColors.textStrong.withValues(alpha: 0.85) : const Color(0xFF8A7F76)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildEmpty(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 40),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 120,
            height: 52,
            child: Stack(
              children: [
                Positioned(left: 0, child: Container(width: 52, height: 52, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFEFE4D8)))),
                Positioned(left: 36, child: Container(width: 52, height: 52, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFE7DACD)))),
                Positioned(left: 72, child: Container(width: 52, height: 52, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFF0D9C6)))),
              ],
            ),
          ),
          const SizedBox(height: 24),
          const Text("Say hello to someone nearby", textAlign: TextAlign.center, style: TextStyle(fontFamily: serifFamily, fontSize: 28, height: 1.15, color: AgoraColors.text)),
          const SizedBox(height: 10),
          Text(
            onlinePeerCount > 0
                ? "${onlinePeerCount == 1 ? 'One person is' : '$onlinePeerCount people are'} on $networkName right now. Conversations you start will live here."
                : "No one is on $networkName right now. Conversations you start will live here.",
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14.5, color: AgoraColors.text2, height: 1.5),
          ),
          const SizedBox(height: 24),
          GestureDetector(
            onTap: onGoToNearby,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
              decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(99)),
              child: const Text("Go to Nearby", style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AgoraColors.onAccent)),
            ),
          ),
        ],
      ),
    );
  }
}

class ConversationRow {
  final String peerId; // for a group row, this holds the group_id instead
  final String name;
  final String lastBody;
  final String lastDirection;
  final String lastStatus;
  final double lastTs;
  final bool online;
  final bool isGroup;

  const ConversationRow({
    required this.peerId,
    required this.name,
    required this.lastBody,
    required this.lastDirection,
    required this.lastStatus,
    required this.lastTs,
    required this.online,
    this.isGroup = false,
  });
}
