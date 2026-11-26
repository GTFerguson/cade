"""File system watching with debouncing, skipping folders not worth watching.

A recursive watch costs one inotify watch for every directory under the root,
whether or not its events are wanted. Filtering events from an ignored folder
does not give those watches back: a project that keeps clones or build output
in ignored folders can hold hundreds of thousands, exhaust the machine's
budget, and stop every other program from watching files.

So the tree is walked here, ignored folders are never entered, and each
remaining directory gets one non-recursive watch. A folder made later is
picked up by walking it when it appears.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections import deque
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Literal

from watchfiles import Change, awatch

from core.backend.models import FileChangeEvent

logger = logging.getLogger(__name__)

# Default ignore set — callers can override via `ignore_dirs` on FileWatcher.
# Kept aligned with tree.py IGNORED_DIRS for CADE's use; Padarax / other
# consumers can pass their own set.
WATCH_IGNORE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".cade",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    ".venv",
    "venv",
    ".env",
    "env",
    ".tox",
    ".eggs",
}


def _change_to_event(change: Change) -> Literal["created", "modified", "deleted"]:
    """Convert watchfiles Change to event string."""
    if change == Change.added:
        return "created"
    elif change == Change.deleted:
        return "deleted"
    else:
        return "modified"


# Directories watched under one root at most. A root as broad as a home
# directory has more than is worth a watch each; the shallow ones are kept,
# since that is where a person looking at the tree is.
MAX_WATCHED_DIRS = 20_000


def watched_dirs(root: Path, skip: Callable[[Path], bool], limit: int) -> list[Path]:
    """The directories to watch under `root`, itself first, shallowest first.

    A directory `skip` returns True for is left out and never entered, so the
    cost of the walk is the size of what is kept, not of what is skipped.
    Links to directories are not followed. Stops at `limit` directories.
    """
    found = [root]
    queue: deque[Path] = deque([root])
    while queue and len(found) < limit:
        current = queue.popleft()
        try:
            with os.scandir(current) as entries:
                children = sorted(
                    Path(e.path) for e in entries if e.is_dir(follow_symlinks=False)
                )
        except OSError:
            continue
        for child in children:
            if len(found) >= limit:
                break
            if skip(child):
                continue
            found.append(child)
            queue.append(child)
    return found


def _should_ignore_watch(path: str, ignore_dirs: set[str]) -> bool:
    """Check if a path should be ignored for watching."""
    parts = Path(path).parts
    return any(part in ignore_dirs for part in parts)


class FileWatcher:
    """Watches a directory for file changes with debouncing."""

    def __init__(
        self,
        root: Path,
        debounce_ms: int = 100,
        ignore_dirs: set[str] | None = None,
        on_raw_change: Callable[[Path], None] | None = None,
        prune: Callable[[str], bool] | None = None,
        max_dirs: int = MAX_WATCHED_DIRS,
    ) -> None:
        """Initialize the file watcher.

        Args:
            root: Root directory to watch
            debounce_ms: Debounce delay in milliseconds
            ignore_dirs: Directory names to skip. Defaults to WATCH_IGNORE_DIRS.
            on_raw_change: Synchronous hook fired per raw change *before*
                debouncing. Used by CADE to invalidate its file-tree cache;
                other consumers (e.g. Padarax) can leave it unset or supply
                their own side-effect.
            prune: Given a directory's root-relative path, whether to leave
                it and everything under it unwatched, beyond `ignore_dirs`.
                CADE passes its gitignore rules.
            max_dirs: The most directories to hold a watch on.
        """
        self._root = root
        self._debounce_ms = debounce_ms
        self._ignore_dirs = ignore_dirs if ignore_dirs is not None else WATCH_IGNORE_DIRS
        self._on_raw_change = on_raw_change
        self._prune = prune
        self._max_dirs = max_dirs
        self._stop_event = asyncio.Event()
        self._callbacks: list[Callable[[FileChangeEvent], None]] = []
        self._force_polling = False

    def on_change(self, callback: Callable[[FileChangeEvent], None]) -> None:
        """Register a callback for file changes."""
        self._callbacks.append(callback)

    def stop(self) -> None:
        """Stop watching for changes."""
        self._stop_event.set()

    def _rel(self, path: Path) -> str | None:
        try:
            return str(path.relative_to(self._root)).replace("\\", "/")
        except ValueError:
            return None

    def _skip_dir(self, path: Path) -> bool:
        if path.name in self._ignore_dirs:
            return True
        if self._prune is None:
            return False
        rel = self._rel(path)
        return rel is not None and self._prune(rel)

    async def watch(self) -> AsyncIterator[FileChangeEvent]:
        """Watch for file changes and yield events one at a time."""
        async for batch in self.watch_batches():
            for event in batch:
                yield event

    async def watch_batches(self) -> AsyncIterator[list[FileChangeEvent]]:
        """Watch for file changes and yield each debounced burst as one list.

        A burst can hold thousands of paths (a build or test run churning a
        temp directory), so consumers that forward changes elsewhere should
        handle the list as a unit rather than per event.

        Falls back to polling mode if inotify fails (e.g. exhausted watches).
        """
        pending_changes: dict[str, FileChangeEvent] = {}
        debounce_task: asyncio.Task | None = None

        async def debounce_flush() -> list[FileChangeEvent]:
            """Wait for debounce period and return accumulated changes."""
            await asyncio.sleep(self._debounce_ms / 1000)
            events = list(pending_changes.values())
            pending_changes.clear()
            return events

        dirs = await asyncio.to_thread(watched_dirs, self._root, self._skip_dir, self._max_dirs)
        if len(dirs) >= self._max_dirs:
            logger.warning(
                "%s has more directories than are watched (%d); the deeper ones are not",
                self._root, self._max_dirs,
            )
        watched = set(dirs)

        try:
            # One round of watching per set of directories: a new directory
            # cannot be added to a running watch, so finding one ends the
            # round and the next starts with it included.
            while not self._stop_event.is_set():
                changed_set = False
                async for changes in awatch(
                    *(d for d in dirs if d.is_dir()),
                    recursive=False,
                    stop_event=self._stop_event,
                    watch_filter=lambda _, path: not _should_ignore_watch(path, self._ignore_dirs),
                    force_polling=self._force_polling,
                    ignore_permission_denied=True,
                ):
                    for change_type, path_str in changes:
                        path = Path(path_str)

                        if self._on_raw_change is not None:
                            try:
                                self._on_raw_change(path)
                            except Exception:
                                logger.exception("on_raw_change hook failed for %s", path)

                        rel_path = self._rel(path)
                        if rel_path is None:
                            continue

                        pending_changes[rel_path] = FileChangeEvent(
                            event=_change_to_event(change_type),
                            path=rel_path,
                        )

                        if change_type == Change.deleted and path in watched:
                            gone = {d for d in watched if d == path or path in d.parents}
                            watched -= gone
                            dirs = [d for d in dirs if d not in gone]
                            changed_set = True
                        elif (
                            change_type == Change.added
                            and path not in watched
                            and path.is_dir()
                            and not path.is_symlink()
                            and not self._skip_dir(path)
                        ):
                            room = self._max_dirs - len(dirs)
                            added = watched_dirs(path, self._skip_dir, room) if room > 0 else []
                            dirs.extend(added)
                            watched.update(added)
                            changed_set = True
                            # Whatever was put in the new folder before it was
                            # watched made no event of its own; report it now.
                            for directory in added:
                                try:
                                    with os.scandir(directory) as entries:
                                        names = [e.name for e in entries]
                                except OSError:
                                    continue
                                for name in names:
                                    inner = self._rel(directory / name)
                                    if inner is None or _should_ignore_watch(inner, self._ignore_dirs):
                                        continue
                                    pending_changes.setdefault(
                                        inner, FileChangeEvent(event="created", path=inner)
                                    )

                    if debounce_task is not None:
                        debounce_task.cancel()
                        try:
                            await debounce_task
                        except asyncio.CancelledError:
                            pass

                    debounce_task = asyncio.create_task(debounce_flush())

                    try:
                        events = await debounce_task
                        if events:
                            yield events
                        for event in events:
                            for callback in self._callbacks:
                                try:
                                    callback(event)
                                except Exception:
                                    pass
                    except asyncio.CancelledError:
                        pass

                    if changed_set:
                        break

                if not changed_set:
                    break

        except OSError as e:
            if self._force_polling:
                raise
            logger.warning(
                "inotify watcher failed (%s), falling back to polling mode", e,
            )
            self._force_polling = True
            self._stop_event = asyncio.Event()
            async for batch in self.watch_batches():
                yield batch
        except asyncio.CancelledError:
            pass
        finally:
            if debounce_task is not None:
                debounce_task.cancel()


async def watch_directory(
    root: Path,
    callback: Callable[[FileChangeEvent], None],
    debounce_ms: int = 100,
) -> FileWatcher:
    """Create and start a file watcher.

    Args:
        root: Directory to watch
        callback: Function to call on changes
        debounce_ms: Debounce delay in milliseconds

    Returns:
        FileWatcher instance (call stop() to stop watching)
    """
    watcher = FileWatcher(root, debounce_ms)
    watcher.on_change(callback)

    async def _run_watcher():
        async for _ in watcher.watch():
            pass

    asyncio.create_task(_run_watcher())
    return watcher
