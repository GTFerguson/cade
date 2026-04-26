"""Orchestrator manager — spawns and tracks agent subprocesses."""

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
from core.backend.providers.base import BaseProvider
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


def _make_worker_provider(
    name: str,
    mode: str,
    working_dir: Path | None,
    connection_id: str,
) -> BaseProvider:
    """Create a LiteLLM APIProvider for a worker agent."""
    import dataclasses
    from core.backend.providers.api_provider import APIProvider
    from core.backend.providers.config import get_providers_config
    from backend.providers.registry import _create_tool_registry
    from backend.prompts import compose_prompt

    providers_cfg = get_providers_config()
    base_name = providers_cfg.default_provider
    base_cfg = providers_cfg.providers.get(base_name)

    # Fall back to first API-type provider if default isn't API
    if base_cfg is None or base_cfg.type != "api":
        base_cfg = next(
            (c for c in providers_cfg.providers.values() if c.type == "api"),
            None,
        )

    if base_cfg is None:
        raise RuntimeError("No API provider configured — cannot spawn LiteLLM worker")

    worker_cfg = dataclasses.replace(
        base_cfg,
        name=f"agent-{name}",
        system_prompt=compose_prompt(mode, working_dir),
    )
    tool_registry = _create_tool_registry(worker_cfg, working_dir, connection_id=connection_id)
    provider = APIProvider(worker_cfg, tool_registry)
    provider.set_mode(mode)
    return provider


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
        self._providers: dict[str, BaseProvider] = {}
        self._connections: dict[str, _ConnectionEntry] = {}
        self._message_queues: dict[str, asyncio.Queue] = {}
        self._guidance_futures: dict[str, asyncio.Future] = {}

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

        # Give the worker its own permission context so its mode is enforced by
        # tool executors. Route permission prompts to the owner's WS connection.
        from backend.permissions.manager import get_permission_manager
        perms = get_permission_manager()
        perms.set_mode(record.mode, connection_id=agent_id)
        owner_fn = perms._send_fns.get(connection_id)
        if owner_fn:
            perms.register_broadcast(agent_id, owner_fn)
        if not perms.get_allow_write(connection_id):
            perms.set_accept_edits(False, connection_id=agent_id)

        self._message_queues[agent_id] = asyncio.Queue()

        # Worker uses agent_id as its connection_id — mode check in file/bash tools
        # will read the worker's own mode rather than the orchestrator's mode
        provider = _make_worker_provider(record.name, record.mode, working_dir, agent_id)
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

    async def request_guidance(self, agent_id: str, question: str) -> str:
        """Called by a worker via its request_guidance MCP tool. Blocks until user responds."""
        loop = asyncio.get_event_loop()
        future: asyncio.Future[str] = loop.create_future()
        self._guidance_futures[agent_id] = future

        await self._send_to_agent(agent_id, {
            "type": MessageType.AGENT_GUIDANCE_REQUEST,
            "agentId": agent_id,
            "question": question,
        })

        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout=3600.0)
        except asyncio.TimeoutError:
            return "No response received (timeout). Continue with your best judgment."
        finally:
            self._guidance_futures.pop(agent_id, None)

    async def respond_guidance(self, agent_id: str, response: str) -> bool:
        """Resolve a pending guidance request from a worker."""
        future = self._guidance_futures.get(agent_id)
        if future is None or future.done():
            return False
        future.set_result(response)
        return True

    async def send_message_to_agent(self, agent_id: str, message: str) -> bool:
        """Send a message to a running agent.

        If the agent is waiting on request_guidance, the message resolves it.
        Otherwise it is queued and picked up when the agent finishes its current turn.
        """
        record = self._agents.get(agent_id)
        if record is None or record.state not in (AgentState.BUSY, AgentState.STARTING):
            return False

        # Resolve a pending guidance request first
        future = self._guidance_futures.get(agent_id)
        if future and not future.done():
            future.set_result(message)
            return True

        # Queue for pickup at the next turn boundary
        queue = self._message_queues.get(agent_id)
        if queue:
            await queue.put(message)
            await self._send_to_agent(agent_id, {
                "type": MessageType.CHAT_STREAM,
                "agentId": agent_id,
                "event": "message-queued",
                "content": message,
            })
            return True

        return False

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
        provider: BaseProvider,
        task: str,
    ) -> None:
        """Run a worker agent, streaming events to the owning connection.

        Supports multi-turn: if the user queues a message while the agent is busy,
        it is injected as a new user turn when the current LLM turn finishes.
        If the agent calls request_guidance(), it blocks until the user responds.
        """
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

            # Outer conversation loop — each iteration is one LLM turn.
            # Continues when a user message is queued after the current turn ends.
            conversation = [ChatMessage(role="user", content=task)]
            accumulated_text = ""

            while True:
                accumulated_text = ""
                got_queued_message = False

                async for event in provider.stream_chat(conversation):
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
                        accumulated_text += event.content
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
                        await self._send_to_agent(agent_id, {
                            "type": MessageType.CHAT_STREAM,
                            "agentId": agent_id,
                            "event": "done",
                            "usage": event.usage,
                            "cost": event.cost,
                        })

                        # Check for a queued user message before going to REVIEW
                        queue = self._message_queues.get(agent_id)
                        if queue and not queue.empty():
                            user_msg = queue.get_nowait()
                            conversation = [
                                ChatMessage(role="user", content=task),
                                ChatMessage(role="assistant", content=accumulated_text),
                                ChatMessage(role="user", content=user_msg),
                            ]
                            await self._send_to_agent(agent_id, {
                                "type": MessageType.CHAT_STREAM,
                                "agentId": agent_id,
                                "event": "user-message",
                                "content": user_msg,
                            })
                            got_queued_message = True
                            break  # restart outer loop with new conversation

                        # No queued messages — agent is done, go to REVIEW
                        record.state = AgentState.REVIEW
                        await self._set_state(agent_id, AgentState.REVIEW)
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
                        return

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
                        return

                if not got_queued_message:
                    # Stream ended without ChatDone — shouldn't happen normally
                    break

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
        finally:
            # Clean up worker's permission context
            from backend.permissions.manager import get_permission_manager
            get_permission_manager().drop_connection(agent_id)
            self._message_queues.pop(agent_id, None)
            self._guidance_futures.pop(agent_id, None)

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
