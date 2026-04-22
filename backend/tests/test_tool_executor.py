"""Tests for tool executor registry and nkrdn implementation."""

from __future__ import annotations

import subprocess
from unittest.mock import MagicMock, patch

import pytest

from core.backend.providers.tool_executor import (
    NkrdnExecutor,
    ToolDefinition,
    ToolRegistry,
    make_nkrdn_registry,
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


class TestNkrdnExecutor:
    """Tests for NkrdnExecutor."""

    def test_nkrdn_tool_definitions(self):
        """Test that NkrdnExecutor exposes one 'nkrdn' tool."""
        executor = NkrdnExecutor()
        defs = executor.tool_definitions()

        assert len(defs) == 1
        assert defs[0].name == "nkrdn"
        assert "search" in defs[0].description
        assert "operation" in defs[0].parameters_schema["properties"]

    def test_nkrdn_missing_required_args(self):
        """Test that missing 'operation' or 'arg' returns error."""
        executor = NkrdnExecutor()

        # Missing operation
        result = executor.execute("nkrdn", {"arg": "foo"})
        assert "Error:" in result
        assert "required" in result.lower()

        # Missing arg
        result = executor.execute("nkrdn", {"operation": "search"})
        assert "Error:" in result

    def test_nkrdn_not_found(self):
        """Test that missing nkrdn binary returns error."""
        executor = NkrdnExecutor()

        with patch("core.backend.providers.tool_executor.shutil.which") as mock_which:
            mock_which.return_value = None
            result = executor.execute("nkrdn", {"operation": "search", "arg": "foo"})
            assert "not found" in result

    def test_nkrdn_success(self):
        """Test successful nkrdn execution."""
        executor = NkrdnExecutor()

        with patch("core.backend.providers.tool_executor.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout="found symbol XYZ\n",
                stderr="",
            )

            result = executor.execute("nkrdn", {"operation": "search", "arg": "foo"})
            assert result == "found symbol XYZ"
            mock_run.assert_called_once()

    def test_nkrdn_timeout(self):
        """Test that timeout is handled."""
        executor = NkrdnExecutor()

        with patch("core.backend.providers.tool_executor.subprocess.run") as mock_run:
            mock_run.side_effect = subprocess.TimeoutExpired("nkrdn", 15)
            result = executor.execute("nkrdn", {"operation": "search", "arg": "foo"})
            assert "timed out" in result

    def test_nkrdn_nonzero_exit(self):
        """Test that nonzero exit code is handled."""
        executor = NkrdnExecutor()

        with patch("core.backend.providers.tool_executor.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=1,
                stdout="",
                stderr="Command not found\n",
            )

            result = executor.execute("nkrdn", {"operation": "search", "arg": "foo"})
            assert "exit 1" in result
            assert "Command not found" in result

    def test_nkrdn_empty_output(self):
        """Test handling of empty output."""
        executor = NkrdnExecutor()

        with patch("core.backend.providers.tool_executor.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout="",
                stderr="",
            )

            result = executor.execute("nkrdn", {"operation": "search", "arg": "foo"})
            assert result == "(no output)"


class TestMakeNkrdnRegistry:
    """Tests for make_nkrdn_registry factory."""

    def test_make_nkrdn_registry_returns_configured_registry(self):
        """Test that factory returns a ready-to-use registry."""
        registry = make_nkrdn_registry()

        assert len(registry.definitions()) == 1
        assert registry.definitions()[0].name == "nkrdn"

        # Should be able to execute without setup
        with patch("core.backend.providers.tool_executor.shutil.which") as mock_which:
            mock_which.return_value = None
            result = registry.execute("nkrdn", {"operation": "search", "arg": "test"})
            assert "not found" in result
