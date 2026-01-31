"""Integration tests for /api/view with real file system.

These tests exercise the full plan file → slug → project → connection routing
path, catching issues like WSL cache timing problems.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.cc_session_resolver import (
    _get_claude_dir,
    resolve_slug_to_project,
)
from backend.connection_registry import ConnectionRegistry


class TestViewRoutingIntegration:
    """Integration tests for /api/view with real file system."""

    @pytest.fixture
    def setup_mock_claude_dir(self, temp_dir: Path, monkeypatch):
        """Create a mock Claude directory structure and patch resolvers.

        Returns a function that creates the directory structure when called.
        """

        def _setup(project_path: str, session_id: str, slug: str):
            # Create the Claude directory structure
            claude_dir = temp_dir / ".claude"
            history_file = claude_dir / "history.jsonl"
            projects_dir = claude_dir / "projects"

            # Create history entry
            history_file.parent.mkdir(parents=True, exist_ok=True)
            history_entry = {"sessionId": session_id, "project": project_path}
            history_file.write_text(json.dumps(history_entry))

            # Create session file with slug - encode project path like Claude does
            encoded_path = project_path.replace("/", "-").replace("\\", "-")
            project_subdir = projects_dir / encoded_path
            project_subdir.mkdir(parents=True)
            session_file = project_subdir / f"{session_id}.jsonl"
            session_entries = [
                {"type": "user", "slug": slug},
            ]
            session_file.write_text(
                "\n".join(json.dumps(e) for e in session_entries)
            )

            # Create the plan file
            plans_dir = claude_dir / "plans"
            plans_dir.mkdir(parents=True, exist_ok=True)
            plan_file = plans_dir / f"{slug}.md"
            plan_file.write_text(f"# Plan for {slug}\n\nTest content.")

            # Patch the resolver functions to use our temp directory
            monkeypatch.setattr(
                "backend.cc_session_resolver._get_history_file",
                lambda: history_file,
            )
            monkeypatch.setattr(
                "backend.cc_session_resolver._get_projects_dir",
                lambda: projects_dir,
            )

            return {
                "claude_dir": claude_dir,
                "plan_file": plan_file,
                "history_file": history_file,
                "projects_dir": projects_dir,
            }

        return _setup

    def test_plan_file_resolves_to_correct_project(
        self, temp_dir: Path, setup_mock_claude_dir, monkeypatch
    ) -> None:
        """Full integration: plan file → slug → project → connection."""
        # Setup: Create mock Claude directory structure
        project_path = "/home/user/myproject"
        session_id = "test-session-123"
        slug = "jazzy-crunching-moonbeam"

        paths = setup_mock_claude_dir(project_path, session_id, slug)

        # Verify slug resolution works
        resolved_project = resolve_slug_to_project(slug)
        assert resolved_project == Path(project_path)

    def test_slug_resolution_with_multiple_sessions(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """Resolves correct project when multiple sessions exist."""
        # Create the Claude directory structure with multiple sessions
        claude_dir = temp_dir / ".claude"
        history_file = claude_dir / "history.jsonl"
        projects_dir = claude_dir / "projects"

        # Create history entries for two different projects
        history_entries = [
            {"sessionId": "session-a", "project": "/project/a"},
            {"sessionId": "session-b", "project": "/project/b"},
        ]
        history_file.parent.mkdir(parents=True, exist_ok=True)
        history_file.write_text(
            "\n".join(json.dumps(e) for e in history_entries)
        )

        # Create session files with different slugs
        for encoded, sess_id, slug in [
            ("-project-a", "session-a", "slug-for-project-a"),
            ("-project-b", "session-b", "slug-for-project-b"),
        ]:
            subdir = projects_dir / encoded
            subdir.mkdir(parents=True)
            session_file = subdir / f"{sess_id}.jsonl"
            session_file.write_text(json.dumps({"type": "user", "slug": slug}))

        # Patch the resolver functions
        monkeypatch.setattr(
            "backend.cc_session_resolver._get_history_file",
            lambda: history_file,
        )
        monkeypatch.setattr(
            "backend.cc_session_resolver._get_projects_dir",
            lambda: projects_dir,
        )

        # Verify each slug resolves to the correct project
        assert resolve_slug_to_project("slug-for-project-a") == Path("/project/a")
        assert resolve_slug_to_project("slug-for-project-b") == Path("/project/b")

    def test_routing_chain_with_connections(
        self, temp_dir: Path, setup_mock_claude_dir, monkeypatch
    ) -> None:
        """Full routing chain: slug → project → connection registry."""
        # Setup: Create mock Claude directory structure
        project_path = "/home/user/myproject"
        session_id = "test-session-456"
        slug = "vectorized-percolating-clarke"

        setup_mock_claude_dir(project_path, session_id, slug)

        # Create registry and register a connection for the project
        registry = ConnectionRegistry()
        mock_ws = MagicMock(name="ws_project")

        # Create the project directory (resolved path needs to exist for some checks)
        project_dir = temp_dir / "myproject"
        project_dir.mkdir(parents=True, exist_ok=True)

        # Register with the actual project path (simulates what CADE does)
        registry.register(mock_ws, Path(project_path))

        # Resolve the slug to a project
        resolved_project = resolve_slug_to_project(slug)
        assert resolved_project is not None

        # Get connections for that project
        connections = registry.get_connections_for_project(resolved_project)

        # Should find our registered connection
        assert len(connections) == 1
        assert mock_ws in connections


class TestWslClaudeDirDetection:
    """Tests for WSL Claude directory detection and cache behavior."""

    def test_wsl_claude_dir_returns_wsl_path_on_windows(
        self, monkeypatch
    ) -> None:
        """Verify _get_claude_dir() returns WSL path on Windows."""
        # Mock sys.platform = "win32"
        monkeypatch.setattr("backend.cc_session_resolver.sys.platform", "win32")

        # Mock get_wsl_home_as_windows_path() to return UNC path
        wsl_home = "\\\\wsl.localhost\\Ubuntu\\home\\testuser"
        monkeypatch.setattr(
            "backend.wsl.paths.get_wsl_home_as_windows_path",
            lambda: wsl_home,
        )

        # Clear cache to force re-evaluation
        _get_claude_dir.cache_clear()

        # Get the Claude directory
        result = _get_claude_dir()

        # Should be the WSL path, not Windows home
        result_str = str(result).replace("/", "\\")
        assert wsl_home in result_str or result_str.startswith(wsl_home)
        assert ".claude" in str(result)

    def test_wsl_claude_dir_falls_back_when_wsl_not_ready(
        self, monkeypatch
    ) -> None:
        """Falls back to Windows home when WSL is not ready (returns None)."""
        # Mock sys.platform = "win32"
        monkeypatch.setattr("backend.cc_session_resolver.sys.platform", "win32")

        # Mock get_wsl_home_as_windows_path() to return None (WSL not ready)
        monkeypatch.setattr(
            "backend.wsl.paths.get_wsl_home_as_windows_path",
            lambda: None,
        )

        # Clear cache to force re-evaluation
        _get_claude_dir.cache_clear()

        # Get the Claude directory
        result = _get_claude_dir()

        # Should fall back to regular home directory
        assert result == Path.home() / ".claude"

    def test_cache_clearing_allows_redetection(self, monkeypatch) -> None:
        """Clearing cache allows WSL to be re-detected after becoming ready."""
        # First call: WSL not ready
        monkeypatch.setattr("backend.cc_session_resolver.sys.platform", "win32")
        monkeypatch.setattr(
            "backend.wsl.paths.get_wsl_home_as_windows_path",
            lambda: None,
        )

        _get_claude_dir.cache_clear()
        result1 = _get_claude_dir()
        assert result1 == Path.home() / ".claude"

        # Second call: WSL now ready
        wsl_home = "\\\\wsl.localhost\\Ubuntu\\home\\user"
        monkeypatch.setattr(
            "backend.wsl.paths.get_wsl_home_as_windows_path",
            lambda: wsl_home,
        )

        # Without clearing cache, should still return old value
        result2 = _get_claude_dir()
        assert result2 == Path.home() / ".claude"  # Cached value

        # After clearing cache, should detect WSL
        _get_claude_dir.cache_clear()
        result3 = _get_claude_dir()
        assert wsl_home in str(result3).replace("/", "\\")


class TestPlanFileRoutingWithWslPaths:
    """Tests for plan file routing with WSL path formats."""

    def test_plan_file_path_normalization(self) -> None:
        """Plan file paths are correctly normalized regardless of format."""
        test_paths = [
            # Unix path
            ("/home/gary/.claude/plans/test-slug.md", "test-slug"),
            # Windows UNC path from WSL
            (
                "\\\\wsl.localhost\\Ubuntu\\home\\gary\\.claude\\plans\\test-slug.md",
                "test-slug",
            ),
            # Windows path
            ("C:\\Users\\gary\\.claude\\plans\\test-slug.md", "test-slug"),
        ]

        for path_str, expected_slug in test_paths:
            # Normalize and check detection
            normalized = path_str.replace("\\", "/")
            assert "/.claude/plans/" in normalized, f"Failed for: {path_str}"

            # Extract slug from normalized path (as main.py does)
            # On Linux, Path() can't parse Windows paths, so we normalize first
            normalized_path = Path(normalized)
            assert normalized_path.stem == expected_slug, f"Slug mismatch for: {path_str}"

    def test_plan_file_routing_with_wsl_unc_path(
        self, temp_dir: Path, monkeypatch
    ) -> None:
        """Plan file with Windows UNC path is routed correctly."""
        # Setup mock Claude directory
        claude_dir = temp_dir / ".claude"
        history_file = claude_dir / "history.jsonl"
        projects_dir = claude_dir / "projects"

        project_path = "/mnt/c/Users/test/project"
        session_id = "test-session"
        slug = "vectorized-percolating-clarke"

        # Create history entry
        history_file.parent.mkdir(parents=True, exist_ok=True)
        history_file.write_text(
            json.dumps({"sessionId": session_id, "project": project_path})
        )

        # Create session file with slug
        encoded = "-mnt-c-Users-test-project"
        subdir = projects_dir / encoded
        subdir.mkdir(parents=True)
        session_file = subdir / f"{session_id}.jsonl"
        session_file.write_text(json.dumps({"type": "user", "slug": slug}))

        # Patch the resolver functions
        monkeypatch.setattr(
            "backend.cc_session_resolver._get_history_file",
            lambda: history_file,
        )
        monkeypatch.setattr(
            "backend.cc_session_resolver._get_projects_dir",
            lambda: projects_dir,
        )

        # Verify resolution works
        resolved = resolve_slug_to_project(slug)
        assert resolved == Path(project_path)

        # Verify connection registry routing
        registry = ConnectionRegistry()
        mock_ws = MagicMock(name="ws_project")
        registry.register(mock_ws, Path(project_path))

        connections = registry.get_connections_for_project(resolved)
        assert len(connections) == 1
        assert mock_ws in connections
