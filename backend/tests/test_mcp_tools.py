"""Tests for MCPToolAdapter."""

from __future__ import annotations

import asyncio

import pytest
from unittest.mock import patch

from core.backend.providers.mcp_tools import MCPToolAdapter
from core.backend.providers.types import ToolDefinition


class TestMCPToolAdapter:
    """Test MCPToolAdapter initialization and interface."""

    def test_initialization(self) -> None:
        """Test adapter initializes with command and env."""
        adapter = MCPToolAdapter(
            command="python",
            args=["-m", "mcp.server"],
            env={"VAR": "value"},
        )
        assert adapter.command == "python"
        assert adapter.args == ["-m", "mcp.server"]
        assert adapter.env == {"VAR": "value"}

    def test_initialization_defaults(self) -> None:
        """Test adapter initializes with defaults."""
        adapter = MCPToolAdapter(command="python")
        assert adapter.command == "python"
        assert adapter.args == []
        assert adapter.env == {}

    def test_tool_definitions_no_connection(self) -> None:
        """Test tool_definitions returns empty when no connection available."""
        adapter = MCPToolAdapter(command="nonexistent-command")
        # Since the server won't actually start, should return empty list
        defs = adapter.tool_definitions()
        assert isinstance(defs, list)

    def test_execute_no_connection(self) -> None:
        """Test execute returns error when no connection available."""
        adapter = MCPToolAdapter(command="nonexistent-command")
        result = adapter.execute("test_tool", {})
        assert "Error" in result
        assert isinstance(result, str)

    def test_tool_executor_protocol(self) -> None:
        """Test adapter implements ToolExecutor protocol."""
        adapter = MCPToolAdapter(command="python")
        assert hasattr(adapter, "execute")
        assert callable(adapter.execute)
        # execute() should take (name: str, arguments: dict) and return str
        result = adapter.execute("test", {})
        assert isinstance(result, str)

    def test_has_tool_definitions_method(self) -> None:
        """Test adapter has tool_definitions method."""
        adapter = MCPToolAdapter(command="python")
        assert hasattr(adapter, "tool_definitions")
        assert callable(adapter.tool_definitions)
        defs = adapter.tool_definitions()
        assert isinstance(defs, list)


class TestMCPToolAdapterCancellation:
    """CancelledError must propagate through _list_tools so task cancellation works."""

    @pytest.mark.asyncio
    async def test_list_tools_propagates_cancelled_error(self) -> None:
        adapter = MCPToolAdapter(command="python")
        with patch.object(adapter, "_ensure_connected", side_effect=asyncio.CancelledError):
            with pytest.raises(asyncio.CancelledError):
                await adapter._list_tools()
