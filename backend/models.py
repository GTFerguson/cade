"""IDE-specific data types for CADE backend.

Portable types (FileChangeEvent) live in core/backend/models.py so
they can be consumed by other forks without pulling in IDE-specific
fields like TerminalSize or FileNode.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class FileNode:
    """Represents a file or directory in the file tree."""

    name: str
    path: str
    type: Literal["file", "directory"]
    children: list[FileNode] | None = None
    modified: float | None = None
    has_more: bool = False

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        result: dict = {
            "name": self.name,
            "path": self.path,
            "type": self.type,
        }
        if self.children is not None:
            result["children"] = [child.to_dict() for child in self.children]
        if self.modified is not None:
            result["modified"] = self.modified
        if self.has_more:
            result["hasMore"] = True
        return result


@dataclass
class TerminalSize:
    """Terminal dimensions."""

    cols: int = 80
    rows: int = 24


@dataclass
class ConnectionState:
    """State associated with a WebSocket connection."""

    working_dir: str
    terminal_size: TerminalSize = field(default_factory=TerminalSize)
