import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../theme.dart';

// Design screen 1.2 "Permissions". Local network access has no distinct
// Android runtime permission to request (it's implied by INTERNET/
// multicast, already declared in the manifest) - what "Allow & continue"
// actually does for real is request the three permissions Android *does*
// gate: microphone, camera, notifications. A decline on any one doesn't
// block onboarding; Agora's own design already says each permission is
// used only when its feature is actually invoked (mic only while in a
// call, etc.), so this screen's job is asking once, honestly, not
// enforcing anything.
class PermissionsScreen extends StatelessWidget {
  final VoidCallback onContinue;
  final VoidCallback onSkip;

  const PermissionsScreen({super.key, required this.onContinue, required this.onSkip});

  Future<void> _requestAll() async {
    await [Permission.microphone, Permission.camera, Permission.notification].request();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 26),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    "A few things Agora needs",
                    style: TextStyle(fontFamily: serifFamily, fontSize: 34, height: 1.06, color: AgoraColors.text),
                  ),
                  const SizedBox(height: 9),
                  const Text(
                    "Nothing leaves this network. Here's exactly what each one is for.",
                    style: TextStyle(fontSize: 15, color: AgoraColors.text2, height: 1.5),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 26),
                child: Column(
                  children: [
                    _PermissionCard(icon: _dotIcon(), title: "Local network access", body: "So Agora can find people near you. Required."),
                    const SizedBox(height: 12),
                    _PermissionCard(icon: _micIcon(), title: "Microphone", body: "For voice calls. Only on while you're in a call."),
                    const SizedBox(height: 12),
                    _PermissionCard(icon: _cameraIcon(), title: "Camera", body: "For video calls. Skip it and audio still works."),
                    const SizedBox(height: 12),
                    _PermissionCard(icon: _bellIcon(), title: "Notifications", body: "So you know when someone nearby messages you."),
                    const SizedBox(height: 16),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                      decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(16)),
                      child: const Text(
                        "Local network permission looks unusual because it is — it's what lets Agora work with no servers at all.",
                        style: TextStyle(fontSize: 13, color: AgoraColors.tipHeading, height: 1.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(26, 16, 26, 34),
              child: Column(
                children: [
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: ElevatedButton(
                      onPressed: () async {
                        await _requestAll();
                        onContinue();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AgoraColors.accent,
                        foregroundColor: AgoraColors.onAccent,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                        elevation: 0,
                      ),
                      child: const Text("Allow & continue", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: onSkip,
                    child: const Text("Decide each one later", style: TextStyle(fontSize: 14, color: AgoraColors.textMuted, fontWeight: FontWeight.w500)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static Widget _dotIcon() => Container(width: 12, height: 12, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent));
  static Widget _micIcon() => Container(width: 10, height: 16, decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(6)));
  static Widget _cameraIcon() => Container(width: 16, height: 11, decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(4)));
  static Widget _bellIcon() => Container(width: 14, height: 14, decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(5)));
}

class _PermissionCard extends StatelessWidget {
  final Widget icon;
  final String title;
  final String body;

  const _PermissionCard({required this.icon, required this.title, required this.body});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgoraColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AgoraColors.borderSoft),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: AgoraColors.accentSoft, borderRadius: BorderRadius.circular(12)),
            alignment: Alignment.center,
            child: icon,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: AgoraColors.text)),
                const SizedBox(height: 3),
                Text(body, style: const TextStyle(fontSize: 13.5, color: AgoraColors.text2, height: 1.45)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
