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

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "event": self.event,
            "path": self.path,
        }
