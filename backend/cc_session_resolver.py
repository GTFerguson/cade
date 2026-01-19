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
from pathlib import Path

logger = logging.getLogger(__name__)

CLAUDE_DIR = Path.home() / ".claude"
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
    if not HISTORY_FILE.exists():
        logger.debug("history.jsonl not found at %s", HISTORY_FILE)
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

    try:
        lines = _tail_file(HISTORY_FILE, max_lines)
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

    Args:
        project_path: The project path.
        session_id: The session UUID.

    Returns:
        The session slug if found, None otherwise.
    """
    projects_dir = get_cc_projects_dir(project_path)
    session_file = projects_dir / f"{session_id}.jsonl"

    if not session_file.exists():
        return None

    try:
        # Read through the file looking for a slug entry
        # Slugs are stored in entries with type: "user"
        with session_file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    # Slug appears in user-type entries
                    if entry.get("slug"):
                        return entry["slug"]
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.debug("Error reading session file %s: %s", session_file, e)

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
