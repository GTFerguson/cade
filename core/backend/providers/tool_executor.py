"""Tool executor protocol, registry, and nkrdn implementation."""

from __future__ import annotations

import shutil
import subprocess
from typing import Protocol, runtime_checkable

from core.backend.providers.types import ToolDefinition


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

    def __init__(self) -> None:
        self._executors: dict[str, ToolExecutor] = {}

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
        return result

    def execute(self, name: str, arguments: dict) -> str:
        """Execute a tool by name. Returns error string if tool not found or raises."""
        executor = self._executors.get(name)
        if executor is None:
            return f"Error: unknown tool '{name}'"
        try:
            return executor.execute(name, arguments)
        except Exception as e:
            return f"Error: {e}"


_NKRDN_SCHEMA = {
    "type": "object",
    "properties": {
        "operation": {
            "type": "string",
            "enum": ["search", "lookup", "details", "context", "usages"],
            "description": "The nkrdn operation to run",
        },
        "arg": {
            "type": "string",
            "description": "Argument: query string, symbol name, URI, or file path",
        },
    },
    "required": ["operation", "arg"],
}


class NkrdnExecutor:
    """Runs nkrdn CLI commands as subprocesses."""

    _TIMEOUT = 15  # seconds

    def tool_definitions(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="nkrdn",
                description=(
                    "Query the nkrdn code knowledge graph. "
                    "operations: search (text query), lookup (symbol name), "
                    "details (URI), context (file path), usages (URI)"
                ),
                parameters_schema=_NKRDN_SCHEMA,
            )
        ]

    def execute(self, name: str, arguments: dict) -> str:
        operation = arguments.get("operation", "")
        arg = arguments.get("arg", "")
        if not operation or not arg:
            return "Error: 'operation' and 'arg' are required"

        bin_path = shutil.which("nkrdn")
        if bin_path is None:
            return "Error: nkrdn not found on PATH"

        try:
            result = subprocess.run(
                [bin_path, operation, arg],
                capture_output=True,
                text=True,
                timeout=self._TIMEOUT,
            )
            if result.returncode != 0:
                return f"Error (exit {result.returncode}): {result.stderr.strip()}"
            return result.stdout.strip() or "(no output)"
        except subprocess.TimeoutExpired:
            return f"Error: nkrdn timed out after {self._TIMEOUT}s"
        except Exception as e:
            return f"Error: {e}"


def make_nkrdn_registry() -> ToolRegistry:
    """Return a pre-configured ToolRegistry with NkrdnExecutor."""
    registry = ToolRegistry()
    executor = NkrdnExecutor()
    for defn in executor.tool_definitions():
        registry.register(executor, defn.name)
    return registry
