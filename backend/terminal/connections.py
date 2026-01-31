"""WebSocket connection manager for broadcasting messages to all clients."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger(__name__)

_manager: ConnectionManager | None = None


class ConnectionManager:
    """Manages active WebSocket connections for broadcasting."""

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    def register(self, websocket: WebSocket) -> None:
        """Register a new WebSocket connection."""
        self._connections.add(websocket)
        logger.debug("Connection registered. Total: %d", len(self._connections))

    def unregister(self, websocket: WebSocket) -> None:
        """Unregister a WebSocket connection."""
        self._connections.discard(websocket)
        logger.debug("Connection unregistered. Total: %d", len(self._connections))

    async def broadcast(self, message: dict) -> None:
        """Broadcast a message to all connected clients."""
        logger.info("Broadcasting to %d connection(s): type=%s", len(self._connections), message.get("type"))
        disconnected: list[WebSocket] = []

        for ws in self._connections:
            try:
                await ws.send_json(message)
                logger.debug("Sent message to client")
            except Exception as e:
                logger.warning("Failed to send to client: %s", e)
                disconnected.append(ws)

        for ws in disconnected:
            self._connections.discard(ws)

    @property
    def connection_count(self) -> int:
        """Return the number of active connections."""
        return len(self._connections)


def get_connection_manager() -> ConnectionManager:
    """Get the global connection manager instance."""
    global _manager
    if _manager is None:
        _manager = ConnectionManager()
    return _manager
