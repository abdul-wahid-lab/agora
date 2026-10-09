// Reimplements the slice of backend/app/storage.py that Phase 1
// (discovery) and Phase 2 (messaging) actually need: this device's own
// persisted identity, trust-on-first-use for both the signing key
// (discovery) and the encryption key (messaging), blocking, and the
// message table itself. Same per-device-only SQLite model - no shared,
// synced, or central database anywhere. Other tables (files, calls,
// groups) get added here when those phases are built, not speculatively
// now - matching how the desktop app itself grew this file.

import 'dart:async';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import 'crypto_identity.dart' as ci;

// Same reasoning as storage.py's own MAX_KNOWN_PEERS: trust-on-first-use
// permanently remembers every never-before-seen peer_id, and a cheap,
// self-signed UDP/mDNS broadcast is all an attacker needs to trigger one
// first-sighting insert - unbounded growth from a trivial packet flood
// without a cap.
const maxKnownPeers = 10000;

// Bounds every known_peers pin/trust-on-first-use transaction - see
// checkAndPinSigningKey's own comment for the real stall this was found
// closing. A real transaction here is a handful of tiny queries against a
// small table; 5s is generous headroom above that, not a tight budget.
const dbTransactionTimeout = Duration(seconds: 5);

class Message {
  final String msgId;
  final String peerId;
  final String direction; // 'sent' or 'received'
  final String body;
  final String status; // 'pending' | 'sent' | 'delivered' | 'received' | 'failed'
  final double ts;

  Message({required this.msgId, required this.peerId, required this.direction, required this.body, required this.status, required this.ts});

  factory Message.fromRow(Map<String, Object?> row) => Message(
        msgId: row['msg_id'] as String,
        peerId: row['peer_id'] as String,
        direction: row['direction'] as String,
        body: row['body'] as String,
        status: row['status'] as String,
        ts: (row['ts'] as num).toDouble(),
      );
}

class MessageStore {
  final String dbPath;
  Database? _db;
  // Dart is single-threaded per isolate, but awaited DB calls can still
  // interleave at their own await points - this one lock serializes the
  // check-then-write pin operations (signing key + encryption key) so two
  // near-simultaneous first-sightings of the same peer_id can't both see
  // "nothing pinned yet", the same TOCTOU race storage.py's own
  // BEGIN IMMEDIATE transaction guards against on the Python side.
  final _pinLock = <String, Future>{};

  MessageStore(this.dbPath);

  Future<Database> _open() async {
    final db = _db;
    if (db != null) return db;
    // Every CREATE TABLE/INDEX runs unconditionally on every open, not
    // just inside onCreate - onCreate only ever fires the very first time
    // a given db *file* is created, so a table added to this schema
    // later would silently never reach an already-existing install's
    // database (found via a real live test: a phone that had already run
    // an older build hit "no such table: files" the moment file transfer
    // was added, since its db file already existed from before that
    // table existed). Mirrors storage.py's own _migrate() pattern - every
    // statement here is IF NOT EXISTS, so re-running them against a
    // database that already has them is always a safe no-op.
    final opened = await openDatabase(dbPath, version: 1);
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS device_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        private_key TEXT NOT NULL,
        public_key TEXT NOT NULL,
        signing_private_key TEXT NOT NULL,
        signing_public_key TEXT NOT NULL
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS known_peers (
        peer_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_seen REAL NOT NULL,
        public_key TEXT,
        signing_public_key TEXT
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS blocked_peers (
        peer_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        blocked_at REAL NOT NULL
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS messages (
        msg_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        ts REAL NOT NULL
      )
    ''');
    await opened.execute('CREATE INDEX IF NOT EXISTS idx_messages_peer ON messages(peer_id, ts)');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS files (
        transfer_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        is_executable INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        saved_path TEXT,
        ts REAL NOT NULL,
        group_id TEXT,
        played_at REAL
      )
    ''');
    await opened.execute('CREATE INDEX IF NOT EXISTS idx_files_peer ON files(peer_id, ts)');
    await opened.execute('CREATE INDEX IF NOT EXISTS idx_files_group ON files(group_id, ts)');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS calls (
        call_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        media TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at REAL NOT NULL,
        ended_at REAL,
        duration REAL
      )
    ''');
    await opened.execute('CREATE INDEX IF NOT EXISTS idx_calls_peer ON calls(peer_id, started_at)');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS disappearing_settings (
        peer_id TEXT PRIMARY KEY,
        duration_seconds INTEGER NOT NULL,
        updated_at REAL NOT NULL
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS groups (
        group_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at REAL NOT NULL
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (group_id, peer_id)
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS group_messages (
        msg_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender_peer_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        body TEXT NOT NULL,
        ts REAL NOT NULL
      )
    ''');
    await opened.execute('CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, ts)');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS pending_group_messages (
        msg_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        sender_peer_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        body TEXT NOT NULL,
        ts REAL NOT NULL,
        PRIMARY KEY (msg_id, peer_id)
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS pending_deletes (
        msg_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        ts REAL NOT NULL
      )
    ''');
    await opened.execute('''
      CREATE TABLE IF NOT EXISTS pending_group_deletes (
        msg_id TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        ts REAL NOT NULL,
        PRIMARY KEY (msg_id, peer_id)
      )
    ''');
    // known_peers.photo_hash: added after the original table, same
    // ALTER-if-missing pattern storage.py's own _migrate() uses - a
    // CREATE TABLE IF NOT EXISTS above is a no-op against an
    // already-existing install's db file, so a column added only there
    // would never reach a device that installed before this was added.
    final knownPeersCols = (await opened.rawQuery('PRAGMA table_info(known_peers)')).map((r) => r['name'] as String).toSet();
    if (!knownPeersCols.contains('photo_hash')) {
      await opened.execute('ALTER TABLE known_peers ADD COLUMN photo_hash TEXT');
    }
    _db = opened;
    return opened;
  }

  static Future<String> defaultPath() async {
    final dir = await getApplicationSupportDirectory();
    return p.join(dir.path, 'agora.db');
  }

  double _now() => DateTime.now().millisecondsSinceEpoch / 1000.0;

  // -- device identity -----------------------------------------------------

  /// Same contract as storage.py's get_or_create_device_keys: generated
  /// once on first ever run, reused forever after - a fresh keypair every
  /// restart would make every peer's trust-on-first-use record look like
  /// an identity change on every launch.
  Future<Map<String, String>> getOrCreateDeviceKeys() async {
    final db = await _open();
    final rows = await db.query('device_identity', where: 'id = 1');
    if (rows.isNotEmpty) {
      final row = rows.first;
      return {
        'private_key': row['private_key'] as String,
        'public_key': row['public_key'] as String,
        'signing_private_key': row['signing_private_key'] as String,
        'signing_public_key': row['signing_public_key'] as String,
      };
    }
    final (privateKey, publicKey) = await ci.generateKeypair();
    final (signPriv, signPub) = await ci.generateSigningKeypair();
    await db.insert('device_identity', {
      'id': 1,
      'private_key': privateKey,
      'public_key': publicKey,
      'signing_private_key': signPriv,
      'signing_public_key': signPub,
    });
    return {
      'private_key': privateKey,
      'public_key': publicKey,
      'signing_private_key': signPriv,
      'signing_public_key': signPub,
    };
  }

  Future<T> _withPinLock<T>(String peerId, Future<T> Function() body) {
    final previous = _pinLock[peerId] ?? Future.value();
    final completer = Completer<T>();
    final next = previous.then((_) async {
      try {
        final result = await body();
        completer.complete(result);
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    _pinLock[peerId] = next;
    return completer.future;
  }

  Future<void> _evictOldestKnownPeersIfFull(DatabaseExecutor db, String peerId) async {
    final countRow = await db.rawQuery('SELECT COUNT(*) AS c FROM known_peers');
    final count = countRow.first['c'] as int;
    if (count < maxKnownPeers) return;
    final toEvict = count - maxKnownPeers + 1;
    await db.rawDelete(
      'DELETE FROM known_peers WHERE peer_id IN ('
      '  SELECT peer_id FROM known_peers WHERE peer_id != ? ORDER BY last_seen ASC LIMIT ?'
      ')',
      [peerId, toEvict],
    );
  }

  /// Same contract as discovery.py's check_and_pin_signing_key - called
  /// on every announcement before it ever reaches the live registry, not
  /// lazily once messaging.py happens to talk to that peer_id. True
  /// (accept) the first time this peer_id is ever seen, or if its signing
  /// key already matches what's on file; false (reject) if a *different*
  /// key is claiming an already-pinned peer_id.
  Future<bool> checkAndPinSigningKey(String peerId, String signingPublicKey) {
    return _withPinLock('sign:$peerId', () async {
      // Plain sequential calls, not db.transaction() - a real stress test
      // (two full peer stacks sharing one isolate, every background flush
      // loop firing at once) found sqflite's own native transaction queue
      // occasionally stall indefinitely on this device, and a stuck
      // transaction wedges the *entire* store behind it forever (even
      // isPeerBlocked, checked on every inbound frame, queues on the same
      // connection - one stall silently kills a device's whole messaging
      // pipeline). A Dart-side .timeout() around the transaction doesn't
      // save it either: the Future gives up, but the native side was
      // still observed stuck behind it minutes later.
      //
      // The transaction isn't actually needed for correctness here, only
      // for the same reason storage.py's Python side needs one: guarding
      // against two *real OS threads* racing this exact check-then-write
      // (zeroconf's own thread and the UDP listener thread there). Dart
      // has no equivalent - discovery.dart's callbacks all run on this
      // one isolate's single event loop - so _withPinLock's own per-
      // peer_id Future-chain serialization already gives the same
      // atomicity a SQL transaction would, without the native call that's
      // the one actually seen to stall.
      final db = await _open();
      final rows = await db.query('known_peers', columns: ['signing_public_key'], where: 'peer_id = ?', whereArgs: [peerId]);
      final pinned = rows.isNotEmpty ? rows.first['signing_public_key'] as String? : null;
      if (pinned != null) {
        return pinned == signingPublicKey;
      }
      final rowExists = rows.isNotEmpty;
      if (!rowExists) {
        await _evictOldestKnownPeersIfFull(db, peerId);
      }
      await db.insert(
        'known_peers',
        {'peer_id': peerId, 'name': peerId, 'last_seen': _now(), 'signing_public_key': signingPublicKey},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      return true;
    });
  }

  /// Trust-on-first-use for the X25519 encryption key - mirrors
  /// check_and_remember_peer_key. Returns the OLD key if a peer_id we
  /// already pinned shows up with a genuinely different one (a real
  /// identity-changed signal), null if this is a first sighting or the
  /// key matches what's on file.
  Future<String?> checkAndRememberPeerKey(String peerId, String name, String publicKey) {
    return _withPinLock('enc:$peerId', () async {
      // Plain sequential calls, not db.transaction() - see
      // checkAndPinSigningKey's own comment for why: a real stress test
      // found the transaction API itself occasionally stalls natively on
      // this device under heavy concurrent load, wedging the whole store
      // behind it, and _withPinLock's per-peer_id serialization already
      // gives this the same atomicity a SQL transaction would (Dart has
      // no equivalent to the two real OS threads storage.py's own version
      // guards against - every caller here runs on one isolate's single
      // event loop).
      final db = await _open();
      final rows = await db.query('known_peers', columns: ['public_key'], where: 'peer_id = ?', whereArgs: [peerId]);
      final oldKey = rows.isNotEmpty ? rows.first['public_key'] as String? : null;
      final now = _now();
      if (rows.isEmpty) {
        await _evictOldestKnownPeersIfFull(db, peerId);
        await db.insert('known_peers', {'peer_id': peerId, 'name': name, 'last_seen': now, 'public_key': publicKey});
      } else {
        // Plain UPDATE, not an ON CONFLICT...DO UPDATE upsert - a real
        // Android 10 device's bundled SQLite rejected that syntax
        // outright ("near ON: syntax error"), found by an actual live
        // cross-device test, not assumed. UPDATE/INSERT has been
        // supported since SQLite's earliest versions, so this is the
        // one way to write "insert or update" that's safe on every
        // real Android version this app might run on, not just recent
        // ones with a modern enough bundled SQLite.
        await db.update('known_peers', {'name': name, 'last_seen': now, 'public_key': publicKey}, where: 'peer_id = ?', whereArgs: [peerId]);
      }
      if (oldKey != null && oldKey != publicKey) return oldKey;
      return null;
    });
  }

  // -- blocking --------------------------------------------------------

  Future<void> blockPeer(String peerId, String name) async {
    final db = await _open();
    await db.insert('blocked_peers', {'peer_id': peerId, 'name': name, 'blocked_at': _now()}, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> unblockPeer(String peerId) async {
    final db = await _open();
    await db.delete('blocked_peers', where: 'peer_id = ?', whereArgs: [peerId]);
  }

  /// The single real choke point every peer-to-peer frame passes through
  /// (messaging.dart checks this on every inbound/outbound frame) - a
  /// stress test found that without a bound here, any device-level
  /// slowdown touching this store cascades into a *permanent* freeze of
  /// this device's entire messaging pipeline, not just a dropped frame.
  /// Fails open (not blocked) on a genuine stall: blocking is a local
  /// preference, not a security boundary a blocked peer couldn't route
  /// around anyway, and keeping every *other* peer's traffic flowing is
  /// clearly the better default than wedging the whole connection over an
  /// edge case this rare.
  Future<bool> isPeerBlocked(String peerId) async {
    final db = await _open();
    try {
      final rows = await db.query('blocked_peers', where: 'peer_id = ?', whereArgs: [peerId]).timeout(dbTransactionTimeout);
      return rows.isNotEmpty;
    } on TimeoutException {
      return false;
    }
  }

  // -- messages ----------------------------------------------------------

  Future<void> saveMessage({required String msgId, required String peerId, required String direction, required String body, required String status, double? ts}) async {
    final db = await _open();
    await db.insert(
      'messages',
      {'msg_id': msgId, 'peer_id': peerId, 'direction': direction, 'body': body, 'status': status, 'ts': ts ?? _now()},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> updateStatus(String msgId, String status) async {
    final db = await _open();
    await db.update('messages', {'status': status}, where: 'msg_id = ?', whereArgs: [msgId]);
  }

  Future<List<Message>> history(String peerId, {int limit = 50}) async {
    final db = await _open();
    final rows = await db.query('messages', where: 'peer_id = ?', whereArgs: [peerId], orderBy: 'ts ASC', limit: limit);
    return rows.map(Message.fromRow).toList();
  }

  /// Messages we tried to send but never got a delivery ack for.
  Future<List<Message>> pendingForPeer(String peerId) async {
    final db = await _open();
    final rows = await db.query(
      'messages',
      where: "peer_id = ? AND direction = 'sent' AND status IN ('pending', 'sent')",
      whereArgs: [peerId],
      orderBy: 'ts ASC',
    );
    return rows.map(Message.fromRow).toList();
  }

  // -- files ---------------------------------------------------------------

  Future<void> saveFile({
    required String transferId,
    required String peerId,
    required String direction,
    required String filename,
    required int size,
    required String sha256,
    required bool isExecutable,
    required String status,
    String? savedPath,
    double? ts,
    String? groupId,
  }) async {
    final db = await _open();
    await db.insert(
      'files',
      {
        'transfer_id': transferId,
        'peer_id': peerId,
        'direction': direction,
        'filename': filename,
        'size': size,
        'sha256': sha256,
        'is_executable': isExecutable ? 1 : 0,
        'status': status,
        'saved_path': savedPath,
        'ts': ts ?? _now(),
        'group_id': groupId,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> updateFileStatus(String transferId, String status, {String? savedPath}) async {
    final db = await _open();
    final values = <String, Object?>{'status': status};
    if (savedPath != null) values['saved_path'] = savedPath;
    await db.update('files', values, where: 'transfer_id = ?', whereArgs: [transferId]);
  }

  Future<FileRecord?> getFile(String transferId) async {
    final db = await _open();
    final rows = await db.query('files', where: 'transfer_id = ?', whereArgs: [transferId]);
    if (rows.isEmpty) return null;
    return FileRecord.fromRow(rows.first);
  }

  Future<List<FileRecord>> listFiles(String peerId) async {
    final db = await _open();
    final rows = await db.query('files', where: 'peer_id = ?', whereArgs: [peerId], orderBy: 'ts ASC');
    return rows.map(FileRecord.fromRow).toList();
  }

  // -- calls -----------------------------------------------------------

  Future<void> saveCallStart({required String callId, required String peerId, required String direction, required String media, double? startedAt}) async {
    final db = await _open();
    await db.insert(
      'calls',
      {'call_id': callId, 'peer_id': peerId, 'direction': direction, 'media': media, 'status': 'missed', 'started_at': startedAt ?? _now(), 'ended_at': null, 'duration': null},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> updateCallEnd(String callId, String status, {double? duration, double? endedAt}) async {
    final db = await _open();
    await db.update('calls', {'status': status, 'ended_at': endedAt ?? _now(), 'duration': duration}, where: 'call_id = ?', whereArgs: [callId]);
  }

  Future<List<Map<String, Object?>>> listCalls(String peerId, {int limit = 50}) async {
    final db = await _open();
    return db.query('calls', where: 'peer_id = ?', whereArgs: [peerId], orderBy: 'started_at DESC', limit: limit);
  }

  Future<List<Map<String, Object?>>> listAllCalls({int limit = 100}) async {
    final db = await _open();
    return db.query('calls', orderBy: 'started_at DESC', limit: limit);
  }

  Future<void> clearAllCalls() async {
    final db = await _open();
    await db.delete('calls');
  }

  // -- files: extra lookups -------------------------------------------------

  Future<List<FileRecord>> listAllFiles({int limit = 500}) async {
    final db = await _open();
    final rows = await db.query('files', orderBy: 'ts DESC', limit: limit);
    return rows.map(FileRecord.fromRow).toList();
  }

  /// Voice-message read receipt: only ever set once (a replay doesn't move
  /// the timestamp), mirroring storage.py's own "WHERE played_at IS NULL".
  Future<void> markFilePlayed(String transferId, {double? playedAt}) async {
    final db = await _open();
    await db.update('files', {'played_at': playedAt ?? _now()}, where: 'transfer_id = ? AND played_at IS NULL', whereArgs: [transferId]);
  }

  /// "Delete for me": removes this device's own local record of one
  /// transfer. Doesn't touch the actual bytes on disk at savedPath.
  Future<void> deleteFile(String transferId) async {
    final db = await _open();
    await db.delete('files', where: 'transfer_id = ?', whereArgs: [transferId]);
  }

  Future<List<FileRecord>> groupFiles(String groupId, {int limit = 200}) async {
    final db = await _open();
    final rows = await db.query('files', where: 'group_id = ?', whereArgs: [groupId], orderBy: 'ts ASC', limit: limit);
    return rows.map(FileRecord.fromRow).toList();
  }

  // -- conversations / known peers ------------------------------------------

  /// One row per peer ever messaged, each carrying its own most recent
  /// message - what the Chats list needs. Includes the peer's last-known
  /// name from known_peers so a conversation still shows a real name once
  /// that peer is no longer live in discovery.
  Future<List<Map<String, Object?>>> listConversations() async {
    final db = await _open();
    return db.rawQuery('''
      SELECT m.peer_id, m.body AS last_body, m.direction AS last_direction, m.status AS last_status, m.ts AS last_ts, k.name
      FROM messages m
      INNER JOIN (
        SELECT peer_id, MAX(ts) AS max_ts FROM messages GROUP BY peer_id
      ) latest ON m.peer_id = latest.peer_id AND m.ts = latest.max_ts
      LEFT JOIN known_peers k ON k.peer_id = m.peer_id
      ORDER BY m.ts DESC
    ''');
  }

  /// Remembers a peer's display name beyond its current live session.
  /// Deliberately an upsert that leaves public_key/signing_public_key
  /// untouched, same reasoning as storage.py's own save_known_peer.
  Future<void> saveKnownPeer(String peerId, String name, {double? ts}) async {
    final db = await _open();
    final now = ts ?? _now();
    final exists = (await db.query('known_peers', where: 'peer_id = ?', whereArgs: [peerId])).isNotEmpty;
    if (!exists) {
      await _evictOldestKnownPeersIfFull(db, peerId);
      await db.insert('known_peers', {'peer_id': peerId, 'name': name, 'last_seen': now});
    } else {
      await db.update('known_peers', {'name': name, 'last_seen': now}, where: 'peer_id = ?', whereArgs: [peerId]);
    }
  }

  Future<List<Map<String, Object?>>> listKnownPeers() async {
    final db = await _open();
    return db.query('known_peers', columns: ['peer_id', 'name', 'last_seen'], orderBy: 'last_seen DESC');
  }

  Future<String?> getKnownPeerPhotoHash(String peerId) async {
    final db = await _open();
    final rows = await db.query('known_peers', columns: ['photo_hash'], where: 'peer_id = ?', whereArgs: [peerId]);
    return rows.isEmpty ? null : rows.first['photo_hash'] as String?;
  }

  Future<void> setKnownPeerPhotoHash(String peerId, String? photoHash) async {
    final db = await _open();
    await db.update('known_peers', {'photo_hash': photoHash}, where: 'peer_id = ?', whereArgs: [peerId]);
  }

  Future<List<Map<String, Object?>>> listBlockedPeers() async {
    final db = await _open();
    return db.query('blocked_peers', orderBy: 'blocked_at DESC');
  }

  // -- disappearing messages -------------------------------------------------

  /// seconds=null turns disappearing messages off for this peer (removes
  /// the row entirely, rather than storing a 0/null sentinel).
  Future<void> setDisappearingDuration(String peerId, int? seconds) async {
    final db = await _open();
    if (seconds == null) {
      await db.delete('disappearing_settings', where: 'peer_id = ?', whereArgs: [peerId]);
    } else {
      await db.insert(
        'disappearing_settings',
        {'peer_id': peerId, 'duration_seconds': seconds, 'updated_at': _now()},
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
  }

  Future<int?> getDisappearingDuration(String peerId) async {
    final db = await _open();
    final rows = await db.query('disappearing_settings', columns: ['duration_seconds'], where: 'peer_id = ?', whereArgs: [peerId]);
    return rows.isEmpty ? null : rows.first['duration_seconds'] as int?;
  }

  Future<List<Map<String, Object?>>> listDisappearingSettings() async {
    final db = await _open();
    return db.query('disappearing_settings', columns: ['peer_id', 'duration_seconds']);
  }

  /// Deletes this device's own copy of anything in this conversation older
  /// than the cutoff; returns how many rows were removed.
  Future<int> deleteExpiredMessages(String peerId, double olderThanTs) async {
    final db = await _open();
    return db.delete('messages', where: 'peer_id = ? AND ts < ?', whereArgs: [peerId, olderThanTs]);
  }

  // -- deletion ("delete for me" / "delete for everyone") -------------------

  Future<void> deleteMessage(String msgId) async {
    final db = await _open();
    await db.delete('messages', where: 'msg_id = ?', whereArgs: [msgId]);
  }

  /// Wipes every message with one peer. Deliberately leaves known_peers and
  /// files untouched - same reasoning as storage.py's own clear_conversation.
  Future<void> clearConversation(String peerId) async {
    final db = await _open();
    await db.delete('messages', where: 'peer_id = ?', whereArgs: [peerId]);
  }

  /// Settings > Privacy & security's "Clear all local chat history" -
  /// every 1:1 and group message on this device, nothing else (known
  /// peers, files, call history all stay, same per-table scoping as the
  /// single-conversation clear above).
  Future<void> clearAllConversations() async {
    final db = await _open();
    await db.delete('messages');
    await db.delete('group_messages');
  }

  Future<void> savePendingDelete(String msgId, String peerId, {double? ts}) async {
    final db = await _open();
    await db.insert('pending_deletes', {'msg_id': msgId, 'peer_id': peerId, 'ts': ts ?? _now()}, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> removePendingDelete(String msgId) async {
    final db = await _open();
    await db.delete('pending_deletes', where: 'msg_id = ?', whereArgs: [msgId]);
  }

  Future<List<String>> pendingDeletesForPeer(String peerId) async {
    final db = await _open();
    final rows = await db.query('pending_deletes', columns: ['msg_id'], where: 'peer_id = ?', whereArgs: [peerId]);
    return rows.map((r) => r['msg_id'] as String).toList();
  }

  // -- groups ----------------------------------------------------------------

  /// Saves a group and its full membership - called both by the creator
  /// and by every invited member, so every device ends up with an
  /// identical local copy of who's in it.
  Future<void> saveGroup(String groupId, String name, List<GroupMember> members, {double? createdAt}) async {
    final db = await _open();
    // Bounded the same way checkAndPinSigningKey/checkAndRememberPeerKey
    // are (see their own comment) - but rethrown here rather than
    // swallowed: a stalled announcement is safe to silently drop and
    // retry later, a group that silently failed to save is a real error
    // the caller needs to know about, not a safe default to fall back to.
    await db.transaction((txn) async {
      await txn.insert('groups', {'group_id': groupId, 'name': name, 'created_at': createdAt ?? _now()}, conflictAlgorithm: ConflictAlgorithm.replace);
      for (final m in members) {
        await txn.insert('group_members', {'group_id': groupId, 'peer_id': m.peerId, 'name': m.name}, conflictAlgorithm: ConflictAlgorithm.replace);
      }
    }).timeout(dbTransactionTimeout);
  }

  Future<Group?> getGroup(String groupId) async {
    final db = await _open();
    final rows = await db.query('groups', where: 'group_id = ?', whereArgs: [groupId]);
    if (rows.isEmpty) return null;
    final memberRows = await db.query('group_members', where: 'group_id = ?', whereArgs: [groupId]);
    final members = memberRows.map((r) => GroupMember(r['peer_id'] as String, r['name'] as String)).toList();
    final r = rows.first;
    return Group(r['group_id'] as String, r['name'] as String, (r['created_at'] as num).toDouble(), members);
  }

  /// Every group this device is a member of, most recently created first.
  Future<List<Group>> listGroups() async {
    final db = await _open();
    final rows = await db.query('groups', orderBy: 'created_at DESC');
    final groups = <Group>[];
    for (final r in rows) {
      final memberRows = await db.query('group_members', where: 'group_id = ?', whereArgs: [r['group_id']]);
      final members = memberRows.map((m) => GroupMember(m['peer_id'] as String, m['name'] as String)).toList();
      groups.add(Group(r['group_id'] as String, r['name'] as String, (r['created_at'] as num).toDouble(), members));
    }
    return groups;
  }

  Future<void> saveGroupMessage({required String msgId, required String groupId, required String senderPeerId, required String senderName, required String body, double? ts}) async {
    final db = await _open();
    await db.insert(
      'group_messages',
      {'msg_id': msgId, 'group_id': groupId, 'sender_peer_id': senderPeerId, 'sender_name': senderName, 'body': body, 'ts': ts ?? _now()},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<GroupMessage>> groupHistory(String groupId, {int limit = 100}) async {
    final db = await _open();
    final rows = await db.query('group_messages', where: 'group_id = ?', whereArgs: [groupId], orderBy: 'ts ASC', limit: limit);
    return rows.map(GroupMessage.fromRow).toList();
  }

  /// "Delete for me" on a group message: removes only this device's own
  /// local copy, nothing goes over the wire.
  Future<void> deleteGroupMessage(String msgId) async {
    final db = await _open();
    await db.delete('group_messages', where: 'msg_id = ?', whereArgs: [msgId]);
  }

  Future<void> savePendingGroupMessage({
    required String msgId,
    required String peerId,
    required String groupId,
    required String senderPeerId,
    required String senderName,
    required String body,
    required double ts,
  }) async {
    final db = await _open();
    await db.insert(
      'pending_group_messages',
      {'msg_id': msgId, 'peer_id': peerId, 'group_id': groupId, 'sender_peer_id': senderPeerId, 'sender_name': senderName, 'body': body, 'ts': ts},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> removePendingGroupMessage(String msgId, String peerId) async {
    final db = await _open();
    await db.delete('pending_group_messages', where: 'msg_id = ? AND peer_id = ?', whereArgs: [msgId, peerId]);
  }

  Future<List<GroupMessage>> pendingGroupMessagesForPeer(String peerId) async {
    final db = await _open();
    final rows = await db.query('pending_group_messages', where: 'peer_id = ?', whereArgs: [peerId]);
    return rows.map(GroupMessage.fromRow).toList();
  }

  Future<void> savePendingGroupDelete(String msgId, String peerId, String groupId, {double? ts}) async {
    final db = await _open();
    await db.insert(
      'pending_group_deletes',
      {'msg_id': msgId, 'peer_id': peerId, 'group_id': groupId, 'ts': ts ?? _now()},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> removePendingGroupDelete(String msgId, String peerId) async {
    final db = await _open();
    await db.delete('pending_group_deletes', where: 'msg_id = ? AND peer_id = ?', whereArgs: [msgId, peerId]);
  }

  /// Returns (msg_id, group_id) pairs - the group_id is what lets the
  /// flush loop rebuild a real group_delete wire message.
  Future<List<(String, String)>> pendingGroupDeletesForPeer(String peerId) async {
    final db = await _open();
    final rows = await db.query('pending_group_deletes', columns: ['msg_id', 'group_id'], where: 'peer_id = ?', whereArgs: [peerId]);
    return rows.map((r) => (r['msg_id'] as String, r['group_id'] as String)).toList();
  }
}

class FileRecord {
  final String transferId;
  final String peerId;
  final String direction;
  final String filename;
  final int size;
  final String sha256;
  final bool isExecutable;
  final String status;
  final String? savedPath;
  final double ts;
  final String? groupId;
  final double? playedAt;

  FileRecord({
    required this.transferId,
    required this.peerId,
    required this.direction,
    required this.filename,
    required this.size,
    required this.sha256,
    required this.isExecutable,
    required this.status,
    this.savedPath,
    required this.ts,
    this.groupId,
    this.playedAt,
  });

  factory FileRecord.fromRow(Map<String, Object?> row) => FileRecord(
        transferId: row['transfer_id'] as String,
        peerId: row['peer_id'] as String,
        direction: row['direction'] as String,
        filename: row['filename'] as String,
        size: row['size'] as int,
        sha256: row['sha256'] as String,
        isExecutable: (row['is_executable'] as int) != 0,
        status: row['status'] as String,
        savedPath: row['saved_path'] as String?,
        ts: (row['ts'] as num).toDouble(),
        groupId: row['group_id'] as String?,
        playedAt: (row['played_at'] as num?)?.toDouble(),
      );
}

class GroupMember {
  final String peerId;
  final String name;
  const GroupMember(this.peerId, this.name);
}

class Group {
  final String groupId;
  final String name;
  final double createdAt;
  final List<GroupMember> members;
  const Group(this.groupId, this.name, this.createdAt, this.members);
}

class GroupMessage {
  final String msgId;
  final String groupId;
  final String senderPeerId;
  final String senderName;
  final String body;
  final double ts;

  GroupMessage({required this.msgId, required this.groupId, required this.senderPeerId, required this.senderName, required this.body, required this.ts});

  factory GroupMessage.fromRow(Map<String, Object?> row) => GroupMessage(
        msgId: row['msg_id'] as String,
        groupId: row['group_id'] as String,
        senderPeerId: row['sender_peer_id'] as String,
        senderName: row['sender_name'] as String,
        body: row['body'] as String,
        ts: (row['ts'] as num).toDouble(),
      );
}
