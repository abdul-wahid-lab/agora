"""
Phase 2 - Local persistence.

Each device keeps its own SQLite file. No shared/central database -
sender and receiver each store their own copy of every message, per the
spec's "your data stays on this network / this device" design.
"""

from __future__ import annotations

import asyncio
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# A cap on known_peers, found necessary by stress-testing the signed-
# discovery fix (see storage.check_and_pin_signing_key): trust-on-first-use
# permanently remembers every never-before-seen peer_id, and a real
# adversarial flood test showed an attacker can trigger a first-sighting
# insert with nothing more than one cheap, self-signed UDP broadcast per
# fake identity - no connection handshake needed, unlike the older
# encryption-key trust-on-first-use path this table already had. Without a
# cap, that's unbounded permanent disk growth from a trivial one-way
# packet flood. 10,000 is generous for what this app actually is (a LAN
# chat app, not a service with millions of real contacts) while still
# bounding the damage: oldest-last_seen entries are evicted to make room
# for a genuinely new one, never the other way around.
MAX_KNOWN_PEERS = 10_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    msg_id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    direction TEXT NOT NULL,   -- 'sent' or 'received'
    body TEXT NOT NULL,
    status TEXT NOT NULL,      -- 'pending' | 'sent' | 'delivered' | 'received' | 'failed'
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_peer ON messages(peer_id, ts);

CREATE TABLE IF NOT EXISTS files (
    transfer_id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    direction TEXT NOT NULL,     -- 'sent' or 'received'
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    is_executable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,        -- 'offered' | 'awaiting_accept' | 'accepted' | 'declined' |
                                  -- 'transferring' | 'completed' | 'failed'
    saved_path TEXT,
    ts REAL NOT NULL
    -- group_id added via migration below, not here - CREATE TABLE IF NOT
    -- EXISTS is a no-op against an already-existing files table (any real
    -- device with prior message/file history), so a column added only
    -- here would silently never reach that table, and CREATE INDEX would
    -- then fail outright against the missing column, exactly what
    -- happened when this was tested against a leftover local .db file.
);
CREATE INDEX IF NOT EXISTS idx_files_peer ON files(peer_id, ts);

CREATE TABLE IF NOT EXISTS known_peers (
    peer_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_seen REAL NOT NULL
    -- public_key added via migration below, same reason group_id was:
    -- an already-existing known_peers table predates this column.
);

CREATE TABLE IF NOT EXISTS device_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- exactly one row, ever
    private_key TEXT NOT NULL,
    public_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_peers (
    peer_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    blocked_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS disappearing_settings (
    peer_id TEXT PRIMARY KEY,
    duration_seconds INTEGER NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
    call_id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    direction TEXT NOT NULL,   -- 'outgoing' or 'incoming'
    media TEXT NOT NULL,       -- 'audio' or 'video'
    status TEXT NOT NULL,      -- 'missed' | 'declined' | 'completed' | 'dropped' | 'failed' | 'busy' | 'collision'
    started_at REAL NOT NULL,
    ended_at REAL,
    duration REAL              -- seconds actually connected (in_call), not total ring time
);
CREATE INDEX IF NOT EXISTS idx_calls_peer ON calls(peer_id, started_at);

CREATE TABLE IF NOT EXISTS groups (
    group_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (group_id, peer_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
    msg_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    sender_peer_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    body TEXT NOT NULL,
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, ts);

CREATE TABLE IF NOT EXISTS pending_group_messages (
    msg_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,        -- the one member this specific fan-out copy never reached
    group_id TEXT NOT NULL,
    sender_peer_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    body TEXT NOT NULL,
    ts REAL NOT NULL,
    PRIMARY KEY (msg_id, peer_id)  -- same message can be pending for several offline members at once
);

CREATE TABLE IF NOT EXISTS pending_deletes (
    msg_id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    ts REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_group_deletes (
    msg_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,   -- the one member this specific delete notice never reached
    group_id TEXT NOT NULL,
    ts REAL NOT NULL,
    PRIMARY KEY (msg_id, peer_id)  -- same delete can be pending for several offline members at once
);
"""


@dataclass
class Message:
    msg_id: str
    peer_id: str
    direction: str
    body: str
    status: str
    ts: float


@dataclass
class CallRecord:
    call_id: str
    peer_id: str
    direction: str
    media: str
    status: str
    started_at: float
    ended_at: Optional[float]
    duration: Optional[float]


@dataclass
class FileRecord:
    transfer_id: str
    peer_id: str
    direction: str
    filename: str
    size: int
    sha256: str
    is_executable: bool
    status: str
    saved_path: Optional[str]
    ts: float
    group_id: Optional[str] = None
    played_at: Optional[float] = None


@dataclass
class GroupMember:
    peer_id: str
    name: str


@dataclass
class Group:
    group_id: str
    name: str
    created_at: float
    members: list[GroupMember]


@dataclass
class GroupMessage:
    msg_id: str
    group_id: str
    sender_peer_id: str
    sender_name: str
    body: str
    ts: float


class MessageStore:
    """Thin async wrapper around a per-device SQLite file.

    Each call opens a short-lived connection on a worker thread rather than
    sharing one connection across threads/coroutines - simplest way to stay
    correct without a connection-pool for what is, per device, low-volume
    traffic.
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _init_schema(self) -> None:
        conn = sqlite3.connect(self.db_path)
        try:
            # WAL mode persists in the database file itself (a one-time
            # switch, not a per-connection setting), so every later
            # connection this class opens - including from a completely
            # different process on a later launch - picks it up
            # automatically. Found via stress-testing real message
            # throughput: SQLite's default rollback-journal mode does a
            # full synchronous disk flush on every single commit, which
            # measured at ~20ms per write on this machine - two of those
            # per message (save_message, then update_status) accounted for
            # nearly all of a 500-message send's ~59ms-per-message real
            # time, real encryption included at under 0.01ms. WAL mode
            # (with SQLite's own recommended NORMAL synchronous pairing -
            # still fully safe from corruption, the tradeoff is only a
            # vanishingly small durability window on true power loss, not
            # correctness under any normal failure) cut this dramatically.
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.executescript(SCHEMA)
            self._migrate(conn)
            conn.commit()
        finally:
            conn.close()

    def _migrate(self, conn: sqlite3.Connection) -> None:
        """Schema changes that CREATE TABLE IF NOT EXISTS can't express
        against an already-existing database - anyone who already has an
        agora.db with message/file history predates the group_id column,
        and ALTER TABLE is the only safe way to add it without losing their
        data. Each migration checks for its own column first so this stays
        idempotent (safe to run on every startup, on both a fresh db and an
        old one)."""
        existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(files)").fetchall()}
        if "group_id" not in existing_columns:
            conn.execute("ALTER TABLE files ADD COLUMN group_id TEXT")
        if "played_at" not in existing_columns:
            # Voice-message read receipts (see api.py's mark_file_played) -
            # when the *other* side actually played this transfer back, not
            # just when it finished downloading. Only ever meaningful on a
            # "sent" row (the sender is who wants to know "did they listen
            # to it"), but added to every row rather than a separate table,
            # same reasoning saved_path already uses for a field that's
            # only ever populated on one direction.
            conn.execute("ALTER TABLE files ADD COLUMN played_at REAL")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_files_group ON files(group_id, ts)")

        known_peers_columns = {row[1] for row in conn.execute("PRAGMA table_info(known_peers)").fetchall()}
        if "public_key" not in known_peers_columns:
            conn.execute("ALTER TABLE known_peers ADD COLUMN public_key TEXT")
        if "signing_public_key" not in known_peers_columns:
            # The pinned key for verifying discovery announcements (see
            # crypto_identity.py's signed-broadcast section) - deliberately
            # a separate column from public_key (the encryption key): they
            # are different keys for different purposes, and a peer_id's
            # encryption key can legitimately be re-derived/rotated
            # independently of whether its signing identity has changed.
            conn.execute("ALTER TABLE known_peers ADD COLUMN signing_public_key TEXT")
        if "photo_hash" not in known_peers_columns:
            # The sha256 of whatever photo this peer_id last announced
            # having, see photos.py - lets a cached copy in photos/peers/
            # be trusted without re-fetching it over the network on every
            # sighting, and tells us the moment it needs refreshing instead.
            conn.execute("ALTER TABLE known_peers ADD COLUMN photo_hash TEXT")

        device_identity_columns = {row[1] for row in conn.execute("PRAGMA table_info(device_identity)").fetchall()}
        if "signing_private_key" not in device_identity_columns:
            conn.execute("ALTER TABLE device_identity ADD COLUMN signing_private_key TEXT")
        if "signing_public_key" not in device_identity_columns:
            conn.execute("ALTER TABLE device_identity ADD COLUMN signing_public_key TEXT")

    def _connect(self, isolation_level: object = "") -> sqlite3.Connection:
        """The one place every connection in this class comes from -
        `sqlite3.connect()`'s own default isolation_level ("") is passed
        explicitly rather than omitted, so a caller that needs manual
        transaction control (isolation_level=None) is an obvious,
        deliberate exception, not an inconsistency. journal_mode=WAL is
        stored in the database file itself (set once in _init_schema) and
        applies automatically here, but synchronous is a per-connection
        setting that resets to SQLite's default (FULL) on every new
        connection unless reapplied - see _init_schema's own comment for
        why NORMAL matters here."""
        conn = sqlite3.connect(self.db_path, isolation_level=isolation_level)
        conn.execute("PRAGMA synchronous = NORMAL")
        return conn

    def _run(self, fn):
        conn = self._connect()
        try:
            return fn(conn)
        finally:
            conn.close()

    def _evict_oldest_known_peers_if_full(self, conn: sqlite3.Connection, peer_id: str) -> None:
        """Called right before inserting a genuinely NEW known_peers row
        (never on an update to an existing one) - see MAX_KNOWN_PEERS'
        own comment for why this cap exists. Evicts the least-recently-
        seen row(s) to make room, but never the row for `peer_id` itself
        (irrelevant here since it doesn't exist yet, but keeps this safe
        to reuse if that ever changes) and never more than necessary to
        get back under the cap."""
        count = conn.execute("SELECT COUNT(*) FROM known_peers").fetchone()[0]
        if count < MAX_KNOWN_PEERS:
            return
        to_evict = count - MAX_KNOWN_PEERS + 1
        conn.execute(
            "DELETE FROM known_peers WHERE peer_id IN ("
            "  SELECT peer_id FROM known_peers WHERE peer_id != ? ORDER BY last_seen ASC LIMIT ?"
            ")",
            (peer_id, to_evict),
        )

    async def save_message(self, msg_id: str, peer_id: str, direction: str, body: str, status: str, ts: Optional[float] = None) -> None:
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO messages (msg_id, peer_id, direction, body, status, ts) VALUES (?, ?, ?, ?, ?, ?)",
                (msg_id, peer_id, direction, body, status, ts),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def update_status(self, msg_id: str, status: str) -> None:
        def _op(conn: sqlite3.Connection):
            conn.execute("UPDATE messages SET status = ? WHERE msg_id = ?", (status, msg_id))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def history(self, peer_id: str, limit: int = 50) -> list[Message]:
        def _op(conn: sqlite3.Connection) -> list[Message]:
            rows = conn.execute(
                "SELECT msg_id, peer_id, direction, body, status, ts FROM messages WHERE peer_id = ? ORDER BY ts ASC LIMIT ?",
                (peer_id, limit),
            ).fetchall()
            return [Message(*row) for row in rows]

        return await asyncio.to_thread(self._run, _op)

    async def save_file(
        self,
        transfer_id: str,
        peer_id: str,
        direction: str,
        filename: str,
        size: int,
        sha256: str,
        is_executable: bool,
        status: str,
        saved_path: Optional[str] = None,
        ts: Optional[float] = None,
        group_id: Optional[str] = None,
    ) -> None:
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO files "
                "(transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts, group_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (transfer_id, peer_id, direction, filename, size, sha256, int(is_executable), status, saved_path, ts, group_id),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def update_file_status(self, transfer_id: str, status: str, saved_path: Optional[str] = None) -> None:
        def _op(conn: sqlite3.Connection):
            if saved_path is not None:
                conn.execute("UPDATE files SET status = ?, saved_path = ? WHERE transfer_id = ?", (status, saved_path, transfer_id))
            else:
                conn.execute("UPDATE files SET status = ? WHERE transfer_id = ?", (status, transfer_id))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def get_file(self, transfer_id: str) -> Optional[FileRecord]:
        def _op(conn: sqlite3.Connection) -> Optional[FileRecord]:
            row = conn.execute(
                "SELECT transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts, group_id, played_at "
                "FROM files WHERE transfer_id = ?",
                (transfer_id,),
            ).fetchone()
            if row is None:
                return None
            return FileRecord(row[0], row[1], row[2], row[3], row[4], row[5], bool(row[6]), row[7], row[8], row[9], row[10], row[11])

        return await asyncio.to_thread(self._run, _op)

    async def list_all_files(self, limit: int = 500) -> list[FileRecord]:
        """Every file transfer across every peer, most recent first - what
        the unified Files browser shows (distinct from list_files, which is
        scoped to one conversation)."""

        def _op(conn: sqlite3.Connection) -> list[FileRecord]:
            rows = conn.execute(
                "SELECT transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts, group_id, played_at "
                "FROM files ORDER BY ts DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [FileRecord(r[0], r[1], r[2], r[3], r[4], r[5], bool(r[6]), r[7], r[8], r[9], r[10], r[11]) for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def list_files(self, peer_id: str, limit: int = 50) -> list[FileRecord]:
        def _op(conn: sqlite3.Connection) -> list[FileRecord]:
            rows = conn.execute(
                "SELECT transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts, group_id, played_at "
                "FROM files WHERE peer_id = ? ORDER BY ts ASC LIMIT ?",
                (peer_id, limit),
            ).fetchall()
            return [FileRecord(r[0], r[1], r[2], r[3], r[4], r[5], bool(r[6]), r[7], r[8], r[9], r[10], r[11]) for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def mark_file_played(self, transfer_id: str, played_at: Optional[float] = None) -> None:
        """Voice-message read receipt: called on the *sender's* own row once
        the other side actually plays the clip back (see api.py's
        mark_file_played and the file_played control message in
        messaging.py). Only ever set once - a replay doesn't move the
        timestamp - so this is a no-op past the first call."""
        played_at = played_at if played_at is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute("UPDATE files SET played_at = ? WHERE transfer_id = ? AND played_at IS NULL", (played_at, transfer_id))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def delete_file(self, transfer_id: str) -> None:
        """'Delete for me': removes this device's own local record of one
        file transfer, same as delete_message. Purely local, no wire
        protocol involved, and deliberately doesn't touch the actual bytes
        on disk at saved_path - clearing a transfer's history entry is a
        different, smaller action than deleting a file you've downloaded."""

        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM files WHERE transfer_id = ?", (transfer_id,))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def group_files(self, group_id: str, limit: int = 200) -> list[FileRecord]:
        """Every file sent/received as part of one group, across however
        many individual 1:1 transfers that fanned out to - what the group
        chat's merged message+file timeline shows."""

        def _op(conn: sqlite3.Connection) -> list[FileRecord]:
            rows = conn.execute(
                "SELECT transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts, group_id, played_at "
                "FROM files WHERE group_id = ? ORDER BY ts ASC LIMIT ?",
                (group_id, limit),
            ).fetchall()
            return [FileRecord(r[0], r[1], r[2], r[3], r[4], r[5], bool(r[6]), r[7], r[8], r[9], r[10], r[11]) for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def list_conversations(self) -> list[dict]:
        """One row per peer we've ever exchanged a message with, each
        carrying its own most recent message - what the Chats list actually
        needs (distinct from `history`, which is one peer's full thread).
        Ordered by recency so the list reads like a real chat app's.

        Includes the peer's last-known display name from `known_peers` (see
        `save_known_peer`) so a conversation still shows a real name after
        that peer goes offline, instead of the UI having nothing to show but
        a bare peer_id once it's no longer in the live discovery list."""

        def _op(conn: sqlite3.Connection) -> list[dict]:
            rows = conn.execute(
                """
                SELECT m.peer_id, m.body, m.direction, m.status, m.ts, k.name
                FROM messages m
                INNER JOIN (
                    SELECT peer_id, MAX(ts) AS max_ts FROM messages GROUP BY peer_id
                ) latest ON m.peer_id = latest.peer_id AND m.ts = latest.max_ts
                LEFT JOIN known_peers k ON k.peer_id = m.peer_id
                ORDER BY m.ts DESC
                """
            ).fetchall()
            return [
                {"peer_id": r[0], "last_body": r[1], "last_direction": r[2], "last_status": r[3], "last_ts": r[4], "name": r[5]}
                for r in rows
            ]

        return await asyncio.to_thread(self._run, _op)

    async def save_known_peer(self, peer_id: str, name: str, ts: Optional[float] = None) -> None:
        """Remembers a peer's display name beyond its current live session -
        discovery.py's registry is purely in-memory and forgets a peer the
        moment it drops off the network, which would otherwise mean a
        conversation's name reverting to "Unknown" as soon as the other
        person closes their laptop.

        Deliberately an UPSERT that leaves public_key untouched, not an
        INSERT OR REPLACE - this is also called from the contacts-import
        flow, which only ever has a peer_id/name/last_seen to offer, and a
        blind REPLACE would silently null out a real trust-on-first-use key
        already recorded for that peer_id by check_and_remember_peer_key."""
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection):
            row_exists = conn.execute("SELECT 1 FROM known_peers WHERE peer_id = ?", (peer_id,)).fetchone() is not None
            if not row_exists:
                # Same unbounded-growth concern MAX_KNOWN_PEERS exists for -
                # reached here only via the local-only API's contacts-import
                # (peers already live in discovery already went through
                # check_and_pin_signing_key's own cap first).
                self._evict_oldest_known_peers_if_full(conn, peer_id)
            conn.execute(
                """
                INSERT INTO known_peers (peer_id, name, last_seen) VALUES (?, ?, ?)
                ON CONFLICT(peer_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen
                """,
                (peer_id, name, ts),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    def get_or_create_device_keys(self) -> dict:
        """This device's own X25519 (encryption) and Ed25519 (discovery-
        broadcast signing - see crypto_identity.py) keypairs - generated
        once, on first ever run, and reused forever after (a fresh keypair
        every restart would make every peer's trust-on-first-use record
        look like an identity change on every launch). Deliberately
        synchronous, not wrapped in asyncio.to_thread like the rest of this
        class: called once at module-load time in api.py, before the event
        loop exists, the same way NAME/PORT/PEER_ID are already resolved
        there.

        A device that already has an X25519 row from before signing keys
        existed gets its signing keypair backfilled in place, once - same
        idempotent-migration spirit as _migrate(), just data instead of
        schema."""
        from app.crypto_identity import generate_keypair, generate_signing_keypair

        conn = self._connect()
        try:
            row = conn.execute("SELECT private_key, public_key, signing_private_key, signing_public_key FROM device_identity WHERE id = 1").fetchone()
            if row:
                private_key, public_key, signing_private_key, signing_public_key = row
                if not signing_private_key or not signing_public_key:
                    signing_private_key, signing_public_key = generate_signing_keypair()
                    conn.execute(
                        "UPDATE device_identity SET signing_private_key = ?, signing_public_key = ? WHERE id = 1",
                        (signing_private_key, signing_public_key),
                    )
                    conn.commit()
                return {"private_key": private_key, "public_key": public_key, "signing_private_key": signing_private_key, "signing_public_key": signing_public_key}

            private_key, public_key = generate_keypair()
            signing_private_key, signing_public_key = generate_signing_keypair()
            conn.execute(
                "INSERT INTO device_identity (id, private_key, public_key, signing_private_key, signing_public_key) VALUES (1, ?, ?, ?, ?)",
                (private_key, public_key, signing_private_key, signing_public_key),
            )
            conn.commit()
            return {"private_key": private_key, "public_key": public_key, "signing_private_key": signing_private_key, "signing_public_key": signing_public_key}
        finally:
            conn.close()

    def check_and_pin_signing_key(self, peer_id: str, signing_public_key: str) -> bool:
        """The real fix for the discovery-spoofing hole a real adversarial
        test found (see _test_adversarial.py's Attack 3): called from
        discovery.py's own listener callbacks, on every announcement,
        *before* it's ever allowed to reach the live PeerRegistry - not
        lazily, later, only once messaging.py happens to talk to that
        peer_id. Returns True (accept) the first time this peer_id is ever
        seen, or if its signing key already matches what's on file. Returns
        False (reject - the announcement is dropped, never upserted) if a
        *different* signing key is claiming a peer_id already pinned to
        another one - exactly the forged-broadcast scenario that attack
        demonstrated.

        Deliberately synchronous like get_or_create_device_keys: discovery
        callbacks run on zeroconf's own thread and the UDP listener thread,
        neither of which has (or should need) access to the asyncio event
        loop. Each call opens its own short-lived connection, same as
        every other method here - safe to call from any thread.

        The read-then-write here is wrapped in a single atomic transaction
        (BEGIN IMMEDIATE), not a plain SELECT followed by a separate
        INSERT - found the hard way by stress-testing this exact method
        with two real OS threads racing to pin a brand-new peer_id at the
        same instant: without the transaction, both threads' SELECT could
        see "nothing pinned yet" before either one's INSERT committed, so
        *both* returned True - a real TOCTOU race that could let a
        precisely-timed forged announcement slip in as if it were the
        legitimate first sighting, undermining the exact guarantee this
        method exists to provide. BEGIN IMMEDIATE takes SQLite's write lock
        up front, so a second thread's own BEGIN IMMEDIATE blocks until the
        first thread's transaction fully commits (busy_timeout below is
        what makes it wait instead of raising "database is locked")."""

        # A real 32-way-concurrent stress run found two bugs here, not one:
        # first, that busy_timeout alone isn't always enough - under heavy
        # enough real contention BEGIN IMMEDIATE can still raise "database
        # is locked" even after waiting out the full timeout, so this now
        # retries that specific error a bounded number of times instead of
        # ever propagating a transient lock as a hard failure. Second, and
        # worse: the original `except Exception: conn.execute("ROLLBACK")`
        # assumed a transaction was always open by the time an exception
        # could occur - but if BEGIN IMMEDIATE itself is what raised (the
        # exact "database is locked" case), there is no transaction to roll
        # back, and SQLite raises a SECOND, unrelated error ("cannot
        # rollback - no transaction is active") that replaces the real one.
        # That second error then propagates out of discovery.py's listener
        # callbacks uncaught (see the hardening added there in the same
        # investigation), which was observed to permanently kill the UDP
        # discovery thread for the rest of the app session - a single
        # transient lock timeout silently disabling UDP fallback forever,
        # not a contained, recoverable failure. `in_transaction` tracks
        # whether BEGIN IMMEDIATE actually succeeded before ever attempting
        # a rollback.
        attempts_left = 3
        while True:
            conn = self._connect(isolation_level=None)
            in_transaction = False
            try:
                conn.execute("PRAGMA busy_timeout = 5000")
                conn.execute("BEGIN IMMEDIATE")
                in_transaction = True
                row = conn.execute("SELECT signing_public_key FROM known_peers WHERE peer_id = ?", (peer_id,)).fetchone()
                pinned = row[0] if row else None
                if pinned is not None:
                    conn.execute("COMMIT")
                    return pinned == signing_public_key
                # First sighting ever - pin it, still inside the same
                # transaction the check above ran in. known_peers may or
                # may not already have a row for this peer_id (e.g. from a
                # contacts import, or an earlier encryption-key sighting) -
                # upsert rather than assume either way, same pattern as
                # check_and_remember_peer_key. Only evict to make room when
                # this peer_id doesn't have a row at all yet - a peer
                # already known for some other reason isn't growing the
                # table, so there's nothing to make room for.
                row_exists = conn.execute("SELECT 1 FROM known_peers WHERE peer_id = ?", (peer_id,)).fetchone() is not None
                if not row_exists:
                    self._evict_oldest_known_peers_if_full(conn, peer_id)
                conn.execute(
                    """
                    INSERT INTO known_peers (peer_id, name, last_seen, signing_public_key) VALUES (?, ?, ?, ?)
                    ON CONFLICT(peer_id) DO UPDATE SET signing_public_key = excluded.signing_public_key
                    """,
                    (peer_id, peer_id, time.time(), signing_public_key),
                )
                conn.execute("COMMIT")
                return True
            except sqlite3.OperationalError:
                if in_transaction:
                    conn.execute("ROLLBACK")
                attempts_left -= 1
                if attempts_left <= 0:
                    raise
                time.sleep(0.05)
                continue
            except Exception:
                if in_transaction:
                    conn.execute("ROLLBACK")
                raise
            finally:
                conn.close()

    async def check_and_remember_peer_key(self, peer_id: str, name: str, public_key: str, ts: Optional[float] = None) -> Optional[str]:
        """Trust-on-first-use. The first time this peer_id is ever seen (or
        whenever it matches what's already on file), its key is (re)recorded
        and this returns None - nothing to warn about. If a *different* key
        shows up for a peer_id we've already recorded one for, that's a real
        red flag (someone else now claiming this identity, or a genuine
        reinstall) - this returns the OLD key so the caller can surface a
        real warning instead of silently trusting or silently blocking it."""
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection) -> Optional[str]:
            row = conn.execute("SELECT public_key FROM known_peers WHERE peer_id = ?", (peer_id,)).fetchone()
            old_key = row[0] if row else None
            if row is None:
                # A genuinely new peer_id - same unbounded-growth concern
                # MAX_KNOWN_PEERS exists for (see its own comment), just
                # reached via a real connection handshake instead of a
                # bare UDP packet.
                self._evict_oldest_known_peers_if_full(conn, peer_id)
            conn.execute(
                """
                INSERT INTO known_peers (peer_id, name, last_seen, public_key) VALUES (?, ?, ?, ?)
                ON CONFLICT(peer_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen, public_key = excluded.public_key
                """,
                (peer_id, name, ts, public_key),
            )
            conn.commit()
            if old_key is not None and old_key != public_key:
                return old_key
            return None

        return await asyncio.to_thread(self._run, _op)

    async def list_known_peers(self) -> list[dict]:
        """Every peer this device has ever exchanged a hello with, regardless
        of whether there's any message history - the Network menu's "Known
        Peers" view and contact export both need this broader list, unlike
        list_conversations() which only returns peers with real messages."""

        def _op(conn: sqlite3.Connection) -> list[dict]:
            rows = conn.execute("SELECT peer_id, name, last_seen FROM known_peers ORDER BY last_seen DESC").fetchall()
            return [{"peer_id": r[0], "name": r[1], "last_seen": r[2]} for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def get_known_peer_photo_hash(self, peer_id: str) -> Optional[str]:
        """What photo_hash this peer_id's cached photo (if any) was fetched
        against, so a request handler can tell a fresh cache from a stale
        one without re-reading and re-hashing the cached file itself."""

        def _op(conn: sqlite3.Connection) -> Optional[str]:
            row = conn.execute("SELECT photo_hash FROM known_peers WHERE peer_id = ?", (peer_id,)).fetchone()
            return row[0] if row else None

        return await asyncio.to_thread(self._run, _op)

    async def set_known_peer_photo_hash(self, peer_id: str, photo_hash: Optional[str]) -> None:
        def _op(conn: sqlite3.Connection):
            conn.execute("UPDATE known_peers SET photo_hash = ? WHERE peer_id = ?", (photo_hash, peer_id))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def block_peer(self, peer_id: str, name: str, ts: Optional[float] = None) -> None:
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute("INSERT OR REPLACE INTO blocked_peers (peer_id, name, blocked_at) VALUES (?, ?, ?)", (peer_id, name, ts))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def unblock_peer(self, peer_id: str) -> None:
        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM blocked_peers WHERE peer_id = ?", (peer_id,))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def is_peer_blocked(self, peer_id: str) -> bool:
        """Checked at the single real choke point every peer-to-peer channel
        rides through - see messaging.py's _handle_inbound/_get_connection -
        so a block actually refuses messages, calls, files, and group
        traffic all at once, not just one of them."""

        def _op(conn: sqlite3.Connection) -> bool:
            row = conn.execute("SELECT 1 FROM blocked_peers WHERE peer_id = ?", (peer_id,)).fetchone()
            return row is not None

        return await asyncio.to_thread(self._run, _op)

    async def list_blocked_peers(self) -> list[dict]:
        def _op(conn: sqlite3.Connection) -> list[dict]:
            rows = conn.execute("SELECT peer_id, name, blocked_at FROM blocked_peers ORDER BY blocked_at DESC").fetchall()
            return [{"peer_id": r[0], "name": r[1], "blocked_at": r[2]} for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def set_disappearing_duration(self, peer_id: str, seconds: Optional[int]) -> None:
        """seconds=None turns disappearing messages off for this peer
        (removes the row entirely, rather than storing a 0/null sentinel)."""

        def _op(conn: sqlite3.Connection):
            if seconds is None:
                conn.execute("DELETE FROM disappearing_settings WHERE peer_id = ?", (peer_id,))
            else:
                conn.execute(
                    "INSERT OR REPLACE INTO disappearing_settings (peer_id, duration_seconds, updated_at) VALUES (?, ?, ?)",
                    (peer_id, seconds, time.time()),
                )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def get_disappearing_duration(self, peer_id: str) -> Optional[int]:
        def _op(conn: sqlite3.Connection) -> Optional[int]:
            row = conn.execute("SELECT duration_seconds FROM disappearing_settings WHERE peer_id = ?", (peer_id,)).fetchone()
            return row[0] if row else None

        return await asyncio.to_thread(self._run, _op)

    async def list_disappearing_settings(self) -> list[dict]:
        """Backs the periodic sweep loop - every peer with an active setting,
        checked on a timer rather than scheduling a one-off task per message
        (simpler, and self-correcting if the app was closed for a while)."""

        def _op(conn: sqlite3.Connection) -> list[dict]:
            rows = conn.execute("SELECT peer_id, duration_seconds FROM disappearing_settings").fetchall()
            return [{"peer_id": r[0], "duration_seconds": r[1]} for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def delete_expired_messages(self, peer_id: str, older_than_ts: float) -> int:
        """Deletes this device's own copy of anything in this conversation
        older than the cutoff - local-only, see disappearing.py's own
        docstring for why this doesn't try to tell the peer to do the same."""

        def _op(conn: sqlite3.Connection) -> int:
            cur = conn.execute("DELETE FROM messages WHERE peer_id = ? AND ts < ?", (peer_id, older_than_ts))
            conn.commit()
            return cur.rowcount

        return await asyncio.to_thread(self._run, _op)

    async def save_call_start(self, call_id: str, peer_id: str, direction: str, media: str, started_at: Optional[float] = None) -> None:
        started_at = started_at if started_at is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO calls (call_id, peer_id, direction, media, status, started_at, ended_at, duration) "
                "VALUES (?, ?, ?, ?, 'missed', ?, NULL, NULL)",
                (call_id, peer_id, direction, media, started_at),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def update_call_end(self, call_id: str, status: str, duration: Optional[float] = None, ended_at: Optional[float] = None) -> None:
        ended_at = ended_at if ended_at is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "UPDATE calls SET status = ?, ended_at = ?, duration = ? WHERE call_id = ?",
                (status, ended_at, duration, call_id),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def list_all_calls(self, limit: int = 100) -> list[CallRecord]:
        """Every call across every peer, most recent first - the Calls tab's
        history view (distinct from list_calls, which is scoped to one
        peer's calling history)."""

        def _op(conn: sqlite3.Connection) -> list[CallRecord]:
            rows = conn.execute(
                "SELECT call_id, peer_id, direction, media, status, started_at, ended_at, duration "
                "FROM calls ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [CallRecord(*row) for row in rows]

        return await asyncio.to_thread(self._run, _op)

    async def list_calls(self, peer_id: str, limit: int = 50) -> list[CallRecord]:
        def _op(conn: sqlite3.Connection) -> list[CallRecord]:
            rows = conn.execute(
                "SELECT call_id, peer_id, direction, media, status, started_at, ended_at, duration "
                "FROM calls WHERE peer_id = ? ORDER BY started_at DESC LIMIT ?",
                (peer_id, limit),
            ).fetchall()
            return [CallRecord(*row) for row in rows]

        return await asyncio.to_thread(self._run, _op)

    async def delete_message(self, msg_id: str) -> None:
        """'Delete for me': removes this device's own local copy of one
        message. Purely local, no wire protocol involved - the other side's
        copy (if any) is untouched."""

        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM messages WHERE msg_id = ?", (msg_id,))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def clear_conversation(self, peer_id: str) -> None:
        """Wipes every message with one peer - a whole-thread 'clear chat'.
        Deliberately leaves `known_peers` (their remembered name) and `files`
        (the actual downloaded bytes on disk) untouched: wiping the name
        would resurrect the old "Unknown" bug for a peer who's currently
        offline, and file records point at real bytes a user may still want
        even after clearing the text history."""

        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM messages WHERE peer_id = ?", (peer_id,))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def clear_all_calls(self) -> None:
        """Wipes the entire call history. The Calls tab is one flat list
        across every peer (no per-peer view exists in the UI), so this
        mirrors that shape rather than clearing one peer at a time."""

        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM calls")
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def save_pending_delete(self, msg_id: str, peer_id: str, ts: Optional[float] = None) -> None:
        """Remembers a 'delete for everyone' that couldn't reach the peer
        yet (they were offline), so deletion.py's flush loop can retry it
        the same way messaging.py's _flush_pending_loop retries a held
        chat message - same guarantee, same shape, different table."""
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO pending_deletes (msg_id, peer_id, ts) VALUES (?, ?, ?)",
                (msg_id, peer_id, ts),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def remove_pending_delete(self, msg_id: str) -> None:
        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM pending_deletes WHERE msg_id = ?", (msg_id,))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def pending_deletes_for_peer(self, peer_id: str) -> list[str]:
        def _op(conn: sqlite3.Connection) -> list[str]:
            rows = conn.execute("SELECT msg_id FROM pending_deletes WHERE peer_id = ?", (peer_id,)).fetchall()
            return [r[0] for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def save_group(self, group_id: str, name: str, members: list[GroupMember], created_at: Optional[float] = None) -> None:
        """Saves a group and its full membership - called both by the
        creator (right after generating the group_id) and by every invited
        member (on receiving the group_invite control message), so every
        device ends up with an identical local copy of who's in it."""
        created_at = created_at if created_at is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute("INSERT OR REPLACE INTO groups (group_id, name, created_at) VALUES (?, ?, ?)", (group_id, name, created_at))
            for m in members:
                conn.execute("INSERT OR REPLACE INTO group_members (group_id, peer_id, name) VALUES (?, ?, ?)", (group_id, m.peer_id, m.name))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def get_group(self, group_id: str) -> Optional[Group]:
        def _op(conn: sqlite3.Connection) -> Optional[Group]:
            row = conn.execute("SELECT group_id, name, created_at FROM groups WHERE group_id = ?", (group_id,)).fetchone()
            if row is None:
                return None
            members = conn.execute("SELECT peer_id, name FROM group_members WHERE group_id = ?", (group_id,)).fetchall()
            return Group(row[0], row[1], row[2], [GroupMember(m[0], m[1]) for m in members])

        return await asyncio.to_thread(self._run, _op)

    async def list_groups(self) -> list[Group]:
        """Every group this device is a member of, most recently created
        first - what the Chats list's group section shows."""

        def _op(conn: sqlite3.Connection) -> list[Group]:
            rows = conn.execute("SELECT group_id, name, created_at FROM groups ORDER BY created_at DESC").fetchall()
            groups = []
            for r in rows:
                members = conn.execute("SELECT peer_id, name FROM group_members WHERE group_id = ?", (r[0],)).fetchall()
                groups.append(Group(r[0], r[1], r[2], [GroupMember(m[0], m[1]) for m in members]))
            return groups

        return await asyncio.to_thread(self._run, _op)

    async def save_group_message(self, msg_id: str, group_id: str, sender_peer_id: str, sender_name: str, body: str, ts: Optional[float] = None) -> None:
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO group_messages (msg_id, group_id, sender_peer_id, sender_name, body, ts) VALUES (?, ?, ?, ?, ?, ?)",
                (msg_id, group_id, sender_peer_id, sender_name, body, ts),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def group_history(self, group_id: str, limit: int = 100) -> list[GroupMessage]:
        def _op(conn: sqlite3.Connection) -> list[GroupMessage]:
            rows = conn.execute(
                "SELECT msg_id, group_id, sender_peer_id, sender_name, body, ts FROM group_messages WHERE group_id = ? ORDER BY ts ASC LIMIT ?",
                (group_id, limit),
            ).fetchall()
            return [GroupMessage(*row) for row in rows]

        return await asyncio.to_thread(self._run, _op)

    async def delete_group_message(self, msg_id: str) -> None:
        """'Delete for me' on a group message - same shape as the 1:1
        delete_message(): removes only this device's own local copy,
        nothing goes over the wire."""

        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM group_messages WHERE msg_id = ?", (msg_id,))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def save_pending_group_message(self, msg_id: str, peer_id: str, group_id: str, sender_peer_id: str, sender_name: str, body: str, ts: float) -> None:
        """One offline member missed a group message - remembered here so
        GroupService's own flush loop (mirrors messaging.py's
        _flush_pending_loop) can retry just their copy once they reappear,
        without resending to members who already got it fine."""

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO pending_group_messages (msg_id, peer_id, group_id, sender_peer_id, sender_name, body, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (msg_id, peer_id, group_id, sender_peer_id, sender_name, body, ts),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def remove_pending_group_message(self, msg_id: str, peer_id: str) -> None:
        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM pending_group_messages WHERE msg_id = ? AND peer_id = ?", (msg_id, peer_id))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def pending_group_messages_for_peer(self, peer_id: str) -> list[GroupMessage]:
        def _op(conn: sqlite3.Connection) -> list[GroupMessage]:
            rows = conn.execute(
                "SELECT msg_id, group_id, sender_peer_id, sender_name, body, ts FROM pending_group_messages WHERE peer_id = ?",
                (peer_id,),
            ).fetchall()
            return [GroupMessage(*row) for row in rows]

        return await asyncio.to_thread(self._run, _op)

    async def save_pending_group_delete(self, msg_id: str, peer_id: str, group_id: str, ts: Optional[float] = None) -> None:
        """One offline member never got told a group message was deleted -
        remembered here (with the group_id, needed to rebuild the exact
        group_delete wire message on retry) so GroupService's flush loop can
        retry just their notice once they reappear, mirroring pending_
        deletes' own 1:1 shape but keyed per-member since one delete can
        miss several different offline members at once."""

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO pending_group_deletes (msg_id, peer_id, group_id, ts) VALUES (?, ?, ?, ?)",
                (msg_id, peer_id, group_id, ts if ts is not None else time.time()),
            )
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def remove_pending_group_delete(self, msg_id: str, peer_id: str) -> None:
        def _op(conn: sqlite3.Connection):
            conn.execute("DELETE FROM pending_group_deletes WHERE msg_id = ? AND peer_id = ?", (msg_id, peer_id))
            conn.commit()

        await asyncio.to_thread(self._run, _op)

    async def pending_group_deletes_for_peer(self, peer_id: str) -> list[tuple[str, str]]:
        """Returns (msg_id, group_id) pairs - the group_id is what lets the
        flush loop rebuild a real group_delete wire message, not just a bare
        msg_id with nowhere to put it."""

        def _op(conn: sqlite3.Connection) -> list[tuple[str, str]]:
            rows = conn.execute("SELECT msg_id, group_id FROM pending_group_deletes WHERE peer_id = ?", (peer_id,)).fetchall()
            return [(row[0], row[1]) for row in rows]

        return await asyncio.to_thread(self._run, _op)

    async def pending_for_peer(self, peer_id: str) -> list[Message]:
        """Messages we tried to send but never got a delivery ack for."""

        def _op(conn: sqlite3.Connection) -> list[Message]:
            rows = conn.execute(
                "SELECT msg_id, peer_id, direction, body, status, ts FROM messages "
                "WHERE peer_id = ? AND direction = 'sent' AND status IN ('pending', 'sent') ORDER BY ts ASC",
                (peer_id,),
            ).fetchall()
            return [Message(*row) for row in rows]

        return await asyncio.to_thread(self._run, _op)
