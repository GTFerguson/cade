"""Backend-side handle on a file-watch worker process.

Presents the same surface as core.backend.watcher.FileWatcher (``watch_batches``,
``stop``, ``on_raw_change``) so ProjectServices can treat the two alike, but
the watching itself happens in a child process; see backend.watch_worker for
why that matters on large projects.

The child is driven with a plain Popen and blocking reads on worker threads
rather than asyncio's subprocess transport: cancelling a task while that
transport is still connecting its pipes leaves the event loop unable to
close (CPython 3.12), which froze the test suite whenever a connection was
torn down moments after opening a project.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path

from core.backend.models import FileChangeEvent

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_EXIT_GRACE_SECONDS = 2.0


def worker_command(root: Path) -> list[str]:
    """How to launch the worker for ``root`` under this interpreter."""
    if getattr(sys, "frozen", False):
        return [sys.executable, "watch", str(root)]
    return [sys.executable, "-m", "backend.watch_worker", str(root)]


class WatchProcess:
    """Watches ``root`` from a child process and yields its change bursts."""

    def __init__(
        self,
        root: Path,
        on_raw_change: Callable[[Path], None] | None = None,
    ) -> None:
        self._root = root
        self._on_raw_change = on_raw_change
        self._proc: subprocess.Popen[bytes] | None = None
        # Set by stop(); the stream then ends without reporting an error.
        self._stopped = False
        # Set once watch_batches() is over, so a spawn still in flight on its
        # thread knows to terminate the process it just started.
        self._finished = False

    def stop(self) -> None:
        """Stop watching; the worker exits and watch_batches() ends."""
        self._stopped = True
        self._terminate()

    def _terminate(self) -> None:
        proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        # Closing stdin asks the worker to stop; terminate covers a wedged one.
        if proc.stdin is not None:
            try:
                proc.stdin.close()
            except OSError:
                pass
        try:
            proc.terminate()
        except ProcessLookupError:
            pass

    def _spawn(self) -> subprocess.Popen[bytes]:
        """Start the worker. Runs on a thread, so the handle is stored before
        returning and a stop() that lands mid-spawn still reaches the process."""
        frozen = getattr(sys, "frozen", False)
        proc = subprocess.Popen(
            worker_command(self._root),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            cwd=None if frozen else str(_PROJECT_ROOT),
        )
        self._proc = proc
        if self._stopped or self._finished:
            self._terminate()
        return proc

    async def watch_batches(self) -> AsyncIterator[list[FileChangeEvent]]:
        """Yield each burst of changes the worker reports.

        Raises RuntimeError if the worker exits on its own, so the caller's
        retry logic can start another.
        """
        proc: subprocess.Popen[bytes] | None = None
        try:
            proc = await asyncio.to_thread(self._spawn)
            assert proc.stdout is not None
            while True:
                line = await asyncio.to_thread(proc.stdout.readline)
                if not line:
                    break
                batch = self._parse(line)
                for event in batch:
                    self._invalidate(event)
                if batch:
                    yield batch
        finally:
            self._finished = True
            self._terminate()
            if proc is not None:
                await asyncio.to_thread(self._reap, proc)

        if not self._stopped:
            raise RuntimeError(
                f"file watch worker for {self._root} exited with code {proc.returncode}"
            )

    def _parse(self, line: bytes) -> list[FileChangeEvent]:
        try:
            return [FileChangeEvent(**item) for item in json.loads(line)]
        except (ValueError, TypeError):
            logger.warning("Ignoring malformed line from file watch worker: %r", line[:200])
            return []

    def _invalidate(self, event: FileChangeEvent) -> None:
        if self._on_raw_change is None:
            return
        try:
            self._on_raw_change(self._root / event.path)
        except Exception:
            logger.exception("on_raw_change hook failed for %s", event.path)

    @staticmethod
    def _reap(proc: subprocess.Popen[bytes]) -> None:
        try:
            proc.wait(timeout=_EXIT_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        if proc.stdout is not None:
            proc.stdout.close()
