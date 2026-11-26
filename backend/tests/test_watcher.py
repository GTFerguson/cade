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


# ---------------------------------------------------------------------------
# Watching only what is worth watching
#
# A recursive watch costs one inotify watch per directory under the root,
# ignored or not. A project that keeps clones and build output in gitignored
# folders can hold hundreds of thousands, which exhausts the machine's
# budget and breaks every other tool that watches files.
# ---------------------------------------------------------------------------

import sys

import pytest

from core.backend.watcher import watched_dirs


def _tree(root: Path, *dirs: str) -> None:
    for d in dirs:
        (root / d).mkdir(parents=True, exist_ok=True)


def _rel(root: Path, dirs: list[Path]) -> list[str]:
    return sorted(str(d.relative_to(root)) for d in dirs if d != root)


def test_lists_the_directories_to_watch_without_entering_skipped_ones(tmp_path: Path):
    _tree(tmp_path, "src/app", "docs", "repos/clone/src", "node_modules/pkg")
    entered: list[str] = []

    def skip(path: Path) -> bool:
        entered.append(path.name)
        return path.name in {"repos", "node_modules"}

    dirs = watched_dirs(tmp_path, skip, limit=1000)
    assert dirs[0] == tmp_path
    assert _rel(tmp_path, dirs) == ["docs", "src", "src/app"]
    # Skipping is decided at the folder's own name: nothing under it is looked at.
    assert "clone" not in entered and "pkg" not in entered


def test_keeps_the_shallow_directories_when_there_are_too_many(tmp_path: Path):
    _tree(tmp_path, "a/deep/deeper", "b/deep", "c")
    dirs = watched_dirs(tmp_path, lambda _p: False, limit=4)
    assert _rel(tmp_path, dirs) == ["a", "b", "c"]


def test_does_not_follow_a_link_to_a_directory(tmp_path: Path):
    _tree(tmp_path, "real/inner")
    (tmp_path / "link").symlink_to(tmp_path / "real")
    assert _rel(tmp_path, watched_dirs(tmp_path, lambda _p: False, limit=100)) == ["real", "real/inner"]


async def _paths_until(watcher: FileWatcher, wanted: str, timeout: float = 8.0) -> set[str]:
    seen: set[str] = set()

    async def run() -> None:
        async for batch in watcher.watch_batches():
            seen.update(e.path for e in batch)
            if wanted in seen:
                return

    await asyncio.wait_for(run(), timeout)
    watcher.stop()
    return seen


async def test_reports_a_change_deep_in_a_watched_folder(tmp_path: Path):
    _tree(tmp_path, "src/app")
    watcher = FileWatcher(tmp_path)

    async def write() -> None:
        await asyncio.sleep(0.3)
        (tmp_path / "src" / "app" / "main.py").write_text("x")

    task = asyncio.create_task(write())
    assert "src/app/main.py" in await _paths_until(watcher, "src/app/main.py")
    await task


async def test_reports_nothing_from_inside_a_pruned_folder(tmp_path: Path):
    _tree(tmp_path, "repos/clone", "src")
    watcher = FileWatcher(tmp_path, prune=lambda rel: rel == "repos")

    async def write() -> None:
        await asyncio.sleep(0.3)
        (tmp_path / "repos" / "clone" / "noise.txt").write_text("x")
        await asyncio.sleep(0.5)
        (tmp_path / "src" / "signal.txt").write_text("x")

    task = asyncio.create_task(write())
    seen = await _paths_until(watcher, "src/signal.txt")
    await task
    assert not any(p.startswith("repos/") for p in seen)


async def test_starts_watching_a_folder_made_after_it_began(tmp_path: Path):
    watcher = FileWatcher(tmp_path)

    async def write() -> None:
        await asyncio.sleep(0.3)
        (tmp_path / "later").mkdir()
        await asyncio.sleep(1.0)
        (tmp_path / "later" / "file.txt").write_text("x")

    task = asyncio.create_task(write())
    seen = await _paths_until(watcher, "later/file.txt")
    await task
    assert "later" in seen


async def test_reports_what_was_already_in_a_new_folder_when_it_was_noticed(tmp_path: Path):
    """A folder and its first file can be made in one go, before the new
    folder is being watched; the file must not be lost for that."""
    watcher = FileWatcher(tmp_path)

    async def write() -> None:
        await asyncio.sleep(0.3)
        (tmp_path / "pkg" / "sub").mkdir(parents=True)
        (tmp_path / "pkg" / "sub" / "first.txt").write_text("x")

    task = asyncio.create_task(write())
    seen = await _paths_until(watcher, "pkg/sub/first.txt")
    await task
    assert {"pkg", "pkg/sub"} <= seen


@pytest.mark.skipif(sys.platform != "linux", reason="counts inotify watches through /proc")
async def test_holds_no_watches_inside_pruned_and_ignored_folders(tmp_path: Path):
    _tree(tmp_path, "src", *(f"repos/clone{i}/src" for i in range(60)), *(f"node_modules/p{i}" for i in range(60)))

    def watches() -> int:
        total = 0
        for info in Path("/proc/self/fdinfo").iterdir():
            try:
                total += sum(1 for line in info.read_text().splitlines() if line.startswith("inotify"))
            except OSError:
                pass
        return total

    before = watches()
    watcher = FileWatcher(tmp_path, prune=lambda rel: rel == "repos")

    async def write() -> None:
        await asyncio.sleep(0.4)
        (tmp_path / "src" / "f.txt").write_text("x")

    task = asyncio.create_task(write())
    held: list[int] = []

    async def run() -> None:
        async for _batch in watcher.watch_batches():
            held.append(watches() - before)
            return

    await asyncio.wait_for(run(), 8.0)
    watcher.stop()
    await task
    # The root, src, and the two skipped folders' parent entries at most:
    # nowhere near the 180 directories under the skipped folders.
    assert held[0] < 20
