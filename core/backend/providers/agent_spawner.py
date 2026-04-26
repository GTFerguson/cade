"""Agent spawner tool executor for CADE providers."""

from __future__ import annotations

import json
import logging
from typing import Any

from core.backend.providers.types import ToolDefinition

logger = logging.getLogger(__name__)


class AgentSpawnerTool:
    """Tool executor that spawns new agents via orchestrator MCP."""

    def tool_definitions(self) -> list[ToolDefinition]:
        """Define the spawn_agent tool."""
        return [
            ToolDefinition(
                name="spawn_agent",
                description=(
                    "Spawn a new agent to work on a task. The agent runs in a separate session "
                    "and returns a completion report. Requires user approval before starting. "
                    "Call this to delegate work to a specialized agent or to continue work "
                    "when context is getting full."
                ),
                parameters_schema={
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Short identifier for the agent (e.g. 'test-writer', 'refactor')",
                        },
                        "task": {
                            "type": "string",
                            "description": "Full task description — what the agent should do",
                        },
                        "mode": {
                            "type": "string",
                            "enum": ["code", "plan"],
                            "description": (
                                "Agent mode. 'code' has full access (default), "
                                "'plan' is read-only planning"
                            ),
                        },
                        "context_handoff": {
                            "type": "string",
                            "description": (
                                "Optional context summary to inject into the agent's system prompt. "
                                "Used when continuing work after a handoff."
                            ),
                        },
                    },
                    "required": ["name", "task"],
                },
            )
        ]

    def execute(self, name: str, arguments: dict) -> str:
        """Execute spawn_agent request.

        This is a placeholder that documents the interface.
        Actual execution happens via orchestrator MCP in the UI layer.
        """
        if name != "spawn_agent":
            return f"Error: unknown tool '{name}'"

        agent_name = arguments.get("name", "")
        task = arguments.get("task", "")
        mode = arguments.get("mode", "code")
        context_handoff = arguments.get("context_handoff", "")

        if not agent_name or not task:
            return "Error: 'name' and 'task' are required"

        # Return a structured response that the orchestrator can act on
        result = {
            "action": "spawn_agent",
            "agent_name": agent_name,
            "task": task,
            "mode": mode,
        }
        if context_handoff:
            result["context_handoff"] = context_handoff

        return json.dumps(result)
