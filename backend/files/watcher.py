"""File system watching with debouncing and gitignore support."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Literal

from watchfiles import Change, awatch

from backend.files.tree import get_file_tree_cache
from backend.models import FileChangeEvent

logger = logging.getLogger(__name__)

# Directories to ignore when watching (aligned with tree.py IGNORED_DIRS)
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


def _should_ignore_watch(path: str) -> bool:
    """Check if a path should be ignored for watching."""
    parts = Path(path).parts
    return any(part in WATCH_IGNORE_DIRS for part in parts)


class FileWatcher:
    """Watches a directory for file changes with debouncing."""

    def __init__(
        self,
        root: Path,
        debounce_ms: int = 100,
    ) -> None:
        """Initialize the file watcher.

        Args:
            root: Root directory to watch
            debounce_ms: Debounce delay in milliseconds
        """
        self._root = root
        self._debounce_ms = debounce_ms
        self._stop_event = asyncio.Event()
        self._callbacks: list[Callable[[FileChangeEvent], None]] = []
        self._force_polling = False

    def on_change(self, callback: Callable[[FileChangeEvent], None]) -> None:
        """Register a callback for file changes."""
        self._callbacks.append(callback)

    def stop(self) -> None:
        """Stop watching for changes."""
        self._stop_event.set()

    async def watch(self) -> AsyncIterator[FileChangeEvent]:
        """Watch for file changes and yield events.

        Falls back to polling mode if inotify fails (e.g. exhausted watches).

        Yields:
            FileChangeEvent objects for each detected change
        """
        pending_changes: dict[str, FileChangeEvent] = {}
        debounce_task: asyncio.Task | None = None

        async def debounce_flush() -> list[FileChangeEvent]:
            """Wait for debounce period and return accumulated changes."""
            await asyncio.sleep(self._debounce_ms / 1000)
            events = list(pending_changes.values())
            pending_changes.clear()
            return events

        try:
            async for changes in awatch(
                self._root,
                stop_event=self._stop_event,
                watch_filter=lambda _, path: not _should_ignore_watch(path),
                force_polling=self._force_polling,
                ignore_permission_denied=True,
            ):
                for change_type, path_str in changes:
                    path = Path(path_str)

                    # Invalidate file tree cache for affected paths
                    cache = get_file_tree_cache()
                    cache.invalidate(path)

                    try:
                        rel_path = str(path.relative_to(self._root)).replace("\\", "/")
                    except ValueError:
                        continue

                    event = FileChangeEvent(
                        event=_change_to_event(change_type),
                        path=rel_path,
                    )

                    pending_changes[rel_path] = event

                if debounce_task is not None:
                    debounce_task.cancel()
                    try:
                        await debounce_task
                    except asyncio.CancelledError:
                        pass

                debounce_task = asyncio.create_task(debounce_flush())

                try:
                    events = await debounce_task
                    for event in events:
                        yield event
                        for callback in self._callbacks:
                            try:
                                callback(event)
                            except Exception:
                                pass
                except asyncio.CancelledError:
                    pass

        except OSError as e:
            if self._force_polling:
                raise
            logger.warning(
                "inotify watcher failed (%s), falling back to polling mode", e,
            )
            self._force_polling = True
            self._stop_event = asyncio.Event()
            async for event in self.watch():
                yield event
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
