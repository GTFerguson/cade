"""The pull request for each session's branch, read from the `gh` CLI.

A session works on a branch; once that branch has a pull request, what
happens to it (checks, reviews, conflicts with its base) happens on GitHub
where the tab cannot see it. This module polls `gh`, which the user is
already signed in to, and keeps a short summary on each session for the tab
to show. It only reads: nothing here changes a pull request.

One `gh` call is made per repository with a session open, not one per
session, and each session is matched to a pull request by its branch.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from collections.abc import Awaitable, Callable, Iterable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# How long between polls when nothing is in motion, and while some pull
# request's checks are still running and an answer is expected soon.
POLL_SECONDS = 90.0
POLL_SECONDS_WHILE_RUNNING = 20.0
COMMAND_TIMEOUT_SECONDS = 20.0
# More open pull requests than this in one repository and the later ones are
# not seen; a session's branch is then simply shown without one.
PR_LIMIT = 100

PR_FIELDS = "number,title,url,headRefName,isDraft,reviewDecision,mergeable,statusCheckRollup"

CHECKS_FAILING = "failing"
CHECKS_RUNNING = "running"
CHECKS_PASSING = "passing"

_FAILED = {"FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"}
_UNFINISHED = {"PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"}

_REVIEWS = {
    "APPROVED": "approved",
    "CHANGES_REQUESTED": "changes",
    "REVIEW_REQUIRED": "required",
}


def checks_state(rollup: Any) -> str | None:
    """Reduce a pull request's checks to failing, running, passing or None.

    `gh` reports two kinds of entry: check runs, with a `status` and once
    finished a `conclusion`, and commit statuses, with a `state`. One failure
    outranks anything still running, since it will not pass as it stands.
    """
    if not isinstance(rollup, list) or not rollup:
        return None
    running = False
    for check in rollup:
        if not isinstance(check, dict):
            continue
        outcome = str(check.get("conclusion") or check.get("state") or "").upper()
        status = str(check.get("status") or "").upper()
        if outcome in _FAILED:
            return CHECKS_FAILING
        if outcome in _UNFINISHED or (not outcome and status != "COMPLETED"):
            running = True
    return CHECKS_RUNNING if running else CHECKS_PASSING


def summarise(pr: dict[str, Any]) -> dict[str, Any]:
    """What a tab shows of a pull request, from one `gh pr list` entry."""
    return {
        "number": pr.get("number"),
        "title": pr.get("title") or "",
        "url": pr.get("url") or "",
        "draft": bool(pr.get("isDraft")),
        "checks": checks_state(pr.get("statusCheckRollup")),
        "review": _REVIEWS.get(str(pr.get("reviewDecision") or "").upper()),
        "conflicts": str(pr.get("mergeable") or "").upper() == "CONFLICTING",
    }


def by_branch(prs: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Summaries keyed by head branch. `gh` lists newest first, and the
    newest pull request for a branch is the one a session on it means."""
    out: dict[str, dict[str, Any]] = {}
    for pr in prs:
        branch = pr.get("headRefName")
        if isinstance(branch, str) and branch and branch not in out:
            out[branch] = summarise(pr)
    return out


async def _run(args: list[str], cwd: Path) -> str | None:
    """A command's stdout, or None when it fails, hangs or is not there."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(cwd),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError:
        return None
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), COMMAND_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        return None
    return out.decode("utf-8", "replace") if proc.returncode == 0 else None


async def repo_and_branch(path: Path) -> tuple[Path, str] | None:
    """The repository a folder is in and the branch checked out there.

    None outside a repository and on a detached HEAD, which has no branch
    for a pull request to come from.
    """
    root = (await _run(["git", "rev-parse", "--show-toplevel"], path) or "").strip()
    if not root:
        return None
    # symbolic-ref, not rev-parse: it also names the branch of a repository
    # with no commits yet, and fails on a detached HEAD instead of saying "HEAD".
    branch = (await _run(["git", "symbolic-ref", "--short", "-q", "HEAD"], path) or "").strip()
    return (Path(root), branch) if branch else None


async def open_pull_requests(repo: Path) -> dict[str, dict[str, Any]] | None:
    """Open pull requests of a repository by head branch, None when `gh`
    could not say (not signed in, no GitHub remote, no network)."""
    out = await _run(
        ["gh", "pr", "list", "--state", "open", "--limit", str(PR_LIMIT), "--json", PR_FIELDS],
        repo,
    )
    if out is None:
        return None
    try:
        prs = json.loads(out)
    except ValueError:
        return None
    return by_branch(prs) if isinstance(prs, list) else None


def pr_message(session) -> dict[str, Any]:
    """The WebSocket frame carrying a session's pull request, or its absence."""
    return {"type": "session-pr", "sessionId": session.id, "pr": session.pull_request}


async def broadcast_pr(session) -> None:
    frame = pr_message(session)
    for ws in list(session.connected_clients):
        try:
            await ws.send_json(frame)
        except Exception:  # noqa: BLE001 — a dying peer is its own handler's problem
            pass


Lookup = Callable[[Path], Awaitable[Any]]


class PullRequestMonitor:
    """Keeps each live session's `pull_request` in step with GitHub."""

    def __init__(
        self,
        sessions: Callable[[], list],
        *,
        locate: Lookup = repo_and_branch,
        fetch: Lookup = open_pull_requests,
        announce: Callable[[Any], Awaitable[None]] = broadcast_pr,
    ) -> None:
        self._sessions = sessions
        self._locate = locate
        self._fetch = fetch
        self._announce = announce
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if shutil.which("gh") is None:
            # Said once here and never to the user: a tab with no pull
            # request has no reason to hear about GitHub.
            logger.info("gh is not installed; pull request state will not be shown")
            return
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                running = await self.poll_once()
            except Exception:
                logger.exception("Pull request poll failed")
                running = False
            await asyncio.sleep(POLL_SECONDS_WHILE_RUNNING if running else POLL_SECONDS)

    async def poll_once(self) -> bool:
        """Refresh every session. Returns True when some pull request's
        checks are still running, which is worth looking at again soon."""
        located: dict[str, tuple[Path, str]] = {}
        for session in self._sessions():
            if not session.is_alive():
                continue
            where = await self._locate(session.project_path)
            if where is not None:
                located[session.id] = where

        prs_by_repo: dict[Path, dict[str, dict[str, Any]] | None] = {}
        for repo in {repo for repo, _ in located.values()}:
            prs_by_repo[repo] = await self._fetch(repo)

        running = False
        for session in self._sessions():
            where = located.get(session.id)
            prs = prs_by_repo.get(where[0]) if where else {}
            if prs is None:
                # `gh` could not answer for this repository. What was shown
                # stays: a dropped connection is not a closed pull request.
                continue
            pr = prs.get(where[1]) if where else None
            if pr and pr["checks"] == CHECKS_RUNNING:
                running = True
            if session.pull_request != pr:
                session.pull_request = pr
                await self._announce(session)
        return running


_monitor: PullRequestMonitor | None = None


def get_pull_request_monitor() -> PullRequestMonitor:
    global _monitor
    if _monitor is None:
        from backend.terminal.sessions import get_registry

        _monitor = PullRequestMonitor(lambda: get_registry().sessions())
    return _monitor
