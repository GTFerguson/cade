"""Tests for the tool executor registry."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.backend.providers.tool_executor import (
    ToolDefinition,
    ToolRegistry,
)


class TestToolRegistry:
    """Tests for ToolRegistry."""

    def test_registry_definitions(self):
        """Test that registry collects definitions from executors."""

        class TestExecutor:
            def tool_definitions(self):
                return [
                    ToolDefinition(
                        name="test",
                        description="A test tool",
                        parameters_schema={"type": "object"},
                    )
                ]

            def execute(self, name: str, arguments: dict) -> str:
                return "result"

        registry = ToolRegistry()
        executor = TestExecutor()
        registry.register(executor, "test")

        defs = registry.definitions()
        assert len(defs) == 1
        assert defs[0].name == "test"

    def test_registry_dispatch(self):
        """Test that registry dispatches to correct executor."""

        class TestExecutor:
            def tool_definitions(self):
                return []

            def execute(self, name: str, arguments: dict) -> str:
                return f"executed: {name}"

        registry = ToolRegistry()
        executor = TestExecutor()
        registry.register(executor, "test")

        result = registry.execute("test", {})
        assert result == "executed: test"

    def test_registry_unknown_tool(self):
        """Test that unknown tool returns error string (not raise)."""
        registry = ToolRegistry()
        result = registry.execute("unknown", {})
        assert "unknown tool" in result

    def test_registry_executor_exception(self):
        """Test that executor exceptions are caught and returned as error strings."""

        class BadExecutor:
            def tool_definitions(self):
                return []

            def execute(self, name: str, arguments: dict) -> str:
                raise ValueError("Something went wrong")

        registry = ToolRegistry()
        executor = BadExecutor()
        registry.register(executor, "bad")

        result = registry.execute("bad", {})
        assert "Error:" in result
        assert "Something went wrong" in result

    def test_registry_deduplicates_definitions(self):
        """Test that shared executors are deduplicated in definitions()."""

        class SharedExecutor:
            def tool_definitions(self):
                return [
                    ToolDefinition(
                        name="shared",
                        description="Shared tool",
                        parameters_schema={"type": "object"},
                    )
                ]

            def execute(self, name: str, arguments: dict) -> str:
                return "shared"

        registry = ToolRegistry()
        executor = SharedExecutor()
        # Register same executor under multiple names
        registry.register(executor, "tool_a", "tool_b")

        # definitions() should include the tool only once despite multiple registrations
        defs = registry.definitions()
        assert len(defs) == 1


class TestDefinitionsAsyncTimeout:
    """Tests for the 10-second timeout on MCP tool discovery in definitions_async."""

    @pytest.mark.asyncio
    async def test_slow_adapter_is_timed_out(self) -> None:
        """A slow _list_tools() must be aborted after 10 s and return no tools."""
        registry = ToolRegistry()

        class SlowAdapter:
            async def _list_tools(self):
                await asyncio.sleep(60)  # simulates a hung MCP connection
                return {"tool": MagicMock()}

        registry.register(SlowAdapter(), "slow")

        async def always_timeout(coro, timeout):
            coro.close()  # consume coroutine to suppress "never awaited" warning
            raise asyncio.TimeoutError

        with patch("core.backend.providers.tool_executor.asyncio.wait_for", always_timeout):
            defs = await registry.definitions_async()

        assert defs == []

    @pytest.mark.asyncio
    async def test_timeout_does_not_affect_other_adapters(self) -> None:
        """When one adapter times out, others in the registry still contribute."""
        registry = ToolRegistry()

        timed_out = ToolDefinition(name="__sentinel__", description="", parameters_schema={})
        fast_tool = ToolDefinition(name="fast_tool", description="", parameters_schema={})

        call_count = 0

        async def patched_wait_for(coro, timeout):
            nonlocal call_count
            call_count += 1
            # Consume the coroutine so it doesn't leak, then decide the outcome
            coro.close()
            if call_count == 1:
                raise asyncio.TimeoutError
            return {"fast_tool": fast_tool}

        class Adapter:
            async def _list_tools(self):  # pragma: no cover — body never runs
                return {}

        registry.register(Adapter(), "slow")
        registry.register(Adapter(), "fast")

        with patch("core.backend.providers.tool_executor.asyncio.wait_for", patched_wait_for):
            defs = await registry.definitions_async()

        names = [d.name for d in defs]
        assert "fast_tool" in names

    @pytest.mark.asyncio
    async def test_cancelled_error_propagates_through_definitions_async(self) -> None:
        """CancelledError from the outer task must propagate, not be swallowed."""
        registry = ToolRegistry()

        class CancellingAdapter:
            async def _list_tools(self):
                raise asyncio.CancelledError

        registry.register(CancellingAdapter(), "bad")

        with pytest.raises(asyncio.CancelledError):
            await registry.definitions_async()
