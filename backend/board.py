"""The board for a project: its streams of work in one place.

A stream is a ticket and what carries it: a handoff brief, a worktree and
branch, a pull request. People keep that mapping by hand in a markdown table
(`docs/plans/work-board.md`), where every mechanical column goes stale the
moment it is written. This module reads the table for what only a person
knows (which ticket, which handoff, which worktree, what is next) and fills
in the rest from where it lives: the worktree's own state from git, the pull
request's from GitHub, the handoff's age from disk.

Nothing here writes. The board file is read, never edited, and worktrees are
described, never removed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

from backend.projects import list_handoffs
from backend.pull_requests import PR_FIELDS, _run, summarise
from backend.session_context import parse_status

logger = logging.getLogger(__name__)

BOARD_FILE = Path("docs") / "plans" / "work-board.md"
# Where a project keeps the clones and worktrees of the repositories it works
# on, beside the project being a repository itself.
REPOS_DIR = "repos"
# Worktrees whose `git status` runs at once. Each is a process reading a
# whole checkout, and a project can have dozens.
STATUS_CONCURRENCY = 8
# How long a gathered board is served again without looking. Gathering runs
# git in every worktree and asks GitHub, which takes seconds.
CACHE_SECONDS = 60.0
MERGED_PR_LIMIT = 300

TICKET_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_WIKI_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
_CODE_RE = re.compile(r"`([^`]+)`")
_PR_RE = re.compile(r"#(\d+)\b")

# A worktree's standing, worked out the same way wherever it is shown.
FINISHED = "finished"          # merged, nothing newer than the merge, clean
MERGED_DIRTY = "merged-dirty"  # merged, but removing it would lose something
IN_REVIEW = "in-review"        # pull request open
CLOSED = "closed"              # pull request closed without merging
LOCAL = "local"                # no pull request


def _cells(line: str) -> list[str]:
    # A wiki-link's alias is written with a pipe, which is not a column break.
    held = re.sub(r"\[\[[^\]]*\]\]", lambda m: m.group(0).replace("|", "\x00"), line)
    return [c.strip().replace("\x00", "|") for c in held.strip().strip("|").split("|")]


def _is_rule(line: str) -> bool:
    return bool(re.fullmatch(r"\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?", line.strip()))


def _plain(text: str) -> str:
    """Markdown cell text with its links and code marks taken off."""
    text = _LINK_RE.sub(r"\1", text)
    text = _WIKI_RE.sub(lambda m: m.group(1).rsplit("/", 1)[-1], text)
    return text.replace("`", "").replace("**", "").strip()


def parse_board(text: str) -> list[dict[str, Any]]:
    """The ticket rows of a board file.

    Any table with a "Ticket" column counts, whatever else it has; the other
    columns are found by name, so tables of different shapes in one file all
    read. A row whose ticket cell names no ticket is skipped.
    """
    rows: list[dict[str, Any]] = []
    section = ""
    header: list[str] | None = None
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("#"):
            section = line.lstrip("#").strip()
            header = None
            continue
        if not line.lstrip().startswith("|"):
            header = None
            continue
        if _is_rule(line):
            continue
        cells = _cells(line)
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if header is None and _is_rule(nxt):
            header = [c.lower() for c in cells]
            continue
        if header is None or "ticket" not in header:
            continue

        def col(*names: str) -> str:
            for at, name in enumerate(header or []):
                if any(n in name for n in names) and at < len(cells):
                    return cells[at]
            return ""

        ticket_cell = cells[header.index("ticket")] if header.index("ticket") < len(cells) else ""
        found = TICKET_RE.search(_plain(ticket_cell))
        if not found:
            continue
        link = _LINK_RE.search(ticket_cell)
        linear = _plain(col("linear"))
        status, _, detail = linear.partition(" (")
        handoff = _WIKI_RE.search(col("handoff"))
        carries = col("worktree", "branch")
        rows.append({
            "ticket": found.group(0),
            "url": link.group(2) if link else None,
            "title": _plain(col("title", "stream")),
            "status": status.strip(),
            "statusDetail": detail.rstrip(")").strip(),
            "section": section,
            "handoff": handoff.group(1).rsplit("/", 1)[-1] if handoff else None,
            "names": _CODE_RE.findall(carries),
            "prs": [int(n) for n in _PR_RE.findall(carries)],
            "next": _plain(col("next", "remaining", "evidence")),
        })
    return rows


async def _repositories(project: Path) -> list[Path]:
    """The repositories a project works on: itself, and the clones it keeps."""
    found: list[Path] = []
    candidates = [project]
    repos = project / REPOS_DIR
    if repos.is_dir():
        candidates.extend(sorted(p for p in repos.iterdir() if p.is_dir()))
    seen: set[str] = set()
    for folder in candidates:
        # A worktree shares its repository's common directory, so each
        # repository is listed once however many worktrees sit beside it.
        common = (await _run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], folder) or "").strip()
        if common and common not in seen:
            seen.add(common)
            found.append(folder)
    return found


async def _worktrees(repo: Path) -> list[dict[str, Any]]:
    out = await _run(["git", "worktree", "list", "--porcelain"], repo) or ""
    trees: list[dict[str, Any]] = []
    current: dict[str, Any] = {}
    for line in [*out.splitlines(), ""]:
        if line.startswith("worktree "):
            current = {"path": line[len("worktree "):], "branch": None, "head": None}
        elif line.startswith("HEAD "):
            current["head"] = line[len("HEAD "):]
        elif line.startswith("branch "):
            current["branch"] = line[len("branch "):].removeprefix("refs/heads/")
        elif not line and current:
            trees.append(current)
            current = {}
    return trees


async def _pull_requests(repo: Path) -> dict[str, dict[str, Any]]:
    """Pull requests of a repository by head branch: the open ones in full,
    and the merged and closed ones by their state. Empty when `gh` cannot say."""
    by_branch: dict[str, dict[str, Any]] = {}

    async def listed(state: str, fields: str, limit: int) -> list[dict[str, Any]]:
        out = await _run(
            ["gh", "pr", "list", "--state", state, "--limit", str(limit), "--json", fields], repo
        )
        try:
            prs = json.loads(out) if out else []
        except ValueError:
            prs = []
        return prs if isinstance(prs, list) else []

    done_fields = "number,title,url,headRefName,headRefOid,state,mergedAt"
    open_prs, merged, closed = await asyncio.gather(
        listed("open", PR_FIELDS + ",headRefOid", 100),
        listed("merged", done_fields, MERGED_PR_LIMIT),
        listed("closed", done_fields, 100),
    )
    # Open outranks merged outranks closed for a branch that has several, and
    # `gh` lists newest first within each.
    for state, prs in (("open", open_prs), ("merged", merged), ("closed", closed)):
        for pr in prs:
            branch = pr.get("headRefName")
            if not isinstance(branch, str) or branch in by_branch:
                continue
            summary = summarise(pr) if state == "open" else {
                "number": pr.get("number"), "title": pr.get("title") or "", "url": pr.get("url") or "",
            }
            by_branch[branch] = {
                **summary,
                "state": "merged" if state == "merged" else ("closed" if state == "closed" else "open"),
                "head": pr.get("headRefOid"),
                "mergedAt": pr.get("mergedAt"),
            }
    return by_branch


def verdict(
    pr: dict[str, Any] | None, head: str | None, uncommitted: int, *, contained: bool = False
) -> str:
    """Where a worktree stands. "Finished" is deliberately strict: anything
    that removing the worktree would lose keeps it out.

    `contained` says the worktree's commit is already part of what the pull
    request merged, which covers a branch that was updated on GitHub after
    the last local pull: it is behind the merged head, not ahead of it.
    """
    if pr is None:
        return LOCAL
    if pr["state"] == "open":
        return IN_REVIEW
    if pr["state"] == "closed":
        return CLOSED
    nothing_newer = bool(head) and (head == pr.get("head") or contained)
    return FINISHED if nothing_newer and uncommitted == 0 else MERGED_DIRTY


async def _contained(path: Path, head: str | None, pr: dict[str, Any] | None) -> bool:
    """Whether a merged pull request's head already holds this commit. False
    when git cannot tell, for one because the merged head was never fetched."""
    merged_head = pr.get("head") if pr and pr["state"] == "merged" else None
    if not head or not merged_head or head == merged_head:
        return False
    return await _run(["git", "merge-base", "--is-ancestor", head, merged_head], path) is not None


async def _describe_worktrees(project: Path) -> list[dict[str, Any]]:
    gate = asyncio.Semaphore(STATUS_CONCURRENCY)

    async def status(path: str) -> dict[str, Any] | None:
        async with gate:
            out = await _run(["git", "status", "--porcelain=v2", "--branch"], Path(path))
        return parse_status(out) if out is not None else None

    described: list[dict[str, Any]] = []
    for repo in await _repositories(project):
        trees, prs = await asyncio.gather(_worktrees(repo), _pull_requests(repo))
        states = await asyncio.gather(*(status(t["path"]) for t in trees))
        for tree, state in zip(trees, states):
            branch = tree["branch"]
            pr = prs.get(branch) if branch else None
            uncommitted = state["uncommitted"] if state else 0
            path = Path(tree["path"])
            contained = await _contained(path, tree["head"], pr)
            described.append({
                "name": path.name,
                "path": str(path),
                "repo": repo.name,
                "branch": branch,
                "uncommitted": uncommitted,
                "unpushed": state["unpushed"] if state else None,
                "pr": pr,
                "verdict": verdict(pr, tree["head"], uncommitted, contained=contained),
            })
    return described


def assemble(
    project: Path,
    rows: list[dict[str, Any]],
    handoffs: list[dict[str, Any]],
    worktrees: list[dict[str, Any]],
) -> dict[str, Any]:
    """Join the board's rows to the handoffs and worktrees they name.

    What no row names is returned too, as the gaps the board exists to show:
    a handoff with no ticket, a worktree nobody listed.
    """
    by_handoff = {Path(h["name"]).stem: h for h in handoffs}
    by_name: dict[str, dict[str, Any]] = {}
    for tree in worktrees:
        by_name[tree["name"]] = tree
        if tree["branch"]:
            by_name[tree["branch"]] = tree
    by_pr = {t["pr"]["number"]: t for t in worktrees if t["pr"]}

    used_handoffs: set[str] = set()
    used_trees: set[str] = set()
    streams: list[dict[str, Any]] = []
    for row in rows:
        trees: list[dict[str, Any]] = []
        for key in [*row["names"], *row["prs"]]:
            tree = by_name.get(key) if isinstance(key, str) else by_pr.get(key)
            if tree and tree not in trees:
                trees.append(tree)
        handoff = by_handoff.get(row["handoff"]) if row["handoff"] else None
        if handoff:
            used_handoffs.add(row["handoff"])
        used_trees.update(t["path"] for t in trees)
        streams.append({
            "ticket": row["ticket"],
            "url": row["url"],
            "title": row["title"],
            "status": row["status"],
            "statusDetail": row["statusDetail"],
            "section": row["section"],
            "next": row["next"],
            "handoff": _handoff_view(handoff) if handoff else None,
            # Named on the board but not on disk: said, so it can be fixed.
            "missingHandoff": row["handoff"] if row["handoff"] and not handoff else None,
            "worktrees": trees,
            "prs": row["prs"],
        })

    return {
        "project": str(project),
        "hasBoardFile": bool(rows),
        "streams": streams,
        "handoffs": [_handoff_view(h) for h in handoffs if Path(h["name"]).stem not in used_handoffs],
        "worktrees": [t for t in worktrees if t["path"] not in used_trees],
        "gathered": time.time(),
    }


def _handoff_view(handoff: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": Path(handoff["name"]).stem,
        "relPath": handoff["relPath"],
        "title": handoff["title"],
        "modified": handoff["modified"],
    }


async def gather(project: Path) -> dict[str, Any]:
    """Read everything the board shows for a project."""
    try:
        text = await asyncio.to_thread((project / BOARD_FILE).read_text, "utf-8")
    except OSError:
        text = ""
    handoffs, worktrees = await asyncio.gather(
        asyncio.to_thread(list_handoffs, project),
        _describe_worktrees(project),
    )
    return assemble(project, parse_board(text), handoffs, worktrees)


_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_gathering: dict[str, asyncio.Task] = {}


async def board(project: Path, *, fresh: bool = False) -> dict[str, Any]:
    """The project's board, gathered at most once a minute unless asked."""
    key = str(project)
    cached = _cache.get(key)
    if cached and not fresh and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]
    # Two requests for one project share a gathering instead of running git
    # in every worktree twice.
    task = _gathering.get(key)
    if task is None:
        task = asyncio.create_task(gather(project))
        _gathering[key] = task
        task.add_done_callback(lambda _t: _gathering.pop(key, None))
    result = await task
    _cache[key] = (time.time(), result)
    return result
