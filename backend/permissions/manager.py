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
    connection_id: str = ""
    result: asyncio.Future[dict[str, Any]] = field(default_factory=lambda: asyncio.get_event_loop().create_future())


class PermissionManager:
    """Manages permission prompt lifecycle, mode state, and per-category permissions."""

    def __init__(self) -> None:
        self._pending: dict[str, PermissionRequest] = {}
        self._send_fns: dict[str, BroadcastFn] = {}
        self._current_mode: str = "code"
        # "cc" when the active session uses ClaudeCodeProvider; "api" otherwise
        self.provider_type: str = "api"
        # Per-category permissions — True means auto-approve, False means deny
        self.allow_read: bool = True
        self.allow_write: bool = True
        self.allow_tools: bool = True
        self.allow_subagents: bool = True
        self.auto_approve_reports: bool = False
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
    # Permission toggles
    # ------------------------------------------------------------------

    @property
    def accept_edits(self) -> bool:
        return self.allow_write

    @accept_edits.setter
    def accept_edits(self, value: bool) -> None:
        self.allow_write = value

    def set_accept_edits(self, enabled: bool) -> None:
        self.allow_write = enabled

    def get_permissions(self) -> dict:
        return {
            "providerType": self.provider_type,
            "allowRead": self.allow_read,
            "allowWrite": self.allow_write,
            "allowTools": self.allow_tools,
            "allowSubagents": self.allow_subagents,
            "autoApproveReports": self.auto_approve_reports,
        }

    def set_permission(self, name: str, value: bool) -> bool:
        mapping = {
            "allowRead": "allow_read",
            "allowWrite": "allow_write",
            "allowTools": "allow_tools",
            "allowSubagents": "allow_subagents",
            "autoApproveReports": "auto_approve_reports",
        }
        attr = mapping.get(name)
        if attr is None:
            return False
        setattr(self, attr, value)
        return True

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

    def register_broadcast(self, connection_id: str, fn: BroadcastFn) -> None:
        self._send_fns[connection_id] = fn

    def unregister_broadcast(self, connection_id: str) -> None:
        self._send_fns.pop(connection_id, None)

    async def _send_to(self, connection_id: str, msg: dict[str, Any]) -> None:
        """Send to one connection, or broadcast to all if connection_id is empty."""
        if connection_id and connection_id in self._send_fns:
            try:
                await self._send_fns[connection_id](msg)
            except Exception:
                pass
        elif not connection_id:
            for fn in self._send_fns.values():
                try:
                    await fn(msg)
                except Exception:
                    pass

    async def request_permission(
        self,
        tool_name: str,
        description: str,
        tool_input: dict[str, Any],
        connection_id: str = "",
    ) -> dict[str, Any]:
        """Create a permission request, send to the requesting connection, block until resolved.

        Returns the user's decision dict.
        """
        request_id = str(uuid.uuid4())[:8]
        request = PermissionRequest(
            id=request_id,
            tool_name=tool_name,
            description=description,
            tool_input=tool_input,
            connection_id=connection_id,
        )
        self._pending[request_id] = request

        await self._send_to(connection_id, {
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

        await self._send_to(request.connection_id, {
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

        await self._send_to(request.connection_id, {
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
