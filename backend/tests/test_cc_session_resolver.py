"""Tests for the CC session resolver module."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.cc_session_resolver import (
    encode_project_path,
    get_cc_projects_dir,
    resolve_slug_to_project,
    _get_recent_sessions,
    _get_session_slug,
    _tail_file,
    CLAUDE_DIR,
)


class TestEncodeProjectPath:
    """Tests for encode_project_path function."""

    def test_encodes_unix_path(self) -> None:
        """Unix paths are encoded with leading dash."""
        result = encode_project_path("/mnt/c/Users/foo/project")
        assert result == "-mnt-c-Users-foo-project"

    def test_encodes_home_path(self) -> None:
        """Home directory paths are encoded correctly."""
        result = encode_project_path("/home/user/project")
        assert result == "-home-user-project"

    def test_accepts_path_object(self) -> None:
        """Path objects are accepted."""
        result = encode_project_path(Path("/home/user/project"))
        assert result == "-home-user-project"

    def test_handles_windows_path(self) -> None:
        """Windows paths with backslashes are encoded."""
        result = encode_project_path("C:\\Users\\foo\\project")
        assert result == "C:-Users-foo-project"


class TestGetCCProjectsDir:
    """Tests for get_cc_projects_dir function."""

    def test_returns_projects_subdir(self) -> None:
        """Returns path under ~/.claude/projects/."""
        result = get_cc_projects_dir("/mnt/c/project")
        expected = CLAUDE_DIR / "projects" / "-mnt-c-project"
        assert result == expected


class TestTailFile:
    """Tests for _tail_file function."""

    def test_tail_reads_last_lines(self, temp_dir: Path) -> None:
        """Reads the last N lines of a file."""
        test_file = temp_dir / "test.txt"
        lines = [f"line{i}\n" for i in range(10)]
        test_file.write_text("".join(lines))

        result = _tail_file(test_file, 3)
        assert len(result) == 3
        assert "line7\n" in result
        assert "line8\n" in result
        assert "line9\n" in result

    def test_tail_small_file(self, temp_dir: Path) -> None:
        """Small files return all lines."""
        test_file = temp_dir / "small.txt"
        test_file.write_text("line1\nline2\n")

        result = _tail_file(test_file, 100)
        assert len(result) == 2

    def test_tail_nonexistent_file(self, temp_dir: Path) -> None:
        """Non-existent files return empty list."""
        result = _tail_file(temp_dir / "nonexistent.txt", 10)
        assert result == []


class TestGetRecentSessions:
    """Tests for _get_recent_sessions function."""

    def test_parses_history_entries(self, temp_dir: Path, monkeypatch) -> None:
        """Parses session entries from history.jsonl."""
        history_file = temp_dir / "history.jsonl"
        entries = [
            {"sessionId": "sess-1", "project": "/project/a"},
            {"sessionId": "sess-2", "project": "/project/b"},
        ]
        history_file.write_text("\n".join(json.dumps(e) for e in entries))

        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE", history_file
        )

        result = _get_recent_sessions()
        assert result == {
            "sess-1": "/project/a",
            "sess-2": "/project/b",
        }

    def test_handles_missing_file(self, temp_dir: Path, monkeypatch) -> None:
        """Missing history file returns empty dict."""
        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE",
            temp_dir / "nonexistent.jsonl",
        )

        result = _get_recent_sessions()
        assert result == {}

    def test_skips_invalid_json(self, temp_dir: Path, monkeypatch) -> None:
        """Invalid JSON lines are skipped."""
        history_file = temp_dir / "history.jsonl"
        content = (
            'invalid json\n'
            '{"sessionId": "good", "project": "/project"}\n'
            'also invalid\n'
        )
        history_file.write_text(content)

        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE", history_file
        )

        result = _get_recent_sessions()
        assert result == {"good": "/project"}

    def test_skips_entries_without_required_fields(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """Entries without sessionId or project are skipped."""
        history_file = temp_dir / "history.jsonl"
        entries = [
            {"sessionId": "sess-1"},  # Missing project
            {"project": "/project/a"},  # Missing sessionId
            {"sessionId": "sess-2", "project": "/project/b"},  # Valid
        ]
        history_file.write_text("\n".join(json.dumps(e) for e in entries))

        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE", history_file
        )

        result = _get_recent_sessions()
        assert result == {"sess-2": "/project/b"}


class TestGetSessionSlug:
    """Tests for _get_session_slug function."""

    def test_finds_slug_in_session_file(self, temp_dir: Path, monkeypatch) -> None:
        """Finds slug in a session's jsonl file."""
        projects_dir = temp_dir / "projects" / "-project-path"
        projects_dir.mkdir(parents=True)

        session_file = projects_dir / "sess-123.jsonl"
        entries = [
            {"type": "file-history-snapshot", "messageId": "1"},
            {"type": "user", "slug": "jazzy-crunching-moonbeam"},
            {"type": "assistant", "content": "hello"},
        ]
        session_file.write_text("\n".join(json.dumps(e) for e in entries))

        monkeypatch.setattr(
            "backend.cc_session_resolver.PROJECTS_DIR", temp_dir / "projects"
        )

        result = _get_session_slug("/project/path", "sess-123")
        assert result == "jazzy-crunching-moonbeam"

    def test_returns_none_for_missing_file(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """Missing session file returns None."""
        monkeypatch.setattr(
            "backend.cc_session_resolver.PROJECTS_DIR", temp_dir / "projects"
        )

        result = _get_session_slug("/project/path", "nonexistent")
        assert result is None

    def test_returns_none_for_no_slug(self, temp_dir: Path, monkeypatch) -> None:
        """Session file without slug returns None."""
        projects_dir = temp_dir / "projects" / "-project-path"
        projects_dir.mkdir(parents=True)

        session_file = projects_dir / "sess-123.jsonl"
        entries = [
            {"type": "file-history-snapshot", "messageId": "1"},
            {"type": "user", "content": "hello"},  # No slug
        ]
        session_file.write_text("\n".join(json.dumps(e) for e in entries))

        monkeypatch.setattr(
            "backend.cc_session_resolver.PROJECTS_DIR", temp_dir / "projects"
        )

        result = _get_session_slug("/project/path", "sess-123")
        assert result is None


class TestResolveSlugToProject:
    """Tests for resolve_slug_to_project function."""

    def test_resolves_slug_to_project_path(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """Resolves a slug to its project path."""
        # Set up mock Claude directory structure
        claude_dir = temp_dir / ".claude"
        history_file = claude_dir / "history.jsonl"
        projects_dir = claude_dir / "projects"

        # Create history entry
        history_file.parent.mkdir(parents=True, exist_ok=True)
        history_entry = {"sessionId": "sess-abc", "project": "/home/user/myproject"}
        history_file.write_text(json.dumps(history_entry))

        # Create session file with slug
        project_subdir = projects_dir / "-home-user-myproject"
        project_subdir.mkdir(parents=True)
        session_file = project_subdir / "sess-abc.jsonl"
        session_entries = [
            {"type": "user", "slug": "jazzy-crunching-moonbeam"},
        ]
        session_file.write_text("\n".join(json.dumps(e) for e in session_entries))

        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE", history_file
        )
        monkeypatch.setattr(
            "backend.cc_session_resolver.PROJECTS_DIR", projects_dir
        )

        result = resolve_slug_to_project("jazzy-crunching-moonbeam")
        assert result == Path("/home/user/myproject")

    def test_returns_none_for_unknown_slug(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """Unknown slugs return None."""
        # Set up mock Claude directory with no matching slug
        history_file = temp_dir / "history.jsonl"
        projects_dir = temp_dir / "projects"

        history_entry = {"sessionId": "sess-abc", "project": "/project"}
        history_file.write_text(json.dumps(history_entry))

        project_subdir = projects_dir / "-project"
        project_subdir.mkdir(parents=True)
        session_file = project_subdir / "sess-abc.jsonl"
        session_file.write_text(json.dumps({"type": "user", "slug": "other-slug"}))

        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE", history_file
        )
        monkeypatch.setattr(
            "backend.cc_session_resolver.PROJECTS_DIR", projects_dir
        )

        result = resolve_slug_to_project("nonexistent-slug")
        assert result is None

    def test_returns_none_for_missing_history(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """Missing history.jsonl returns None."""
        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE",
            temp_dir / "nonexistent.jsonl",
        )

        result = resolve_slug_to_project("any-slug")
        assert result is None

    def test_handles_multiple_sessions_same_slug(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """First matching session wins when multiple have same slug."""
        # This scenario shouldn't happen in practice, but test defensive behavior
        history_file = temp_dir / "history.jsonl"
        projects_dir = temp_dir / "projects"

        entries = [
            {"sessionId": "sess-1", "project": "/project/a"},
            {"sessionId": "sess-2", "project": "/project/b"},
        ]
        history_file.write_text("\n".join(json.dumps(e) for e in entries))

        # Both sessions have the same slug
        for encoded, sess_id in [("-project-a", "sess-1"), ("-project-b", "sess-2")]:
            subdir = projects_dir / encoded
            subdir.mkdir(parents=True)
            session_file = subdir / f"{sess_id}.jsonl"
            session_file.write_text(json.dumps({"type": "user", "slug": "same-slug"}))

        monkeypatch.setattr(
            "backend.cc_session_resolver.HISTORY_FILE", history_file
        )
        monkeypatch.setattr(
            "backend.cc_session_resolver.PROJECTS_DIR", projects_dir
        )

        result = resolve_slug_to_project("same-slug")
        # Should return one of the projects (dict ordering may vary)
        assert result in [Path("/project/a"), Path("/project/b")]
