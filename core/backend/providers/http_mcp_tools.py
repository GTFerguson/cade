"""HTTP MCP server tools adapter for CADE providers."""

from __future__ import annotations

import asyncio
import json
import logging
import pathlib
import time
import weakref
from typing import TYPE_CHECKING

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from core.backend.providers.types import ToolDefinition

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


# Per-step budget for the HTTP transport handshake and the MCP `initialize`
# round-trip. The outer wrapper in `tool_executor.definitions_async` bounds
# the whole connect-plus-list cycle to MCP_DISCOVERY_TIMEOUT_S, so this is the
# defensive inner cap; if the outer fires first, that wins. Kept equal to the
# discovery timeout so the documented worst-case block is one budget, not two.
MCP_HANDSHAKE_TIMEOUT_S = 10.0


# Process-wide registry of live adapter instances. Held weakly so adapters are
# GC'd with their owning provider, but accessible so a fresh OAuth token can
# invalidate the cached connect-failed state across every provider that wires
# the same MCP server. Cleaned opportunistically.
_adapter_refs: list[weakref.ref] = []


def _summarise_exc(e: BaseException) -> str:
    """One-line description of an exception suitable for user-facing errors."""
    if isinstance(e, BaseExceptionGroup):
        children = [_summarise_exc(c) for c in e.exceptions]
        return f"{type(e).__name__}({'; '.join(children)})"
    msg = str(e).strip()
    if not msg:
        return type(e).__name__
    return f"{type(e).__name__}: {msg.splitlines()[0][:200]}"


def _outer_cancel_pending() -> bool:
    """True if the current task has been cancelled by an outside caller.

    Distinguishes a genuine outer cancellation from an internal anyio
    TaskGroup unwind (which raises CancelledError as part of cleanup when
    a child task fails). Requires Python 3.11+ for Task.cancelling().
    """
    task = asyncio.current_task()
    if task is None:
        return False
    cancelling = getattr(task, "cancelling", None)
    if cancelling is None:
        return True
    return cancelling() > 0


def load_claude_oauth_token(server_name: str) -> str | None:
    """Load OAuth access token for a named MCP server from Claude Code credentials."""
    creds_path = pathlib.Path.home() / ".claude" / ".credentials.json"
    if not creds_path.exists():
        return None
    try:
        with open(creds_path) as f:
            creds = json.load(f)
        mcp_oauth = creds.get("mcpOAuth", {})
        for key, entry in mcp_oauth.items():
            if key.startswith(server_name) and isinstance(entry, dict):
                access_token = entry.get("accessToken")
                if not access_token:
                    return None
                expires_at = entry.get("expiresAt", 0)
                # expiresAt is a JS timestamp in milliseconds
                if isinstance(expires_at, (int, float)) and expires_at > 0:
                    if time.time() * 1000 >= expires_at:
                        logger.debug("OAuth token for %s is expired", server_name)
                        return None
                return access_token
    except Exception as e:
        logger.debug("Could not load Claude OAuth credentials: %s", e)
    return None


def get_mcp_oauth_status(server_name: str) -> dict:
    """Return auth status for a Claude-managed OAuth MCP server."""
    creds_path = pathlib.Path.home() / ".claude" / ".credentials.json"
    if not creds_path.exists():
        return {"authenticated": False, "reason": "no_credentials"}
    try:
        with open(creds_path) as f:
            creds = json.load(f)
        mcp_oauth = creds.get("mcpOAuth", {})
        for key, entry in mcp_oauth.items():
            if key.startswith(server_name) and isinstance(entry, dict):
                access_token = entry.get("accessToken")
                if not access_token:
                    return {"authenticated": False, "reason": "no_token"}
                expires_at = entry.get("expiresAt", 0)
                if isinstance(expires_at, (int, float)) and expires_at > 0:
                    if time.time() * 1000 >= expires_at:
                        return {"authenticated": False, "reason": "token_expired"}
                return {"authenticated": True}
        return {"authenticated": False, "reason": "not_found"}
    except Exception as e:
        logger.debug("Could not check OAuth status for %s: %s", server_name, e)
        return {"authenticated": False, "reason": "error"}


class HTTPMCPToolAdapter:
    """Adapter that connects to an HTTP-based MCP server and exposes its tools."""

    def __init__(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        server_name: str | None = None,
    ) -> None:
        self.url = url
        self.headers = headers or {}
        self._session: ClientSession | None = None
        self._http_ctx = None
        self._tools: dict[str, ToolDefinition] | None = None
        self._connect_failed = False
        self._connect_error: str | None = None
        self._server_name = server_name
        # SSE-style MCP sessions can't multiplex — serialise concurrent
        # call_tool() invocations through one ClientSession.
        self._call_lock = asyncio.Lock()
        _adapter_refs.append(weakref.ref(self))

    @classmethod
    def from_claude_oauth(cls, url: str, server_name: str) -> "HTTPMCPToolAdapter":
        """Create adapter using stored OAuth credentials for the named server."""
        token = load_claude_oauth_token(server_name)
        headers: dict[str, str] = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            logger.warning("No valid OAuth token found for MCP server '%s'", server_name)
        return cls(url, headers, server_name=server_name)

    async def _ensure_connected(self) -> None:
        if self._session is not None:
            return
        self._http_ctx = streamablehttp_client(self.url, headers=self.headers)
        read_stream, write_stream, _ = await asyncio.wait_for(
            self._http_ctx.__aenter__(), timeout=MCP_HANDSHAKE_TIMEOUT_S
        )
        self._session = ClientSession(read_stream, write_stream)
        await self._session.__aenter__()
        await asyncio.wait_for(self._session.initialize(), timeout=MCP_HANDSHAKE_TIMEOUT_S)

    async def _list_tools(self) -> dict[str, ToolDefinition]:
        if self._tools is not None:
            return self._tools
        if self._connect_failed:
            return {}
        # Run the connect in a child task so anyio's TaskGroup cancel scope
        # (used by streamable_http_client) is isolated from our caller. If
        # the MCP server returns 401, anyio cancels its own scope; without
        # this isolation, that cancel propagates up and kills the chat stream.
        setup_task = asyncio.create_task(self._ensure_connected())
        try:
            await setup_task
        except (SystemExit, KeyboardInterrupt):
            raise
        except BaseException as e:
            if isinstance(e, asyncio.CancelledError) and _outer_cancel_pending():
                raise
            self._connect_failed = True
            self._connect_error = _summarise_exc(e)
            logger.warning(
                "HTTP MCP %s: connect failed, disabling for this session (%s)",
                self.url, self._connect_error,
            )
            return {}
        if self._session is None:
            return {}
        try:
            tools_response = await self._session.list_tools()
            self._tools = {}
            for tool_info in tools_response.tools:
                tool_def = ToolDefinition(
                    name=tool_info.name,
                    description=tool_info.description or "",
                    parameters_schema=tool_info.inputSchema or {
                        "type": "object",
                        "properties": {},
                    },
                )
                self._tools[tool_info.name] = tool_def
            logger.info("Loaded %d tools from HTTP MCP server %s", len(self._tools), self.url)
            return self._tools
        except Exception as e:
            logger.error("Failed to list tools from HTTP MCP server %s: %s", self.url, e)
            return {}

    def tool_definitions(self) -> list[ToolDefinition]:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                logger.warning(
                    "tool_definitions() called from async context; "
                    "tools may not be available. Use _list_tools() instead."
                )
                return []
            tools = loop.run_until_complete(self._list_tools())
            return list(tools.values())
        except RuntimeError:
            tools = asyncio.run(self._list_tools())
            return list(tools.values())

    def execute(self, name: str, arguments: dict) -> str:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                return f"Error: tool '{name}' cannot be executed from async context"
            return loop.run_until_complete(self.execute_async(name, arguments))
        except RuntimeError:
            return asyncio.run(self.execute_async(name, arguments))

    async def execute_async(self, name: str, arguments: dict) -> str:
        if self._connect_failed:
            return f"Error: HTTP MCP server unavailable ({self._connect_error or 'previous connect failed'})"
        try:
            await self._ensure_connected()
        except (SystemExit, KeyboardInterrupt):
            raise
        except BaseException as e:
            if isinstance(e, asyncio.CancelledError) and _outer_cancel_pending():
                raise
            self._connect_failed = True
            self._connect_error = _summarise_exc(e)
            return f"Error: HTTP MCP server connect failed for tool '{name}': {self._connect_error}"
        if self._session is None:
            return f"Error: HTTP MCP server not connected for tool '{name}'"
        try:
            async with self._call_lock:
                result = await asyncio.wait_for(
                    self._session.call_tool(name, arguments),
                    timeout=60.0,
                )
        except asyncio.TimeoutError:
            return f"Error: tool '{name}' timed out after 60s on HTTP MCP server"
        try:
            if hasattr(result, "content") and result.content:
                text_parts = []
                for content_block in result.content:
                    if hasattr(content_block, "text"):
                        text_parts.append(content_block.text)
                    elif isinstance(content_block, dict) and "text" in content_block:
                        text_parts.append(content_block["text"])
                if text_parts:
                    return "\n".join(text_parts)
            if isinstance(result, dict):
                return json.dumps(result)
            return str(result)
        except Exception as e:
            return f"Error: {e}"

    async def close(self) -> None:
        if self._session is not None:
            await self._session.__aexit__(None, None, None)
            self._session = None
        if self._http_ctx is not None:
            await self._http_ctx.__aexit__(None, None, None)
            self._http_ctx = None

    async def refresh_credentials(self) -> bool:
        """Reload the OAuth token from disk and reset connect/tool caches.

        Called after a fresh OAuth flow completes so the adapter picks up
        the new bearer token and tries again on the next chat turn instead
        of staying stuck on the cached failure.

        Returns True if a non-empty token was loaded.
        """
        if not self._server_name:
            return False
        token = load_claude_oauth_token(self._server_name)
        if not token:
            return False
        # Drop any cached session — its old auth header is dead. Closing it
        # may itself raise (anyio cleanup quirks); always reset state regardless.
        try:
            await self.close()
        except BaseException as e:  # noqa: BLE001
            logger.debug(
                "HTTP MCP %s: error closing stale session during refresh (%s)",
                self.url, type(e).__name__,
            )
            self._session = None
            self._http_ctx = None
        self.headers["Authorization"] = f"Bearer {token}"
        self._tools = None
        self._connect_failed = False
        self._connect_error = None
        logger.info("HTTP MCP %s: credentials refreshed", self.url)
        return True


async def refresh_adapters_for_server(server_name: str) -> int:
    """Refresh every live adapter that belongs to the named server.

    Returns the count of adapters actually refreshed. Adapters that no
    longer exist (GC'd) are pruned from the registry.
    """
    refreshed = 0
    surviving: list[weakref.ref] = []
    for ref in _adapter_refs:
        adapter = ref()
        if adapter is None:
            continue
        surviving.append(ref)
        if adapter._server_name != server_name:
            continue
        try:
            ok = await adapter.refresh_credentials()
            if ok:
                refreshed += 1
        except BaseException as e:  # noqa: BLE001
            logger.warning(
                "HTTP MCP %s: refresh failed (%s: %s)",
                adapter.url, type(e).__name__, str(e).splitlines()[0][:200] if str(e) else "",
            )
    _adapter_refs[:] = surviving
    return refreshed
