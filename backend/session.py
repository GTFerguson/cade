"""Session state persistence for project-based storage."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, TypedDict

logger = logging.getLogger(__name__)

SESSION_DIR = ".cade"
SESSION_FILE = "session.json"
SESSION_SUBDIR = "sessions"
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


def _slugify_dashboard(dashboard_filename: str) -> str:
    """Derive a filesystem-safe slug from a dashboard filename.

    Strips directory, takes stem, replaces path separators. Used to
    namespace session state per active dashboard so player-mode and
    GM-mode pane widths don't stomp each other.
    """
    stem = Path(dashboard_filename).stem or "dashboard"
    return stem.replace("/", "_").replace("\\", "_")


def _get_session_path(working_dir: Path, dashboard_filename: str | None = None) -> Path:
    """Get the path to the session file for a given dashboard.

    When ``dashboard_filename`` is set, sessions are stored under
    ``.cade/sessions/<slug>.json`` so each dashboard keeps its own
    pane proportions and tree-expansion state. When None, the legacy
    ``.cade/session.json`` is used (backwards-compatible for projects
    that don't declare a dashboard_file).
    """
    base = working_dir / SESSION_DIR
    if dashboard_filename:
        return base / SESSION_SUBDIR / f"{_slugify_dashboard(dashboard_filename)}.json"
    return base / SESSION_FILE


def load_session(
    working_dir: Path, dashboard_filename: str | None = None
) -> SessionState | None:
    """Load session state, namespaced by active dashboard when provided.

    Args:
        working_dir: Project root directory
        dashboard_filename: Active dashboard file (launch.yml's
            ``dashboard_file`` or the ``?dashboard=`` override). When
            set, reads ``.cade/sessions/<slug>.json`` so different
            dashboards keep independent pane widths.

    Returns:
        Session state dict or None if not found/invalid
    """
    session_path = _get_session_path(working_dir, dashboard_filename)

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


def save_session(
    working_dir: Path,
    state: SessionState,
    dashboard_filename: str | None = None,
) -> bool:
    """Save session state, namespaced by active dashboard when provided.

    Args:
        working_dir: Project root directory
        state: Session state to save
        dashboard_filename: Active dashboard file — sessions are
            keyed by dashboard slug so player-mode and GM-mode
            (different dashboards on the same project) don't
            overwrite each other's pane proportions.

    Returns:
        True if saved successfully, False otherwise
    """
    session_path = _get_session_path(working_dir, dashboard_filename)

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
