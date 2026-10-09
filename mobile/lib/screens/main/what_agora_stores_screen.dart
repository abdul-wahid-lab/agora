import 'package:flutter/material.dart';

import '../../theme.dart';

// Not a design-extracted screen - a plain informational page the About
// screen links to, describing exactly what storage.dart actually keeps
// (messages, files, calls, known peers, blocked peers), all per-device
// SQLite with nothing synced anywhere.
class WhatAgoraStoresScreen extends StatelessWidget {
  final VoidCallback onBack;
  const WhatAgoraStoresScreen({super.key, required this.onBack});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [IconButton(onPressed: onBack, icon: const Icon(Icons.chevron_left, size: 26, color: AgoraColors.textStrong)), const Text('What Agora stores', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AgoraColors.text))]),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(24, 10, 24, 30),
                children: [
                  _item('Messages', 'Every 1:1 and group message, stored only on this device.'),
                  _item('Files', "Transfers you've sent or received - filename, size, hash, and where a received file was saved."),
                  _item('Call history', 'Who, when, how long, and how each call ended.'),
                  _item('Known peers', "Names and public keys of anyone this device has ever exchanged a signed announcement with - what makes trust-on-first-use work across restarts."),
                  _item('Blocked peers', "Anyone you've blocked, so their frames keep getting dropped even if they reappear."),
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(18)),
                    child: const Text(
                      "All of it lives in one local SQLite database on this device. Nothing is uploaded, backed up, or synced anywhere - clearing a conversation or uninstalling the app removes it for good.",
                      style: TextStyle(fontSize: 13.5, color: Color(0xFF6B5C50), height: 1.5),
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

  Widget _item(String title, String body) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5, color: AgoraColors.text)),
          const SizedBox(height: 4),
          Text(body, style: const TextStyle(fontSize: 13.5, color: AgoraColors.text2, height: 1.5)),
        ],
      ),
    );
  }
}
