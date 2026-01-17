"""Data types for ccplus backend."""

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
        return result


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
