// Group chat and group calling - exact port of backend/app/groups.py.
//
// No new server or relay of any kind: this rides the exact same
// peer-to-peer building blocks every other feature here already uses. A
// "group" is purely a locally-agreed-upon membership list, not a real
// resource anywhere - each member's device independently stores its own
// copy of who's in it (via group_invite), and there's no single owner who
// could go offline and take the group down with them.
//
// Wire protocol (control messages, over the existing per-peer connection,
// riding MessagingService.addControlHandler/sendControl the same way
// filetransfer.dart and deletion.dart do):
//   group_invite     {group_id, name, members: [{peer_id, name}, ...]}
//   group_message    {group_id, msg_id, sender_peer_id, sender_name, body, ts}
//   group_delete     {group_id, msg_id}
//   group_call_start {group_id, group_call_id, media, group_name}
//
// Group messaging: whoever sends a message fans the *same* group_message
// control frame out to every other member individually, over each
// member's own existing 1:1 connection. A member who's offline at send
// time has their copy queued in pending_group_messages (mirrors
// messaging.dart's own pending-flush loop) and gets it once this
// service's own flush loop sees them reappear in discovery.
//
// Group calling (full mesh, no SFU/relay): calling.dart stays a pure 1:1
// signaling relay, completely unaware groups exist. A group call is
// really just N ordinary 1:1 calls happening at once, tagged with a
// shared group_call_id so the UI can render them as one screen. Mesh
// formation avoids every pair connecting twice with a simple,
// deterministic rule applied identically on every member's device: after
// a group_call_start, each member calls every *other* member whose
// peer_id sorts after their own.

import 'dart:async';
import 'dart:io';

import 'package:uuid/uuid.dart';

import 'discovery.dart' as disc;
import 'filetransfer.dart' as ft;
import 'messaging.dart' as msging;
import 'storage.dart' as storage;

// Full mesh means every member connects directly to every other member -
// connections grow as N*(N-1)/2, and so does the encode/decode work every
// device does simultaneously. Capping group calls at this size keeps every
// group call within the mesh's actual comfort zone instead of quietly
// degrading as a group grows. Group *chat* has no such limit.
const maxGroupCallMembers = 4;

class GroupMessageEvent {
  final String groupId;
  final String msgId;
  final String senderPeerId;
  final String senderName;
  final String body;
  final double ts;
  const GroupMessageEvent({required this.groupId, required this.msgId, required this.senderPeerId, required this.senderName, required this.body, required this.ts});
}

class GroupCallStartEvent {
  final String groupId;
  final String groupCallId;
  final String media;
  final List<storage.GroupMember> members;
  final String groupName;
  const GroupCallStartEvent({required this.groupId, required this.groupCallId, required this.media, required this.members, required this.groupName});
}

class GroupService {
  final disc.PeerDiscovery discovery;
  final msging.MessagingService messaging;
  final storage.MessageStore store;
  final ft.FileTransferService fileTransfer;
  final String selfPeerId;
  final String selfName;

  final void Function(storage.Group group)? onGroupInvite;
  final void Function(GroupMessageEvent event)? onGroupMessage;
  final void Function(GroupCallStartEvent event)? onGroupCallStart;
  final void Function(String groupId, String msgId)? onGroupDelete;

  Timer? _flushTimer;

  GroupService({
    required this.discovery,
    required this.messaging,
    required this.store,
    required this.fileTransfer,
    required this.selfPeerId,
    required this.selfName,
    this.onGroupInvite,
    this.onGroupMessage,
    this.onGroupCallStart,
    this.onGroupDelete,
  }) {
    messaging.addControlHandler(_onControl);
  }

  void start() {
    _flushTimer = Timer.periodic(const Duration(seconds: 2), (_) => unawaited(_flushPendingTick()));
  }

  void stop() {
    _flushTimer?.cancel();
  }

  /// Mirrors messaging.dart's own pending-flush loop, applied to group
  /// messages/deletes specifically: whenever a member we have a held item
  /// for becomes visible again, resend just their missed copy.
  Future<void> _flushPendingTick() async {
    final visibleIds = discovery.registry.list().map((p) => p.peerId).toSet();
    for (final peerId in visibleIds) {
      for (final pm in await store.pendingGroupMessagesForPeer(peerId)) {
        final sent = await messaging.sendControl(peerId, {
          'type': 'group_message',
          'group_id': pm.groupId,
          'msg_id': pm.msgId,
          'sender_peer_id': pm.senderPeerId,
          'sender_name': pm.senderName,
          'body': pm.body,
          'ts': pm.ts,
        });
        if (sent) await store.removePendingGroupMessage(pm.msgId, peerId);
      }
      for (final (msgId, delGroupId) in await store.pendingGroupDeletesForPeer(peerId)) {
        final sent = await messaging.sendControl(peerId, {'type': 'group_delete', 'group_id': delGroupId, 'msg_id': msgId});
        if (sent) await store.removePendingGroupDelete(msgId, peerId);
      }
    }
  }

  /// memberPeerIdsAndNames excludes the creator - self is always added
  /// automatically, so the caller only needs to pass who else is invited.
  Future<storage.Group> createGroup(String name, List<(String, String)> memberPeerIdsAndNames) async {
    final groupId = const Uuid().v4();
    final members = [storage.GroupMember(selfPeerId, selfName), ...memberPeerIdsAndNames.map((e) => storage.GroupMember(e.$1, e.$2))];
    await store.saveGroup(groupId, name, members);

    for (final (pid, _) in memberPeerIdsAndNames) {
      await messaging.sendControl(pid, {
        'type': 'group_invite',
        'group_id': groupId,
        'name': name,
        'members': members.map((m) => {'peer_id': m.peerId, 'name': m.name}).toList(),
      });
    }
    return (await store.getGroup(groupId))!;
  }

  Future<String> sendGroupMessage(String groupId, String body) async {
    final group = await store.getGroup(groupId);
    if (group == null) throw ArgumentError('no such group $groupId');
    final msgId = const Uuid().v4();
    final ts = DateTime.now().millisecondsSinceEpoch / 1000.0;
    await store.saveGroupMessage(msgId: msgId, groupId: groupId, senderPeerId: selfPeerId, senderName: selfName, body: body, ts: ts);

    for (final m in group.members) {
      if (m.peerId == selfPeerId) continue;
      final sent = await messaging.sendControl(m.peerId, {
        'type': 'group_message',
        'group_id': groupId,
        'msg_id': msgId,
        'sender_peer_id': selfPeerId,
        'sender_name': selfName,
        'body': body,
        'ts': ts,
      });
      if (!sent) {
        await store.savePendingGroupMessage(msgId: msgId, peerId: m.peerId, groupId: groupId, senderPeerId: selfPeerId, senderName: selfName, body: body, ts: ts);
      }
    }
    return msgId;
  }

  /// Group analogue of deletion.dart's 1:1 deleteForEveryone(): deletes
  /// this device's own copy immediately, then fans a group_delete notice
  /// out to every other member, queuing it for anyone offline right now.
  Future<void> deleteGroupMessageForEveryone(String groupId, String msgId) async {
    final group = await store.getGroup(groupId);
    if (group == null) throw ArgumentError('no such group $groupId');
    await store.deleteGroupMessage(msgId);
    for (final m in group.members) {
      if (m.peerId == selfPeerId) continue;
      final sent = await messaging.sendControl(m.peerId, {'type': 'group_delete', 'group_id': groupId, 'msg_id': msgId});
      if (!sent) await store.savePendingGroupDelete(msgId, m.peerId, groupId);
    }
  }

  /// Sends a file to every other member as its own completely normal 1:1
  /// transfer, just tagged with this group_id so it shows up in the
  /// group's timeline on every device. No group-aware retry here: if one
  /// member is offline right now, their copy simply fails like any 1:1
  /// send to an unreachable peer would (filetransfer.dart's own flush
  /// loop retries it later).
  Future<List<String>> sendGroupFile(String groupId, File file, {bool keepSenderCopy = false}) async {
    final group = await store.getGroup(groupId);
    if (group == null) throw ArgumentError('no such group $groupId');
    final transferIds = <String>[];
    for (final m in group.members) {
      if (m.peerId == selfPeerId) continue;
      try {
        transferIds.add(await fileTransfer.sendFile(m.peerId, file, groupId: groupId, keepSenderCopy: keepSenderCopy));
      } on StateError {
        // that member is unreachable right now (filetransfer.dart's own
        // StateError for "not reachable"/"never responded") - its own
        // flush loop will retry. Narrowed to StateError specifically,
        // mirroring Python's own `except ConnectionError` - a bare catch
        // here previously swallowed a real bug (see BUILD_LOG) along with
        // genuine unreachability, which is exactly the kind of mistake
        // that hides real failures instead of handling an expected one.
      }
    }
    return transferIds;
  }

  /// Tells every other member a group call is starting. Doesn't place any
  /// actual calls itself - calling.dart's real 1:1 signaling only happens
  /// where the real RTCPeerConnections live (webrtc_call.dart). This just
  /// broadcasts the starting gun; every member's own app (including the
  /// initiator's, via the same event) decides who *it* needs to call
  /// using the peer_id-ordering mesh rule.
  Future<GroupCallStartEvent> startGroupCall(String groupId, String media, {String? groupCallId}) async {
    final group = await store.getGroup(groupId);
    if (group == null) throw ArgumentError('no such group $groupId');
    if (group.members.length > maxGroupCallMembers) {
      throw ArgumentError('group calling is limited to $maxGroupCallMembers people, this group has ${group.members.length}');
    }
    final resolvedCallId = groupCallId ?? const Uuid().v4();

    for (final m in group.members) {
      if (m.peerId == selfPeerId) continue;
      await messaging.sendControl(m.peerId, {
        'type': 'group_call_start',
        'group_id': groupId,
        'group_call_id': resolvedCallId,
        'media': media,
        'group_name': group.name,
      });
    }

    return GroupCallStartEvent(groupId: groupId, groupCallId: resolvedCallId, media: media, members: group.members, groupName: group.name);
  }

  Future<void> _onControl(String mtype, String peerId, Map<String, dynamic> msg) async {
    if (mtype == 'group_invite') {
      final members = (msg['members'] as List).map((m) => storage.GroupMember(m['peer_id'] as String, m['name'] as String)).toList();
      await store.saveGroup(msg['group_id'] as String, msg['name'] as String, members);
      if (onGroupInvite != null) {
        final group = await store.getGroup(msg['group_id'] as String);
        if (group != null) onGroupInvite!(group);
      }
    } else if (mtype == 'group_message') {
      final ts = (msg['ts'] as num?)?.toDouble() ?? DateTime.now().millisecondsSinceEpoch / 1000.0;
      await store.saveGroupMessage(
        msgId: msg['msg_id'] as String,
        groupId: msg['group_id'] as String,
        senderPeerId: msg['sender_peer_id'] as String,
        senderName: msg['sender_name'] as String,
        body: msg['body'] as String,
        ts: ts,
      );
      onGroupMessage?.call(GroupMessageEvent(
        groupId: msg['group_id'] as String,
        msgId: msg['msg_id'] as String,
        senderPeerId: msg['sender_peer_id'] as String,
        senderName: msg['sender_name'] as String,
        body: msg['body'] as String,
        ts: ts,
      ));
    } else if (mtype == 'group_call_start') {
      final group = await store.getGroup(msg['group_id'] as String);
      if (group != null && onGroupCallStart != null) {
        onGroupCallStart!(GroupCallStartEvent(
          groupId: msg['group_id'] as String,
          groupCallId: msg['group_call_id'] as String,
          media: msg['media'] as String,
          members: group.members,
          groupName: group.name,
        ));
      }
    } else if (mtype == 'group_delete') {
      await store.deleteGroupMessage(msg['msg_id'] as String);
      onGroupDelete?.call(msg['group_id'] as String, msg['msg_id'] as String);
    }
  }
}
