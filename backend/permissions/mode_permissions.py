"""Per-mode file write permissions."""

from __future__ import annotations

from pathlib import Path

from backend.modes import MODES

_WRITE_ALL = {name for name, cfg in MODES.items() if cfg.write_access == "all"}
_WRITE_DOCS_ONLY = {name for name, cfg in MODES.items() if cfg.write_access == "docs_plans"}


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
