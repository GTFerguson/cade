"""Resolver for mapping Claude Code session slugs to project paths.

This module provides functionality to resolve plan file slugs (like
'jazzy-crunching-moonbeam') to their corresponding project paths by
querying Claude's session files.

Resolution flow:
    Plan file: ~/.claude/plans/jazzy-crunching-moonbeam.md
        ↓ extract slug from filename
    Slug: "jazzy-crunching-moonbeam"
        ↓ scan history.jsonl for recent sessions
        ↓ check each session's .jsonl for matching slug
    Project path: /mnt/c/.../project
        ↓ lookup in ConnectionRegistry
    WebSocket connections for that project → route message
"""

from __future__ import annotations

import json
import logging
import sys
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_claude_dir() -> Path:
    """Get the Claude directory, handling Windows/WSL correctly.

    When running on Windows but Claude Code runs in WSL, the Claude directory
    is in the WSL filesystem, not the Windows filesystem.

    Returns:
        Path to the .claude directory.
    """
    if sys.platform == "win32":
        # On Windows, Claude Code likely runs in WSL
        from backend.wsl.paths import get_wsl_home_as_windows_path

        wsl_home = get_wsl_home_as_windows_path()
        if wsl_home:
            claude_dir = Path(wsl_home) / ".claude"
            logger.debug("Using WSL Claude directory: %s", claude_dir)
            return claude_dir

    # Default: use local home directory
    return Path.home() / ".claude"


# Lazy initialization to avoid import-time subprocess calls
def _get_history_file() -> Path:
    return _get_claude_dir() / "history.jsonl"


def _get_projects_dir() -> Path:
    return _get_claude_dir() / "projects"


# For backwards compatibility with tests that monkeypatch these
CLAUDE_DIR = Path.home() / ".claude"  # Default, may be overridden
HISTORY_FILE = CLAUDE_DIR / "history.jsonl"
PROJECTS_DIR = CLAUDE_DIR / "projects"


def resolve_slug_to_project(slug: str) -> Path | None:
    """Find which project is using a Claude Code session slug.

    Reads Claude's history.jsonl to find recent sessions, then checks each
    session's .jsonl file for a matching slug.

    Args:
        slug: The session slug (e.g., "jazzy-crunching-moonbeam")

    Returns:
        The project path if found, None otherwise.
    """
    history_file = _get_history_file()
    logger.debug("Looking for slug '%s' in history at: %s", slug, history_file)

    if not history_file.exists():
        logger.debug("history.jsonl not found at %s", history_file)
        return None

    # Read recent history entries to find active sessions
    sessions = _get_recent_sessions()

    if not sessions:
        logger.debug("No sessions found in history.jsonl")
        return None

    # Check each session's file for the matching slug
    for session_id, project_path in sessions.items():
        session_slug = _get_session_slug(project_path, session_id)
        if session_slug == slug:
            logger.debug(
                "Resolved slug '%s' to project: %s", slug, project_path
            )
            return Path(project_path)

    logger.debug("No session found with slug '%s'", slug)
    return None


def encode_project_path(project_path: Path | str) -> str:
    """Encode a project path for Claude's projects directory format.

    Claude encodes project paths by replacing '/' with '-' and removing
    leading separators.

    Args:
        project_path: The project path to encode.

    Returns:
        The encoded directory name.

    Examples:
        >>> encode_project_path("/mnt/c/Users/foo/project")
        '-mnt-c-Users-foo-project'
        >>> encode_project_path("/home/user/project")
        '-home-user-project'
    """
    path_str = str(project_path)
    # Replace all path separators with dashes
    encoded = path_str.replace("/", "-").replace("\\", "-")
    return encoded


def get_cc_projects_dir(project_path: Path | str) -> Path:
    """Get the Claude projects directory for a given project path.

    Args:
        project_path: The project path.

    Returns:
        Path to the Claude projects subdirectory for this project.
    """
    encoded = encode_project_path(project_path)
    return PROJECTS_DIR / encoded


def _get_recent_sessions(max_lines: int = 100) -> dict[str, str]:
    """Read recent sessions from history.jsonl.

    Args:
        max_lines: Maximum number of lines to read from the end.

    Returns:
        Dict mapping session_id to project path.
    """
    sessions: dict[str, str] = {}
    history_file = _get_history_file()

    try:
        lines = _tail_file(history_file, max_lines)
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                session_id = entry.get("sessionId")
                project = entry.get("project")
                if session_id and project:
                    sessions[session_id] = project
            except json.JSONDecodeError:
                continue
    except Exception as e:
        logger.warning("Error reading history.jsonl: %s", e)

    return sessions


def _get_session_slug(project_path: str, session_id: str) -> str | None:
    """Extract the slug from a session's jsonl file.

    Searches for the session file using glob instead of encoding the project
    path, which is more robust across platforms since Claude's path encoding
    algorithm may vary (e.g., replacing '.' with '-' on some systems).

    Args:
        project_path: The project path (unused, kept for API compatibility).
        session_id: The session UUID.

    Returns:
        The session slug if found, None otherwise.
    """
    projects_dir = _get_projects_dir()
    logger.debug("Searching for session %s in: %s", session_id, projects_dir)

    # Search for session file in any project directory using glob
    # This avoids needing to match Claude's exact path encoding algorithm
    for session_file in projects_dir.glob(f"*/{session_id}.jsonl"):
        try:
            with session_file.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        if entry.get("slug"):
                            return entry["slug"]
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            logger.debug("Error reading session file %s: %s", session_file, e)

    return None


def resolve_project_to_slug(project_path: Path | str) -> str | None:
    """Find the Claude Code session slug for a given project.

    This is the reverse of resolve_slug_to_project(). Given a project path,
    finds the most recent Claude Code session for that project and returns
    its slug.

    Args:
        project_path: The project directory path.

    Returns:
        The session slug if found, None otherwise.
    """
    from backend.wsl.paths import wsl_mount_to_windows_path

    # Normalize the project path for comparison
    project_str = str(project_path)
    # Also get Windows-style path for comparison
    project_windows = wsl_mount_to_windows_path(project_str)

    # Normalize both to lowercase for case-insensitive comparison on Windows
    project_normalized = project_str.lower().replace("\\", "/")
    project_windows_normalized = project_windows.lower().replace("\\", "/")

    history_file = _get_history_file()
    if not history_file.exists():
        logger.debug("history.jsonl not found at %s", history_file)
        return None

    # Read history in reverse order (most recent first)
    lines = _tail_file(history_file, 200)

    # Track session_ids we've seen for this project (most recent first)
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            session_id = entry.get("sessionId")
            entry_project = entry.get("project", "")

            if not session_id or not entry_project:
                continue

            # Normalize entry project path for comparison
            entry_normalized = entry_project.lower().replace("\\", "/")
            entry_windows = wsl_mount_to_windows_path(entry_project)
            entry_windows_normalized = entry_windows.lower().replace("\\", "/")

            # Check if this entry matches our project
            if (entry_normalized == project_normalized or
                entry_normalized == project_windows_normalized or
                entry_windows_normalized == project_normalized or
                entry_windows_normalized == project_windows_normalized):

                # Found a matching session, get its slug
                slug = _get_session_slug(entry_project, session_id)
                if slug:
                    logger.debug(
                        "Resolved project '%s' to slug '%s'",
                        project_path, slug
                    )
                    return slug

        except json.JSONDecodeError:
            continue

    logger.debug("No session found for project '%s'", project_path)
    return None


def _tail_file(path: Path, lines: int) -> list[str]:
    """Read the last N lines from a file efficiently.

    Args:
        path: Path to the file.
        lines: Number of lines to read.

    Returns:
        List of the last N lines (may be fewer if file is smaller).
    """
    result: list[str] = []

    try:
        with path.open("r", encoding="utf-8") as f:
            # For small files, just read everything
            all_lines = f.readlines()
            result = all_lines[-lines:] if len(all_lines) > lines else all_lines
    except Exception as e:
        logger.debug("Error tailing file %s: %s", path, e)

    return result
