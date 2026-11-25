"""Where each session's work stands on disk: its branch and its handoff.

A tab shows one line about the work in front of it. The pull request comes
from GitHub (see pull_requests.py); this module supplies what only the
working tree knows: which branch is checked out, how much is uncommitted or
not yet pushed, and the handoff brief last written for the project.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from backend.projects import list_handoffs
from backend.pull_requests import _run

logger = logging.getLogger(__name__)

# The count of uncommitted files is what goes stale fastest, so this is
# polled more often than GitHub is.
POLL_SECONDS = 30.0


def parse_status(text: str) -> dict[str, Any] | None:
    """Reduce `git status --porcelain=v2 --branch` to what a tab shows.

    `unpushed` is None when the branch has no upstream to compare with,
    which is different from having nothing to push.
    """
    branch: str | None = None
    unpushed: int | None = None
    uncommitted = 0
    for line in text.splitlines():
        if line.startswith("# branch.head "):
            head = line[len("# branch.head "):].strip()
            branch = None if head == "(detached)" else head
        elif line.startswith("# branch.ab "):
            ahead = line.split()[2]
            if ahead.startswith("+") and ahead[1:].isdigit():
                unpushed = int(ahead[1:])
        elif line and line[0] in "12u?":
            uncommitted += 1
    if branch is None:
        return None
    return {"branch": branch, "uncommitted": uncommitted, "unpushed": unpushed}


async def working_tree(path: Path) -> dict[str, Any] | None:
    """The branch and pending work in a project, None outside a repository
    or on a detached HEAD."""
    out = await _run(["git", "status", "--porcelain=v2", "--branch"], path)
    return parse_status(out) if out is not None else None


def latest_handoff(path: Path) -> dict[str, Any] | None:
    """The handoff brief most recently written for a project."""
    handoffs = list_handoffs(path)
    if not handoffs:
        return None
    newest = handoffs[0]
    return {
        "name": Path(newest["name"]).stem,
        "relPath": newest["relPath"],
        "title": newest["title"],
        "modified": newest["modified"],
    }


async def session_context(path: Path) -> dict[str, Any] | None:
    """Everything this module knows about a project, None when that is nothing."""
    tree = await working_tree(path)
    handoff = await asyncio.to_thread(latest_handoff, path)
    if tree is None and handoff is None:
        return None
    return {**(tree or {"branch": None, "uncommitted": 0, "unpushed": None}), "handoff": handoff}


def context_message(session) -> dict[str, Any]:
    return {"type": "session-context", "sessionId": session.id, "context": session.context}


async def broadcast_context(session) -> None:
    frame = context_message(session)
    for ws in list(session.connected_clients):
        try:
            await ws.send_json(frame)
        except Exception:  # noqa: BLE001 — a dying peer is its own handler's problem
            pass


class SessionContextMonitor:
    """Keeps each watched session's `context` in step with its working tree."""

    def __init__(
        self,
        sessions: Callable[[], list],
        *,
        read: Callable[[Path], Awaitable[dict[str, Any] | None]] = session_context,
        announce: Callable[[Any], Awaitable[None]] = broadcast_context,
    ) -> None:
        self._sessions = sessions
        self._read = read
        self._announce = announce
        self._task: asyncio.Task | None = None
        # Reads asked for between polls, held so they are not collected
        # before they finish and so that stopping can end them.
        self._asked: set[asyncio.Task] = set()

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        tasks = [self._task, *self._asked]
        self._task = None
        self._asked.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def refresh_soon(self, session) -> None:
        """Read one session now instead of at the next poll.

        Does nothing while the monitor is stopped: with no loop of its own
        running there is nothing to end the read if the backend shuts down.
        """
        if self._task is None:
            return
        task = asyncio.create_task(self.refresh(session))
        self._asked.add(task)
        task.add_done_callback(self._asked.discard)

    async def _loop(self) -> None:
        while True:
            try:
                await self.poll_once()
            except Exception:
                logger.exception("Session context poll failed")
            await asyncio.sleep(POLL_SECONDS)

    async def poll_once(self) -> None:
        """Refresh the sessions someone is looking at.

        A session with no client attached is skipped: nobody would see the
        answer, and it is read afresh when a client attaches.
        """
        for session in self._sessions():
            if not session.is_alive() or not session.connected_clients:
                continue
            await self.refresh(session)

    async def refresh(self, session) -> None:
        context = await self._read(session.project_path)
        if session.context != context:
            session.context = context
            await self._announce(session)


_monitor: SessionContextMonitor | None = None


def get_session_context_monitor() -> SessionContextMonitor:
    global _monitor
    if _monitor is None:
        from backend.terminal.sessions import get_registry

        _monitor = SessionContextMonitor(lambda: get_registry().sessions())
    return _monitor
