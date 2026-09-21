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
"""


@dataclass
class Message:
    msg_id: str
    peer_id: str
    direction: str
    body: str
    status: str
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
