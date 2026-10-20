"""Per-directory machinery shared by every connection open on that directory.

Each tab holds its own WebSocket connection, and several tabs are often open
on one project. Giving each connection its own file watcher, doc index and
nkrdn service meant a burst of file changes was processed once per tab and
every code edit started one nkrdn rebuild per tab. Connections now register
as listeners on a single ProjectServices per resolved directory, which lives
until the last of them releases it.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from backend.files.tree import get_file_tree_cache
from core.backend.models import FileChangeEvent
from core.backend.watcher import FileWatcher

if TYPE_CHECKING:
    from backend.doc_index import DocIndexService
    from backend.nkrdn_service import NkrdnService

logger = logging.getLogger(__name__)

_WATCH_MAX_RETRIES = 3


@dataclass(eq=False)
class ProjectListener:
    """A connection's hooks into its project's shared services.

    Both callbacks are synchronous and must not block: they run inside the
    shared watch loop, so a slow listener would delay every other tab.
    Connections hand events to their own queue or task instead.
    """

    on_file_change: Callable[[FileChangeEvent], None]
    on_graph_rebuilt: Callable[[], None]


class ProjectServices:
    """File watching and indexing for one directory, fanned out to listeners."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._listeners: list[ProjectListener] = []
        self._watcher: FileWatcher | None = None
        self._watch_task: asyncio.Task | None = None
        self._doc_index: DocIndexService | None = None
        self._nkrdn: NkrdnService | None = None
        self._indexing_enabled = False
        self._build_tasks: list[asyncio.Task] = []

    def _start(self) -> None:
        self._watcher = self._new_watcher()
        self._watch_task = asyncio.create_task(self._watch_loop())

    def _new_watcher(self) -> FileWatcher:
        return FileWatcher(
            self.root,
            on_raw_change=lambda p: get_file_tree_cache().invalidate(p),
        )

    def enable_indexing(self) -> None:
        """Build and maintain the doc index and nkrdn graph for this directory.

        Kiosk connections never call this, so a directory opened only in
        kiosk mode is watched but not indexed. The first caller starts the
        initial builds; later callers share their results.
        """
        if self._indexing_enabled:
            return
        self._indexing_enabled = True

        from backend.doc_index import DOC_INDEX_AVAILABLE, DocIndexService
        if DOC_INDEX_AVAILABLE:
            self._doc_index = DocIndexService(self.root)
            self._build_tasks.append(
                asyncio.create_task(self._doc_index.initial_build())
            )

        from backend.nkrdn_service import NKRDN_AVAILABLE, NkrdnService
        if NKRDN_AVAILABLE:
            self._nkrdn = NkrdnService(self.root, on_rebuild=self._notify_graph_rebuilt)
            nkrdn = self._nkrdn

            async def _build_then_notify() -> None:
                await nkrdn.initial_build()
                await self._notify_graph_rebuilt()

            self._build_tasks.append(asyncio.create_task(_build_then_notify()))

    async def _notify_graph_rebuilt(self) -> None:
        for listener in list(self._listeners):
            try:
                listener.on_graph_rebuilt()
            except Exception:
                logger.exception("Graph-rebuilt listener failed for %s", self.root)

    def _dispatch(self, event: FileChangeEvent) -> None:
        for service in (self._doc_index, self._nkrdn):
            if service is not None:
                try:
                    service.on_file_change(event)
                except Exception:
                    logger.exception("Index service failed on change to %s", event.path)
        for listener in list(self._listeners):
            try:
                listener.on_file_change(event)
            except Exception:
                logger.exception("File-change listener failed for %s", self.root)

    async def _watch_loop(self) -> None:
        """Watch the directory, recreating the watcher with backoff on failure.

        The project stays open if watching is permanently lost; tabs just stop
        receiving live updates.
        """
        for attempt in range(_WATCH_MAX_RETRIES + 1):
            if self._watcher is None:
                return
            try:
                async for event in self._watcher.watch():
                    self._dispatch(event)
                return
            except asyncio.CancelledError:
                return
            except Exception as e:
                if attempt < _WATCH_MAX_RETRIES:
                    backoff = 2 ** (attempt + 1)
                    logger.warning(
                        "Watch error on %s (attempt %d/%d), retrying in %ds: %s",
                        self.root, attempt + 1, _WATCH_MAX_RETRIES, backoff, e,
                    )
                    await asyncio.sleep(backoff)
                    self._watcher = self._new_watcher()
                else:
                    logger.warning(
                        "File watcher on %s failed after %d retries, disabling: %s",
                        self.root, _WATCH_MAX_RETRIES, e,
                    )

    def _stop(self) -> None:
        if self._watcher is not None:
            self._watcher.stop()
            self._watcher = None
        if self._watch_task is not None:
            self._watch_task.cancel()
            self._watch_task = None
        for task in self._build_tasks:
            task.cancel()
        self._build_tasks.clear()
        for service in (self._doc_index, self._nkrdn):
            if service is not None:
                service.cancel()
        self._doc_index = None
        self._nkrdn = None


_projects: dict[Path, ProjectServices] = {}


def acquire_project(root: Path, listener: ProjectListener) -> ProjectServices:
    """Join (or open) the shared services for `root`. Pair with release_project."""
    key = root.resolve()
    services = _projects.get(key)
    if services is None:
        services = ProjectServices(key)
        _projects[key] = services
        services._start()
    if listener not in services._listeners:
        services._listeners.append(listener)
    return services


def release_project(services: ProjectServices, listener: ProjectListener) -> None:
    """Leave the shared services; the last listener out shuts them down."""
    if listener in services._listeners:
        services._listeners.remove(listener)
    if services._listeners:
        return
    if _projects.get(services.root) is services:
        del _projects[services.root]
    services._stop()
