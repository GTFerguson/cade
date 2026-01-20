"""Connection registry for project-aware WebSocket routing.

Maps WebSocket connections to their project paths, enabling targeted
message routing instead of broadcasting to all connections.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger(__name__)

_registry: ConnectionRegistry | None = None


@dataclass
class ConnectionInfo:
    """Information about a registered connection."""

    project_path: Path
    session_id: str | None


class ConnectionRegistry:
    """Registry mapping WebSocket connections to projects for targeted routing.

    Enables project-aware message routing so that file updates are only
    sent to connections that belong to the relevant project.
    """

    def __init__(self) -> None:
        self._connections: dict[WebSocket, ConnectionInfo] = {}

    def register(
        self,
        websocket: WebSocket,
        project_path: Path,
        session_id: str | None = None,
    ) -> None:
        """Register a WebSocket connection with its project path.

        Args:
            websocket: The WebSocket connection.
            project_path: The root directory of the project.
            session_id: Optional session identifier.
        """
        resolved_path = project_path.resolve()
        self._connections[websocket] = ConnectionInfo(
            project_path=resolved_path,
            session_id=session_id,
        )
        logger.debug(
            "Registered connection for project: %s (total: %d)",
            resolved_path,
            len(self._connections),
        )

    def unregister(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection from the registry.

        Args:
            websocket: The WebSocket connection to remove.
        """
        if websocket in self._connections:
            info = self._connections.pop(websocket)
            logger.debug(
                "Unregistered connection for project: %s (total: %d)",
                info.project_path,
                len(self._connections),
            )

    def get_connections_for_file(self, file_path: str | Path) -> list[WebSocket]:
        """Find all connections whose project contains the given file.

        Uses path containment to determine if a file belongs to a project.
        If multiple projects match (nested projects), returns the most
        specific (deepest) match.

        Args:
            file_path: Path to the file being viewed/updated.

        Returns:
            List of WebSocket connections that should receive the message.
            Returns empty list if no matching project is found.
        """
        file_path = Path(file_path).resolve()

        # Find all matching connections grouped by project depth
        matches: dict[WebSocket, int] = {}

        for ws, info in self._connections.items():
            try:
                # Check if file is within this project's directory
                file_path.relative_to(info.project_path)
                # Store the depth (number of path parts) for specificity
                depth = len(info.project_path.parts)
                matches[ws] = depth
            except ValueError:
                # File is not within this project
                continue

        if not matches:
            return []

        # Find the maximum depth (most specific project)
        max_depth = max(matches.values())

        # Return only connections with the most specific match
        return [ws for ws, depth in matches.items() if depth == max_depth]

    def get_connections_for_project(self, project_path: str | Path) -> list[WebSocket]:
        """Find all connections for a specific project path.

        Used for routing messages when we know the exact project (e.g., after
        resolving a plan file slug to its project).

        Handles WSL/Windows path format differences by trying both the original
        path and a converted Windows path if applicable.

        Args:
            project_path: The project path to match exactly.

        Returns:
            List of WebSocket connections for that project.
        """
        from backend.wsl_path import wsl_mount_to_windows_path

        path_str = str(project_path)
        resolved_path = Path(project_path).resolve()

        # Also try converting WSL mount path to Windows format
        # e.g., /mnt/c/Users/... -> C:\Users\...
        converted_path_str = wsl_mount_to_windows_path(path_str)
        converted_path = (
            Path(converted_path_str).resolve()
            if converted_path_str != path_str
            else None
        )

        results = []
        for ws, info in self._connections.items():
            if info.project_path == resolved_path:
                results.append(ws)
            elif converted_path and info.project_path == converted_path:
                results.append(ws)

        return results

    def get_all_connections(self) -> list[WebSocket]:
        """Get all registered connections.

        Returns:
            List of all registered WebSocket connections.
        """
        return list(self._connections.keys())

    @property
    def connection_count(self) -> int:
        """Return the number of registered connections."""
        return len(self._connections)


def get_connection_registry() -> ConnectionRegistry:
    """Get the global connection registry instance."""
    global _registry
    if _registry is None:
        _registry = ConnectionRegistry()
    return _registry
