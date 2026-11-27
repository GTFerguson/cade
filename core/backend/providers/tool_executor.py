"""Tool executor protocol and the registry that dispatches calls by name."""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol, runtime_checkable

from core.backend.providers.http_mcp_tools import MCP_HANDSHAKE_TIMEOUT_S
from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)


@runtime_checkable
class ToolExecutor(Protocol):
    """Anything that can execute a named tool."""

    def execute(self, name: str, arguments: dict) -> str:
        """Execute a tool and return the result as a string.

        On error, return an "Error: ..." message (not raise).
        """
        ...


class ToolRegistry:
    """Holds named executors and dispatches calls by tool name."""

    def __init__(self, disabled: "set[str] | frozenset[str]" = frozenset()) -> None:
        self._executors: dict[str, ToolExecutor] = {}
        # Turned off in providers.toml. Left out of the definitions and also
        # refused on execution, because a model can call a tool by a name it
        # was not offered.
        self._disabled = frozenset(disabled)

    def register(self, executor: ToolExecutor, *tool_names: str) -> None:
        """Register an executor under one or more tool names."""
        for name in tool_names:
            self._executors[name] = executor

    def definitions(self) -> list[ToolDefinition]:
        """Collect tool definitions from registered executors.

        Deduplicates: if a single executor instance is registered under
        multiple names, its definitions are included only once.
        """
        seen: set[int] = set()
        result: list[ToolDefinition] = []
        for executor in self._executors.values():
            executor_id = id(executor)
            if executor_id in seen:
                continue
            seen.add(executor_id)
            if hasattr(executor, "tool_definitions"):
                result.extend(executor.tool_definitions())
        return [d for d in result if d.name not in self._disabled]

    def _refusal(self, name: str) -> str | None:
        if name in self._disabled:
            return f"Error: tool '{name}' is turned off in providers.toml ([tools] disabled)"
        return None

    def execute(self, name: str, arguments: dict) -> str:
        """Execute a tool by name. Returns error string if tool not found or raises."""
        refusal = self._refusal(name)
        if refusal:
            return refusal
        executor = self._executors.get(name)
        if executor is None:
            return f"Error: unknown tool '{name}'"
        try:
            return executor.execute(name, arguments)
        except Exception as e:
            return f"Error: {e}"

    async def definitions_async(self) -> list[ToolDefinition]:
        """Async version of definitions() — resolves MCP adapters properly.

        Also registers discovered MCP tool names so execute_async can route
        to the right adapter by name after this call.
        """
        seen: set[int] = set()
        result: list[ToolDefinition] = []
        for executor in list(self._executors.values()):
            executor_id = id(executor)
            if executor_id in seen:
                continue
            seen.add(executor_id)
            if hasattr(executor, "_list_tools"):
                try:
                    tools: dict = await asyncio.wait_for(executor._list_tools(), timeout=MCP_HANDSHAKE_TIMEOUT_S)
                except asyncio.TimeoutError:
                    logger.warning("MCP tool discovery timed out for %s", type(executor).__name__)
                    tools = {}
                for tool_name, tool_def in tools.items():
                    if tool_name not in self._executors:
                        self._executors[tool_name] = executor
                result.extend(tools.values())
            elif hasattr(executor, "tool_definitions"):
                result.extend(executor.tool_definitions())
        return [d for d in result if d.name not in self._disabled]

    async def execute_async(self, name: str, arguments: dict) -> str:
        """Async version of execute() — delegates to execute_async if available."""
        refusal = self._refusal(name)
        if refusal:
            return refusal
        executor = self._executors.get(name)
        if executor is None:
            return f"Error: unknown tool '{name}'"
        try:
            if hasattr(executor, "execute_async"):
                return await executor.execute_async(name, arguments)
            return executor.execute(name, arguments)
        except Exception as e:
            return f"Error: {e}"
