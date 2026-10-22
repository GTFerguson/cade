"""Portable data types used by core/backend primitives.

Kept minimal: only types referenced by watcher, dashboard, or other
core modules live here. IDE-specific types (FileNode, TerminalSize,
ConnectionState) remain in backend/models.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class FileChangeEvent:
    """Represents a file system change event."""

    event: Literal["created", "modified", "deleted"]
    path: str
    # Whether the path is a directory; None when unknown (a deleted path
    # cannot be stat'ed, and a plain watcher does not look). Clients patch
    # their tree from events instead of refetching it, so a created entry
    # must say what kind of node to insert.
    is_dir: bool | None = None
    # Whether the project's .gitignore hides the path, so a client showing
    # only tracked files can skip the entry without asking.
    ignored: bool = False

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "event": self.event,
            "path": self.path,
            "isDir": self.is_dir,
            "ignored": self.ignored,
        }
