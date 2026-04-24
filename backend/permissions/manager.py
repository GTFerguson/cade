"""Permission prompt manager.

Tracks pending permission requests, broadcasts them to the frontend,
and blocks until the user approves or denies.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any


def _default_approved_paths() -> set[str]:
    """Scratch locations that are pre-approved for writes without prompting."""
    paths = {"/tmp"}
    tmpdir = os.environ.get("TMPDIR")
    if tmpdir:
        paths.add(tmpdir.rstrip("/"))
    return paths

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


@dataclass
class ConnectionState:
    """Per-connection permission and mode state."""
    mode: str = "code"
    provider_type: str = "api"
    allow_read: bool = True
    allow_write: bool = True
    allow_tools: bool = True
    allow_subagents: bool = True
    auto_approve_reports: bool = False
    approved_paths: set[str] = field(default_factory=_default_approved_paths)
    approved_commands: set[str] = field(default_factory=set)


class PermissionManager:
    """Manages permission prompt lifecycle, mode state, and per-category permissions.

    All state is scoped to connection_id so multiple project tabs don't bleed
    into each other.
    """

    def __init__(self) -> None:
        self._pending: dict[str, PermissionRequest] = {}
        self._send_fns: dict[str, BroadcastFn] = {}
        self._states: dict[str, ConnectionState] = {}

    def _state(self, connection_id: str) -> ConnectionState:
        """Return (creating if needed) the state for a connection."""
        if connection_id not in self._states:
            self._states[connection_id] = ConnectionState()
        return self._states[connection_id]

    def drop_connection(self, connection_id: str) -> None:
        """Remove per-connection state when a tab disconnects."""
        self._states.pop(connection_id, None)

    # ------------------------------------------------------------------
    # Mode state
    # ------------------------------------------------------------------

    def set_mode(self, mode: str, connection_id: str = "") -> None:
        self._state(connection_id).mode = mode

    def get_mode(self, connection_id: str = "") -> str:
        return self._state(connection_id).mode

    # ------------------------------------------------------------------
    # Permission toggles
    # ------------------------------------------------------------------

    @property
    def accept_edits(self) -> bool:
        return self._state("").allow_write

    @accept_edits.setter
    def accept_edits(self, value: bool) -> None:
        self._state("").allow_write = value

    def set_accept_edits(self, enabled: bool, connection_id: str = "") -> None:
        self._state(connection_id).allow_write = enabled

    def get_permissions(self, connection_id: str = "") -> dict:
        s = self._state(connection_id)
        return {
            "providerType": s.provider_type,
            "allowRead": s.allow_read,
            "allowWrite": s.allow_write,
            "allowTools": s.allow_tools,
            "allowSubagents": s.allow_subagents,
            "autoApproveReports": s.auto_approve_reports,
        }

    def set_permission(self, name: str, value: bool, connection_id: str = "") -> bool:
        s = self._state(connection_id)
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
        setattr(s, attr, value)
        return True

    def get_allow_write(self, connection_id: str = "") -> bool:
        return self._state(connection_id).allow_write

    def get_allow_subagents(self, connection_id: str = "") -> bool:
        return self._state(connection_id).allow_subagents

    def get_auto_approve_reports(self, connection_id: str = "") -> bool:
        return self._state(connection_id).auto_approve_reports

    def set_provider_type(self, provider_type: str, connection_id: str = "") -> None:
        self._state(connection_id).provider_type = provider_type

    # ------------------------------------------------------------------
    # Path scope cache (per-connection)
    # ------------------------------------------------------------------

    def is_path_approved(self, path: "Path", connection_id: str = "") -> bool:  # noqa: F821
        path_str = str(path)
        return any(
            path_str == p or path_str.startswith(p + "/")
            for p in self._state(connection_id).approved_paths
        )

    def approve_path(self, path: "Path", connection_id: str = "") -> None:  # noqa: F821
        self._state(connection_id).approved_paths.add(str(path.parent))

    def is_command_approved(self, token: str, connection_id: str = "") -> bool:
        return token in self._state(connection_id).approved_commands

    def approve_command(self, token: str, connection_id: str = "") -> None:
        self._state(connection_id).approved_commands.add(token)

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

    async def approve(self, request_id: str, approve_for_session: bool = False) -> bool:
        """Approve a pending permission request.

        If approve_for_session is True and the request carries a _session_key
        in its tool_input, that key is cached so future identical commands
        skip the prompt for this connection.
        """
        request = self._pending.get(request_id)
        if request is None:
            return False

        if approve_for_session:
            session_key = request.tool_input.get("_session_key", "")
            if session_key:
                self.approve_command(session_key, request.connection_id)
                logger.info("Session-approved command token '%s' for connection %s",
                            session_key, request.connection_id)

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
