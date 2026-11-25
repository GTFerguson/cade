"""The projects under the main working folder, and each project's handoffs.

This is what the project picker lists: projects most recently worked on
first, and inside a project the handoff briefs a new session can start from.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

HANDOFF_DIR = Path("docs") / "plans" / "handoff"

# Paths inside a project whose modification time moves when work happens
# there. The folder's own time only moves when a top-level entry is added or
# removed, so git's index and reflog carry most of the signal.
_ACTIVITY_PATHS = (Path(".git") / "index", Path(".git") / "logs" / "HEAD", HANDOFF_DIR)


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def doc_title(path: Path) -> str:
    """A doc's frontmatter ``title:`` or first ``# `` heading, else its filename."""
    try:
        with path.open(encoding="utf-8") as fh:
            in_frontmatter = False
            for i, raw in enumerate(fh):
                line = raw.rstrip("\n")
                if i == 0 and line.strip() == "---":
                    in_frontmatter = True
                    continue
                if in_frontmatter:
                    if line.strip() == "---":
                        in_frontmatter = False
                        continue
                    if line.lower().startswith("title:"):
                        t = line.split(":", 1)[1].strip().strip("\"'")
                        if t:
                            return t
                    continue
                if line.startswith("# "):
                    return line[2:].strip()
                if i > 40:  # title lives near the top; stop scanning
                    break
    except (OSError, UnicodeDecodeError):
        pass
    return path.stem


def handoff_files(project: Path) -> list[Path]:
    """A project's handoff briefs. A README there is an index, not a brief."""
    folder = project / HANDOFF_DIR
    if not folder.is_dir():
        return []
    return [
        p for p in folder.glob("*.md") if p.is_file() and p.name.lower() != "readme.md"
    ]


def list_handoffs(project: Path) -> list[dict[str, Any]]:
    """A project's handoff briefs, most recently edited first."""
    entries = [
        {
            "name": p.name,
            "relPath": str(p.relative_to(project)),
            "title": doc_title(p),
            "modified": _mtime(p),
        }
        for p in handoff_files(project)
    ]
    entries.sort(key=lambda e: e["modified"], reverse=True)
    return entries


def project_activity(project: Path) -> float:
    """When a project was last worked on, as far as cheap checks can tell."""
    times = [_mtime(project)]
    times.extend(_mtime(project / rel) for rel in _ACTIVITY_PATHS)
    times.extend(_mtime(p) for p in handoff_files(project))
    try:
        with os.scandir(project) as entries:
            for entry in entries:
                # Hidden entries are tool state (indexes, caches) that changes
                # without anyone working on the project; git is read above.
                if entry.name.startswith("."):
                    continue
                try:
                    times.append(entry.stat(follow_symlinks=False).st_mtime)
                except OSError:
                    pass
    except OSError:
        pass
    return max(times)


def list_projects(root: Path) -> list[dict[str, Any]]:
    """Folders directly under ``root``, most recently worked on first."""
    try:
        children = [p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")]
    except OSError:
        return []
    projects = [
        {
            "name": p.name,
            "path": str(p),
            "modified": project_activity(p),
            "handoffs": len(handoff_files(p)),
        }
        for p in children
    ]
    projects.sort(key=lambda e: (-e["modified"], e["name"].lower()))
    return projects
