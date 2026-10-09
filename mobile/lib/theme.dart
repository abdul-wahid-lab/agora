import 'package:flutter/material.dart';

// Exact values pulled from the design file's mobile screens (ui prompt/
// Agora-standalone.html, screens 1.1-9.4) via computed inline styles, same
// extraction method BUILD_LOG documents for the desktop rebuild. These are
// the identical hex values as frontend/src/index.css's :root tokens - the
// mobile and desktop screens in the design file share one palette.
class AgoraColors {
  AgoraColors._();

  static const ground = Color(0xFFFBF7F2);
  static const surface = Color(0xFFFFFFFF);
  static const surface2 = Color(0xFFF3E8DD); // tip/info card fill
  static const border = Color(0xFFE3D9CE);
  static const borderSoft = Color(0xFFECDFD2);

  static const text = Color(0xFF2A2320);
  static const text2 = Color(0xFF7D7168);
  static const text3 = Color(0xFFA2968B);
  static const textStrong = Color(0xFF5D4F45);
  static const textMuted = Color(0xFF9A8C81);
  static const tipHeading = Color(0xFF6B5C50);

  static const accent = Color(0xFFE2703A);
  static const accentStrong = Color(0xFFC2562A);
  static const accentSoft = Color(0xFFFBE4D3);
  static const onAccent = Color(0xFFFFF8F2);

  static const avatarSelfBg = Color(0xFFF0D9C6);
  static const avatarSelfText = Color(0xFFC2562A);

  static const danger = Color(0xFFC2352A);
  static const dangerSoft = Color(0xFFF5DAD6);

  static const shuffleBg = Color(0xFF2A2320); // "Shuffle avatar" dark pill
  static const blockedCircle = Color(0xFF8C5A3C); // router-blocked avatar tint
  static const blockedLine = Color(0xFFC25C2A);

  static const icon2 = Color(0xFFB5A89C); // inactive bottom-tab icon stroke
  static const signalMuted = Color(0xFFEADBCD); // unfilled signal-strength bar
  static const stepChipBg = Color(0xFFFBE4D3); // numbered-step circle fill (troubleshooting)
  static const stepChipText = Color(0xFFC2562A);
  static const scrimDark = Color(0x6B2A2320); // quick-actions sheet backdrop scrim
}

// Same per-peer bg/text pairs as frontend/src/lib/avatar.js, so a given
// peer_id renders as the same color on phone and desktop.
class AvatarPaletteEntry {
  final Color bg;
  final Color text;
  const AvatarPaletteEntry(this.bg, this.text);
}

const List<AvatarPaletteEntry> kAvatarPalette = [
  AvatarPaletteEntry(Color(0xFFD8E0D2), Color(0xFF4C5A46)), // green
  AvatarPaletteEntry(Color(0xFFE6D6EA), Color(0xFF5C4A63)), // purple
  AvatarPaletteEntry(Color(0xFFF0E2C8), Color(0xFF6B5A34)), // yellow/tan
  AvatarPaletteEntry(Color(0xFFEAD9C9), Color(0xFF8A6A4A)), // warm tan
];

AvatarPaletteEntry paletteForPeer(String peerId) {
  int hash = 0;
  for (final codeUnit in peerId.codeUnits) {
    hash = (hash * 31 + codeUnit) & 0xFFFFFFFF;
  }
  return kAvatarPalette[hash % kAvatarPalette.length];
}

String initialsFor(String name) {
  final parts = name.trim().split(RegExp(r'[\s-]+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return "?";
  final first = parts[0].isNotEmpty ? parts[0][0] : "?";
  final second = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : "";
  return (first + second).toUpperCase();
}

const serifFamily = "Instrument Serif";
const sansFamily = "Hanken Grotesk";
const monoFamily = "IBM Plex Mono";

ThemeData buildAgoraTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: AgoraColors.ground,
    fontFamily: sansFamily,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AgoraColors.accent,
      primary: AgoraColors.accent,
      surface: AgoraColors.ground,
    ),
    textTheme: const TextTheme().apply(
      fontFamily: sansFamily,
      bodyColor: AgoraColors.text,
      displayColor: AgoraColors.text,
    ),
  );
}
