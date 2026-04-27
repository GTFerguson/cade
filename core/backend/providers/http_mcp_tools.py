"""HTTP MCP server tools adapter for CADE providers."""

from __future__ import annotations

import asyncio
import json
import logging
import pathlib
import time

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)


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
    ) -> None:
        self.url = url
        self.headers = headers or {}
        self._session: ClientSession | None = None
        self._http_ctx = None
        self._tools: dict[str, ToolDefinition] | None = None

    @classmethod
    def from_claude_oauth(cls, url: str, server_name: str) -> "HTTPMCPToolAdapter":
        """Create adapter using Claude Code's stored OAuth credentials for the named server."""
        token = load_claude_oauth_token(server_name)
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        else:
            logger.warning("No valid OAuth token found for MCP server '%s'", server_name)
        return cls(url, headers)

    async def _ensure_connected(self) -> None:
        if self._session is not None:
            return
        self._http_ctx = streamablehttp_client(self.url, headers=self.headers)
        read_stream, write_stream, _ = await asyncio.wait_for(
            self._http_ctx.__aenter__(), timeout=8.0
        )
        self._session = ClientSession(read_stream, write_stream)
        await self._session.__aenter__()
        await asyncio.wait_for(self._session.initialize(), timeout=8.0)

    async def _list_tools(self) -> dict[str, ToolDefinition]:
        if self._tools is not None:
            return self._tools
        try:
            await self._ensure_connected()
        except (Exception, BaseException) as e:
            if isinstance(e, (asyncio.CancelledError, SystemExit, KeyboardInterrupt)):
                raise
            logger.debug("Could not connect to HTTP MCP server %s: %s", self.url, e)
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
        try:
            await self._ensure_connected()
        except (Exception, BaseException) as e:
            if isinstance(e, (asyncio.CancelledError, SystemExit, KeyboardInterrupt)):
                raise
            return f"Error: HTTP MCP server not connected for tool '{name}': {e}"
        if self._session is None:
            return f"Error: HTTP MCP server not connected for tool '{name}'"
        try:
            result = await self._session.call_tool(name, arguments)
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
