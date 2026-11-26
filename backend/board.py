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
from backend.pull_requests import _run, git_common_dir, is_main_branch
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

TICKET_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_WIKI_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
_CODE_RE = re.compile(r"`([^`]+)`")
_PR_RE = re.compile(r"#(\d+)\b")
# How a row records the ticket it sits under: "parent ABC-1" or "child of ABC-1".
_HANDOFF_LINK_RE = re.compile(r"\[\[(handoff/[^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
_PARENT_RE = re.compile(r"\b(?:parent|child of)\s+([A-Z][A-Z0-9]+-\d+)\b")

# Where the owner's tickets go that the board file does not mention. It is
# counted with the tickets in play: they are theirs and unfinished.
UNLISTED_SECTION = "Active tickets"

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
        # The doc a session on this ticket starts from. The column has been
        # called "Handoff" and "Resumption owner" and may be renamed again,
        # and it names a handoff or a plan; failing a column by any of those
        # names, a link into the handoff folder anywhere in the row will do.
        owner = _WIKI_RE.search(col("handoff", "resumption", "owner")) or next(
            (m for m in (_HANDOFF_LINK_RE.search(c) for c in cells) if m), None
        )
        target = owner.group(1).strip() if owner else None
        carries = col("worktree", "branch")
        rows.append({
            "ticket": found.group(0),
            "url": link.group(2) if link else None,
            "title": _plain(col("title", "stream")),
            "status": status.strip(),
            "statusDetail": detail.rstrip(")").strip(),
            "parent": (_PARENT_RE.search(linear) or [None, None])[1],
            "section": section,
            "handoff": target.rsplit("/", 1)[-1] if target else None,
            # The link as written, relative to the plans folder.
            "owner": target,
            "names": _CODE_RE.findall(carries),
            "prs": [int(n) for n in _PR_RE.findall(carries)],
            "next": _plain(col("next", "remaining", "evidence")),
        })
    return rows


async def _repositories(project: Path) -> list[tuple[Path, Path]]:
    """The repositories a project works on: itself, and the clones it keeps.

    Each as a folder to run git in and its common directory. A worktree
    shares its repository's common directory, so a repository is listed once
    however many worktrees sit beside it. Which repository a folder belongs
    to is read from its `.git` entry, not asked of git: a project can keep
    eighty folders here, and a process for each was most of the processes a
    board cost.
    """
    found: list[tuple[Path, Path]] = []
    seen: set[Path] = set()

    def add(folder: Path, common: Path | None) -> None:
        if common is not None and common not in seen:
            seen.add(common)
            found.append((folder, common))

    own = git_common_dir(project)
    if own is None:
        # The project may sit inside a repository without being its top.
        out = (await _run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], project) or "").strip()
        own = Path(out) if out else None
    add(project, own)
    repos = project / REPOS_DIR
    if repos.is_dir():
        for folder in sorted(p for p in repos.iterdir() if p.is_dir()):
            add(folder, git_common_dir(folder))
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


_PR_NODE = (
    "number title url state isDraft mergedAt headRefOid reviewDecision mergeable "
    "commits(last:1){nodes{commit{statusCheckRollup{state}}}}"
)
# Branches asked about in one request. GitHub limits how much one query may
# select, and a repository can have more worktrees than fit.
BRANCHES_PER_QUERY = 50

_ROLLUP = {
    "SUCCESS": "passing",
    "FAILURE": "failing",
    "ERROR": "failing",
    "PENDING": "running",
    "EXPECTED": "running",
}
_REVIEW = {"APPROVED": "approved", "CHANGES_REQUESTED": "changes", "REVIEW_REQUIRED": "required"}


def branch_query(branches: list[str]) -> str:
    """One GraphQL query asking for the newest pull requests of each branch.

    Asking by branch, instead of listing a repository's pull requests and
    looking for ours among them, costs the same however many pull requests
    the repository has, and finds one that merged long ago.
    """
    asks = " ".join(
        f"b{i}: pullRequests(headRefName:{json.dumps(branch)}, first:3, "
        f"orderBy:{{field:CREATED_AT,direction:DESC}}){{nodes{{{_PR_NODE}}}}}"
        for i, branch in enumerate(branches)
    )
    return f"query($owner:String!,$name:String!){{repository(owner:$owner,name:$name){{{asks}}}}}"


def prs_from_answer(answer: Any, branches: list[str]) -> dict[str, dict[str, Any]]:
    """The pull request that stands for each branch, from a `branch_query`
    answer: an open one before a merged one before a closed one, the newest
    of each."""
    repository = ((answer or {}).get("data") or {}).get("repository") or {}
    found: dict[str, dict[str, Any]] = {}
    for i, branch in enumerate(branches):
        nodes = (repository.get(f"b{i}") or {}).get("nodes") or []
        pick = next(
            (n for state in ("OPEN", "MERGED", "CLOSED") for n in nodes if n.get("state") == state),
            None,
        )
        if pick is None:
            continue
        state = str(pick.get("state")).lower()
        pr: dict[str, Any] = {
            "number": pick.get("number"),
            "title": pick.get("title") or "",
            "url": pick.get("url") or "",
            "state": state,
            "head": pick.get("headRefOid"),
            "mergedAt": pick.get("mergedAt"),
        }
        if state == "open":
            commits = (pick.get("commits") or {}).get("nodes") or []
            rollup = ((commits[0].get("commit") or {}).get("statusCheckRollup") or {}) if commits else {}
            pr.update({
                "draft": bool(pick.get("isDraft")),
                "checks": _ROLLUP.get(str(rollup.get("state") or "").upper()),
                "review": _REVIEW.get(str(pick.get("reviewDecision") or "").upper()),
                "conflicts": str(pick.get("mergeable") or "").upper() == "CONFLICTING",
            })
        found[branch] = pr
    return found


async def _pull_requests(repo: Path, branches: list[str]) -> dict[str, dict[str, Any]]:
    """The pull request for each of a repository's branches we have checked
    out. Empty when `gh` cannot say (no GitHub remote, signed out, offline)."""

    async def ask(chunk: list[str]) -> dict[str, dict[str, Any]]:
        out = await _run(
            ["gh", "api", "graphql", "-F", "owner={owner}", "-F", "name={repo}",
             "-f", f"query={branch_query(chunk)}"],
            repo,
        )
        try:
            return prs_from_answer(json.loads(out), chunk) if out else {}
        except ValueError:
            return {}

    chunks = [branches[i:i + BRANCHES_PER_QUERY] for i in range(0, len(branches), BRANCHES_PER_QUERY)]
    found: dict[str, dict[str, Any]] = {}
    for part in await asyncio.gather(*(ask(c) for c in chunks)):
        found.update(part)
    return found


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


async def _describe_worktrees(project: Path, *, pending: bool = True) -> list[dict[str, Any]]:
    """Every worktree of the project's repositories, with its pull request.

    With `pending`, each one's uncommitted and unpushed work is read as
    well, which is what a verdict needs and costs a `git status` apiece.
    Without it those are left as None and no verdict is given: enough for a
    caller that wants to know which pull request goes with which branch and
    will look at one worktree itself.
    """
    gate = asyncio.Semaphore(STATUS_CONCURRENCY)

    async def status(path: str) -> dict[str, Any] | None:
        async with gate:
            out = await _run(["git", "status", "--porcelain=v2", "--branch"], Path(path))
        return parse_status(out) if out is not None else None

    async def nothing(_path: str) -> None:
        return None

    async def describe(repo: Path, common: Path) -> list[dict[str, Any]]:
        trees = await _worktrees(repo)
        # A repository's main branch has no pull request of its own, so
        # GitHub is not asked about it; a clone kept only on main costs no
        # request at all.
        branches = sorted({
            t["branch"] for t in trees if t["branch"] and not is_main_branch(t["branch"], common)
        })
        # GitHub and the working trees are asked at the same time: neither
        # needs the other, and GitHub is the slow one.
        prs, states = await asyncio.gather(
            _pull_requests(repo, branches) if branches else _no_pull_requests(),
            asyncio.gather(*((status if pending else nothing)(t["path"]) for t in trees)),
        )
        contained = await asyncio.gather(*(
            _contained(Path(t["path"]), t["head"], prs.get(t["branch"]) if t["branch"] else None)
            if pending else _false()
            for t in trees
        ))
        out: list[dict[str, Any]] = []
        for tree, state, held in zip(trees, states, contained):
            branch = tree["branch"]
            pr = prs.get(branch) if branch else None
            path = Path(tree["path"])
            uncommitted = state["uncommitted"] if state else (0 if pending else None)
            out.append({
                "name": path.name,
                "path": str(path),
                "repo": repo.name,
                "branch": branch,
                "uncommitted": uncommitted,
                "unpushed": state["unpushed"] if state else None,
                "pr": pr,
                "verdict": verdict(pr, tree["head"], uncommitted or 0, contained=held) if pending else None,
            })
        return out

    # Every repository at once: one slow answer from GitHub should not hold
    # up the rest.
    per_repo = await asyncio.gather(*(describe(r, c) for r, c in await _repositories(project)))
    return [tree for trees in per_repo for tree in trees]


async def _no_pull_requests() -> dict[str, dict[str, Any]]:
    return {}


async def _false() -> bool:
    return False


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
        handoff = _owner_doc(project, row, by_handoff)
        if handoff and handoff.get("kind") != "plan":
            used_handoffs.add(row["handoff"])
        used_trees.update(t["path"] for t in trees)
        streams.append({
            "ticket": row["ticket"],
            "url": row["url"],
            "title": row["title"],
            "status": row["status"],
            "statusDetail": row["statusDetail"],
            "statusType": row.get("statusType", ""),
            "live": row.get("live", False),
            "parent": row["parent"],
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
        # Set on a board read without its worktrees (see `quick`).
        "partial": False,
    }


def _handoff_view(handoff: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": Path(handoff["name"]).stem,
        "relPath": handoff["relPath"],
        "title": handoff["title"],
        "modified": handoff["modified"],
        "kind": handoff.get("kind", "handoff"),
    }


def _owner_doc(
    project: Path, row: dict[str, Any], by_handoff: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    """The doc a row names as where its work is picked up: a handoff, or a
    plan beside the handoff folder. None when it names none or the doc is
    not there."""
    target = row.get("owner") or (f"handoff/{row['handoff']}" if row.get("handoff") else None)
    if not target:
        return None
    if target.startswith("handoff/"):
        return by_handoff.get(target.rsplit("/", 1)[-1])
    plans = (project / BOARD_FILE).parent
    path = (plans / target).with_suffix(".md")
    try:
        resolved = path.resolve()
        rel = resolved.relative_to(project.resolve())
        if not resolved.is_file():
            return None
        modified = resolved.stat().st_mtime
    except (OSError, ValueError):
        # Missing, unreadable, or outside the project.
        return None
    from backend.projects import doc_title

    return {
        "name": f"{resolved.stem}.md", "relPath": str(rel), "title": doc_title(resolved),
        "modified": modified, "kind": "plan",
    }


def _read_board_file(project: Path) -> str:
    try:
        return (project / BOARD_FILE).read_text("utf-8")
    except OSError:
        return ""


def overlay_tracker(
    rows: list[dict[str, Any]], known: dict[str, dict[str, Any]] | None
) -> list[dict[str, Any]]:
    """The board file's rows with the tracker's word taken over the file's.

    A row keeps what only the file knows (handoff, worktree, next step) and
    takes its title, status, link and parent from the tracker, which is
    where those are kept true. The owner's unfinished tickets that the file
    does not mention are added as rows of their own: a ticket nobody wrote
    down is still theirs to do. With no tracker the rows are returned as
    they are.
    """
    if known is None:
        return [{**row, "statusType": "", "live": False} for row in rows]
    out: list[dict[str, Any]] = []
    for row in rows:
        ticket = known.get(row["ticket"])
        if ticket is None:
            out.append({**row, "statusType": "", "live": False})
            continue
        out.append({
            **row,
            "title": ticket["title"] or row["title"],
            "url": ticket["url"] or row["url"],
            "status": ticket["status"],
            "statusType": ticket["statusType"],
            # The file's note beside the status says when it was last read
            # by hand, which is beside the point once it is read live.
            "statusDetail": "",
            "parent": ticket["parent"],
            "live": True,
        })
    listed = {row["ticket"] for row in rows}
    for ticket in known.values():
        if ticket["mine"] and ticket["ticket"] not in listed:
            out.append({
                "ticket": ticket["ticket"], "url": ticket["url"], "title": ticket["title"],
                "status": ticket["status"], "statusType": ticket["statusType"], "statusDetail": "",
                "parent": ticket["parent"], "section": UNLISTED_SECTION, "handoff": None,
                "names": [], "prs": [], "next": "", "live": True,
            })
    return out


def parent_titles(rows: list[dict[str, Any]], known: dict[str, dict[str, Any]] | None) -> dict[str, Any]:
    """Tickets that rows sit under but that are not rows themselves, so a
    tree's upper levels can be named."""
    listed = {row["ticket"] for row in rows}
    return {
        t["ticket"]: {"title": t["title"], "status": t["status"], "url": t["url"], "parent": t["parent"]}
        for t in (known or {}).values()
        if t["ticket"] not in listed
    }


async def gather(project: Path, *, pending: bool = True) -> dict[str, Any]:
    """Read everything the board shows for a project.

    Without `pending` the worktrees' uncommitted work and verdicts are left
    out (see `_describe_worktrees`), which is most of the cost.
    """
    from backend import linear

    text = await asyncio.to_thread(_read_board_file, project)
    rows = parse_board(text)
    wanted = {r["ticket"] for r in rows} | {r["parent"] for r in rows if r["parent"]}
    handoffs, worktrees, known = await asyncio.gather(
        asyncio.to_thread(list_handoffs, project),
        _describe_worktrees(project, pending=pending),
        linear.tickets(wanted),
    )
    has_file = bool(rows)
    rows = overlay_tracker(rows, known)
    result = assemble(project, rows, handoffs, worktrees)
    # Tickets added from the tracker are not the project having a board file.
    result["hasBoardFile"] = has_file
    result["tracker"] = {"live": known is not None, "tickets": len(known or {})}
    result["parents"] = parent_titles(rows, known)
    result["pending"] = pending
    return result


async def quick(project: Path) -> dict[str, Any]:
    """The board at once, for a screen that should not open empty.

    The last full board if there is one, however old: stale worktree state
    is better to look at than nothing while the fresh one is read. Otherwise
    the tickets and handoffs alone, which need only two reads from disk, and
    marked partial so that missing worktrees are not taken for none.
    """
    cached = _cache.get(str(project))
    if cached:
        return cached[1]
    text, handoffs = await asyncio.gather(
        asyncio.to_thread(_read_board_file, project),
        asyncio.to_thread(list_handoffs, project),
    )
    rows = overlay_tracker(parse_board(text), None)
    return {
        **assemble(project, rows, handoffs, []),
        "partial": True,
        "tracker": {"live": False, "tickets": 0},
        "parents": {},
    }


_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_gathering: dict[str, asyncio.Task] = {}
# Boards read without the worktrees' pending work, for callers that do not
# need it. Kept apart: one must never be served where a full one is wanted.
_light_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_light_gathering: dict[str, asyncio.Task] = {}


async def board(
    project: Path, *, fresh: bool = False, max_age: float = CACHE_SECONDS
) -> dict[str, Any]:
    """The project's board, gathered at most once a minute unless asked."""
    key = str(project)
    cached = _cache.get(key)
    if cached and not fresh and time.time() - cached[0] < max_age:
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


async def streams(project: Path, *, max_age: float) -> dict[str, Any]:
    """Which tickets, worktrees and pull requests go together, without what
    is pending in each worktree.

    For the line above a terminal, which wants one stream's row and reads
    its one worktree itself. A full board read recently enough is used when
    there is one; otherwise a lighter one is gathered, which runs no
    `git status` at all.
    """
    key = str(project)
    now = time.time()
    full = _cache.get(key)
    if full and now - full[0] < max_age:
        return full[1]
    light = _light_cache.get(key)
    if light and now - light[0] < max_age:
        return light[1]
    task = _light_gathering.get(key)
    if task is None:
        task = asyncio.create_task(gather(project, pending=False))
        _light_gathering[key] = task
        task.add_done_callback(lambda _t: _light_gathering.pop(key, None))
    result = await task
    _light_cache[key] = (time.time(), result)
    return result
