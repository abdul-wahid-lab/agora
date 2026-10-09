import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'app_prefs.dart';
import 'backend/calling.dart' as calling;
import 'backend/disappearing.dart' as disappearing;
import 'backend/discovery.dart' as disc;
import 'backend/filetransfer.dart' as ft;
import 'backend/groups.dart' as groups;
import 'backend/latency.dart' as lat;
import 'backend/messaging.dart' as msging;
import 'backend/photos.dart' as photos;
import 'backend/storage.dart' as storage;
import 'backend/webrtc_call.dart' as webrtc;
import 'screens/main/about_screen.dart';
import 'screens/main/call_list_screen.dart';
import 'screens/main/call_screen.dart';
import 'screens/main/chat_info_screen.dart';
import 'screens/main/chat_list_screen.dart';
import 'screens/main/chat_screen.dart';
import 'screens/main/group_chat_screen.dart';
import 'screens/main/nearby_screen.dart';
import 'screens/main/network_settings_screen.dart';
import 'screens/main/new_chat_screen.dart';
import 'screens/main/notifications_settings_screen.dart';
import 'screens/main/peer_quick_actions_sheet.dart';
import 'screens/main/privacy_security_screen.dart';
import 'screens/main/settings_home_screen.dart';
import 'screens/main/troubleshooting_screen.dart';
import 'screens/main/what_agora_stores_screen.dart';
import 'screens/onboarding/network_check_screen.dart';
import 'screens/onboarding/permissions_screen.dart';
import 'screens/onboarding/profile_setup_screen.dart';
import 'screens/onboarding/splash_screen.dart';
import 'theme.dart';
import 'util/file_display.dart';
import 'widgets/bottom_tab_bar.dart';

void main() {
  runApp(const AgoraApp());
}

final navigatorKey = GlobalKey<NavigatorState>();

class AgoraApp extends StatelessWidget {
  const AgoraApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: 'Agora',
      debugShowCheckedModeBanner: false,
      theme: buildAgoraTheme(),
      home: const AppRoot(),
    );
  }
}

enum _Step { loading, splash, permissions, profile, networkCheck, main }

class AppRoot extends StatefulWidget {
  const AppRoot({super.key});
  @override
  State<AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<AppRoot> {
  late AppPrefs _prefs;
  _Step _step = _Step.loading;

  // Backend services - constructed once (either from a returning user's
  // stored identity, or right after onboarding's Profile Setup step picks
  // a name), then kept alive for the rest of the app's lifetime. The
  // MessageStore itself isn't held here: it's captured by discovery's own
  // onVerifySigningKey closure and messaging/fileTransfer's constructors,
  // which is what actually keeps it alive - a field here would just be a
  // second, currently-unused reference to the same object.
  disc.PeerDiscovery? _discovery;
  msging.MessagingService? _messaging;
  ft.FileTransferService? _fileTransfer;
  photos.PhotoStore? _photoStore;
  lat.LatencyService? _latency;
  storage.MessageStore? _store;
  calling.CallService? _callService;
  webrtc.WebrtcCallManager? _webrtcManager;
  groups.GroupService? _groupService;
  final Map<String, String> _completionCaptions = {};

  String? _chosenName;
  int _avatarIndex = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_bootstrap());
  }

  Future<void> _bootstrap() async {
    _prefs = await AppPrefs.load();
    if (_prefs.onboarded && _prefs.chosenName != null) {
      _chosenName = _prefs.chosenName;
      _avatarIndex = _prefs.avatarIndex;
      await _startBackend(_prefs.chosenName!);
      setState(() => _step = _Step.main);
    } else {
      setState(() => _step = _Step.splash);
    }
  }

  /// Real pre-flight check the splash screen runs before moving on: makes
  /// sure local storage (device identity) is reachable. Doesn't start
  /// discovery yet for a first-run device - that needs a chosen name
  /// first (Profile Setup), matching the design's own onboarding order.
  Future<void> _splashCheck() async {
    if (!_prefs.onboarded) {
      final dbPath = await storage.MessageStore.defaultPath();
      final store = storage.MessageStore(dbPath);
      await store.getOrCreateDeviceKeys();
    }
  }

  Future<void> _startBackend(String deviceName) async {
    final dbPath = await storage.MessageStore.defaultPath();
    final store = storage.MessageStore(dbPath);
    final keys = await store.getOrCreateDeviceKeys();

    final discovery = disc.PeerDiscovery(
      deviceName: deviceName,
      servicePort: 8420,
      peerId: _prefs.peerId,
      publicKey: keys['public_key']!,
      signingPrivateKey: keys['signing_private_key']!,
      signingPublicKey: keys['signing_public_key']!,
      mode: 'auto',
      onVerifySigningKey: (pid, key) => store.checkAndPinSigningKey(pid, key),
      onRegistryChange: () {
        if (mounted) setState(() {});
      },
    );
    await discovery.start();
    if (!_prefs.visibleInNearby) await discovery.setVisible(false);

    final messaging = msging.MessagingService(discovery: discovery, store: store);
    await messaging.start();

    final appSupportDir = await storage.MessageStore.defaultPath();
    final photoStore = await photos.PhotoStore.open(File(appSupportDir).parent.path);
    photos.PhotoExchange(messaging: messaging, store: photoStore);

    final latency = lat.LatencyService(discovery: discovery, messaging: messaging);
    latency.start();

    final callService = calling.CallService(selfPeerId: _prefs.peerId, messaging: messaging, store: store);
    final webrtcManager = webrtc.WebrtcCallManager(callService: callService);
    callService.onIncomingCall = (state, sdp) {
      final live = discovery.registry.list().cast<disc.Peer?>().firstWhere((p) => p!.peerId == state.peerId, orElse: () => null);
      navigatorKey.currentState?.push(MaterialPageRoute(
        builder: (_) => CallScreen(
          callService: callService,
          webrtcManager: webrtcManager,
          latency: latency,
          peerId: state.peerId,
          peerName: live?.name ?? state.peerId,
          media: state.media,
          direction: 'incoming',
          callId: state.callId,
          offerSdp: sdp,
        ),
      ));
    };

    final transferStarts = <String, DateTime>{};
    final downloadsDir = await ft.FileTransferService.defaultDownloadsDir();
    final fileTransfer = ft.FileTransferService(
      discovery: discovery,
      messaging: messaging,
      store: store,
      downloadsDir: downloadsDir,
      isCallActive: () => callService.hasActiveCall,
      onProgress: (transferId, bytesSoFar, total) {
        transferStarts.putIfAbsent(transferId, () => DateTime.now());
        if (mounted) setState(() {});
      },
      onOffer: (_) {
        if (mounted) setState(() {});
      },
      onReceived: (transferId, status, savedPath) {
        final start = transferStarts.remove(transferId);
        if (status == 'completed' && start != null) {
          unawaited(() async {
            final record = await store.getFile(transferId);
            final elapsed = DateTime.now().difference(start).inMilliseconds / 1000.0;
            final elapsedText = elapsed < 1 ? '<1 s' : '${elapsed.round()} s';
            final speedText = record != null && elapsed > 0 ? ' · ${humanSpeed(record.size / elapsed)}' : '';
            _completionCaptions[transferId] = 'complete in $elapsedText$speedText';
            if (mounted) setState(() {});
          }());
        }
        if (mounted) setState(() {});
      },
    );
    await fileTransfer.start();

    final groupService = groups.GroupService(
      discovery: discovery,
      messaging: messaging,
      store: store,
      fileTransfer: fileTransfer,
      selfPeerId: _prefs.peerId,
      selfName: deviceName,
      onGroupMessage: (_) {
        if (mounted) setState(() {});
      },
      onGroupInvite: (_) {
        if (mounted) setState(() {});
      },
    );
    groupService.start();

    final disappearingService = disappearing.DisappearingMessagesService(store: store);
    disappearingService.start();

    _discovery = discovery;
    _messaging = messaging;
    _fileTransfer = fileTransfer;
    _photoStore = photoStore;
    _latency = latency;
    _store = store;
    _callService = callService;
    _webrtcManager = webrtcManager;
    _groupService = groupService;
  }

  Future<void> _onProfileContinue(String name, int avatarIndex, String? photoPath) async {
    _chosenName = name;
    _avatarIndex = avatarIndex;
    await _prefs.setChosenName(name);
    await _prefs.setAvatarIndex(avatarIndex);
    await _startBackend(name);
    if (photoPath != null) {
      final bytes = await File(photoPath).readAsBytes();
      await _photoStore!.setSelfPhoto(Uint8List.fromList(bytes));
      await _prefs.setSelfPhotoPath(photoPath);
    }
    if (mounted) setState(() => _step = _Step.networkCheck);
  }

  Future<void> _finishOnboarding() async {
    await _prefs.setOnboarded(true);
    if (mounted) setState(() => _step = _Step.main);
  }

  @override
  void dispose() {
    _latency?.stop();
    _fileTransfer?.stop();
    _messaging?.stop();
    _discovery?.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    switch (_step) {
      case _Step.loading:
        return const Scaffold(backgroundColor: AgoraColors.ground, body: SizedBox.shrink());

      case _Step.splash:
        return SplashScreen(
          onCheck: _splashCheck,
          onDone: () => setState(() => _step = _Step.permissions),
        );

      case _Step.permissions:
        return PermissionsScreen(
          onContinue: () => setState(() => _step = _Step.profile),
          onSkip: () => setState(() => _step = _Step.profile),
        );

      case _Step.profile:
        return ProfileSetupScreen(
          networkName: "this network",
          onContinue: (name, avatarIndex, photoPath) => unawaited(_onProfileContinue(name, avatarIndex, photoPath)),
        );

      case _Step.networkCheck:
        final palette = kAvatarPalette[_avatarIndex];
        final peers = _discovery?.registry.list() ?? [];
        return NetworkCheckScreen(
          peers: peers,
          selfInitial: (_chosenName?.isNotEmpty ?? false) ? _chosenName![0].toUpperCase() : "?",
          selfBg: palette.bg,
          selfText: palette.text,
          networkName: "this network",
          onRescan: () => setState(() {}),
          onContinue: () => unawaited(_finishOnboarding()),
        );

      case _Step.main:
        return _MainShell(
          discovery: _discovery!,
          latency: _latency!,
          messaging: _messaging!,
          store: _store!,
          callService: _callService!,
          webrtcManager: _webrtcManager!,
          fileTransfer: _fileTransfer!,
          groupService: _groupService!,
          completionCaptions: _completionCaptions,
          prefs: _prefs,
          selfName: _chosenName ?? '',
          avatarIndex: _avatarIndex,
          onRename: (name) => setState(() => _chosenName = name),
        );
    }
  }
}

/// Real tab-based shell for design screens 3.x (Nearby, built) / 4.x
/// (Chats) / 5.x (Calls). Chats and Calls aren't built yet - rather than
/// fake a populated screen for either, each shows an honest "not built
/// yet" placeholder until that work actually happens.
class _MainShell extends StatefulWidget {
  final disc.PeerDiscovery discovery;
  final lat.LatencyService latency;
  final msging.MessagingService messaging;
  final storage.MessageStore store;
  final calling.CallService callService;
  final webrtc.WebrtcCallManager webrtcManager;
  final ft.FileTransferService fileTransfer;
  final groups.GroupService groupService;
  final Map<String, String> completionCaptions;
  final AppPrefs prefs;
  final String selfName;
  final int avatarIndex;
  final void Function(String name) onRename;

  const _MainShell({
    required this.discovery,
    required this.latency,
    required this.messaging,
    required this.store,
    required this.callService,
    required this.webrtcManager,
    required this.fileTransfer,
    required this.groupService,
    required this.completionCaptions,
    required this.prefs,
    required this.selfName,
    required this.avatarIndex,
    required this.onRename,
  });

  @override
  State<_MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<_MainShell> {
  Timer? _refreshTimer;
  AppTab _tab = AppTab.nearby;
  bool _rescanning = false;
  List<ConversationRow> _conversations = [];
  List<CallRow> _calls = [];

  @override
  void initState() {
    super.initState();
    unawaited(_refreshConversations());
    unawaited(_refreshCalls());
    _refreshTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (mounted) setState(() {});
      unawaited(_refreshConversations());
      unawaited(_refreshCalls());
    });
  }

  Future<void> _refreshCalls() async {
    final rows = await widget.store.listAllCalls();
    if (!mounted) return;
    final onlineIds = widget.discovery.registry.list().map((p) => p.peerId).toSet();
    setState(() {
      _calls = rows.map((r) {
        final peerId = r['peer_id'] as String;
        final live = onlineIds.contains(peerId) ? widget.discovery.registry.list().firstWhere((p) => p.peerId == peerId) : null;
        final known = _conversations.where((c) => c.peerId == peerId);
        return CallRow(
          callId: r['call_id'] as String,
          peerId: peerId,
          name: live?.name ?? (known.isNotEmpty ? known.first.name : peerId),
          direction: r['direction'] as String,
          media: r['media'] as String,
          status: r['status'] as String,
          startedAt: (r['started_at'] as num).toDouble(),
          duration: (r['duration'] as num?)?.toDouble(),
        );
      }).toList();
    });
  }

  Future<void> _refreshConversations() async {
    final rows = await widget.store.listConversations();
    final groupList = await widget.store.listGroups();
    if (!mounted) return;
    final onlineIds = widget.discovery.registry.list().map((p) => p.peerId).toSet();
    final directRows = rows.map((r) {
      final peerId = r['peer_id'] as String;
      final knownName = r['name'] as String?;
      final online = onlineIds.contains(peerId);
      final liveName = online ? widget.discovery.registry.list().firstWhere((p) => p.peerId == peerId).name : null;
      return ConversationRow(
        peerId: peerId,
        name: liveName ?? knownName ?? peerId,
        lastBody: r['last_body'] as String,
        lastDirection: r['last_direction'] as String,
        lastStatus: r['last_status'] as String,
        lastTs: (r['last_ts'] as num).toDouble(),
        online: online,
      );
    }).toList();

    final groupRows = <ConversationRow>[];
    for (final g in groupList) {
      final history = await widget.store.groupHistory(g.groupId, limit: 1000);
      final onlineCount = g.members.where((m) => onlineIds.contains(m.peerId)).length;
      groupRows.add(ConversationRow(
        peerId: g.groupId,
        name: g.name,
        lastBody: history.isEmpty ? 'No messages yet' : '${history.last.senderPeerId == widget.groupService.selfPeerId ? 'You' : history.last.senderName}: ${history.last.body}',
        lastDirection: 'received',
        lastStatus: 'received',
        lastTs: history.isEmpty ? g.createdAt : history.last.ts,
        online: onlineCount > 0,
        isGroup: true,
      ));
    }

    final merged = [...directRows, ...groupRows]..sort((a, b) => b.lastTs.compareTo(a.lastTs));
    if (!mounted) return;
    setState(() => _conversations = merged);
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _rescan() async {
    setState(() => _rescanning = true);
    // There's no real "trigger a scan" primitive to call - discovery is
    // already continuously listening. This just gives the Rescan control a
    // real, visible effect (a fresh ping sweep) instead of doing nothing.
    for (final peer in widget.discovery.registry.list()) {
      await widget.latency.ping(peer.peerId);
    }
    if (mounted) setState(() => _rescanning = false);
  }

  void _openChat(String peerId, String peerName) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ChatScreen(
        store: widget.store,
        messaging: widget.messaging,
        discovery: widget.discovery,
        callService: widget.callService,
        webrtcManager: widget.webrtcManager,
        latency: widget.latency,
        fileTransfer: widget.fileTransfer,
        completionCaptions: widget.completionCaptions,
        peerId: peerId,
        peerName: peerName,
        onBack: () => Navigator.of(context).pop(),
        onOpenInfo: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ChatInfoScreen(
            store: widget.store,
            discovery: widget.discovery,
            peerId: peerId,
            peerName: peerName,
            onBack: () => Navigator.of(context).pop(),
            onConversationCleared: () => unawaited(_refreshConversations()),
          ),
        )),
      ),
    ));
  }

  void _openGroup(String groupId) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => GroupChatScreen(
        store: widget.store,
        groupService: widget.groupService,
        discovery: widget.discovery,
        groupId: groupId,
        selfPeerId: widget.groupService.selfPeerId,
        onBack: () => Navigator.of(context).pop(),
      ),
    ));
  }

  Future<void> _openNewChat() async {
    final peers = widget.discovery.registry.list();
    final onlineIds = peers.map((p) => p.peerId).toSet();
    final known = await widget.store.listKnownPeers();
    final offline = known.where((r) => !onlineIds.contains(r['peer_id'] as String)).map((r) => (peerId: r['peer_id'] as String, name: r['name'] as String)).toList();
    if (!mounted) return;
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => NewChatScreen(
        nearbyPeers: peers,
        offlineKnownPeers: offline,
        onStartDirectChat: (peerId, peerName) {
          Navigator.of(context).pop();
          _openChat(peerId, peerName);
        },
        onCreateGroup: (name, members) {
          Navigator.of(context).pop();
          unawaited(widget.groupService.createGroup(name, members.map((p) => (p.peerId, p.name)).toList()).then((group) {
            unawaited(_refreshConversations());
            if (mounted) _openGroup(group.groupId);
          }));
        },
      ),
    ));
  }

  void _placeCall(String peerId, String peerName, String media) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => CallScreen(
        callService: widget.callService,
        webrtcManager: widget.webrtcManager,
        latency: widget.latency,
        peerId: peerId,
        peerName: peerName,
        media: media,
        direction: 'outgoing',
      ),
    ));
  }

  void _openPeerActions(disc.Peer peer) {
    final sample = widget.latency.latest[peer.peerId];
    PeerQuickActionsSheet.show(
      context,
      peer: peer,
      rttMs: sample?.rttMs,
      quality: sample?.quality,
      onMessage: () {
        Navigator.of(context).pop();
        _openChat(peer.peerId, peer.name);
      },
      onCall: () {
        Navigator.of(context).pop();
        _placeCall(peer.peerId, peer.name, 'audio');
      },
      onVideo: () {
        Navigator.of(context).pop();
        _placeCall(peer.peerId, peer.name, 'video');
      },
      onViewProfile: () => Navigator.of(context).pop(),
    );
  }

  void _openTroubleshooting() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => TroubleshootingScreen(
        discovery: widget.discovery,
        onBack: () => Navigator.of(context).pop(),
        onRescan: () => unawaited(_rescan()),
      ),
    ));
  }

  String _diagnosticsText() {
    final peers = widget.discovery.registry.list();
    return 'Agora diagnostics\ndevice id: ${widget.discovery.peerId}\ndiscovery mode: ${widget.discovery.mode}\npeers visible: ${peers.length}';
  }

  Future<void> _renameSelf() async {
    final controller = TextEditingController(text: widget.selfName);
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Your name'),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (name != null && name.isNotEmpty) {
      await widget.prefs.setChosenName(name);
      widget.onRename(name);
    }
  }

  void _openSettings() {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => SettingsHomeScreen(
        selfName: widget.selfName,
        selfPeerId: widget.discovery.peerId,
        selfBg: kAvatarPalette[widget.avatarIndex].bg,
        selfText: kAvatarPalette[widget.avatarIndex].text,
        onBack: () => Navigator.of(context).pop(),
        onRename: () => unawaited(_renameSelf()),
        onOpenNetwork: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => NetworkSettingsScreen(
            discovery: widget.discovery,
            networkName: 'this network',
            onBack: () => Navigator.of(context).pop(),
            onRescan: _rescan,
          ),
        )),
        onOpenPrivacy: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => PrivacySecurityScreen(
            discovery: widget.discovery,
            store: widget.store,
            initialVisible: widget.discovery.visible,
            onVisibilityChanged: (v) => unawaited(widget.prefs.setVisibleInNearby(v)),
            onBack: () => Navigator.of(context).pop(),
          ),
        )),
        onOpenNotifications: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => NotificationsSettingsScreen(onBack: () => Navigator.of(context).pop()))),
        onOpenAbout: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => AboutScreen(
            onBack: () => Navigator.of(context).pop(),
            diagnosticsText: _diagnosticsText(),
            onOpenTroubleshooting: _openTroubleshooting,
            onOpenWhatAgoraStores: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WhatAgoraStoresScreen(onBack: () => Navigator.of(context).pop()))),
          ),
        )),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final peers = widget.discovery.registry.list();
    final palette = kAvatarPalette[widget.avatarIndex];

    Widget body;
    switch (_tab) {
      case AppTab.nearby:
        body = NearbyScreen(
          peers: peers,
          latencyByPeer: widget.latency.latest,
          selfInitial: widget.selfName.isNotEmpty ? widget.selfName[0].toUpperCase() : "?",
          selfBg: palette.bg,
          selfText: palette.text,
          networkName: "this network",
          rescanning: _rescanning,
          onRescan: () => unawaited(_rescan()),
          onPeerTap: _openPeerActions,
          onWhyEmpty: _openTroubleshooting,
        );
      case AppTab.chats:
        body = ChatListScreen(
          conversations: _conversations,
          onlinePeerCount: peers.length,
          networkName: "this network",
          onOpenRow: (row) => row.isGroup ? _openGroup(row.peerId) : _openChat(row.peerId, row.name),
          onNewChat: () => unawaited(_openNewChat()),
          onGoToNearby: () => setState(() => _tab = AppTab.nearby),
        );
      case AppTab.calls:
        body = CallListScreen(
          calls: _calls,
          networkName: "this network",
          onCallPeer: (peerId, peerName) => _placeCall(peerId, peerName, 'audio'),
          onGoToNearby: () => setState(() => _tab = AppTab.nearby),
        );
    }

    return Scaffold(
      backgroundColor: AgoraColors.ground,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(0, 2, 16, 0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  GestureDetector(
                    onTap: _openSettings,
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(color: AgoraColors.surface, borderRadius: BorderRadius.circular(11), border: Border.all(color: AgoraColors.border)),
                      alignment: Alignment.center,
                      child: const Icon(Icons.settings_outlined, size: 16, color: AgoraColors.textStrong),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(child: body),
          ],
        ),
      ),
      bottomNavigationBar: BottomTabBar(current: _tab, onSelect: (t) => setState(() => _tab = t)),
    );
  }
}
