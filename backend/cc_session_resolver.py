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
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_claude_dir() -> Path:
    """Get the default Claude directory, handling Windows/WSL correctly.

    Cached because on Windows finding it shells out to WSL. Profile directories
    are read uncached by _extra_claude_dirs() so a new profile applies at once.

    Returns:
        Path to the default .claude directory.
    """
    from backend.claude_profiles import default_claude_dir

    return default_claude_dir()


# Lazy initialization to avoid import-time subprocess calls
def _get_history_file() -> Path:
    return _get_claude_dir() / "history.jsonl"


def _get_projects_dir() -> Path:
    return _get_claude_dir() / "projects"


def _extra_claude_dirs() -> list[Path]:
    """Claude profile directories other than the default one.

    Sessions started under a profile write their history and transcripts into
    that profile's directory, so lookups search these as well as the default.
    """
    from backend.claude_profiles import profile_dirs

    default = _get_claude_dir()
    return [d for d in profile_dirs() if d != default]


def _history_files() -> list[Path]:
    return [_get_history_file(), *(d / "history.jsonl" for d in _extra_claude_dirs())]


def _projects_dirs() -> list[Path]:
    return [_get_projects_dir(), *(d / "projects" for d in _extra_claude_dirs())]


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
    history_files = _history_files()
    logger.debug("Looking for slug '%s' in history at: %s", slug, history_files)

    if not any(f.exists() for f in history_files):
        logger.debug("No history.jsonl found at %s", history_files)
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
    """Read recent sessions from every known history.jsonl.

    Args:
        max_lines: Maximum number of lines to read from the end of each file.

    Returns:
        Dict mapping session_id to project path.
    """
    sessions: dict[str, str] = {}

    for history_file in _history_files():
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
            logger.warning("Error reading %s: %s", history_file, e)

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
    projects_dirs = _projects_dirs()
    logger.debug("Searching for session %s in: %s", session_id, projects_dirs)

    # Search for session file in any project directory using glob
    # This avoids needing to match Claude's exact path encoding algorithm
    session_files = [
        f for projects_dir in projects_dirs for f in projects_dir.glob(f"*/{session_id}.jsonl")
    ]
    for session_file in session_files:
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

    from backend.claude_profiles import profile_for

    history_files = [f for f in _history_files() if f.exists()]
    if not history_files:
        logger.debug("No history.jsonl found for project '%s'", project_path)
        return None

    # A project's current sessions live in its own profile's directory, so read
    # that history first; others only hold sessions from before it was profiled
    profile = profile_for(project_path)
    if profile is not None:
        preferred = profile.config_dir / "history.jsonl"
        history_files.sort(key=lambda f: f != preferred)

    for history_file in history_files:
        # Read history in reverse order (most recent first)
        lines = _tail_file(history_file, 200)

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
