"""Orchestrator manager — spawns and tracks agent CC subprocesses."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.orchestrator.models import AgentRecord, AgentSpec, AgentState
from backend.protocol import MessageType
from backend.providers.claude_code_provider import ClaudeCodeProvider
from core.backend.providers.config import ProviderConfig
from core.backend.providers.types import (
    ChatDone,
    ChatError,
    ChatMessage,
    SystemInfo,
    TextDelta,
    ThinkingDelta,
    ToolResult,
    ToolUseStart,
)

logger = logging.getLogger(__name__)

BroadcastFn = Callable[[dict], Coroutine[Any, Any, None]]


@dataclass
class _ConnectionEntry:
    send_fn: BroadcastFn
    working_dir: Path | None = None


class OrchestratorManager:
    """Manages orchestrator agent lifecycle and output streaming.

    Each agent is owned by the connection that spawned it. All broadcasts
    are routed only to that connection's send function, preventing bleed-through
    to other tabs/projects.
    """

    def __init__(self) -> None:
        self._agents: dict[str, AgentRecord] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._providers: dict[str, ClaudeCodeProvider] = {}
        self._connections: dict[str, _ConnectionEntry] = {}

    def register_connection(
        self,
        connection_id: str,
        fn: BroadcastFn,
        working_dir: Path | None = None,
    ) -> None:
        self._connections[connection_id] = _ConnectionEntry(
            send_fn=fn, working_dir=working_dir
        )

    def unregister_connection(self, connection_id: str) -> None:
        self._connections.pop(connection_id, None)

    async def _send_to(self, connection_id: str, message: dict) -> None:
        """Send a message to one specific connection."""
        entry = self._connections.get(connection_id)
        if entry:
            try:
                await entry.send_fn(message)
            except Exception:
                logger.debug("Send callback failed for connection %s", connection_id, exc_info=True)
        elif not connection_id:
            # No owner — fall back to broadcasting to all connections (legacy path)
            for e in list(self._connections.values()):
                try:
                    await e.send_fn(message)
                except Exception:
                    logger.debug("Broadcast callback failed", exc_info=True)

    async def _send_to_agent(self, agent_id: str, message: dict) -> None:
        """Send a message to the connection that owns this agent."""
        record = self._agents.get(agent_id)
        if record:
            await self._send_to(record.owner_connection_id, message)

    # ── Public API ──────────────────────────────────────────────────

    async def spawn_agent(
        self, spec: AgentSpec, connection_id: str = ""
    ) -> AgentRecord:
        """Create a new agent in PENDING state and send approval request to its owner.

        Only available in orchestrator mode. Blocked when allow_subagents is False.
        """
        from backend.permissions.manager import get_permission_manager
        perms = get_permission_manager()

        short_id = uuid.uuid4().hex[:6]
        agent_id = f"agent-{spec.name}-{short_id}"

        if perms.get_mode(connection_id) != "orchestrator":
            logger.warning(
                "spawn_agent blocked: mode=%s is not orchestrator (agent_id=%s)",
                perms.get_mode(connection_id), agent_id,
            )
            raise ValueError("Subagents can only be spawned in orchestrator mode")

        if not perms.get_allow_subagents(connection_id):
            logger.warning("spawn_agent blocked: allow_subagents=False (agent_id=%s)", agent_id)
            raise ValueError("Subagent spawning is disabled")

        logger.info(
            "spawn_agent: id=%s name=%s connection=%s", agent_id, spec.name, connection_id
        )

        record = AgentRecord(
            agent_id=agent_id,
            name=spec.name,
            task=spec.task,
            mode=spec.mode,
            state=AgentState.PENDING,
            owner_connection_id=connection_id,
        )
        self._agents[agent_id] = record

        await self._send_to(connection_id, {
            "type": MessageType.CHAT_STREAM,
            "event": "agent-approval-request",
            "targetAgentId": agent_id,
            "name": spec.name,
            "task": spec.task,
            "mode": spec.mode,
        })

        return record

    async def approve_agent(self, agent_id: str) -> bool:
        """Approve a pending agent — creates the provider, broadcasts AGENT_SPAWNED, starts execution."""
        record = self._agents.get(agent_id)
        if record is None or record.state != AgentState.PENDING:
            return False

        record.spawn_approved = True
        connection_id = record.owner_connection_id

        entry = self._connections.get(connection_id)
        working_dir = entry.working_dir if entry else None

        config = ProviderConfig(
            name=f"agent-{record.name}",
            type="claude-code",
            model="sonnet",
        )
        provider = ClaudeCodeProvider(config)
        provider.set_mode(record.mode)
        if working_dir:
            provider.set_working_dir(working_dir)
        self._providers[agent_id] = provider

        await self._send_to(connection_id, {
            "type": MessageType.AGENT_SPAWNED,
            "agentId": agent_id,
            "name": record.name,
            "task": record.task,
            "mode": record.mode,
        })

        await self._send_to(connection_id, {
            "type": MessageType.CHAT_STREAM,
            "event": "agent-approval-resolved",
            "targetAgentId": agent_id,
            "resolution": "approved",
        })

        task = asyncio.create_task(self._run_agent(agent_id, provider, record.task))
        self._tasks[agent_id] = task

        return True

    async def reject_agent(self, agent_id: str) -> bool:
        """Reject a pending agent — sets completion event so MCP tool unblocks."""
        record = self._agents.get(agent_id)
        if record is None or record.state != AgentState.PENDING:
            return False

        record.state = AgentState.ERROR
        record.error = "Rejected by user"
        record.final_result = "Agent spawn was rejected by user."
        record.completion_event.set()

        await self._send_to(record.owner_connection_id, {
            "type": MessageType.CHAT_STREAM,
            "event": "agent-approval-resolved",
            "targetAgentId": agent_id,
            "resolution": "rejected",
        })

        return True

    async def approve_report(self, agent_id: str) -> bool:
        """Approve agent report — unblocks MCP tool with the report text."""
        record = self._agents.get(agent_id)
        if not record or record.state != AgentState.REVIEW:
            return False

        record.report_approved = True
        record.state = AgentState.CLOSED
        record.final_result = record.report
        await self._set_state(agent_id, AgentState.CLOSED)
        record.completion_event.set()

        await self._send_to_agent(agent_id, {
            "type": MessageType.AGENT_KILLED,
            "agentId": agent_id,
        })

        return True

    async def reject_report(self, agent_id: str) -> bool:
        """Reject agent report — unblocks MCP tool with rejection."""
        record = self._agents.get(agent_id)
        if not record or record.state != AgentState.REVIEW:
            return False

        record.report_approved = False
        record.state = AgentState.CLOSED
        record.final_result = f"Report rejected by user. Report was:\n{record.report}"
        await self._set_state(agent_id, AgentState.CLOSED)
        record.completion_event.set()

        await self._send_to_agent(agent_id, {
            "type": MessageType.AGENT_KILLED,
            "agentId": agent_id,
        })

        return True

    async def await_completion(self, agent_id: str, timeout: float = 3600.0) -> dict:
        """Block until agent lifecycle completes (spawn rejected or report approved/rejected)."""
        record = self._agents.get(agent_id)
        if not record:
            return {"error": "Agent not found"}
        try:
            await asyncio.wait_for(record.completion_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return {"error": "Timed out", "agent_id": agent_id}
        return {
            "agent_id": agent_id,
            "state": record.state.value,
            "report": record.final_result,
            "cost": record.cost,
            "approved": record.report_approved,
        }

    def get_status(self, agent_id: str) -> dict | None:
        record = self._agents.get(agent_id)
        if record is None:
            return None
        return {
            "agent_id": record.agent_id,
            "name": record.name,
            "state": record.state.value,
            "has_report": bool(record.report),
        }

    def get_report(self, agent_id: str) -> dict | None:
        record = self._agents.get(agent_id)
        if record is None:
            return None
        return {
            "agent_id": record.agent_id,
            "name": record.name,
            "state": record.state.value,
            "report": record.report,
            "error": record.error,
            "cost": record.cost,
        }

    async def kill_agent(self, agent_id: str) -> bool:
        record = self._agents.get(agent_id)
        if record is None:
            return False

        task = self._tasks.get(agent_id)
        if task and not task.done():
            task.cancel()

        provider = self._providers.get(agent_id)
        if provider:
            await provider.cancel()

        record.state = AgentState.ERROR
        record.error = "Killed by user"
        record.final_result = "Agent was killed by user."
        record.completion_event.set()

        await self._send_to_agent(agent_id, {
            "type": MessageType.AGENT_KILLED,
            "agentId": agent_id,
        })

        return True

    def list_agents(self) -> list[dict]:
        return [
            {
                "agent_id": r.agent_id,
                "name": r.name,
                "state": r.state.value,
                "task": r.task,
            }
            for r in self._agents.values()
        ]

    # ── Agent execution ─────────────────────────────────────────────

    async def _run_agent(
        self,
        agent_id: str,
        provider: ClaudeCodeProvider,
        task: str,
    ) -> None:
        """Run an agent subprocess, stream chat events to the owning connection."""
        record = self._agents[agent_id]
        record.state = AgentState.STARTING
        await self._set_state(agent_id, AgentState.STARTING)

        try:
            await self._send_to_agent(agent_id, {
                "type": MessageType.CHAT_STREAM,
                "agentId": agent_id,
                "event": "user-message",
                "content": task,
            })

            messages = [ChatMessage(role="user", content=task)]

            async for event in provider.stream_chat(messages):
                if isinstance(event, SystemInfo):
                    record.session_id = event.session_id
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "system-info",
                        "model": event.model,
                        "sessionId": event.session_id,
                        "tools": event.tools,
                        "slashCommands": event.slash_commands,
                        "version": event.version,
                    })

                elif isinstance(event, TextDelta):
                    record.report += event.content
                    if record.state != AgentState.BUSY:
                        record.state = AgentState.BUSY
                        await self._set_state(agent_id, AgentState.BUSY)
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "text-delta",
                        "content": event.content,
                    })

                elif isinstance(event, ThinkingDelta):
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "thinking-delta",
                        "content": event.content,
                    })

                elif isinstance(event, ToolUseStart):
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "tool-use-start",
                        "toolId": event.tool_id,
                        "toolName": event.tool_name,
                    })

                elif isinstance(event, ToolResult):
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "tool-result",
                        "toolId": event.tool_id,
                        "toolName": event.tool_name,
                        "status": event.status,
                    })

                elif isinstance(event, ChatDone):
                    record.cost = event.cost
                    record.usage = event.usage
                    record.state = AgentState.REVIEW
                    await self._set_state(agent_id, AgentState.REVIEW)
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "done",
                        "usage": event.usage,
                        "cost": event.cost,
                    })
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "report-review-request",
                        "report": record.report[:500],
                        "cost": record.cost,
                    })

                    from backend.permissions.manager import get_permission_manager
                    if get_permission_manager().get_auto_approve_reports(record.owner_connection_id):
                        await self.approve_report(agent_id)

                elif isinstance(event, ChatError):
                    record.error = event.message
                    record.state = AgentState.ERROR
                    record.final_result = f"Agent error: {event.message}"
                    await self._set_state(agent_id, AgentState.ERROR)
                    record.completion_event.set()
                    await self._send_to_agent(agent_id, {
                        "type": MessageType.CHAT_STREAM,
                        "agentId": agent_id,
                        "event": "error",
                        "message": event.message,
                    })

        except asyncio.CancelledError:
            record.state = AgentState.ERROR
            record.error = "Cancelled"
            record.final_result = "Agent was cancelled."
            await self._set_state(agent_id, AgentState.ERROR)
            record.completion_event.set()
        except Exception as e:
            logger.exception("Agent %s failed: %s", agent_id, e)
            record.state = AgentState.ERROR
            record.error = str(e)
            record.final_result = f"Agent error: {e}"
            await self._set_state(agent_id, AgentState.ERROR)
            record.completion_event.set()

    async def _set_state(self, agent_id: str, state: AgentState) -> None:
        await self._send_to_agent(agent_id, {
            "type": MessageType.AGENT_STATE_CHANGED,
            "agentId": agent_id,
            "state": state.value,
        })


# ── Singleton ───────────────────────────────────────────────────────

_instance: OrchestratorManager | None = None


def get_orchestrator_manager() -> OrchestratorManager:
    global _instance
    if _instance is None:
        _instance = OrchestratorManager()
    return _instance
