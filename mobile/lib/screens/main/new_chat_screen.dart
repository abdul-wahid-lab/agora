import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../theme.dart';

// Design 4.4. "NOT ON THIS NETWORK" is real known_peers minus who's
// currently live in discovery - groups.dart genuinely can't invite someone
// who isn't reachable right now (createGroup only sends group_invite to
// peers it can actually message), so that section is shown disabled
// rather than silently letting a selection fail later.
class NewChatScreen extends StatefulWidget {
  final List<disc.Peer> nearbyPeers;
  final List<({String peerId, String name})> offlineKnownPeers;
  final void Function(String peerId, String peerName) onStartDirectChat;
  final void Function(String groupName, List<disc.Peer> members) onCreateGroup;

  const NewChatScreen({
    super.key,
    required this.nearbyPeers,
    required this.offlineKnownPeers,
    required this.onStartDirectChat,
    required this.onCreateGroup,
  });

  @override
  State<NewChatScreen> createState() => _NewChatScreenState();
}

class _NewChatScreenState extends State<NewChatScreen> {
  final Set<String> _selected = {};
  final _nameController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  void _next() {
    final chosen = widget.nearbyPeers.where((p) => _selected.contains(p.peerId)).toList();
    if (chosen.isEmpty) return;
    if (chosen.length == 1) {
      widget.onStartDirectChat(chosen.first.peerId, chosen.first.name);
      return;
    }
    final name = _nameController.text.trim().isEmpty ? chosen.map((p) => p.name.split(' ').first).join(', ') : _nameController.text.trim();
    widget.onCreateGroup(name, chosen);
  }

  @override
  Widget build(BuildContext context) {
    final multi = _selected.length > 1;
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  GestureDetector(onTap: () => Navigator.of(context).pop(), child: const Text('Cancel', style: TextStyle(fontSize: 15, color: AgoraColors.text2))),
                  const Text('New chat', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AgoraColors.text)),
                  GestureDetector(
                    onTap: _selected.isEmpty ? null : _next,
                    child: Text('Next', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _selected.isEmpty ? AgoraColors.textMuted : AgoraColors.accentStrong)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                children: [
                  if (multi) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.borderSoft)),
                      child: Row(
                        children: [
                          Container(width: 40, height: 40, decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(13)), alignment: Alignment.center, child: const Icon(Icons.add, color: AgoraColors.accentStrong)),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextField(
                              controller: _nameController,
                              decoration: const InputDecoration(border: InputBorder.none, hintText: 'Group name', hintStyle: TextStyle(color: AgoraColors.textMuted)),
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                            ),
                          ),
                          const Text('optional avatar', style: TextStyle(fontSize: 11.5, color: AgoraColors.textMuted)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                  ] else
                    const SizedBox(height: 10),
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 8),
                    child: Text('NEARBY RIGHT NOW · ${widget.nearbyPeers.length}', style: const TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted)),
                  ),
                  ...widget.nearbyPeers.map((p) {
                    final selected = _selected.contains(p.peerId);
                    final palette = paletteForPeer(p.peerId);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(18),
                        onTap: () => setState(() => selected ? _selected.remove(p.peerId) : _selected.add(p.peerId)),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: selected ? AgoraColors.accent : AgoraColors.borderSoft, width: selected ? 1.5 : 1)),
                          child: Row(
                            children: [
                              CircleAvatar(backgroundColor: palette.bg, radius: 20, child: Text(initialsFor(p.name), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600))),
                              const SizedBox(width: 13),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
                                    Text(p.deviceType.isEmpty ? 'Device' : p.deviceType, style: const TextStyle(fontSize: 12.5, color: Color(0xFF8A7F76))),
                                  ],
                                ),
                              ),
                              Container(
                                width: 26,
                                height: 26,
                                decoration: BoxDecoration(shape: BoxShape.circle, color: selected ? AgoraColors.accent : Colors.transparent, border: Border.all(color: selected ? AgoraColors.accent : const Color(0xFFD9CCBF), width: 2)),
                                child: selected ? const Icon(Icons.check, size: 15, color: Colors.white) : null,
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                  if (widget.offlineKnownPeers.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    const Padding(padding: EdgeInsets.only(left: 4, bottom: 8), child: Text('NOT ON THIS NETWORK', style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted))),
                    ...widget.offlineKnownPeers.map((p) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Opacity(
                            opacity: 0.6,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                              decoration: BoxDecoration(color: const Color(0xFFF0EAE1), borderRadius: BorderRadius.circular(18)),
                              child: Row(
                                children: [
                                  CircleAvatar(backgroundColor: const Color(0xFFD9CCBF), radius: 20, child: Text(initialsFor(p.name), style: const TextStyle(color: Color(0xFF8A7F76), fontWeight: FontWeight.w600))),
                                  const SizedBox(width: 13),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5, color: Color(0xFF8A7F76))),
                                        const Text("Can't be added until they're back", style: TextStyle(fontSize: 12.5, color: Color(0xFF9A8C81))),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        )),
                  ],
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                    decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
                    child: const Text('Groups can only include people currently discovered on this network.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: Color(0xFF6B5C50), height: 1.4)),
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
