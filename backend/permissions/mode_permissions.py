"""Per-mode file write permissions."""

from __future__ import annotations

from pathlib import Path

# Modes with unrestricted write access
_WRITE_ALL = {"code", "orchestrator"}

# Modes restricted to writing within docs/plans/ only
_WRITE_DOCS_ONLY = {"review"}

# All other modes (plan, research) are fully read-only


def can_write(mode: str) -> bool:
    """True if the mode permits any writes at all."""
    return mode in _WRITE_ALL or mode in _WRITE_DOCS_ONLY


def can_write_path(mode: str, path: Path) -> bool:
    """True if the mode permits writing to this specific path."""
    if mode in _WRITE_ALL:
        return True
    if mode in _WRITE_DOCS_ONLY:
        parts = path.parts
        return "docs" in parts and "plans" in parts
    return False
