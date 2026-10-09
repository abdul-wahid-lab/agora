import 'package:flutter/material.dart';

import '../../theme.dart';
import '../../widgets/presence_ring.dart';

// Design screen 1.1 "Splash". The design's own spec ("Auto-transitions after
// checking permissions/network state") is honored literally: this isn't a
// fixed-timer splash, `onDone` fires once the real local-storage/permission
// checks this app actually needs to do are finished, with a floor so the
// animation is never skipped so fast it reads as a glitch rather than a
// screen.
class SplashScreen extends StatefulWidget {
  final Future<void> Function() onCheck;
  final VoidCallback onDone;

  const SplashScreen({super.key, required this.onCheck, required this.onDone});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    final minDisplay = Future.delayed(const Duration(milliseconds: 1100));
    await widget.onCheck();
    await minDisplay;
    if (mounted) widget.onDone();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgoraColors.accent,
      body: Stack(
        children: [
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 96,
                  height: 96,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      const PresenceRings(size: 96, color: AgoraColors.onAccent),
                      Container(
                        width: 56,
                        height: 56,
                        decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.onAccent),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 26),
                const Text(
                  "Agora",
                  style: TextStyle(fontFamily: serifFamily, fontSize: 56, color: Color(0xFFFFF8F2), letterSpacing: -0.5, height: 1),
                ),
                const SizedBox(height: 26),
                const Text(
                  "Talk to who's around you.",
                  style: TextStyle(fontSize: 17, color: Color(0xFFFDE8DA), fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 52,
            child: Center(
              child: BlinkText(
                text: "checking network…",
                style: const TextStyle(fontFamily: monoFamily, fontSize: 12, fontWeight: FontWeight.w500, color: Color(0xFFF7C9AB)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
