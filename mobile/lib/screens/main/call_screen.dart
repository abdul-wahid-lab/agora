import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../backend/calling.dart' as calling;
import '../../backend/latency.dart' as lat;
import '../../backend/webrtc_call.dart' as webrtc;
import '../../theme.dart';
import '../../widgets/presence_ring.dart';

// Design 5.1/5.2/5.2b/5.3/5.4/5.5. One screen covers every call phase,
// mirroring calling.dart's own real state machine (ringing -> in_call ->
// ended) rather than separate screens that would need to agree with each
// other about whose job state transitions are. Mute/speaker/camera-flip
// are real device operations (track.enabled, Helper.setSpeakerphoneOn/
// switchCamera) - nothing here is a decorative toggle.
class CallScreen extends StatefulWidget {
  final calling.CallService callService;
  final webrtc.WebrtcCallManager webrtcManager;
  final lat.LatencyService latency;
  final String peerId;
  final String peerName;
  final String media; // 'audio' | 'video'
  final String direction; // 'outgoing' | 'incoming'
  final String? callId; // set for incoming (offer already carries one)
  final Map<String, dynamic>? offerSdp; // set for incoming

  const CallScreen({
    super.key,
    required this.callService,
    required this.webrtcManager,
    required this.latency,
    required this.peerId,
    required this.peerName,
    required this.media,
    required this.direction,
    this.callId,
    this.offerSdp,
  });

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  String? _callId;
  String _phase = 'connecting'; // connecting | ringing | active | ended
  String _endReason = 'ended';
  bool _videoOn = false;
  bool _muted = false;
  bool _speakerOn = true;
  double? _connectedAt;
  Timer? _poll;
  Timer? _clockTick;
  final _localRenderer = RTCVideoRenderer();
  final _remoteRenderer = RTCVideoRenderer();
  bool _renderersReady = false;
  bool _hasRemoteStream = false;

  @override
  void initState() {
    super.initState();
    _videoOn = widget.media == 'video';
    unawaited(_init());
  }

  Future<void> _init() async {
    await _localRenderer.initialize();
    await _remoteRenderer.initialize();
    if (mounted) setState(() => _renderersReady = true);

    if (widget.direction == 'incoming') {
      _callId = widget.callId;
      setState(() => _phase = 'ringing');
    } else {
      setState(() => _phase = 'connecting');
      try {
        final callId = await widget.webrtcManager.placeCall(widget.peerId, widget.media);
        _callId = callId;
        if (mounted) setState(() => _phase = 'ringing');
      } catch (_) {
        if (mounted) setState(() => _phase = 'ended');
        return;
      }
    }

    _poll = Timer.periodic(const Duration(milliseconds: 350), (_) => _tick());
    _clockTick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  void _tick() {
    if (!mounted || _callId == null) return;
    final state = widget.callService.get(_callId!);
    if (state == null) return;

    if (state.status == 'in_call' && _phase != 'active') {
      setState(() {
        _phase = 'active';
        _connectedAt = state.connectedAt;
      });
    } else if (state.status == 'ended' && _phase != 'ended') {
      setState(() {
        _phase = 'ended';
        _endReason = state.endReason ?? 'ended';
      });
    }

    if (!_hasRemoteStream) {
      final active = widget.webrtcManager.activeCallFor(_callId!);
      if (active?.remoteStream != null) {
        _remoteRenderer.srcObject = active!.remoteStream;
        _localRenderer.srcObject = active.localStream;
        _hasRemoteStream = true;
        if (mounted) setState(() {});
      }
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _clockTick?.cancel();
    _localRenderer.dispose();
    _remoteRenderer.dispose();
    super.dispose();
  }

  void _toggleMute() {
    final active = _callId == null ? null : widget.webrtcManager.activeCallFor(_callId!);
    final audioTracks = active?.localStream.getAudioTracks() ?? [];
    for (final t in audioTracks) {
      t.enabled = _muted;
    }
    setState(() => _muted = !_muted);
  }

  void _toggleSpeaker() {
    setState(() => _speakerOn = !_speakerOn);
    unawaited(Helper.setSpeakerphoneOn(_speakerOn));
  }

  void _flipCamera() {
    final active = _callId == null ? null : widget.webrtcManager.activeCallFor(_callId!);
    final videoTracks = active?.localStream.getVideoTracks() ?? [];
    if (videoTracks.isNotEmpty) unawaited(Helper.switchCamera(videoTracks.first));
  }

  Future<void> _accept() async {
    if (_callId == null || widget.offerSdp == null) return;
    setState(() => _phase = 'connecting');
    await widget.webrtcManager.answerIncoming(_callId!, widget.offerSdp!, widget.media);
  }

  Future<void> _hangUp({String reason = 'ended'}) async {
    if (_callId != null) {
      await widget.webrtcManager.hangUp(_callId!, reason: reason);
    }
    if (mounted) setState(() => _phase = 'ended');
    unawaited(Future.delayed(const Duration(milliseconds: 1400), () {
      if (mounted) Navigator.of(context).pop();
    }));
  }

  String get _elapsed {
    if (_connectedAt == null) return '00:00';
    final secs = (DateTime.now().millisecondsSinceEpoch / 1000.0 - _connectedAt!).round().clamp(0, 999999);
    final m = (secs ~/ 60).toString().padLeft(2, '0');
    final s = (secs % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    if (_phase == 'ended') return _buildEnded();
    if (_phase == 'active' && _videoOn) return _buildActiveVideo();
    return _buildVoiceLike();
  }

  // -- ringing / connecting / active-audio: shared dark avatar layout ------

  Widget _buildVoiceLike() {
    final palette = paletteForPeer(widget.peerId);
    final ringing = _phase == 'ringing' || _phase == 'connecting';
    return Scaffold(
      backgroundColor: const Color(0xFF2A2320),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 4, 28, 0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(TimeOfDay.now().format(context), style: const TextStyle(color: Color(0xFFF5ECE3), fontWeight: FontWeight.w600, fontSize: 14)),
                ],
              ),
            ),
            SizedBox(height: _phase == 'active' ? 76 : 80),
            SizedBox(
              width: 180,
              height: 180,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  if (ringing) ...[
                    PresenceRings(size: 180, color: AgoraColors.accent, strokeWidth: 2, period: const Duration(milliseconds: 2800), stagger: const Duration(milliseconds: 900)),
                  ] else
                    PresenceRings(size: 170, color: AgoraColors.accent.withValues(alpha: 0.45), strokeWidth: 1.5, period: const Duration(milliseconds: 3400)),
                  CircleAvatar(
                    backgroundColor: palette.bg,
                    radius: 70,
                    child: Text(initialsFor(widget.peerName), style: TextStyle(fontFamily: serifFamily, fontSize: 52, color: palette.text)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 34),
            Text(widget.peerName, style: const TextStyle(fontFamily: serifFamily, fontSize: 38, color: Color(0xFFF9F1E8))),
            const SizedBox(height: 12),
            if (_phase == 'active')
              Text(_elapsed, style: const TextStyle(fontFamily: monoFamily, fontSize: 20, color: Color(0xFFC0AD9E), fontWeight: FontWeight.w500))
            else
              Text(
                widget.direction == 'outgoing' ? 'Calling…' : 'Incoming ${widget.media} call',
                style: const TextStyle(fontSize: 16, color: Color(0xFFC0AD9E), fontWeight: FontWeight.w500),
              ),
            const SizedBox(height: 12),
            if (_phase != 'active') _buildStatusPill(widget.direction == 'outgoing' ? 'Ringing on this network' : 'Calling from this network'),
            if (_phase == 'active') _buildQualityPill(),
            const Spacer(),
            Padding(
              padding: const EdgeInsets.only(bottom: 52),
              child: _phase == 'ringing' && widget.direction == 'incoming' ? _buildIncomingControls() : _buildOutgoingOrActiveControls(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusPill(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      decoration: BoxDecoration(color: AgoraColors.accent.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(99)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 7, height: 7, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent)),
          const SizedBox(width: 7),
          Text(text, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFFF0B591))),
        ],
      ),
    );
  }

  Widget _buildQualityPill() {
    final sample = widget.latency.latest[widget.peerId];
    final rtt = sample?.rttMs;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(color: AgoraColors.accent.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(99)),
      child: Text(
        rtt != null ? 'Local connection — ${rtt.round()} ms' : 'Local connection',
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFF0B591)),
      ),
    );
  }

  Widget _buildIncomingControls() {
    return Column(
      children: [
        Wrap(
          spacing: 9,
          alignment: WrapAlignment.center,
          children: [
            _chip("Can't talk now", () => unawaited(_hangUp(reason: 'declined'))),
            _chip("Two minutes", () => unawaited(_hangUp(reason: 'declined'))),
            _chip("Message instead", () => unawaited(_hangUp(reason: 'declined'))),
          ],
        ),
        const SizedBox(height: 24),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _roundAction(color: const Color(0xFFC2352A), onTap: () => unawaited(_hangUp(reason: 'declined')), label: 'Decline', child: _hangupIcon()),
            _roundAction(color: const Color(0xFF4D7A4A), onTap: () => unawaited(_accept()), label: 'Accept', child: _acceptIcon()),
          ],
        ),
      ],
    );
  }

  Widget _chip(String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(99)),
        child: Text(label, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: Color(0xFFE2D5C9))),
      ),
    );
  }

  Widget _buildOutgoingOrActiveControls() {
    final active = _phase == 'active';
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _circleToggle(active: _muted, onTap: active || _phase != 'connecting' ? _toggleMute : null, child: _micIcon()),
            const SizedBox(width: 18),
            if (active) ...[
              _circleToggle(active: _speakerOn, onTap: _toggleSpeaker, child: _speakerIcon(), filled: _speakerOn, label: 'Speaker'),
              const SizedBox(width: 18),
            ],
            _circleToggle(active: false, onTap: () => _showNotSupported(context), child: _videoIcon()),
          ],
        ),
        const SizedBox(height: 28),
        GestureDetector(
          onTap: () => unawaited(_hangUp(reason: 'ended')),
          child: Container(
            width: 74,
            height: 74,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFC2352A)),
            alignment: Alignment.center,
            child: _hangupIcon(),
          ),
        ),
        if (!active) ...[
          const SizedBox(height: 12),
          GestureDetector(onTap: () => unawaited(_hangUp(reason: 'ended')), child: const Text('Cancel', style: TextStyle(fontSize: 14, color: Color(0xFF8D7D70), fontWeight: FontWeight.w500))),
        ],
      ],
    );
  }

  void _showNotSupported(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Switching to video mid-call isn't supported yet.")));
  }

  Widget _circleToggle({required bool active, required VoidCallback? onTap, required Widget child, bool filled = false, String? label}) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 62,
            height: 62,
            decoration: BoxDecoration(shape: BoxShape.circle, color: filled ? const Color(0xFFF9F1E8) : Colors.white.withValues(alpha: 0.1)),
            alignment: Alignment.center,
            child: filled ? IconTheme(data: const IconThemeData(color: Color(0xFF2A2320)), child: child) : child,
          ),
        ],
      ),
    );
  }

  Widget _micIcon() => Container(width: 10, height: 16, decoration: BoxDecoration(color: const Color(0xFFF9F1E8), borderRadius: BorderRadius.circular(6)));
  Widget _speakerIcon() => Container(width: 18, height: 18, decoration: BoxDecoration(color: const Color(0xFF2A2320), borderRadius: BorderRadius.circular(5)));
  Widget _videoIcon() => Container(width: 22, height: 15, decoration: BoxDecoration(borderRadius: BorderRadius.circular(5), border: Border.all(color: const Color(0xFFF9F1E8), width: 2.2)));
  Widget _hangupIcon() => Transform.rotate(angle: 2.32, child: Container(width: 26, height: 26, decoration: BoxDecoration(borderRadius: BorderRadius.circular(9), border: Border.all(color: Colors.white, width: 3))));
  Widget _acceptIcon() => Transform.rotate(angle: -0.14, child: Container(width: 26, height: 26, decoration: BoxDecoration(borderRadius: BorderRadius.circular(9), border: Border.all(color: Colors.white, width: 3))));

  Widget _roundAction({required Color color, required VoidCallback onTap, required String label, required Widget child}) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(width: 74, height: 74, decoration: BoxDecoration(shape: BoxShape.circle, color: color), alignment: Alignment.center, child: child),
          const SizedBox(height: 10),
          Text(label, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: Color(0xFFA3948A))),
        ],
      ),
    );
  }

  // -- active video -----------------------------------------------------

  Widget _buildActiveVideo() {
    return Scaffold(
      backgroundColor: const Color(0xFF453A34),
      body: Stack(
        children: [
          Positioned.fill(
            child: _hasRemoteStream && _renderersReady
                ? RTCVideoView(_remoteRenderer, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover)
                : Center(
                    child: Text("Connecting ${widget.peerName}'s video…", style: const TextStyle(fontFamily: monoFamily, fontSize: 12, color: Color(0xFFB3A298), letterSpacing: 1.1)),
                  ),
          ),
          SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 6),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
                        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.55), borderRadius: BorderRadius.circular(99)),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(width: 7, height: 7, decoration: const BoxDecoration(shape: BoxShape.circle, color: AgoraColors.accent)),
                            const SizedBox(width: 8),
                            const Text('Local connection', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFFF7E8DC))),
                          ],
                        ),
                      ),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.55), borderRadius: BorderRadius.circular(99)),
                        child: Text(_elapsed, style: const TextStyle(fontFamily: monoFamily, fontSize: 13, color: Color(0xFFF7E8DC))),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: Align(
                    alignment: Alignment.topRight,
                    child: Padding(
                      padding: const EdgeInsets.only(right: 18, top: 16),
                      child: Container(
                        width: 104,
                        height: 152,
                        decoration: BoxDecoration(borderRadius: BorderRadius.circular(22), border: Border.all(color: Colors.white.withValues(alpha: 0.5), width: 2)),
                        clipBehavior: Clip.antiAlias,
                        child: _renderersReady ? RTCVideoView(_localRenderer, mirror: true, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover) : Container(color: const Color(0xFF5C4D44)),
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 36),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(26)),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _videoBtn(_micIcon(), _toggleMute),
                            _videoBtn(_videoIcon(), _flipCamera),
                            _videoBtn(const Icon(Icons.flip_camera_ios_outlined, color: Color(0xFFF9F1E8), size: 18), _flipCamera),
                            _videoBtn(const Icon(Icons.fullscreen_exit, color: Color(0xFFF9F1E8), size: 18), () {}),
                            GestureDetector(
                              onTap: () => unawaited(_hangUp(reason: 'ended')),
                              child: Container(width: 52, height: 52, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFC2352A)), alignment: Alignment.center, child: _hangupIcon()),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _videoBtn(Widget icon, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(width: 52, height: 52, decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: 0.14)), alignment: Alignment.center, child: icon),
    );
  }

  // -- ended ---------------------------------------------------------------

  Widget _buildEnded() {
    final palette = paletteForPeer(widget.peerId);
    final hadDuration = _connectedAt != null;
    final durationText = hadDuration ? _elapsed : null;
    return Scaffold(
      backgroundColor: const Color(0xFF2A2320),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(backgroundColor: palette.bg, radius: 55, child: Text(initialsFor(widget.peerName), style: TextStyle(fontFamily: serifFamily, fontSize: 40, color: palette.text))),
            const SizedBox(height: 26),
            const Text('Call ended', style: TextStyle(fontFamily: serifFamily, fontSize: 32, color: Color(0xFFF9F1E8))),
            const SizedBox(height: 8),
            Text(
              durationText != null ? '$durationText with ${widget.peerName.split(' ').first}' : _endReasonLabel(_endReason),
              style: const TextStyle(fontFamily: monoFamily, fontSize: 15, color: Color(0xFFA3948A)),
            ),
            const SizedBox(height: 26),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _pillBtn('Call again', () {
                  Navigator.of(context).pop();
                }),
                const SizedBox(width: 10),
                _pillBtn('Back to chat', () => Navigator.of(context).pop()),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _endReasonLabel(String reason) {
    switch (reason) {
      case 'declined':
        return "${widget.peerName.split(' ').first} declined";
      case 'busy':
        return "${widget.peerName.split(' ').first} is on another call";
      case 'collision':
        return 'Call crossed with theirs';
      case 'failed':
        return "Couldn't reach ${widget.peerName.split(' ').first}";
      case 'dropped':
        return 'Connection dropped';
      default:
        return 'Call ended';
    }
  }

  Widget _pillBtn(String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99)),
        child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFFF0E4D8))),
      ),
    );
  }
}
