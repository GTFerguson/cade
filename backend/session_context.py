"""Where each session's work stands: its handoff, tickets, branch and pull request.

A tab shows one line about the work in front of it. Where a tab is opened
says little about that: several tabs are often opened on one project folder,
each working a different stream in a worktree beneath it. What tells them
apart is the handoff brief each is working from, so this module first works
out a session's handoff and then reads the rest from the board's row for it
(backend/board.py): the tickets it carries, its worktree and branch, its
pull request. A session with no handoff falls back on the folder it was
opened on.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from backend.projects import list_handoffs
from backend.pull_requests import _run

logger = logging.getLogger(__name__)

# The count of uncommitted files is what goes stale fastest, so this is
# polled more often than GitHub is.
POLL_SECONDS = 30.0
# How old a board may be and still do for the strip. Reading one runs git in
# every worktree and asks GitHub and the tracker, which a line above a
# terminal does not justify twice a minute.
BOARD_MAX_AGE_SECONDS = 120.0
# Where the hook that watches an agent's edits records the handoff a tab
# last wrote (backend/hooks/commands.py: record_handoff_owner).
OWNED_DIR = Path(".cache") / "cade-resume"

# How a session's handoff was worked out, most trusted first.
CHOSEN = "chosen"    # picked when the tab was opened
WRITTEN = "written"  # the handoff its agent last wrote to
TITLED = "titled"    # the handoff its tab title names


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
    """The branch and pending work in a folder, None outside a repository
    or on a detached HEAD."""
    out = await _run(["git", "status", "--porcelain=v2", "--branch"], path)
    return parse_status(out) if out is not None else None


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


# The fewest words of a handoff's name a title must hold to count when it
# holds only the start of the name and not all of it.
MIN_PARTIAL_WORDS = 3


def handoff_named_in(title: str, names: list[str]) -> str | None:
    """The handoff a tab's title names, if it names one.

    An agent titles its tab after what it is doing ("Review model metrics
    handoff"), which usually contains the handoff's name in words. The
    name's words must appear in the title together and in order. The whole
    name is the usual case; a title often drops a name's last word
    ("maker shooter attribution" for maker-shooter-attribution-assist), so
    the start of a name counts too when it is at least three words. The
    longest match wins, and two names matched equally well are no match: a
    wrong stream shown is worse than none. A one-word name is too easy to
    hit by chance and is never matched.
    """
    title_words = _words(title)

    def held(words: list[str]) -> bool:
        return any(
            title_words[i:i + len(words)] == words for i in range(len(title_words) - len(words) + 1)
        )

    scored: list[tuple[int, int, str]] = []
    for name in names:
        words = _words(name)
        if len(words) >= 2 and held(words):
            # A whole name outranks the start of a longer one of equal length.
            scored.append((len(words), 1, name))
            continue
        for k in range(len(words) - 1, MIN_PARTIAL_WORDS - 1, -1):
            if held(words[:k]):
                scored.append((k, 0, name))
                break
    if not scored:
        return None
    scored.sort(reverse=True)
    if len(scored) > 1 and scored[0][:2] == scored[1][:2]:
        return None
    return scored[0][2]


def written_handoff(session_id: str, project: Path) -> str | None:
    """The handoff this session's agent last wrote, as a path in the project."""
    try:
        recorded = (Path.home() / OWNED_DIR / f"owned-{session_id}").read_text().strip()
    except OSError:
        return None
    path = Path(recorded)
    try:
        rel = path.resolve().relative_to(project.resolve())
    except ValueError:
        # Written in some other project; not this tab's work here.
        return None
    return str(rel) if path.is_file() else None


def session_handoff(session, handoffs: list[dict[str, Any]]) -> tuple[dict[str, Any], str] | None:
    """The handoff a session is working from and how that is known, or None.

    `handoffs` is the project's list (backend.projects.list_handoffs). A
    handoff that no longer exists is not returned, however it was known.
    """
    by_rel = {h["relPath"]: h for h in handoffs}
    chosen = getattr(session, "handoff", None)
    if chosen and chosen in by_rel:
        return by_rel[chosen], CHOSEN
    written = written_handoff(session.id, session.project_path)
    if written and written in by_rel:
        return by_rel[written], WRITTEN
    label = getattr(session, "label", None)
    if label:
        named = handoff_named_in(label, [Path(h["name"]).stem for h in handoffs])
        if named:
            return next(h for h in handoffs if Path(h["name"]).stem == named), TITLED
    return None


def _lead_worktree(worktrees: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The worktree a stream is best summed up by: one whose pull request is
    open, then one that merged, then any."""
    for wanted in ("open", "merged"):
        for tree in worktrees:
            if tree["pr"] and tree["pr"]["state"] == wanted:
                return tree
    return worktrees[0] if worktrees else None


def stream_for(board: dict[str, Any], handoff_name: str) -> dict[str, Any] | None:
    """What the board knows about the stream a handoff carries: its tickets
    and the worktree and pull request that stand for it."""
    tickets = [s for s in board.get("streams", []) if s["handoff"] and s["handoff"]["name"] == handoff_name]
    if not tickets:
        return None
    seen: dict[str, dict[str, Any]] = {}
    for ticket in tickets:
        for tree in ticket["worktrees"]:
            seen.setdefault(tree["path"], tree)
    lead = _lead_worktree(list(seen.values()))
    return {
        "tickets": [
            {
                "ticket": t["ticket"], "title": t["title"], "url": t["url"],
                "status": t["status"], "statusType": t.get("statusType", ""),
            }
            for t in tickets
        ],
        "worktree": (
            {
                "name": lead["name"], "path": lead["path"], "branch": lead["branch"],
                "uncommitted": lead["uncommitted"], "unpushed": lead["unpushed"],
            }
            if lead else None
        ),
        "pr": lead["pr"] if lead else None,
    }


async def _board(project: Path) -> dict[str, Any] | None:
    from backend import board

    try:
        # Which tickets and pull requests go with which handoff; the one
        # worktree this tab cares about is read here, not all of them there.
        return await board.streams(project, max_age=BOARD_MAX_AGE_SECONDS)
    except Exception:  # noqa: BLE001 — the strip can do without a board
        logger.exception("Could not read the board for %s", project)
        return None


class Shared:
    """What several sessions read in one poll, read once.

    Tabs opened on one project folder ask for the same folder's state, the
    same list of handoffs and the same board. Each is fetched the first time
    it is asked for and handed to the rest.
    """

    def __init__(self) -> None:
        self._pending: dict[tuple[str, str], asyncio.Future] = {}

    async def once(self, kind: str, key: Path, read: Callable[[], Awaitable[Any]]) -> Any:
        slot = (kind, str(key))
        if slot not in self._pending:
            self._pending[slot] = asyncio.ensure_future(read())
        return await self._pending[slot]


async def session_context(
    session,
    *,
    read_board: Callable[[Path], Awaitable[dict[str, Any] | None]] = _board,
    shared: Shared | None = None,
) -> dict[str, Any] | None:
    """Everything a tab shows about its work, None when that is nothing.

    `shared` lets the sessions of one poll reuse each other's reads.
    """
    shared = shared or Shared()
    project = session.project_path
    tree, handoffs = await asyncio.gather(
        shared.once("tree", project, lambda: working_tree(project)),
        shared.once("handoffs", project, lambda: asyncio.to_thread(list_handoffs, project)),
    )
    found = session_handoff(session, handoffs)
    stream = None
    if found:
        board = await shared.once("board", project, lambda: read_board(project))
        stream = stream_for(board, Path(found[0]["name"]).stem) if board else None
    if stream and stream["worktree"]:
        # The board says which worktree stands for the stream; what is
        # pending in it is read here, for this one worktree.
        where = Path(stream["worktree"].pop("path"))
        state = await shared.once("tree", where, lambda: working_tree(where))
        if state:
            stream["worktree"].update(uncommitted=state["uncommitted"], unpushed=state["unpushed"])
        else:
            stream["worktree"].update(uncommitted=stream["worktree"]["uncommitted"] or 0)
    if tree is None and found is None:
        return None
    handoff, source = found if found else (None, None)
    return {
        # The folder the tab was opened on. Shown only when the stream has no
        # worktree of its own to show in its place.
        **(tree or {"branch": None, "uncommitted": 0, "unpushed": None}),
        "handoff": (
            {
                "name": Path(handoff["name"]).stem, "relPath": handoff["relPath"],
                "title": handoff["title"], "modified": handoff["modified"], "source": source,
            }
            if handoff else None
        ),
        "tickets": stream["tickets"] if stream else [],
        "worktree": stream["worktree"] if stream else None,
        "pr": stream["pr"] if stream else None,
    }


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
    """Keeps each watched session's `context` in step with its work."""

    def __init__(
        self,
        sessions: Callable[[], list],
        *,
        read: Callable[[Any, Shared | None], Awaitable[dict[str, Any] | None]] = lambda s, shared: session_context(
            s, shared=shared
        ),
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
        shared = Shared()
        for session in self._sessions():
            if not session.is_alive() or not session.connected_clients:
                continue
            await self.refresh(session, shared)

    async def refresh(self, session, shared: Shared | None = None) -> None:
        context = await self._read(session, shared)
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
