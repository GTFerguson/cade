"""Integration tests for /api/view file routing."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.connection_registry import ConnectionRegistry


class TestViewFileRouting:
    """Tests for project-aware file routing in /api/view endpoint."""

    @pytest.fixture
    def mock_registry(self) -> ConnectionRegistry:
        """Create a fresh registry for each test."""
        return ConnectionRegistry()

    @pytest.fixture
    def mock_ws_project_a(self) -> MagicMock:
        """Mock WebSocket for Project A."""
        return MagicMock(name="ws_project_a")

    @pytest.fixture
    def mock_ws_project_b(self) -> MagicMock:
        """Mock WebSocket for Project B."""
        return MagicMock(name="ws_project_b")

    def test_file_routed_to_correct_project(
        self,
        temp_dir: Path,
        mock_registry: ConnectionRegistry,
        mock_ws_project_a: MagicMock,
        mock_ws_project_b: MagicMock,
    ) -> None:
        """File edit in Project A only sent to Project A connections."""
        # Setup: Create two projects
        project_a = temp_dir / "project_a"
        project_b = temp_dir / "project_b"
        project_a.mkdir(parents=True, exist_ok=True)
        project_b.mkdir(parents=True, exist_ok=True)

        # Register connections for each project
        mock_registry.register(mock_ws_project_a, project_a, session_id="session-a")
        mock_registry.register(mock_ws_project_b, project_b, session_id="session-b")

        # File in Project A
        file_path = project_a / "plans" / "plan.md"

        # Get connections for this file
        connections = mock_registry.get_connections_for_file(file_path)

        # Should only include Project A's connection
        assert len(connections) == 1
        assert mock_ws_project_a in connections
        assert mock_ws_project_b not in connections

    def test_file_outside_projects_returns_empty(
        self,
        temp_dir: Path,
        mock_registry: ConnectionRegistry,
        mock_ws_project_a: MagicMock,
        mock_ws_project_b: MagicMock,
    ) -> None:
        """File not in any project returns empty list."""
        # Setup: Create two projects
        project_a = temp_dir / "project_a"
        project_b = temp_dir / "project_b"
        project_a.mkdir(parents=True, exist_ok=True)
        project_b.mkdir(parents=True, exist_ok=True)

        # Register connections
        mock_registry.register(mock_ws_project_a, project_a)
        mock_registry.register(mock_ws_project_b, project_b)

        # File outside all projects
        file_path = Path("/completely/different/path/file.md")

        connections = mock_registry.get_connections_for_file(file_path)

        # Should return empty (triggers broadcast fallback)
        assert len(connections) == 0

    def test_multiple_tabs_same_project(
        self,
        temp_dir: Path,
        mock_registry: ConnectionRegistry,
    ) -> None:
        """Multiple tabs for same project all receive the message."""
        project = temp_dir / "my_project"
        project.mkdir(parents=True, exist_ok=True)

        # Create multiple tabs for the same project
        tab1 = MagicMock(name="tab1")
        tab2 = MagicMock(name="tab2")
        tab3 = MagicMock(name="tab3")

        mock_registry.register(tab1, project)
        mock_registry.register(tab2, project)
        mock_registry.register(tab3, project)

        file_path = project / "src" / "main.py"

        connections = mock_registry.get_connections_for_file(file_path)
        assert len(connections) == 3

        # All tabs should be included
        assert tab1 in connections
        assert tab2 in connections
        assert tab3 in connections

    def test_nested_projects_most_specific_wins(
        self,
        temp_dir: Path,
        mock_registry: ConnectionRegistry,
    ) -> None:
        """When projects are nested, the most specific match wins."""
        parent_project = temp_dir / "monorepo"
        child_project = temp_dir / "monorepo" / "packages" / "webapp"
        parent_project.mkdir(parents=True, exist_ok=True)
        child_project.mkdir(parents=True, exist_ok=True)

        ws_parent = MagicMock(name="ws_parent")
        ws_child = MagicMock(name="ws_child")

        mock_registry.register(ws_parent, parent_project)
        mock_registry.register(ws_child, child_project)

        # File in the child project
        file_path = child_project / "src" / "App.tsx"

        connections = mock_registry.get_connections_for_file(file_path)

        # Only the child project connection should receive it
        assert len(connections) == 1
        assert ws_child in connections
        assert ws_parent not in connections

    def test_connection_cleanup_removes_from_routing(
        self,
        temp_dir: Path,
        mock_registry: ConnectionRegistry,
        mock_ws_project_a: MagicMock,
    ) -> None:
        """After connection cleanup, it's no longer in routing."""
        project = temp_dir / "project"
        project.mkdir(parents=True, exist_ok=True)

        mock_registry.register(mock_ws_project_a, project)

        file_path = project / "file.txt"

        # Before cleanup
        connections = mock_registry.get_connections_for_file(file_path)
        assert len(connections) == 1

        # Cleanup (simulates _cleanup in websocket.py)
        mock_registry.unregister(mock_ws_project_a)

        # After cleanup
        connections = mock_registry.get_connections_for_file(file_path)
        assert len(connections) == 0


class TestPlanFileDetection:
    """Tests for detecting plan files with different path formats."""

    def test_detects_plan_file_with_forward_slashes(self) -> None:
        """Plan file with Unix-style path is detected."""
        path = "/home/gary/.claude/plans/jazzy-crunching-moonbeam.md"
        normalized = path.replace("\\", "/")
        assert "/.claude/plans/" in normalized

    def test_detects_plan_file_with_wsl_unc_path(self) -> None:
        """Plan file with Windows UNC path from WSL is detected."""
        # This is what wsl_to_windows_path() produces
        path = "\\\\wsl.localhost\\Ubuntu\\home\\gary\\.claude\\plans\\vectorized-percolating-clarke.md"
        normalized = path.replace("\\", "/")
        assert "/.claude/plans/" in normalized

    def test_detects_plan_file_with_windows_path(self) -> None:
        """Plan file with Windows-style path is detected."""
        path = "C:\\Users\\gary\\.claude\\plans\\my-plan.md"
        normalized = path.replace("\\", "/")
        assert "/.claude/plans/" in normalized

    def test_non_plan_file_not_detected(self) -> None:
        """Non-plan files are not detected."""
        paths = [
            "/home/gary/project/plans/local-plan.md",  # In project, not .claude
            "/home/gary/.claude/history.jsonl",  # In .claude, not plans
            "\\\\wsl.localhost\\Ubuntu\\home\\gary\\Documents\\file.md",  # Not in plans
        ]
        for path in paths:
            normalized = path.replace("\\", "/")
            # Should not match the specific .claude/plans pattern
            # (though some might contain "plans", they shouldn't match "/.claude/plans/")
            if "/.claude/plans/" in normalized:
                # Only fail if it actually matches
                assert False, f"Path {path} should not match plan file pattern"
