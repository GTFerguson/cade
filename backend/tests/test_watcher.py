"""Tests for FileWatcher's batch and per-event iteration."""

from __future__ import annotations

import asyncio
from pathlib import Path

from core.backend.watcher import FileWatcher


async def _collect(agen, until, timeout: float = 5.0) -> list:
    items: list = []

    async def run() -> None:
        async for item in agen:
            items.append(item)
            if until(items):
                return

    await asyncio.wait_for(run(), timeout)
    return items


async def test_a_burst_of_writes_arrives_as_one_batch(tmp_path: Path):
    watcher = FileWatcher(tmp_path)

    async def write_burst() -> None:
        await asyncio.sleep(0.2)
        for i in range(50):
            (tmp_path / f"f{i}.txt").write_text("x")

    writer = asyncio.create_task(write_burst())
    batches = await _collect(
        watcher.watch_batches(),
        until=lambda bs: sum(len(b) for b in bs) >= 50,
    )
    watcher.stop()
    await writer

    paths = {e.path for b in batches for e in b}
    assert {f"f{i}.txt" for i in range(50)} <= paths
    # watchfiles groups a burst; one batch per file would defeat the point.
    assert len(batches) < 5


async def test_watch_still_yields_single_events(tmp_path: Path):
    watcher = FileWatcher(tmp_path)

    async def write() -> None:
        await asyncio.sleep(0.2)
        (tmp_path / "a.txt").write_text("x")

    writer = asyncio.create_task(write())
    events = await _collect(watcher.watch(), until=lambda es: len(es) >= 1)
    watcher.stop()
    await writer
    assert events[0].path == "a.txt"
