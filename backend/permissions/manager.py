"""Permission prompt manager.

Tracks pending permission requests, broadcasts them to the frontend,
and blocks until the user approves or denies.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

BroadcastFn = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class PermissionRequest:
    id: str
    tool_name: str
    description: str
    tool_input: dict[str, Any]
    result: asyncio.Future[dict[str, Any]] = field(default_factory=lambda: asyncio.get_event_loop().create_future())


class PermissionManager:
    """Manages permission prompt lifecycle, mode state, and edit approval."""

    def __init__(self) -> None:
        self._pending: dict[str, PermissionRequest] = {}
        self._broadcast_fns: list[BroadcastFn] = []
        self._current_mode: str = "code"
        self.accept_edits: bool = True
        # Approved directory prefixes outside the project root (persists per session)
        self._approved_paths: set[str] = set()

    # ------------------------------------------------------------------
    # Mode state
    # ------------------------------------------------------------------

    def set_mode(self, mode: str) -> None:
        self._current_mode = mode

    def get_mode(self) -> str:
        return self._current_mode

    # ------------------------------------------------------------------
    # Accept-edits toggle
    # ------------------------------------------------------------------

    def set_accept_edits(self, enabled: bool) -> None:
        self.accept_edits = enabled

    # ------------------------------------------------------------------
    # Path scope cache
    # ------------------------------------------------------------------

    def is_path_approved(self, path: "Path") -> bool:  # noqa: F821
        path_str = str(path)
        return any(
            path_str == p or path_str.startswith(p + "/")
            for p in self._approved_paths
        )

    def approve_path(self, path: "Path") -> None:  # noqa: F821
        # Cache at directory level so sibling files don't re-prompt
        self._approved_paths.add(str(path.parent))

    def register_broadcast(self, fn: BroadcastFn) -> None:
        self._broadcast_fns.append(fn)

    def unregister_broadcast(self, fn: BroadcastFn) -> None:
        self._broadcast_fns = [f for f in self._broadcast_fns if f is not fn]

    async def _broadcast(self, msg: dict[str, Any]) -> None:
        for fn in self._broadcast_fns:
            try:
                await fn(msg)
            except Exception:
                pass

    async def request_permission(
        self,
        tool_name: str,
        description: str,
        tool_input: dict[str, Any],
    ) -> dict[str, Any]:
        """Create a permission request, broadcast to frontend, block until resolved.

        Returns the user's decision dict.
        """
        request_id = str(uuid.uuid4())[:8]
        request = PermissionRequest(
            id=request_id,
            tool_name=tool_name,
            description=description,
            tool_input=tool_input,
        )
        self._pending[request_id] = request

        # Broadcast to frontend
        await self._broadcast({
            "type": "chat-stream",
            "event": "permission-request",
            "requestId": request_id,
            "toolName": tool_name,
            "description": description,
            "toolInput": tool_input,
        })

        logger.info("Permission requested: %s %s (id=%s)", tool_name, description[:60], request_id)

        try:
            result = await asyncio.wait_for(request.result, timeout=3600.0)
        except asyncio.TimeoutError:
            result = {"decision": "deny", "message": "Permission request timed out"}
        finally:
            self._pending.pop(request_id, None)

        return result

    async def approve(self, request_id: str) -> bool:
        """Approve a pending permission request."""
        request = self._pending.get(request_id)
        if request is None:
            return False

        if not request.result.done():
            request.result.set_result({"decision": "allow"})

        await self._broadcast({
            "type": "chat-stream",
            "event": "permission-resolved",
            "requestId": request_id,
            "decision": "allow",
        })

        logger.info("Permission approved: %s (id=%s)", request.tool_name, request_id)
        return True

    async def deny(self, request_id: str, message: str = "") -> bool:
        """Deny a pending permission request."""
        request = self._pending.get(request_id)
        if request is None:
            return False

        if not request.result.done():
            request.result.set_result({
                "decision": "deny",
                "message": message or "User denied permission",
            })

        await self._broadcast({
            "type": "chat-stream",
            "event": "permission-resolved",
            "requestId": request_id,
            "decision": "deny",
        })

        logger.info("Permission denied: %s (id=%s)", request.tool_name, request_id)
        return True


# Singleton
_manager: PermissionManager | None = None


def get_permission_manager() -> PermissionManager:
    global _manager
    if _manager is None:
        _manager = PermissionManager()
    return _manager
