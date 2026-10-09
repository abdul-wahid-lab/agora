import 'dart:async';

import 'package:flutter/material.dart';

import '../../backend/storage.dart' as storage;
import '../../theme.dart';
import '../../util/file_display.dart';

// Design 8.5. Shown before accepting any incoming file flagged
// is_executable (filetransfer.dart's own real isExecutableFile check - the
// same extension list the backend already screens with, not a UI-only
// guess). "known X days, Y messages" and the sha256 prefix are both real,
// computed from this device's own stored history with that peer - nothing
// here is invented. The CTA is labeled "Download anyway" rather than the
// design's "Install anyway": tapping it only accepts the transfer
// (filetransfer.dart's accept()) - actually installing the package is a
// separate, later OS action the person takes themselves by opening it.
class SecurityInterstitialScreen extends StatefulWidget {
  final storage.FileRecord record;
  final String peerName;
  final int knownDays;
  final int messageCount;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  const SecurityInterstitialScreen({
    super.key,
    required this.record,
    required this.peerName,
    required this.knownDays,
    required this.messageCount,
    required this.onAccept,
    required this.onDecline,
  });

  @override
  State<SecurityInterstitialScreen> createState() => _SecurityInterstitialScreenState();
}

class _SecurityInterstitialScreenState extends State<SecurityInterstitialScreen> {
  bool _checkKnown = false;
  bool _checkUnderstand = false;
  bool _unlocked = false;

  @override
  void initState() {
    super.initState();
    Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _unlocked = true);
    });
  }

  bool get _canProceed => _checkKnown && _checkUnderstand && _unlocked;

  @override
  Widget build(BuildContext context) {
    final shortId = widget.record.peerId.length > 8 ? widget.record.peerId.substring(0, 8) : widget.record.peerId;
    final sha = widget.record.sha256;
    final shaShort = sha.length > 10 ? '${sha.substring(0, 6)}…${sha.substring(sha.length - 4)}' : sha;
    return Scaffold(
      backgroundColor: const Color(0xFF2A2320),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 14, 24, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(color: const Color(0xFFC2352A), borderRadius: BorderRadius.circular(18)),
                      alignment: Alignment.center,
                      child: const Text('!', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w700, color: Colors.white)),
                    ),
                    const SizedBox(height: 14),
                    const Text('This file can install software on your phone', style: TextStyle(fontFamily: serifFamily, fontSize: 32, color: Color(0xFFF9F1E8), height: 1.1)),
                    const SizedBox(height: 10),
                    const Text(
                      "Agora delivered it exactly as sent — but it can't tell you what's inside. An installable package can change or damage your device.",
                      style: TextStyle(fontSize: 14.5, color: Color(0xFFB5A396), height: 1.55),
                    ),
                    const SizedBox(height: 18),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.07), borderRadius: BorderRadius.circular(20)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(14)),
                                alignment: Alignment.center,
                                child: Text(fileTypeBadge(widget.record.filename), style: const TextStyle(fontFamily: monoFamily, fontSize: 10, fontWeight: FontWeight.w600, color: Color(0xFFF9F1E8))),
                              ),
                              const SizedBox(width: 13),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(widget.record.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: Color(0xFFF9F1E8))),
                                    Text('${humanFileSize(widget.record.size)} · Android package', style: const TextStyle(fontFamily: monoFamily, fontSize: 11.5, color: Color(0xFFA3948A))),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Container(height: 1, color: Colors.white.withValues(alpha: 0.1)),
                          const SizedBox(height: 12),
                          Text(
                            'sender  ${widget.peerName} ($shortId)\nknown   ${widget.knownDays == 0 ? 'today' : '${widget.knownDays} day${widget.knownDays == 1 ? '' : 's'}'}, ${widget.messageCount} message${widget.messageCount == 1 ? '' : 's'}\nsha256  $shaShort',
                            style: const TextStyle(fontFamily: monoFamily, fontSize: 12.5, height: 1.7, color: Color(0xFFA3948A)),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                    _checkRow('I know ${widget.peerName.split(' ').first} personally and expected this file.', _checkKnown, (v) => setState(() => _checkKnown = v)),
                    const SizedBox(height: 11),
                    _checkRow('I understand this app will be able to run on my device.', _checkUnderstand, (v) => setState(() => _checkUnderstand = v)),
                    const SizedBox(height: 14),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 14, 24, 28),
              child: Column(
                children: [
                  GestureDetector(
                    onTap: _canProceed ? widget.onAccept : null,
                    child: Container(
                      height: 54,
                      decoration: BoxDecoration(
                        color: _canProceed ? const Color(0xFFC2352A) : const Color(0xFFC2352A).withValues(alpha: 0.25),
                        border: Border.all(color: const Color(0xFFC2352A).withValues(alpha: _canProceed ? 1 : 0.5)),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      alignment: Alignment.center,
                      child: Text('Download anyway', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: _canProceed ? Colors.white : const Color(0xFFD9A49D))),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    !_unlocked ? 'Both boxes must be ticked · button unlocks after 3 s' : 'Both boxes must be ticked',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF7F7166)),
                  ),
                  const SizedBox(height: 11),
                  GestureDetector(
                    onTap: widget.onDecline,
                    child: Container(
                      height: 54,
                      decoration: BoxDecoration(color: const Color(0xFFF9F1E8), borderRadius: BorderRadius.circular(18)),
                      alignment: Alignment.center,
                      child: const Text('Keep it closed', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Color(0xFF2A2320))),
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

  Widget _checkRow(String label, bool value, void Function(bool) onChanged) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 22,
            height: 22,
            margin: const EdgeInsets.only(top: 1),
            decoration: BoxDecoration(
              color: value ? AgoraColors.accent : Colors.transparent,
              borderRadius: BorderRadius.circular(7),
              border: Border.all(color: value ? AgoraColors.accent : const Color(0xFF7F7166), width: 2),
            ),
            alignment: Alignment.center,
            child: value ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: const TextStyle(fontSize: 14, color: Color(0xFFD7C8BB), height: 1.45))),
        ],
      ),
    );
  }
}
