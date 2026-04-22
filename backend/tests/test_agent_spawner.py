"""Tests for AgentSpawnerTool."""

from __future__ import annotations

import json

import pytest

from core.backend.providers.agent_spawner import AgentSpawnerTool


class TestAgentSpawnerTool:
    """Test AgentSpawnerTool initialization and interface."""

    def test_initialization(self) -> None:
        """Test spawner initializes without arguments."""
        spawner = AgentSpawnerTool()
        assert spawner is not None

    def test_tool_definitions(self) -> None:
        """Test tool_definitions returns spawn_agent tool."""
        spawner = AgentSpawnerTool()
        defs = spawner.tool_definitions()
        assert len(defs) == 1
        assert defs[0].name == "spawn_agent"
        assert "spawn" in defs[0].description.lower()
        assert "agent" in defs[0].description.lower()

    def test_spawn_agent_schema(self) -> None:
        """Test spawn_agent tool has correct schema."""
        spawner = AgentSpawnerTool()
        defs = spawner.tool_definitions()
        schema = defs[0].parameters_schema

        assert schema["type"] == "object"
        assert "name" in schema["properties"]
        assert "task" in schema["properties"]
        assert "mode" in schema["properties"]
        assert "context_handoff" in schema["properties"]

        assert schema["required"] == ["name", "task"]

    def test_execute_valid_spawn(self) -> None:
        """Test execute returns JSON for valid spawn request."""
        spawner = AgentSpawnerTool()
        result = spawner.execute("spawn_agent", {"name": "test-agent", "task": "Do something"})
        parsed = json.loads(result)

        assert parsed["action"] == "spawn_agent"
        assert parsed["agent_name"] == "test-agent"
        assert parsed["task"] == "Do something"
        assert parsed["mode"] == "code"

    def test_execute_with_mode(self) -> None:
        """Test execute with mode parameter."""
        spawner = AgentSpawnerTool()
        result = spawner.execute("spawn_agent", {"name": "arch", "task": "Plan", "mode": "architect"})
        parsed = json.loads(result)

        assert parsed["mode"] == "architect"

    def test_execute_with_context_handoff(self) -> None:
        """Test execute includes context_handoff when provided."""
        spawner = AgentSpawnerTool()
        handoff = "Completed: Phase 1. Next: implement Phase 2"
        result = spawner.execute("spawn_agent", {
            "name": "phase2",
            "task": "Continue implementation",
            "context_handoff": handoff,
        })
        parsed = json.loads(result)

        assert parsed["context_handoff"] == handoff

    def test_execute_missing_name(self) -> None:
        """Test execute returns error when name is missing."""
        spawner = AgentSpawnerTool()
        result = spawner.execute("spawn_agent", {"task": "Do something"})

        assert "Error" in result

    def test_execute_missing_task(self) -> None:
        """Test execute returns error when task is missing."""
        spawner = AgentSpawnerTool()
        result = spawner.execute("spawn_agent", {"name": "agent"})

        assert "Error" in result

    def test_execute_unknown_tool(self) -> None:
        """Test execute returns error for unknown tool name."""
        spawner = AgentSpawnerTool()
        result = spawner.execute("unknown_tool", {})

        assert "Error" in result
        assert "unknown" in result.lower()

    def test_tool_executor_protocol(self) -> None:
        """Test spawner implements ToolExecutor protocol."""
        spawner = AgentSpawnerTool()
        assert hasattr(spawner, "execute")
        assert callable(spawner.execute)
        assert hasattr(spawner, "tool_definitions")
        assert callable(spawner.tool_definitions)
