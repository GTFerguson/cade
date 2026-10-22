"""File-watch worker: runs one FileWatcher in its own process.

watchfiles registers a recursive watch inside its Rust constructor without
releasing the GIL, and registering walks every entry under the root. On a
project with a few hundred thousand files that is seconds with a warm cache
and far longer cold, during which the whole backend process is frozen: every
tab's terminal stops echoing. Watching from a child process confines that
cost to the child. Bursts of changes stream back to the backend as JSON
lines on stdout.

Usage: ``python -m backend.watch_worker <root>``, or ``cade-backend watch
<root>`` from the packaged binary. The worker stops when its stdin closes,
so a parent that dies takes it down with it.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
from pathlib import Path

from core.backend.models import FileChangeEvent
from core.backend.watcher import FileWatcher


def _stop_when_stdin_closes(loop: asyncio.AbstractEventLoop, watcher: FileWatcher) -> None:
    def wait_for_eof() -> None:
        try:
            sys.stdin.buffer.read()
        except OSError:
            pass
        loop.call_soon_threadsafe(watcher.stop)

    threading.Thread(target=wait_for_eof, name="stdin-eof", daemon=True).start()


def _is_dir(root: Path, event: FileChangeEvent) -> bool | None:
    """Stat here, in the worker, so the backend never touches the disk per event."""
    if event.event == "deleted":
        return None
    try:
        return (root / event.path).is_dir()
    except OSError:
        return None


async def _run(root: Path) -> None:
    watcher = FileWatcher(root)
    _stop_when_stdin_closes(asyncio.get_running_loop(), watcher)
    out = sys.stdout.buffer
    async for batch in watcher.watch_batches():
        line = json.dumps([
            {"event": e.event, "path": e.path, "is_dir": _is_dir(root, e)} for e in batch
        ])
        out.write(line.encode("utf-8") + b"\n")
        out.flush()


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: watch_worker <root>", file=sys.stderr)
        return 2
    root = Path(argv[0])
    if not root.is_dir():
        print(f"watch_worker: not a directory: {root}", file=sys.stderr)
        return 2
    try:
        asyncio.run(_run(root))
    except (KeyboardInterrupt, BrokenPipeError):
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
