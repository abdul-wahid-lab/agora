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
);
CREATE INDEX IF NOT EXISTS idx_files_peer ON files(peer_id, ts);

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
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()

    def _run(self, fn):
        conn = sqlite3.connect(self.db_path)
        try:
            return fn(conn)
        finally:
            conn.close()

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
    ) -> None:
        ts = ts if ts is not None else time.time()

        def _op(conn: sqlite3.Connection):
            conn.execute(
                "INSERT OR REPLACE INTO files "
                "(transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (transfer_id, peer_id, direction, filename, size, sha256, int(is_executable), status, saved_path, ts),
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
                "SELECT transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts "
                "FROM files WHERE transfer_id = ?",
                (transfer_id,),
            ).fetchone()
            if row is None:
                return None
            return FileRecord(row[0], row[1], row[2], row[3], row[4], row[5], bool(row[6]), row[7], row[8], row[9])

        return await asyncio.to_thread(self._run, _op)

    async def list_all_files(self, limit: int = 500) -> list[FileRecord]:
        """Every file transfer across every peer, most recent first - what
        the unified Files browser shows (distinct from list_files, which is
        scoped to one conversation)."""

        def _op(conn: sqlite3.Connection) -> list[FileRecord]:
            rows = conn.execute(
                "SELECT transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts "
                "FROM files ORDER BY ts DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [FileRecord(r[0], r[1], r[2], r[3], r[4], r[5], bool(r[6]), r[7], r[8], r[9]) for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def list_files(self, peer_id: str, limit: int = 50) -> list[FileRecord]:
        def _op(conn: sqlite3.Connection) -> list[FileRecord]:
            rows = conn.execute(
                "SELECT transfer_id, peer_id, direction, filename, size, sha256, is_executable, status, saved_path, ts "
                "FROM files WHERE peer_id = ? ORDER BY ts ASC LIMIT ?",
                (peer_id, limit),
            ).fetchall()
            return [FileRecord(r[0], r[1], r[2], r[3], r[4], r[5], bool(r[6]), r[7], r[8], r[9]) for r in rows]

        return await asyncio.to_thread(self._run, _op)

    async def list_conversations(self) -> list[dict]:
        """One row per peer we've ever exchanged a message with, each
        carrying its own most recent message - what the Chats list actually
        needs (distinct from `history`, which is one peer's full thread).
        Ordered by recency so the list reads like a real chat app's."""

        def _op(conn: sqlite3.Connection) -> list[dict]:
            rows = conn.execute(
                """
                SELECT m.peer_id, m.body, m.direction, m.status, m.ts
                FROM messages m
                INNER JOIN (
                    SELECT peer_id, MAX(ts) AS max_ts FROM messages GROUP BY peer_id
                ) latest ON m.peer_id = latest.peer_id AND m.ts = latest.max_ts
                ORDER BY m.ts DESC
                """
            ).fetchall()
            return [
                {"peer_id": r[0], "last_body": r[1], "last_direction": r[2], "last_status": r[3], "last_ts": r[4]}
                for r in rows
            ]

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
