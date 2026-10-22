"""Tests for the file-watch worker process and its backend-side handle."""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

import backend.watch_process as wp
from backend.watch_process import WatchProcess, worker_command

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


async def _first_batch(watcher: WatchProcess, trigger, timeout: float = 10.0) -> list:
    async def run() -> list:
        started = asyncio.get_running_loop().create_task(trigger())
        try:
            async for batch in watcher.watch_batches():
                return batch
        finally:
            await started
        return []

    return await asyncio.wait_for(run(), timeout)


async def test_a_change_under_the_root_arrives_as_a_batch(tmp_path: Path):
    seen: list[Path] = []
    watcher = WatchProcess(tmp_path, on_raw_change=seen.append)

    async def write() -> None:
        await asyncio.sleep(1.0)  # let the worker start and register its watch
        (tmp_path / "a.txt").write_text("x")

    batch = await _first_batch(watcher, write)
    watcher.stop()

    assert [e.path for e in batch] == ["a.txt"]
    assert batch[0].event in ("created", "modified")
    # The cache-invalidation hook sees absolute paths, as with the in-process watcher.
    assert seen == [tmp_path / "a.txt"]


async def test_stop_ends_the_stream_and_the_worker(tmp_path: Path):
    watcher = WatchProcess(tmp_path)

    async def consume() -> None:
        async for _ in watcher.watch_batches():
            pass

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.5)
    watcher.stop()
    await asyncio.wait_for(task, 5.0)

    assert watcher._proc is not None
    assert watcher._proc.returncode is not None


async def test_a_worker_that_dies_raises_so_the_caller_can_restart(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        wp, "worker_command", lambda root: [sys.executable, "-c", "import sys; sys.exit(3)"]
    )
    watcher = WatchProcess(tmp_path)

    async def consume() -> None:
        async for _ in watcher.watch_batches():
            pass

    try:
        await asyncio.wait_for(consume(), 5.0)
    except RuntimeError as e:
        assert "exited with code 3" in str(e)
    else:
        raise AssertionError("worker exit was not reported")


def test_worker_exits_when_its_stdin_closes(tmp_path: Path):
    """A backend that dies must not leave workers watching forever."""
    proc = subprocess.Popen(
        worker_command(tmp_path),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        cwd=PROJECT_ROOT,
    )
    try:
        proc.stdin.close()
        assert proc.wait(timeout=10) == 0
    finally:
        if proc.poll() is None:
            proc.kill()


def test_worker_rejects_a_missing_directory(tmp_path: Path):
    result = subprocess.run(
        worker_command(tmp_path / "nope"),
        capture_output=True,
        cwd=PROJECT_ROOT,
        timeout=10,
    )
    assert result.returncode == 2
