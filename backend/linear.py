"""Reading tickets from Linear, for the board.

The board file a project keeps by hand records which ticket goes with which
handoff and worktree. What it also records, and cannot keep right, is each
ticket's title, status and parent: those change in the tracker. With a key,
they are read from Linear here and the file's copies are ignored.

Read-only. This module sends queries and nothing else; a key made with only
the Read permission is all it needs.

The key is `LINEAR_API_KEY`, from the environment or `~/.cade/.env`.
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

API_URL = "https://api.linear.app/graphql"
TIMEOUT_SECONDS = 15.0
PAGE_SIZE = 100
# Pages of assigned tickets read at most. Past this the rest are left out
# rather than the board waiting on a tracker with thousands of them.
MAX_PAGES = 5
# How far up a chain of parents is followed. Each level is one more request.
PARENT_LEVELS = 3

_FIELDS = "identifier title url updatedAt state { name type } parent { identifier } team { key }"
_ID_RE = re.compile(r"^([A-Z][A-Z0-9]+)-(\d+)$")

# The tracker's own kinds of state. A ticket is finished or not by its kind,
# whatever a team has named its states.
FINISHED_TYPES = {"completed", "canceled"}

Post = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any] | None]]


def api_key() -> str | None:
    """The key in use, or None when none is set up. Kept apart from the
    reading of it so that tests can switch the tracker off in one place."""
    return read_key()


def read_key() -> str | None:
    """The key as configured.

    The environment first. A backend run from source loads the repository's
    own `.env` and stops there, so the user's file is read here as well.
    """
    key = os.environ.get("LINEAR_API_KEY")
    if key:
        return key.strip() or None
    env_file = Path.home() / ".cade" / ".env"
    try:
        from dotenv import dotenv_values

        value = dotenv_values(env_file).get("LINEAR_API_KEY")
    except Exception:  # noqa: BLE001 — an unreadable file is the same as no key
        return None
    return value.strip() if value and value.strip() else None


async def _post(query: str, variables: dict[str, Any]) -> dict[str, Any] | None:
    """Send one query. None on any failure; the reason is logged, never the key."""
    key = api_key()
    if not key:
        return None
    import httpx

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(
                API_URL,
                json={"query": query, "variables": variables},
                headers={"Authorization": key},
            )
    except httpx.HTTPError as e:
        logger.warning("Linear could not be reached: %s", type(e).__name__)
        return None
    if response.status_code != 200:
        logger.warning("Linear answered %s", response.status_code)
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    if body.get("errors"):
        logger.warning("Linear refused a query: %s", [e.get("message") for e in body["errors"]][:3])
        return None
    return body.get("data")


def normalise(node: dict[str, Any]) -> dict[str, Any]:
    """One ticket as the board uses it."""
    state = node.get("state") or {}
    return {
        "ticket": node.get("identifier"),
        "title": node.get("title") or "",
        "url": node.get("url"),
        "status": state.get("name") or "",
        "statusType": state.get("type") or "",
        "parent": (node.get("parent") or {}).get("identifier"),
        "updated": node.get("updatedAt"),
    }


async def assigned_open(post: Post = _post) -> list[dict[str, Any]] | None:
    """Every unfinished ticket assigned to the key's owner. None if Linear
    could not be read."""
    query = (
        "query($after: String) { viewer { assignedIssues(first: %d, after: $after, "
        'filter: { state: { type: { nin: ["completed", "canceled"] } } }) '
        "{ pageInfo { hasNextPage endCursor } nodes { %s } } } }" % (PAGE_SIZE, _FIELDS)
    )
    found: list[dict[str, Any]] = []
    after: str | None = None
    for _ in range(MAX_PAGES):
        data = await post(query, {"after": after})
        if data is None:
            return None
        page = ((data.get("viewer") or {}).get("assignedIssues")) or {}
        found.extend(normalise(n) for n in page.get("nodes") or [])
        info = page.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            break
        after = info.get("endCursor")
    return found


async def by_id(ids: set[str], post: Post = _post) -> list[dict[str, Any]] | None:
    """The tickets with these ids, whoever they are assigned to and whatever
    their state. One request per team, since an id is a team's key and a
    number. Ids that are not tickets are passed over."""
    by_team: dict[str, list[int]] = {}
    for ticket in ids:
        match = _ID_RE.match(ticket)
        if match:
            by_team.setdefault(match.group(1), []).append(int(match.group(2)))
    query = (
        "query($team: String!, $numbers: [Float!]) { issues(first: %d, "
        "filter: { team: { key: { eq: $team } }, number: { in: $numbers } }) { nodes { %s } } }"
        % (PAGE_SIZE, _FIELDS)
    )
    found: list[dict[str, Any]] = []
    for team, numbers in sorted(by_team.items()):
        for start in range(0, len(numbers), PAGE_SIZE):
            data = await post(query, {"team": team, "numbers": sorted(numbers)[start:start + PAGE_SIZE]})
            if data is None:
                return None
            found.extend(normalise(n) for n in (data.get("issues") or {}).get("nodes") or [])
    return found


async def tickets(wanted: set[str], post: Post = _post) -> dict[str, dict[str, Any]] | None:
    """What the board needs from the tracker, by ticket id.

    The key owner's unfinished tickets, the tickets the board file names,
    and the parents above any of them. Each entry says whether it is `mine`
    (assigned and unfinished). None when there is no key or Linear could not
    be read, in which case the board falls back on what the file says.
    """
    if post is _post and api_key() is None:
        return None
    mine = await assigned_open(post)
    if mine is None:
        return None
    known = {t["ticket"]: {**t, "mine": True} for t in mine if t["ticket"]}

    def parents_unknown() -> set[str]:
        return {t["parent"] for t in known.values() if t["parent"] and t["parent"] not in known}

    missing = {t for t in wanted if t not in known} | parents_unknown()
    for _ in range(PARENT_LEVELS + 1):
        if not missing:
            break
        fetched = await by_id(missing, post)
        if fetched is None:
            return None
        asked = missing
        for t in fetched:
            if t["ticket"]:
                known.setdefault(t["ticket"], {**t, "mine": False})
        # Then whatever those sit under, so a tree has its upper levels. An
        # id asked for and not found is not asked for again.
        missing = parents_unknown() - asked
    return known
