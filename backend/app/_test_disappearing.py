"""
Automated test for disappearing messages (disappearing.py).

Real, local-only claim under test: a message older than the configured
duration actually gets deleted from this device's own store by the
background sweep, with no manual trigger - and a peer with no setting
configured is completely unaffected, proving this is scoped per-peer, not a
global sweep of every conversation.

Not a CLI tool - run directly:
    python -m app._test_disappearing
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
import time
from pathlib import Path

from app.disappearing import DisappearingMessagesService
from app.storage import MessageStore


async def wait_until(predicate, timeout=10, interval=0.2, fail_msg="condition never became true"):
    for _ in range(int(timeout / interval)):
        if await predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError(fail_msg)


async def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="agora_disappearing_test_"))
    print(f"scratch dir: {tmp}")

    store = MessageStore(str(tmp / "alice.db"))
    swept_events = []
    service = DisappearingMessagesService(store, on_swept=lambda peer_id, count: swept_events.append((peer_id, count)))

    # Speed the sweep loop up for the test instead of waiting a real 30s tick.
    import app.disappearing as disappearing_module

    disappearing_module.SWEEP_INTERVAL_SECONDS = 1

    try:
        now = time.time()
        # bob: disappearing set to 5 seconds - an "old" message (10s ago)
        # should be swept, a "fresh" one (just now) should survive.
        await store.save_message("old-1", "bob", "received", "this is old, should vanish", "received", ts=now - 10)
        await store.save_message("fresh-1", "bob", "received", "this is fresh, should stay", "received", ts=now)
        await store.set_disappearing_duration("bob", 5)

        # carol: no disappearing setting at all - an equally "old" message
        # here must be completely unaffected, proving this is per-peer.
        await store.save_message("old-carol", "carol", "received", "old but carol has no setting", "received", ts=now - 10)

        assert await store.get_disappearing_duration("bob") == 5
        assert await store.get_disappearing_duration("carol") is None
        print("TEST 1 (disappearing duration is a real per-peer setting, not global): PASS")

        await service.start()

        await wait_until(lambda: _missing(store, "bob", "old-1"), fail_msg="the real sweep never deleted the expired message")
        print("TEST 2 (the background sweep actually deletes an expired message with no manual trigger): PASS")

        still_there = await _has(store, "bob", "fresh-1")
        assert still_there, "a fresh message under the duration should never be deleted"
        print("TEST 3 (a message younger than the configured duration survives the sweep): PASS")

        carol_still_there = await _has(store, "carol", "old-carol")
        assert carol_still_there, "a peer with no disappearing setting configured must be completely unaffected"
        print("TEST 4 (a peer with no setting is untouched by the sweep, even with an equally old message): PASS")

        assert any(peer_id == "bob" and count >= 1 for peer_id, count in swept_events), "on_swept callback should have fired for bob's real deletion"
        print("TEST 5 (the real on_swept callback fires with the actual peer_id and count, for live UI updates): PASS")

        # Turning it off (seconds=None) removes the setting entirely.
        await store.set_disappearing_duration("bob", None)
        assert await store.get_disappearing_duration("bob") is None
        print("TEST 6 (turning disappearing off removes the setting rather than storing a zero/null sentinel): PASS")

        print()
        print("ALL TESTS PASSED")
    finally:
        await service.stop()
        shutil.rmtree(tmp, ignore_errors=True)


async def _has(store: MessageStore, peer_id: str, msg_id: str) -> bool:
    hist = await store.history(peer_id)
    return any(m.msg_id == msg_id for m in hist)


async def _missing(store: MessageStore, peer_id: str, msg_id: str) -> bool:
    return not await _has(store, peer_id, msg_id)


if __name__ == "__main__":
    asyncio.run(main())
