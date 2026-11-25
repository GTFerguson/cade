"""Tab groups: named, coloured groups of sessions.

A session carries only its group's name. What a group looks like and which
folders join it automatically live in one file per backend, so every device
attached to this backend draws the same groups.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.protocol import MessageType

logger = logging.getLogger(__name__)

GROUPS_FILE_NAME = "tab-groups.json"
MAX_NAME_LENGTH = 40

# Names of the theme's accent colours; the frontend maps each to a CSS variable.
GROUP_COLOURS = ("blue", "green", "orange", "red", "purple", "cyan", "yellow", "grey")
DEFAULT_COLOUR = "grey"


def clean_group_name(value: Any) -> str | None:
    """A usable group name, or None for anything that is not one."""
    if not isinstance(value, str):
        return None
    name = " ".join(value.split())[:MAX_NAME_LENGTH].strip()
    return name or None


@dataclass
class TabGroup:
    name: str
    colour: str = DEFAULT_COLOUR
    # Folders whose sessions join this group when they are created.
    paths: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "colour": self.colour, "paths": list(self.paths)}

    @classmethod
    def from_dict(cls, raw: Any) -> TabGroup | None:
        if not isinstance(raw, dict):
            return None
        name = clean_group_name(raw.get("name"))
        if name is None:
            return None
        colour = raw.get("colour")
        paths = raw.get("paths")
        return cls(
            name=name,
            colour=colour if colour in GROUP_COLOURS else DEFAULT_COLOUR,
            paths=[p for p in paths if isinstance(p, str) and p.strip()]
            if isinstance(paths, list)
            else [],
        )


def parse_groups(raw: Any) -> list[TabGroup]:
    """Groups from untrusted data: bad entries and repeated names are dropped."""
    if not isinstance(raw, list):
        return []
    groups: list[TabGroup] = []
    seen: set[str] = set()
    for item in raw:
        group = TabGroup.from_dict(item)
        if group is None or group.name in seen:
            continue
        seen.add(group.name)
        groups.append(group)
    return groups


def _is_within(path: Path, folder: Path) -> bool:
    return path == folder or folder in path.parents


def group_for_path(groups: list[TabGroup], project_path: Path) -> str | None:
    """The group whose folder list holds the project, deepest folder winning.

    Deepest so that a group for one project can sit inside a group covering
    the folder above it.
    """
    try:
        target = project_path.expanduser().resolve()
    except (OSError, RuntimeError):
        return None
    best: tuple[int, str] | None = None
    for group in groups:
        for raw in group.paths:
            try:
                folder = Path(raw).expanduser().resolve()
            except (OSError, RuntimeError):
                continue
            if not _is_within(target, folder):
                continue
            depth = len(folder.parts)
            if best is None or depth > best[0]:
                best = (depth, group.name)
    return best[1] if best else None


class TabGroupStore:
    """The group definitions file."""

    def __init__(self, cade_dir: Path) -> None:
        self._path = cade_dir / GROUPS_FILE_NAME

    def load(self) -> list[TabGroup]:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, ValueError) as e:
            logger.warning("Could not read %s: %s", self._path, e)
            return []
        return parse_groups(raw.get("groups") if isinstance(raw, dict) else raw)

    def save(self, groups: list[TabGroup]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"groups": [g.to_dict() for g in groups]}, indent=2)
        # Written beside the target and renamed over it, so a crash mid-write
        # cannot leave a truncated file that reads as "no groups".
        fd, tmp = tempfile.mkstemp(dir=self._path.parent, prefix=".tab-groups-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            os.replace(tmp, self._path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def group_for_path(self, project_path: Path) -> str | None:
        return group_for_path(self.load(), project_path)


_store: TabGroupStore | None = None


def get_tab_group_store() -> TabGroupStore:
    global _store
    if _store is None:
        _store = TabGroupStore(Path.home() / ".cade")
    return _store


def group_message(session) -> dict:
    return {
        "type": MessageType.GROUP_CHANGED,
        "sessionId": session.id,
        "group": session.group,
    }


async def broadcast_group(session, *, exclude=None) -> None:
    """Tell the other clients attached to a session that it moved group."""
    frame = group_message(session)
    for ws in list(session.connected_clients):
        if ws is exclude:
            continue
        try:
            await ws.send_json(frame)
        except Exception:  # noqa: BLE001 — a dying peer is its own handler's problem
            pass
