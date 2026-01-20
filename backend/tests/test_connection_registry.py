"""Tests for the connection registry module."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.connection_registry import ConnectionInfo, ConnectionRegistry


class TestConnectionRegistry:
    """Tests for ConnectionRegistry class."""

    def test_register_and_unregister(self, temp_dir: Path) -> None:
        """Test basic connection registration lifecycle."""
        registry = ConnectionRegistry()
        ws = MagicMock()

        # Register
        registry.register(ws, temp_dir, session_id="test-session")
        assert registry.connection_count == 1

        # Unregister
        registry.unregister(ws)
        assert registry.connection_count == 0

    def test_register_stores_connection_info(self, temp_dir: Path) -> None:
        """Test that registration stores correct connection info."""
        registry = ConnectionRegistry()
        ws = MagicMock()
        session_id = "test-session-123"

        registry.register(ws, temp_dir, session_id=session_id)

        # Access internal state for verification
        assert ws in registry._connections
        info = registry._connections[ws]
        assert info.project_path == temp_dir.resolve()
        assert info.session_id == session_id

    def test_get_connections_for_file_in_project(self, temp_dir: Path) -> None:
        """File in project returns that project's connection."""
        registry = ConnectionRegistry()
        ws = MagicMock()

        registry.register(ws, temp_dir)

        # Create a file path within the project
        file_path = temp_dir / "src" / "main.py"

        connections = registry.get_connections_for_file(file_path)
        assert len(connections) == 1
        assert connections[0] is ws

    def test_get_connections_for_file_outside_all_projects(self, temp_dir: Path) -> None:
        """File outside all projects returns empty list."""
        registry = ConnectionRegistry()
        ws = MagicMock()

        registry.register(ws, temp_dir / "project_a")

        # File in a completely different location
        file_path = Path("/some/other/location/file.py")

        connections = registry.get_connections_for_file(file_path)
        assert len(connections) == 0

    def test_multiple_projects_returns_most_specific(self, temp_dir: Path) -> None:
        """Nested projects: more specific path takes precedence."""
        registry = ConnectionRegistry()
        ws_parent = MagicMock(name="ws_parent")
        ws_child = MagicMock(name="ws_child")

        # Register parent project
        parent_path = temp_dir / "projects"
        parent_path.mkdir(parents=True, exist_ok=True)
        registry.register(ws_parent, parent_path)

        # Register child project (nested inside parent)
        child_path = temp_dir / "projects" / "subproject"
        child_path.mkdir(parents=True, exist_ok=True)
        registry.register(ws_child, child_path)

        # File in child project should only return child connection
        file_path = child_path / "src" / "app.py"
        connections = registry.get_connections_for_file(file_path)

        assert len(connections) == 1
        assert connections[0] is ws_child

    def test_multiple_connections_same_project(self, temp_dir: Path) -> None:
        """Multiple tabs for same project all receive message."""
        registry = ConnectionRegistry()
        ws1 = MagicMock(name="ws1")
        ws2 = MagicMock(name="ws2")
        ws3 = MagicMock(name="ws3")

        # Register multiple connections for the same project
        registry.register(ws1, temp_dir)
        registry.register(ws2, temp_dir)
        registry.register(ws3, temp_dir)

        file_path = temp_dir / "file.txt"
        connections = registry.get_connections_for_file(file_path)

        assert len(connections) == 3
        assert ws1 in connections
        assert ws2 in connections
        assert ws3 in connections

    def test_unregister_removes_connection(self, temp_dir: Path) -> None:
        """After unregister, connection is not returned."""
        registry = ConnectionRegistry()
        ws = MagicMock()

        registry.register(ws, temp_dir)
        file_path = temp_dir / "file.txt"

        # Before unregister
        connections = registry.get_connections_for_file(file_path)
        assert len(connections) == 1

        # After unregister
        registry.unregister(ws)
        connections = registry.get_connections_for_file(file_path)
        assert len(connections) == 0

    def test_unregister_nonexistent_connection(self) -> None:
        """Unregistering a non-existent connection does not error."""
        registry = ConnectionRegistry()
        ws = MagicMock()

        # Should not raise
        registry.unregister(ws)
        assert registry.connection_count == 0

    def test_get_all_connections(self, temp_dir: Path) -> None:
        """Test getting all registered connections."""
        registry = ConnectionRegistry()
        ws1 = MagicMock()
        ws2 = MagicMock()

        registry.register(ws1, temp_dir / "project_a")
        registry.register(ws2, temp_dir / "project_b")

        all_connections = registry.get_all_connections()
        assert len(all_connections) == 2
        assert ws1 in all_connections
        assert ws2 in all_connections

    def test_cross_project_isolation(self, temp_dir: Path) -> None:
        """File in Project A does not match Project B."""
        registry = ConnectionRegistry()
        ws_a = MagicMock(name="ws_project_a")
        ws_b = MagicMock(name="ws_project_b")

        project_a = temp_dir / "project_a"
        project_b = temp_dir / "project_b"
        project_a.mkdir(parents=True, exist_ok=True)
        project_b.mkdir(parents=True, exist_ok=True)

        registry.register(ws_a, project_a)
        registry.register(ws_b, project_b)

        # File in project A
        file_in_a = project_a / "plans" / "plan.md"
        connections = registry.get_connections_for_file(file_in_a)

        assert len(connections) == 1
        assert connections[0] is ws_a
        assert ws_b not in connections

    def test_get_connections_for_project(self, temp_dir: Path) -> None:
        """Get connections for exact project match."""
        registry = ConnectionRegistry()
        ws_a = MagicMock(name="ws_project_a")
        ws_b = MagicMock(name="ws_project_b")

        project_a = temp_dir / "project_a"
        project_b = temp_dir / "project_b"
        project_a.mkdir(parents=True, exist_ok=True)
        project_b.mkdir(parents=True, exist_ok=True)

        registry.register(ws_a, project_a)
        registry.register(ws_b, project_b)

        # Get connections for project A
        connections = registry.get_connections_for_project(project_a)
        assert len(connections) == 1
        assert connections[0] is ws_a

        # Get connections for project B
        connections = registry.get_connections_for_project(project_b)
        assert len(connections) == 1
        assert connections[0] is ws_b

    def test_get_connections_for_project_multiple_tabs(self, temp_dir: Path) -> None:
        """Multiple connections for same project all returned."""
        registry = ConnectionRegistry()
        ws1 = MagicMock(name="ws1")
        ws2 = MagicMock(name="ws2")

        project = temp_dir / "project"
        project.mkdir(parents=True, exist_ok=True)

        registry.register(ws1, project)
        registry.register(ws2, project)

        connections = registry.get_connections_for_project(project)
        assert len(connections) == 2
        assert ws1 in connections
        assert ws2 in connections

    def test_get_connections_for_project_no_match(self, temp_dir: Path) -> None:
        """Non-existent project returns empty list."""
        registry = ConnectionRegistry()
        ws = MagicMock()

        project_a = temp_dir / "project_a"
        project_a.mkdir(parents=True, exist_ok=True)
        registry.register(ws, project_a)

        # Ask for a different project
        project_b = temp_dir / "project_b"
        connections = registry.get_connections_for_project(project_b)
        assert len(connections) == 0

    def test_get_connections_for_project_accepts_string(self, temp_dir: Path) -> None:
        """Accepts string path as well as Path object."""
        registry = ConnectionRegistry()
        ws = MagicMock()

        project = temp_dir / "project"
        project.mkdir(parents=True, exist_ok=True)
        registry.register(ws, project)

        # Query with string
        connections = registry.get_connections_for_project(str(project))
        assert len(connections) == 1
        assert connections[0] is ws


class TestGetConnectionsForProjectWslPaths:
    """Tests for WSL path handling in get_connections_for_project."""

    def test_wsl_mount_path_conversion(self) -> None:
        """Verifies wsl_mount_to_windows_path is called for /mnt paths."""
        from backend.wsl_path import wsl_mount_to_windows_path

        # Test the conversion function directly - forward slashes
        assert wsl_mount_to_windows_path("/mnt/c/Users/test") == "C:\\Users\\test"
        assert wsl_mount_to_windows_path("/mnt/d/projects") == "D:\\projects"
        assert wsl_mount_to_windows_path("/home/user") == "/home/user"  # No change

        # Test with backslashes (Windows-style from Path conversion)
        assert wsl_mount_to_windows_path("\\mnt\\c\\Users\\test") == "C:\\Users\\test"
        assert wsl_mount_to_windows_path("\\mnt\\d\\projects") == "D:\\projects"

    def test_non_wsl_path_still_works(self, temp_dir: Path) -> None:
        """Regular paths without /mnt/ prefix still work normally."""
        registry = ConnectionRegistry()
        mock_ws = MagicMock(name="ws")

        registry.register(mock_ws, temp_dir)
        connections = registry.get_connections_for_project(temp_dir)

        assert len(connections) == 1
        assert mock_ws in connections


class TestConnectionInfo:
    """Tests for ConnectionInfo dataclass."""

    def test_connection_info_creation(self) -> None:
        """Test ConnectionInfo can be created with required fields."""
        info = ConnectionInfo(
            project_path=Path("/home/user/project"),
            session_id="session-123",
        )
        assert info.project_path == Path("/home/user/project")
        assert info.session_id == "session-123"

    def test_connection_info_optional_session_id(self) -> None:
        """Test ConnectionInfo with None session_id."""
        info = ConnectionInfo(
            project_path=Path("/home/user/project"),
            session_id=None,
        )
        assert info.session_id is None
