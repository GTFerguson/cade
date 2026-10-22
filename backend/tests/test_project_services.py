"""Tests for per-directory services shared across connections.

Tabs open on the same directory used to run a file watcher, doc index and
nkrdn service each, so one burst of file changes was processed once per tab
and every code edit triggered one nkrdn rebuild per tab.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

import backend.project_services as ps
from backend.project_services import ProjectListener, acquire_project, release_project
from core.backend.models import FileChangeEvent


class FakeWatcher:
    """Stands in for WatchProcess; events are pushed in by the test."""

    instances: list[FakeWatcher] = []

    def __init__(self, root: Path, on_raw_change=None) -> None:
        self.root = root
        self.stopped = False
        self._queue: asyncio.Queue[list[FileChangeEvent] | None] = asyncio.Queue()
        FakeWatcher.instances.append(self)

    def push(self, *paths: str) -> None:
        self._queue.put_nowait([FileChangeEvent(event="modified", path=p) for p in paths])

    def stop(self) -> None:
        self.stopped = True
        self._queue.put_nowait(None)

    async def watch_batches(self):
        while (batch := await self._queue.get()) is not None:
            yield batch


class FakeIndexService:
    instances: list[FakeIndexService] = []

    def __init__(self, project_dir: Path, on_rebuild=None) -> None:
        self.project_dir = project_dir
        self.on_rebuild = on_rebuild
        self.initial_builds = 0
        self.changes: list[str] = []
        self.cancelled = False
        FakeIndexService.instances.append(self)

    async def initial_build(self) -> None:
        self.initial_builds += 1

    def on_file_change(self, event: FileChangeEvent) -> None:
        self.changes.append(event.path)

    def cancel(self) -> None:
        self.cancelled = True


class Recorder:
    def __init__(self) -> None:
        self.batches: list[list[str]] = []
        self.graph_rebuilds = 0
        self.listener = ProjectListener(
            on_file_changes=lambda batch: self.batches.append([e.path for e in batch]),
            on_graph_rebuilt=self._graph,
        )

    @property
    def paths(self) -> list[str]:
        return [p for batch in self.batches for p in batch]

    def _graph(self) -> None:
        self.graph_rebuilds += 1


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    FakeWatcher.instances.clear()
    FakeIndexService.instances.clear()
    monkeypatch.setattr(ps, "WatchProcess", FakeWatcher)
    import backend.doc_index as doc_index
    import backend.nkrdn_service as nkrdn_service
    monkeypatch.setattr(doc_index, "DOC_INDEX_AVAILABLE", True)
    monkeypatch.setattr(doc_index, "DocIndexService", FakeIndexService)
    monkeypatch.setattr(nkrdn_service, "NKRDN_AVAILABLE", True)
    monkeypatch.setattr(nkrdn_service, "NkrdnService", FakeIndexService)
    yield
    assert ps._projects == {}, "a test leaked a project registration"


async def settle() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


async def test_connections_on_one_directory_share_one_watcher(tmp_path):
    a, b = Recorder(), Recorder()
    services_a = acquire_project(tmp_path, a.listener)
    services_b = acquire_project(tmp_path, b.listener)

    assert services_a is services_b
    assert len(FakeWatcher.instances) == 1

    FakeWatcher.instances[0].push("src/main.py")
    await settle()
    assert a.paths == ["src/main.py"]
    assert b.paths == ["src/main.py"]

    release_project(services_a, a.listener)
    release_project(services_b, b.listener)


async def test_a_burst_reaches_each_listener_as_one_batch(tmp_path):
    a = Recorder()
    services = acquire_project(tmp_path, a.listener)
    FakeWatcher.instances[0].push(*[f"tmp{i}/f.npz" for i in range(500)])
    await settle()
    assert len(a.batches) == 1
    assert len(a.batches[0]) == 500
    release_project(services, a.listener)


async def test_paths_resolving_to_one_directory_share(tmp_path):
    (tmp_path / "sub").mkdir()
    a, b = Recorder(), Recorder()
    services_a = acquire_project(tmp_path, a.listener)
    services_b = acquire_project(tmp_path / "sub" / "..", b.listener)
    assert services_a is services_b
    release_project(services_a, a.listener)
    release_project(services_b, b.listener)


async def test_different_directories_get_separate_services(tmp_path):
    (tmp_path / "one").mkdir()
    (tmp_path / "two").mkdir()
    a, b = Recorder(), Recorder()
    services_a = acquire_project(tmp_path / "one", a.listener)
    services_b = acquire_project(tmp_path / "two", b.listener)
    assert services_a is not services_b
    assert len(FakeWatcher.instances) == 2
    release_project(services_a, a.listener)
    release_project(services_b, b.listener)


async def test_watcher_outlives_all_but_the_last_connection(tmp_path):
    a, b = Recorder(), Recorder()
    services = acquire_project(tmp_path, a.listener)
    acquire_project(tmp_path, b.listener)
    watcher = FakeWatcher.instances[0]

    release_project(services, a.listener)
    assert not watcher.stopped
    watcher.push("x.py")
    await settle()
    assert a.paths == []
    assert b.paths == ["x.py"]

    release_project(services, b.listener)
    await settle()
    assert watcher.stopped


async def test_reopening_after_last_release_starts_fresh(tmp_path):
    a = Recorder()
    first = acquire_project(tmp_path, a.listener)
    release_project(first, a.listener)
    second = acquire_project(tmp_path, a.listener)
    assert second is not first
    assert len(FakeWatcher.instances) == 2
    release_project(second, a.listener)


async def test_release_is_idempotent(tmp_path):
    a, b = Recorder(), Recorder()
    services = acquire_project(tmp_path, a.listener)
    acquire_project(tmp_path, b.listener)
    release_project(services, a.listener)
    release_project(services, a.listener)
    assert not FakeWatcher.instances[0].stopped
    release_project(services, b.listener)


async def test_indexing_runs_once_however_many_connections_enable_it(tmp_path):
    listeners = [Recorder() for _ in range(3)]
    services = [acquire_project(tmp_path, r.listener) for r in listeners]
    for s in services:
        s.enable_indexing()
    await settle()

    # One doc-index service and one nkrdn service, each built once.
    assert len(FakeIndexService.instances) == 2
    assert [s.initial_builds for s in FakeIndexService.instances] == [1, 1]

    FakeWatcher.instances[0].push("lib.py")
    await settle()
    assert [s.changes for s in FakeIndexService.instances] == [["lib.py"], ["lib.py"]]

    for s, r in zip(services, listeners):
        release_project(s, r.listener)
    assert all(s.cancelled for s in FakeIndexService.instances)


async def test_graph_rebuild_reaches_every_connection(tmp_path):
    a, b = Recorder(), Recorder()
    services = acquire_project(tmp_path, a.listener)
    acquire_project(tmp_path, b.listener)
    services.enable_indexing()
    await settle()

    # Initial build completion counts as a rebuild for the open tabs.
    assert (a.graph_rebuilds, b.graph_rebuilds) == (1, 1)

    nkrdn = FakeIndexService.instances[1]
    await nkrdn.on_rebuild()
    assert (a.graph_rebuilds, b.graph_rebuilds) == (2, 2)

    release_project(services, a.listener)
    release_project(services, b.listener)


async def test_without_indexing_no_index_services_exist(tmp_path):
    a = Recorder()
    services = acquire_project(tmp_path, a.listener)
    await settle()
    assert FakeIndexService.instances == []
    release_project(services, a.listener)


async def test_failing_listener_does_not_starve_the_others(tmp_path):
    def boom(_event):
        raise RuntimeError("socket gone")

    bad = ProjectListener(on_file_changes=boom, on_graph_rebuilt=lambda: None)
    good = Recorder()
    services = acquire_project(tmp_path, bad)
    acquire_project(tmp_path, good.listener)

    FakeWatcher.instances[0].push("a.py")
    FakeWatcher.instances[0].push("b.py")
    await settle()
    assert good.paths == ["a.py", "b.py"]

    release_project(services, bad)
    release_project(services, good.listener)


async def test_real_watcher_delivers_one_change_to_every_connection(tmp_path, monkeypatch):
    from backend.watch_process import WatchProcess as RealWatcher
    monkeypatch.setattr(ps, "WatchProcess", RealWatcher)

    a, b = Recorder(), Recorder()
    services = acquire_project(tmp_path, a.listener)
    acquire_project(tmp_path, b.listener)
    await asyncio.sleep(1.0)  # let the worker start and inotify register

    (tmp_path / "hello.txt").write_text("hi")
    for _ in range(100):
        if "hello.txt" in a.paths and "hello.txt" in b.paths:
            break
        await asyncio.sleep(0.05)
    assert "hello.txt" in a.paths
    assert "hello.txt" in b.paths

    release_project(services, a.listener)
    release_project(services, b.listener)
