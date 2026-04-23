"""Per-mode file write permissions."""

from __future__ import annotations

# Modes that allow write/edit/delete operations
_WRITE_ALLOWED: dict[str, bool] = {
    "code": True,
    "architect": False,
    "review": False,
    "orchestrator": True,
}


def can_write(mode: str) -> bool:
    return _WRITE_ALLOWED.get(mode, False)
