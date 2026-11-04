"""Tests for how the dashboard handler watches for its config file.

The config lives at ``.cade/dashboard.yml``. Finding it used to mean one
recursive watch over the whole project per connection, which on a project
with hundreds of thousands of directories froze the backend for tens of
seconds per tab and exhausted the machine's inotify watches. The handler
now watches the project root and ``.cade/`` non-recursively.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from watchfiles import Change

import core.backend.dashboard.handler as handler_mod
from core.backend.dashboard.handler import DashboardHandler


class FakeAwatch:
    """Stands in for watchfiles.awatch, recording how it is called.

    Each call pops the next scripted sequence of change sets; the test
    pushes them in. An empty script keeps the generator open until the
    stop event fires.
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.scripts: list[list[set[tuple[Change, str]]]] = []
        self.started = asyncio.Event()

    def __call__(self, *paths, stop_event=None, watch_filter=None, recursive=True, **kwargs):
        self.calls.append({
            "paths": [Path(p) for p in paths],
            "recursive": recursive,
            "filter": watch_filter,
        })
        script = self.scripts.pop(0) if self.scripts else []

        async def gen():
            self.started.set()
            for changes in script:
                # A callable step acts on the filesystem first, so a test can
                # make a directory appear at the moment its event is reported.
                yield changes() if callable(changes) else changes
            if stop_event is not None:
                await stop_event.wait()

        return gen()


@pytest.fixture
def fake_awatch(monkeypatch):
    fake = FakeAwatch()
    monkeypatch.setattr(handler_mod, "awatch", fake)
    return fake


class Recorder:
    def __init__(self, handler: DashboardHandler) -> None:
        self.loads = 0
        self.cleared = 0

        async def load() -> None:
            self.loads += 1

        async def data() -> None:
            pass

        async def cleared() -> None:
            self.cleared += 1

        handler.load_and_send_config = load  # type: ignore[method-assign]
        handler.load_and_send_data = data  # type: ignore[method-assign]
        handler.send_cleared = cleared  # type: ignore[method-assign]


async def _run_until_settled(handler: DashboardHandler) -> None:
    handler.start_watching()
    for _ in range(20):
        await asyncio.sleep(0)
    handler.stop()
    if handler._watch_task is not None:
        try:
            await handler._watch_task
        except asyncio.CancelledError:
            pass


async def test_watches_only_the_root_and_cade_dir_non_recursively(tmp_path, fake_awatch):
    (tmp_path / ".cade").mkdir()
    (tmp_path / "deep" / "er" / "still").mkdir(parents=True)
    handler = DashboardHandler(tmp_path, send=None)  # type: ignore[arg-type]
    Recorder(handler)

    await _run_until_settled(handler)

    assert len(fake_awatch.calls) == 1
    call = fake_awatch.calls[0]
    assert call["recursive"] is False
    assert call["paths"] == [tmp_path, tmp_path / ".cade"]


async def test_watches_the_root_alone_until_cade_dir_appears(tmp_path, fake_awatch):
    handler = DashboardHandler(tmp_path, send=None)  # type: ignore[arg-type]
    rec = Recorder(handler)
    cade = tmp_path / ".cade"
    # First watch: root only; it reports .cade being created, after which
    # the loop re-registers with .cade included and sees the config land.
    def create_cade_dir() -> set[tuple[Change, str]]:
        cade.mkdir()
        return {(Change.added, str(cade))}

    fake_awatch.scripts = [
        [create_cade_dir],
        [{(Change.added, str(cade / "dashboard.yml"))}],
    ]

    await _run_until_settled(handler)

    assert [c["paths"] for c in fake_awatch.calls] == [[tmp_path], [tmp_path, cade]]
    assert all(c["recursive"] is False for c in fake_awatch.calls)
    assert rec.loads == 1


async def test_config_changes_reload_and_deletion_clears(tmp_path, fake_awatch):
    cade = tmp_path / ".cade"
    cade.mkdir()
    handler = DashboardHandler(tmp_path, send=None)  # type: ignore[arg-type]
    rec = Recorder(handler)
    fake_awatch.scripts = [[
        {(Change.modified, str(cade / "dashboard.yml"))},
        {(Change.deleted, str(cade / "dashboard.yml"))},
    ]]

    await _run_until_settled(handler)

    assert rec.loads == 1
    assert rec.cleared == 1


def test_filter_admits_only_the_config_and_the_cade_dir(tmp_path, fake_awatch):
    (tmp_path / ".cade").mkdir()
    handler = DashboardHandler(tmp_path, send=None, config_filename="dashboard-gm.yml")  # type: ignore[arg-type]
    Recorder(handler)

    async def run() -> None:
        await _run_until_settled(handler)

    asyncio.run(run())
    is_relevant = fake_awatch.calls[0]["filter"]

    assert is_relevant(Change.added, str(tmp_path / ".cade"))
    assert is_relevant(Change.modified, str(tmp_path / ".cade" / "dashboard.yml"))
    assert is_relevant(Change.modified, str(tmp_path / ".cade" / "dashboard-gm.yml"))
    assert not is_relevant(Change.modified, str(tmp_path / ".cade" / "session.json"))
    assert not is_relevant(Change.added, str(tmp_path / "src" / "dashboard.yml"))
    assert not is_relevant(Change.added, str(tmp_path / "README.md"))


def _inotify_has_headroom() -> bool:
    import ctypes
    import os

    try:
        libc = ctypes.CDLL(None, use_errno=True)
        fd = libc.inotify_init()
        if fd < 0:
            return False
        try:
            return libc.inotify_add_watch(fd, b"/", 0x100) >= 0
        finally:
            os.close(fd)
    except (OSError, AttributeError):
        return False


@pytest.mark.skipif(not _inotify_has_headroom(), reason="no free inotify watches on this machine")
async def test_real_watch_registers_a_handful_of_watches_however_deep_the_project(tmp_path):
    """Counts this process's inotify watches before and after starting the
    handler on a project with many nested directories."""
    import os

    def watch_count() -> int:
        total = 0
        for fd in os.listdir("/proc/self/fd"):
            try:
                with open(f"/proc/self/fdinfo/{fd}") as fh:
                    total += sum(1 for line in fh if line.startswith("inotify"))
            except OSError:
                continue
        return total

    for i in range(200):
        (tmp_path / "pkg" / f"mod{i}" / "sub").mkdir(parents=True)
    (tmp_path / ".cade").mkdir()

    before = watch_count()
    handler = DashboardHandler(tmp_path, send=None)  # type: ignore[arg-type]
    rec = Recorder(handler)
    handler.start_watching()
    await asyncio.sleep(0.5)
    added = watch_count() - before

    (tmp_path / ".cade" / "dashboard.yml").write_text("dashboard:\n  title: t\n")
    for _ in range(60):
        if rec.loads:
            break
        await asyncio.sleep(0.1)

    handler.stop()
    try:
        await handler._watch_task
    except asyncio.CancelledError:
        pass

    assert rec.loads == 1
    assert added <= 2
