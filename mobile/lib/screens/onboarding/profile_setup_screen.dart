import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../theme.dart';

// Design screen 1.3 "Profile setup". Real functionality throughout: typing
// gates the Continue button exactly like the desktop's own Onboarding.jsx,
// "Shuffle avatar" actually cycles the same AVATAR_PALETTE the rest of the
// app uses for peer avatars, and "Choose photo" is a real OS image picker.
class ProfileSetupScreen extends StatefulWidget {
  final String networkName;
  final void Function(String name, int avatarIndex, String? photoPath) onContinue;

  const ProfileSetupScreen({super.key, required this.networkName, required this.onContinue});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final _controller = TextEditingController();
  int _avatarIndex = 0;
  String? _photoPath;

  @override
  void initState() {
    super.initState();
    _avatarIndex = DateTime.now().millisecondsSinceEpoch % kAvatarPalette.length;
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _shuffleAvatar() {
    setState(() {
      _avatarIndex = (_avatarIndex + 1 + DateTime.now().millisecond % 3) % kAvatarPalette.length;
      _photoPath = null; // a fresh shuffle replaces a chosen photo, matching "pick one or the other"
    });
  }

  Future<void> _choosePhoto() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery, maxWidth: 512, maxHeight: 512, imageQuality: 85);
    if (picked != null) {
      setState(() => _photoPath = picked.path);
    }
  }

  bool get _canContinue => _controller.text.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final palette = kAvatarPalette[_avatarIndex];
    final initial = _controller.text.trim().isNotEmpty ? _controller.text.trim()[0].toUpperCase() : "?";

    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(26, 24, 26, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      "Who should we say you are?",
                      style: TextStyle(fontFamily: serifFamily, fontSize: 36, height: 1.06, color: AgoraColors.text),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      "No account, no email, no password. This name is only visible to people on this network.",
                      style: TextStyle(fontSize: 15, color: AgoraColors.text2, height: 1.5),
                    ),
                    const SizedBox(height: 26),
                    Center(
                      child: Column(
                        children: [
                          ClipOval(
                            child: _photoPath != null
                                ? Image.file(File(_photoPath!), width: 112, height: 112, fit: BoxFit.cover)
                                : Container(
                                    width: 112,
                                    height: 112,
                                    color: palette.bg,
                                    alignment: Alignment.center,
                                    child: Text(initial, style: TextStyle(fontFamily: serifFamily, fontSize: 42, color: palette.text)),
                                  ),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              OutlinedButton(
                                onPressed: _choosePhoto,
                                style: OutlinedButton.styleFrom(
                                  backgroundColor: AgoraColors.surface,
                                  side: const BorderSide(color: AgoraColors.border),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(99)),
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                ),
                                child: const Text("Choose photo", style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AgoraColors.textStrong)),
                              ),
                              const SizedBox(width: 8),
                              ElevatedButton(
                                onPressed: _shuffleAvatar,
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AgoraColors.shuffleBg,
                                  foregroundColor: AgoraColors.ground,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(99)),
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                  elevation: 0,
                                ),
                                child: const Text("Shuffle avatar", style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 26),
                    const Text("DISPLAY NAME", style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: AgoraColors.text3)),
                    const SizedBox(height: 8),
                    Container(
                      height: 56,
                      padding: const EdgeInsets.symmetric(horizontal: 18),
                      decoration: BoxDecoration(
                        color: AgoraColors.surface,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: AgoraColors.accent, width: 1.5),
                      ),
                      alignment: Alignment.centerLeft,
                      child: TextField(
                        controller: _controller,
                        autofocus: true,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(border: InputBorder.none, hintText: "Your name", hintStyle: TextStyle(color: AgoraColors.text3)),
                        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: AgoraColors.text),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text("Others on ${widget.networkName} will see this.", style: const TextStyle(fontSize: 13, color: AgoraColors.textMuted)),
                    const SizedBox(height: 26),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: AgoraColors.surface2, borderRadius: BorderRadius.circular(18)),
                      child: const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text("No sign-up needed", style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: AgoraColors.textStrong)),
                          SizedBox(height: 6),
                          Text(
                            "Agora works the moment you're on a network. Nothing to verify, nothing stored anywhere else.",
                            style: TextStyle(fontSize: 13, color: AgoraColors.text2, height: 1.5),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(26, 16, 26, 34),
              child: SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton(
                  onPressed: _canContinue ? () => widget.onContinue(_controller.text.trim(), _avatarIndex, _photoPath) : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AgoraColors.accent,
                    foregroundColor: AgoraColors.onAccent,
                    disabledBackgroundColor: AgoraColors.accent.withValues(alpha: 0.4),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                    elevation: 0,
                  ),
                  child: const Text("Start looking around", style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
