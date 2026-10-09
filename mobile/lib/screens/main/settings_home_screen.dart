import 'package:flutter/material.dart';

import '../../theme.dart';

// Design 6.1. Self row name is real (tappable to rename, reusing the same
// AppPrefs.setChosenName the onboarding Profile Setup step itself writes
// to) and the peer_id shown is the real one everyone else sees this
// device as.
class SettingsHomeScreen extends StatelessWidget {
  final String selfName;
  final String selfPeerId;
  final Color selfBg;
  final Color selfText;
  final VoidCallback onBack;
  final VoidCallback onRename;
  final VoidCallback onOpenNetwork;
  final VoidCallback onOpenPrivacy;
  final VoidCallback onOpenNotifications;
  final VoidCallback onOpenAbout;

  const SettingsHomeScreen({
    super.key,
    required this.selfName,
    required this.selfPeerId,
    required this.selfBg,
    required this.selfText,
    required this.onBack,
    required this.onRename,
    required this.onOpenNetwork,
    required this.onOpenPrivacy,
    required this.onOpenNotifications,
    required this.onOpenAbout,
  });

  @override
  Widget build(BuildContext context) {
    final shortId = selfPeerId.length > 10 ? selfPeerId.substring(0, 10) : selfPeerId;
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                IconButton(onPressed: onBack, icon: const Icon(Icons.chevron_left, size: 26, color: AgoraColors.textStrong)),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 0, 22, 14),
              child: const Text('Settings', style: TextStyle(fontFamily: serifFamily, fontSize: 34, height: 1, color: AgoraColors.text)),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                children: [
                  InkWell(
                    borderRadius: BorderRadius.circular(20),
                    onTap: onRename,
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: AgoraColors.borderSoft)),
                      child: Row(
                        children: [
                          CircleAvatar(backgroundColor: selfBg, radius: 26, child: Text(initialsFor(selfName), style: TextStyle(fontFamily: serifFamily, fontSize: 20, color: selfText))),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(selfName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AgoraColors.text)),
                                Text('$shortId · this device', style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFF9A8C81))),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right, size: 18, color: Color(0xFF9A8C81)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    decoration: BoxDecoration(color: AgoraColors.surface, border: Border.all(color: AgoraColors.borderSoft), borderRadius: BorderRadius.circular(20)),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        _row(icon: Icons.wifi, label: 'Network', sub: 'LAN-only', onTap: onOpenNetwork),
                        _row(icon: Icons.shield_outlined, label: 'Privacy & security', onTap: onOpenPrivacy),
                        _row(icon: Icons.notifications_outlined, label: 'Notifications', onTap: onOpenNotifications),
                        _row(icon: Icons.help_outline, label: 'About & help', onTap: onOpenAbout, last: true),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(15),
                    decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
                    child: const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("You're running local-only", style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AgoraColors.tipHeading)),
                        SizedBox(height: 5),
                        Text('Nothing in Agora has left this network. There is no cloud sync in this build.', style: TextStyle(fontSize: 13, color: Color(0xFF6B5C50), height: 1.45)),
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

  Widget _row({required IconData icon, required String label, String? sub, required VoidCallback onTap, bool last = false}) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: Color(0xFFF1E7DC)))),
        child: Row(
          children: [
            Container(width: 36, height: 36, decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(12)), alignment: Alignment.center, child: Icon(icon, size: 18, color: AgoraColors.accentStrong)),
            const SizedBox(width: 13),
            Expanded(
              child: sub == null
                  ? Text(label, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: AgoraColors.text))
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(label, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: AgoraColors.text)),
                        Text(sub, style: const TextStyle(fontSize: 12.5, color: Color(0xFF8A7F76))),
                      ],
                    ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: Color(0xFF9A8C81)),
          ],
        ),
      ),
    );
  }
}
