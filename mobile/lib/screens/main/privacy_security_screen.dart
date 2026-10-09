import 'dart:async';

import 'package:flutter/material.dart';

import '../../backend/discovery.dart' as disc;
import '../../backend/storage.dart' as storage;
import '../../theme.dart';

// Design 6.3. The crypto badges are literally accurate - X25519 + ChaCha20-
// Poly1305 are crypto_identity.dart's real algorithms, DTLS-SRTP is what
// WebRTC itself always uses for media. "Show me in Nearby" is a real
// toggle now (discovery.dart's setVisible), not decorative.
class PrivacySecurityScreen extends StatefulWidget {
  final disc.PeerDiscovery discovery;
  final storage.MessageStore store;
  final bool initialVisible;
  final void Function(bool visible) onVisibilityChanged;
  final VoidCallback onBack;

  const PrivacySecurityScreen({
    super.key,
    required this.discovery,
    required this.store,
    required this.initialVisible,
    required this.onVisibilityChanged,
    required this.onBack,
  });

  @override
  State<PrivacySecurityScreen> createState() => _PrivacySecurityScreenState();
}

class _PrivacySecurityScreenState extends State<PrivacySecurityScreen> {
  late bool _visible = widget.initialVisible;
  List<Map<String, Object?>> _blocked = [];

  @override
  void initState() {
    super.initState();
    unawaited(_loadBlocked());
  }

  Future<void> _loadBlocked() async {
    final rows = await widget.store.listBlockedPeers();
    if (mounted) setState(() => _blocked = rows);
  }

  Future<void> _toggleVisible(bool value) async {
    setState(() => _visible = value);
    await widget.discovery.setVisible(value);
    widget.onVisibilityChanged(value);
  }

  Future<void> _unblock(String peerId) async {
    await widget.store.unblockPeer(peerId);
    await _loadBlocked();
  }

  void _confirmClearAll() {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Clear all local chat history?'),
        content: const Text('Every message in every 1:1 and group chat on this device will be removed. Files and call history stay.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          TextButton(
            onPressed: () async {
              Navigator.of(dialogContext).pop();
              await widget.store.clearAllConversations();
              if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('All local chat history cleared.')));
            },
            child: const Text('Clear everything', style: TextStyle(color: Color(0xFFC2352A))),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [IconButton(onPressed: widget.onBack, icon: const Icon(Icons.chevron_left, size: 26, color: AgoraColors.textStrong)), const Text('Privacy & security', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AgoraColors.text))]),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 30),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: AgoraColors.borderSoft)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Encrypted, even at home', style: TextStyle(fontFamily: serifFamily, fontSize: 22, color: AgoraColors.text)),
                        const SizedBox(height: 8),
                        const Text("Every message and call is end-to-end encrypted between devices. Local doesn't mean plaintext — anyone else on this WiFi sees noise, not your conversation.", style: TextStyle(fontSize: 13.5, color: AgoraColors.text2, height: 1.5)),
                        const SizedBox(height: 12),
                        Wrap(spacing: 8, runSpacing: 8, children: [_badge('X25519'), _badge('ChaCha20-Poly1305'), _badge('DTLS-SRTP calls')]),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
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
                              const Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Show me in Nearby', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                                    SizedBox(height: 2),
                                    Text('Turn off to browse without being discovered', style: TextStyle(fontSize: 12.5, color: Color(0xFF8A7F76))),
                                  ],
                                ),
                              ),
                              Switch(value: _visible, onChanged: (v) => unawaited(_toggleVisible(v)), activeThumbColor: AgoraColors.accent),
                            ],
                          ),
                        ),
                        InkWell(
                          onTap: _confirmClearAll,
                          child: const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                            child: Row(children: [Expanded(child: Text('Clear all local chat history', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFFC2562A)))), Icon(Icons.chevron_right, size: 18, color: Color(0xFFC2562A))]),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  Padding(padding: const EdgeInsets.only(left: 4, bottom: 8), child: Text('BLOCKED PEERS · ${_blocked.length}', style: const TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.textMuted))),
                  if (_blocked.isEmpty) const Text('No one is blocked.', style: TextStyle(fontSize: 13.5, color: AgoraColors.text2)),
                  ..._blocked.map((b) {
                    final peerId = b['peer_id'] as String;
                    final name = b['name'] as String;
                    final palette = paletteForPeer(peerId);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AgoraColors.borderSoft)),
                        child: Row(
                          children: [
                            CircleAvatar(backgroundColor: palette.bg, radius: 20, child: Text(initialsFor(name), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600))),
                            const SizedBox(width: 13),
                            Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15))),
                            GestureDetector(
                              onTap: () => unawaited(_unblock(peerId)),
                              child: Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8), decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(99)), child: const Text('Unblock', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AgoraColors.accentStrong))),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _badge(String label) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(99)),
        child: Text(label, style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, fontWeight: FontWeight.w600, color: AgoraColors.tipHeading)),
      );
}
