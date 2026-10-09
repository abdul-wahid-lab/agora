import 'package:flutter/material.dart';

import '../../theme.dart';

// Design 6.4 - shown honestly disabled. There is no local-notification
// system anywhere in this app yet (no notification channel, nothing posts
// a notification for an incoming message or call), so wiring these
// toggles to "look functional" would be decorative - they'd promise to
// mute or enable something that can never ring in the first place.
class NotificationsSettingsScreen extends StatelessWidget {
  final VoidCallback onBack;
  const NotificationsSettingsScreen({super.key, required this.onBack});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [IconButton(onPressed: onBack, icon: const Icon(Icons.chevron_left, size: 26, color: AgoraColors.textStrong)), const Text('Notifications', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AgoraColors.text))]),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 30),
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(18)),
                    child: const Text(
                      "Notifications aren't implemented in this build yet. Agora still delivers messages and calls in real time while the app is open - there's just no system notification when it isn't.",
                      style: TextStyle(fontSize: 13.5, color: Color(0xFF6B5C50), height: 1.5),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Opacity(
                    opacity: 0.5,
                    child: Container(
                      decoration: BoxDecoration(color: AgoraColors.surface, border: Border.all(color: AgoraColors.borderSoft), borderRadius: BorderRadius.circular(20)),
                      clipBehavior: Clip.antiAlias,
                      child: Column(
                        children: [
                          _toggleRow('Messages', true, last: false),
                          _toggleRow('Calls', true, last: false),
                          _toggleRow('Someone joins the network', false, sub: "Only for people you've chatted with", last: true),
                        ],
                      ),
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

  Widget _toggleRow(String label, bool value, {String? sub, required bool last}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: Color(0xFFF1E7DC)))),
      child: Row(
        children: [
          Expanded(
            child: sub == null
                ? Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)), Text(sub, style: const TextStyle(fontSize: 12.5, color: Color(0xFF8A7F76)))]),
          ),
          Switch(value: value, onChanged: null),
        ],
      ),
    );
  }
}
