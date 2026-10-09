import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../backend/calling.dart' as calling;
import '../../backend/discovery.dart' as disc;
import '../../backend/filetransfer.dart' as ft;
import '../../backend/latency.dart' as lat;
import '../../backend/messaging.dart' as msging;
import '../../backend/storage.dart' as storage;
import '../../backend/webrtc_call.dart' as webrtc;
import '../../theme.dart';
import '../../widgets/file_bubble.dart';
import '../../widgets/presence_ring.dart';
import 'call_screen.dart';
import 'file_send_confirm_sheet.dart';
import 'received_file_actions_sheet.dart';
import 'security_interstitial_screen.dart';

// Design 4.2 + 8.x. Messages and files are two separate real tables
// (storage.dart keeps them apart, same as the desktop) - this screen's
// only job beyond either one is interleaving them into one timeline by
// timestamp, the way a real chat reads. No "Seen" receipt anywhere (the
// wire protocol only ever acks delivery, never a read receipt).
class ChatScreen extends StatefulWidget {
  final storage.MessageStore store;
  final msging.MessagingService messaging;
  final disc.PeerDiscovery discovery;
  final calling.CallService callService;
  final webrtc.WebrtcCallManager webrtcManager;
  final lat.LatencyService latency;
  final ft.FileTransferService fileTransfer;
  final Map<String, String> completionCaptions;
  final String peerId;
  final String peerName;
  final VoidCallback onBack;
  final VoidCallback onOpenInfo;

  const ChatScreen({
    super.key,
    required this.store,
    required this.messaging,
    required this.discovery,
    required this.callService,
    required this.webrtcManager,
    required this.latency,
    required this.fileTransfer,
    required this.completionCaptions,
    required this.peerId,
    required this.peerName,
    required this.onBack,
    required this.onOpenInfo,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _TimelineItem {
  final double ts;
  final storage.Message? message;
  final storage.FileRecord? file;
  _TimelineItem.msg(this.message) : ts = message!.ts, file = null;
  _TimelineItem.file(this.file) : ts = file!.ts, message = null;
}

class _ChatScreenState extends State<ChatScreen> {
  List<_TimelineItem> _timeline = [];
  Timer? _ticker;
  final _controller = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
    _ticker = Timer.periodic(const Duration(seconds: 2), (_) => unawaited(_refresh()));
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final messages = await widget.store.history(widget.peerId, limit: 200);
    final files = await widget.store.listFiles(widget.peerId);
    if (!mounted) return;
    final items = [...messages.map(_TimelineItem.msg), ...files.map(_TimelineItem.file)];
    items.sort((a, b) => a.ts.compareTo(b.ts));
    setState(() => _timeline = items);
  }

  Future<void> _send() async {
    final body = _controller.text.trim();
    if (body.isEmpty) return;
    _controller.clear();
    await widget.messaging.send(widget.peerId, body);
    await _refresh();
    _scrollToEnd();
  }

  void _scrollToEnd() {
    if (_scrollController.hasClients) {
      unawaited(_scrollController.animateTo(_scrollController.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut));
    }
  }

  void _placeCall(String media) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => CallScreen(
        callService: widget.callService,
        webrtcManager: widget.webrtcManager,
        latency: widget.latency,
        peerId: widget.peerId,
        peerName: widget.peerName,
        media: media,
        direction: 'outgoing',
      ),
    ));
  }

  // -- attach / send -------------------------------------------------------

  Future<void> _pickAndSendFiles() async {
    final result = await FilePicker.pickFiles();
    final files = result.where((f) => f.path != null).map((f) => File(f.path!)).toList();
    if (files.isEmpty || !mounted) return;
    await FileSendConfirmSheet.show(
      context,
      files: files,
      peerName: widget.peerName,
      onSend: (chosen) {
        for (final f in chosen) {
          unawaited(widget.fileTransfer.sendFile(widget.peerId, f).then((_) => _refresh()));
        }
        unawaited(_refresh());
      },
    );
  }

  // -- receiving -------------------------------------------------------

  Future<void> _acceptOffer(storage.FileRecord record) async {
    if (record.isExecutable) {
      final messages = await widget.store.history(widget.peerId, limit: 100000);
      final earliest = await _earliestInteractionTs();
      final days = earliest == null ? 0 : ((DateTime.now().millisecondsSinceEpoch / 1000.0 - earliest) / 86400).floor();
      if (!mounted) return;
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => SecurityInterstitialScreen(
          record: record,
          peerName: widget.peerName,
          knownDays: days.clamp(0, 999999),
          messageCount: messages.length,
          onAccept: () {
            Navigator.of(context).pop();
            unawaited(widget.fileTransfer.accept(record.transferId).then((_) => _refresh()));
          },
          onDecline: () {
            Navigator.of(context).pop();
            unawaited(widget.fileTransfer.decline(record.transferId).then((_) => _refresh()));
          },
        ),
      ));
      return;
    }
    await widget.fileTransfer.accept(record.transferId);
    await _refresh();
  }

  Future<double?> _earliestInteractionTs() async {
    final messages = await widget.store.history(widget.peerId, limit: 100000);
    final files = await widget.store.listFiles(widget.peerId);
    double? earliest;
    for (final m in messages) {
      if (earliest == null || m.ts < earliest) earliest = m.ts;
    }
    for (final f in files) {
      if (earliest == null || f.ts < earliest) earliest = f.ts;
    }
    return earliest;
  }

  void _openCompletedFile(storage.FileRecord record) {
    if (record.direction != 'received') return;
    ReceivedFileActionsSheet.show(
      context,
      record: record,
      peerName: widget.peerName,
      networkName: 'this network',
      completionCaption: widget.completionCaptions[record.transferId],
      nearbyPeers: widget.discovery.registry.list(),
      onForward: (peer) {
        final path = record.savedPath;
        if (path == null) return;
        unawaited(widget.fileTransfer.sendFile(peer.peerId, File(path)));
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Forwarding to ${peer.name}…')));
      },
      onDeleted: () {
        unawaited(widget.store.deleteFile(record.transferId).then((_) => _refresh()));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final online = widget.discovery.registry.list().any((p) => p.peerId == widget.peerId);
    final palette = paletteForPeer(widget.peerId);

    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(10, 4, 18, 12),
              decoration: const BoxDecoration(color: Color(0xFFFDFAF6), border: Border(bottom: BorderSide(color: Color(0xFFEEE3D8)))),
              child: Row(
                children: [
                  IconButton(onPressed: widget.onBack, icon: const Icon(Icons.chevron_left, color: AgoraColors.textStrong, size: 26)),
                  Expanded(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(14),
                      onTap: widget.onOpenInfo,
                      child: Row(
                        children: [
                          SizedBox(
                            width: 40,
                            height: 40,
                            child: Stack(
                              alignment: Alignment.center,
                              children: [
                                if (online) PresenceRings(size: 40, color: AgoraColors.accent, strokeWidth: 2),
                                CircleAvatar(backgroundColor: palette.bg, radius: 20, child: Text(initialsFor(widget.peerName), style: TextStyle(color: palette.text, fontWeight: FontWeight.w600, fontSize: 14))),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(widget.peerName, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: AgoraColors.text)),
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Container(width: 6, height: 6, decoration: BoxDecoration(shape: BoxShape.circle, color: online ? AgoraColors.accent : const Color(0xFFB5A89C))),
                                    const SizedBox(width: 6),
                                    Text(online ? "On this network" : "Not on this network right now", style: const TextStyle(fontSize: 12.5, color: AgoraColors.text2, fontWeight: FontWeight.w500)),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  IconButton(onPressed: () => _placeCall('audio'), icon: const Icon(Icons.call_outlined, color: AgoraColors.textStrong, size: 20)),
                  IconButton(onPressed: () => _placeCall('video'), icon: const Icon(Icons.videocam_outlined, color: AgoraColors.textStrong, size: 22)),
                ],
              ),
            ),
            Expanded(
              child: _timeline.isEmpty
                  ? Center(child: Text("Say hello to ${widget.peerName}", style: const TextStyle(fontFamily: serifFamily, fontSize: 20, color: AgoraColors.text3)))
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(18),
                      itemCount: _timeline.length + (online ? 0 : 1),
                      itemBuilder: (context, i) {
                        if (i == _timeline.length) {
                          return Container(
                            alignment: Alignment.center,
                            margin: const EdgeInsets.only(top: 6),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                            decoration: BoxDecoration(color: const Color(0xFFF5EFE7), borderRadius: BorderRadius.circular(14)),
                            child: Text(
                              "${widget.peerName} left the network — your messages will send when they're back.",
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 13, color: AgoraColors.text2, height: 1.45),
                            ),
                          );
                        }
                        final item = _timeline[i];
                        if (item.message != null) {
                          return _MessageBubble(message: item.message!, peerName: widget.peerName);
                        }
                        final record = item.file!;
                        final mine = record.direction == 'sent';
                        return FileBubble(
                          record: record,
                          mine: mine,
                          liveStats: widget.fileTransfer.getTransferStats(record.transferId),
                          completionCaption: widget.completionCaptions[record.transferId],
                          onAccept: !mine && record.status == 'awaiting_accept' ? () => unawaited(_acceptOffer(record)) : null,
                          onDecline: !mine && record.status == 'awaiting_accept' ? () => unawaited(widget.fileTransfer.decline(record.transferId).then((_) => _refresh())) : null,
                          onCancel: (record.status == 'transferring' || record.status == 'offered' || record.status == 'accepted') ? () => unawaited(widget.fileTransfer.cancel(record.transferId).then((_) => _refresh())) : null,
                          onRetry: mine && record.status == 'failed' ? () => unawaited(widget.fileTransfer.resend(record.transferId).then((_) => _refresh()).catchError((_) => _refresh())) : null,
                          onSendAgain: mine && record.status == 'cancelled' ? () => unawaited(widget.fileTransfer.resend(record.transferId).then((_) => _refresh()).catchError((_) => _notBuiltYetResend())) : null,
                          onOpen: record.status == 'completed' ? () => _openCompletedFile(record) : null,
                        );
                      },
                    ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
              decoration: const BoxDecoration(color: Color(0xFFFDFAF6), border: Border(top: BorderSide(color: Color(0xFFEEE3D8)))),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => unawaited(_pickAndSendFiles()),
                    child: Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: AgoraColors.border)),
                      alignment: Alignment.center,
                      child: const Text("+", style: TextStyle(fontSize: 20, color: AgoraColors.textMuted)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Container(
                      height: 46,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: AgoraColors.border)),
                      child: TextField(
                        controller: _controller,
                        onSubmitted: (_) => unawaited(_send()),
                        textInputAction: TextInputAction.send,
                        decoration: InputDecoration(border: InputBorder.none, hintText: "Message ${widget.peerName.split(' ').first}…", hintStyle: const TextStyle(color: AgoraColors.textMuted, fontSize: 15)),
                        style: const TextStyle(fontSize: 15, color: AgoraColors.text),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  GestureDetector(
                    onTap: () => unawaited(_send()),
                    child: Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(color: AgoraColors.accent, borderRadius: BorderRadius.circular(16)),
                      alignment: Alignment.center,
                      child: const Icon(Icons.arrow_forward, color: AgoraColors.onAccent, size: 20),
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

  void _notBuiltYetResend() {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Can't resend after a restart — pick the file again.")));
  }
}

class _MessageBubble extends StatelessWidget {
  final storage.Message message;
  final String peerName;
  const _MessageBubble({required this.message, required this.peerName});

  @override
  Widget build(BuildContext context) {
    final mine = message.direction == 'sent';
    final bubble = Container(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
      decoration: BoxDecoration(
        color: mine ? AgoraColors.accent : AgoraColors.surface,
        border: mine ? null : Border.all(color: AgoraColors.borderSoft),
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(20),
          topRight: const Radius.circular(20),
          bottomLeft: Radius.circular(mine ? 20 : 6),
          bottomRight: Radius.circular(mine ? 6 : 20),
        ),
      ),
      child: Text(message.body, style: TextStyle(fontSize: 15, height: 1.45, color: mine ? AgoraColors.onAccent : AgoraColors.text)),
    );

    String? caption;
    if (mine && message.status == 'pending') caption = "Waiting to send";
    if (mine && message.status == 'delivered') caption = "Delivered to $peerName's device";

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          ConstrainedBox(constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.76), child: bubble),
          if (caption != null)
            Padding(
              padding: const EdgeInsets.only(top: 4, left: 4, right: 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (message.status == 'pending') ...[
                    Container(width: 7, height: 7, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: const Color(0xFFC2B3A5), width: 1.5))),
                    const SizedBox(width: 5),
                  ],
                  Text(caption, style: const TextStyle(fontSize: 11.5, color: AgoraColors.textMuted, fontWeight: FontWeight.w500)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
