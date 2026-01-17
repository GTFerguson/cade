"""Session state persistence for project-based storage."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, TypedDict

logger = logging.getLogger(__name__)

SESSION_DIR = ".ccplus"
SESSION_FILE = "session.json"
SESSION_VERSION = 1


class LayoutProportions(TypedDict):
    """Layout pane proportions."""

    fileTree: float
    terminal: float
    viewer: float


class SessionState(TypedDict, total=False):
    """Session state schema."""

    version: int
    expandedPaths: list[str]
    viewerPath: str | None
    layout: LayoutProportions


def _get_session_path(working_dir: Path) -> Path:
    """Get the path to the session file."""
    return working_dir / SESSION_DIR / SESSION_FILE


def load_session(working_dir: Path) -> SessionState | None:
    """Load session state from .ccplus/session.json.

    Args:
        working_dir: Project root directory

    Returns:
        Session state dict or None if not found/invalid
    """
    session_path = _get_session_path(working_dir)

    if not session_path.exists():
        return None

    try:
        content = session_path.read_text(encoding="utf-8")
        data: dict[str, Any] = json.loads(content)

        if data.get("version") != SESSION_VERSION:
            logger.debug("Session version mismatch, ignoring")
            return None

        return SessionState(
            version=data.get("version", SESSION_VERSION),
            expandedPaths=data.get("expandedPaths", []),
            viewerPath=data.get("viewerPath"),
            layout=data.get("layout"),
        )
    except (OSError, json.JSONDecodeError) as e:
        logger.debug("Failed to load session: %s", e)
        return None


def save_session(working_dir: Path, state: SessionState) -> bool:
    """Save session state to .ccplus/session.json.

    Args:
        working_dir: Project root directory
        state: Session state to save

    Returns:
        True if saved successfully, False otherwise
    """
    session_path = _get_session_path(working_dir)

    state_with_version: SessionState = {
        "version": SESSION_VERSION,
        **state,
    }

    try:
        session_path.parent.mkdir(parents=True, exist_ok=True)

        content = json.dumps(state_with_version, indent=2)
        session_path.write_text(content, encoding="utf-8")
        return True
    except OSError as e:
        logger.warning("Failed to save session: %s", e)
        return False
