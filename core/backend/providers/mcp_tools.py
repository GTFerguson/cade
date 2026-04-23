"""MCP server tools adapter for CADE providers."""

from __future__ import annotations

import asyncio
import json
import logging
import sys

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)


class MCPToolAdapter:
    """Adapter that connects to an MCP server and exposes its tools."""

    def __init__(
        self,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        """Initialize adapter with MCP server config.

        Args:
            command: Command to spawn the MCP server
            args: Arguments to pass to the command
            env: Environment variables for the subprocess
        """
        self.command = command
        self.args = args or []
        self.env = env or {}
        self._session: ClientSession | None = None
        self._stdio_ctx = None
        self._tools: dict[str, ToolDefinition] | None = None

    async def _ensure_connected(self) -> None:
        """Connect to the MCP server if not already connected."""
        if self._session is not None:
            return

        params = StdioServerParameters(
            command=self.command,
            args=self.args,
            env=self.env,
        )
        # stdio_client is an async context manager that yields (read_stream, write_stream)
        self._stdio_ctx = stdio_client(params, errlog=sys.stderr)
        read_stream, write_stream = await self._stdio_ctx.__aenter__()
        self._session = ClientSession(read_stream, write_stream)
        await self._session.__aenter__()
        await self._session.initialize()

    async def _list_tools(self) -> dict[str, ToolDefinition]:
        """List tools from the MCP server and convert to ToolDefinitions."""
        if self._tools is not None:
            return self._tools

        try:
            await self._ensure_connected()
        except Exception as e:
            logger.debug(f"Could not connect to MCP server: {e}")
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

            return self._tools
        except Exception as e:
            logger.error(f"Failed to list MCP tools: {e}")
            return {}

    def tool_definitions(self) -> list[ToolDefinition]:
        """Return tool definitions (blocking version)."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If already in an async context, can't use run_until_complete
                logger.warning(
                    "tool_definitions() called from async context; "
                    "tools may not be available. Use _list_tools() instead."
                )
                return []
            tools = loop.run_until_complete(self._list_tools())
            return list(tools.values())
        except RuntimeError:
            # No event loop
            tools = asyncio.run(self._list_tools())
            return list(tools.values())

    def execute(self, name: str, arguments: dict) -> str:
        """Execute a tool by name (blocking version)."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                logger.error(
                    "execute() called from async context; tools cannot be executed. "
                    "Use execute_async() instead."
                )
                return f"Error: tool '{name}' cannot be executed from async context"
            return loop.run_until_complete(self.execute_async(name, arguments))
        except RuntimeError:
            # No event loop
            return asyncio.run(self.execute_async(name, arguments))

    async def execute_async(self, name: str, arguments: dict) -> str:
        """Execute a tool by name (async version)."""
        try:
            await self._ensure_connected()
        except Exception as e:
            logger.debug(f"Could not connect to MCP server: {e}")
            return f"Error: MCP server not connected for tool '{name}'"

        if self._session is None:
            return f"Error: MCP server not connected for tool '{name}'"

        try:
            # Call the tool on the MCP server
            result = await self._session.call_tool(name, arguments)

            # Extract text content from the result
            if hasattr(result, "content") and result.content:
                # MCP returns a list of content blocks
                text_parts = []
                for content_block in result.content:
                    if hasattr(content_block, "text"):
                        text_parts.append(content_block.text)
                    elif isinstance(content_block, dict) and "text" in content_block:
                        text_parts.append(content_block["text"])

                if text_parts:
                    return "\n".join(text_parts)

            # Fallback: return the whole result as JSON
            if isinstance(result, dict):
                return json.dumps(result)
            return str(result)
        except Exception as e:
            return f"Error: {e}"

    async def close(self) -> None:
        """Close the MCP server connection."""
        if self._session is not None:
            await self._session.__aexit__(None, None, None)
            self._session = None
        if self._stdio_ctx is not None:
            await self._stdio_ctx.__aexit__(None, None, None)
            self._stdio_ctx = None
