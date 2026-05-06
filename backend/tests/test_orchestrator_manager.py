"""Tests for OrchestratorManager — mode enforcement, messaging, multi-turn."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.orchestrator.manager import OrchestratorManager
from backend.orchestrator.models import AgentRecord, AgentSpec, AgentState
from backend.protocol import MessageType


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_manager() -> OrchestratorManager:
    return OrchestratorManager()


def _sent_events(messages: list[dict]) -> list[str]:
    """Extract 'event' or 'type' field from broadcast messages."""
    return [m.get("event") or m.get("type") for m in messages]


async def _collect_broadcasts(manager: OrchestratorManager, connection_id: str) -> list[dict]:
    """Register a broadcast collector and return the list it populates."""
    collected: list[dict] = []

    async def capture(msg: dict) -> None:
        collected.append(msg)

    manager.register_connection(connection_id, capture)
    # Also register in PermissionManager so guidance routing works
    from backend.permissions.manager import get_permission_manager
    get_permission_manager().register_broadcast(connection_id, capture)
    return collected


# ── name slugify / resolve ────────────────────────────────────────────────────

class TestSlugify:
    def test_basic_kebab_passes_through(self):
        from backend.orchestrator.manager import _slugify
        assert _slugify("test-writer") == "test-writer"

    def test_uppercase_and_spaces(self):
        from backend.orchestrator.manager import _slugify
        assert _slugify("Test Writer") == "test-writer"

    def test_collapses_special_chars(self):
        from backend.orchestrator.manager import _slugify
        assert _slugify("auth_refactor!! v2") == "auth-refactor-v2"

    def test_strips_leading_trailing_separators(self):
        from backend.orchestrator.manager import _slugify
        assert _slugify("--hello--") == "hello"

    def test_empty_returns_empty(self):
        from backend.orchestrator.manager import _slugify
        assert _slugify("") == ""
        assert _slugify("!!!") == ""

    def test_truncates_to_max_len(self):
        from backend.orchestrator.manager import _slugify
        out = _slugify("a" * 100, max_len=10)
        assert out == "a" * 10

    def test_truncate_does_not_leave_trailing_hyphen(self):
        from backend.orchestrator.manager import _slugify
        # Cut would land mid-separator; trailing '-' is stripped
        out = _slugify("hello world foo", max_len=12)
        assert out == "hello-world"


class TestResolveName:
    def test_uses_spec_name_when_clean(self):
        from backend.orchestrator.manager import _resolve_name
        assert _resolve_name("refactor", "long task", set()) == "refactor"

    def test_falls_back_to_task_when_name_empty(self):
        from backend.orchestrator.manager import _resolve_name
        assert _resolve_name("", "Refactor the auth layer", set()) == "refactor-the-auth-layer"

    def test_falls_back_to_default_when_all_empty(self):
        from backend.orchestrator.manager import _resolve_name
        assert _resolve_name("", "", set()) == "agent"
        assert _resolve_name("???", "!!!", set()) == "agent"

    def test_appends_suffix_on_collision(self):
        from backend.orchestrator.manager import _resolve_name
        assert _resolve_name("worker", "t", {"worker"}) == "worker-2"
        assert _resolve_name("worker", "t", {"worker", "worker-2"}) == "worker-3"

    def test_skips_used_suffixes(self):
        from backend.orchestrator.manager import _resolve_name
        taken = {"worker", "worker-2", "worker-3"}
        assert _resolve_name("worker", "t", taken) == "worker-4"


# ── spawn_agent ───────────────────────────────────────────────────────────────

class TestSpawnAgent:
    @pytest.mark.asyncio
    async def test_blocked_when_orchestrator_toggle_off(self):
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-1")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_mode("code", connection_id="conn-1")
        pm.set_orchestrator(False, connection_id="conn-1")

        with pytest.raises(ValueError, match="orchestrator mode"):
            await manager.spawn_agent(AgentSpec("bot", "Do X"), connection_id="conn-1")

    @pytest.mark.asyncio
    async def test_blocked_when_subagents_disabled(self):
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-2")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_orchestrator(True, connection_id="conn-2")
        pm.set_permission("allowSubagents", False, connection_id="conn-2")

        with pytest.raises(ValueError, match="disabled"):
            await manager.spawn_agent(AgentSpec("bot", "Do X"), connection_id="conn-2")

    @pytest.mark.asyncio
    async def test_creates_record_in_pending_state(self):
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-3")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_orchestrator(True, connection_id="conn-3")
        pm.set_permission("allowSubagents", True, connection_id="conn-3")

        record = await manager.spawn_agent(
            AgentSpec("worker", "Do something"), connection_id="conn-3"
        )
        assert record.state == AgentState.PENDING
        assert record.name == "worker"
        assert record.owner_connection_id == "conn-3"

    @pytest.mark.asyncio
    async def test_normalizes_name_to_kebab_case(self):
        manager = _make_manager()
        collected = await _collect_broadcasts(manager, "conn-norm")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_orchestrator(True, connection_id="conn-norm")
        pm.set_permission("allowSubagents", True, connection_id="conn-norm")

        record = await manager.spawn_agent(
            AgentSpec("Test Writer!", "Write tests"), connection_id="conn-norm"
        )
        assert record.name == "test-writer"
        assert record.agent_id.startswith("agent-test-writer-")
        # Approval-request event reflects the resolved name
        approval = next(m for m in collected if m.get("event") == "agent-approval-request")
        assert approval["name"] == "test-writer"

    @pytest.mark.asyncio
    async def test_falls_back_to_task_slug_when_name_empty(self):
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-fb")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_orchestrator(True, connection_id="conn-fb")
        pm.set_permission("allowSubagents", True, connection_id="conn-fb")

        record = await manager.spawn_agent(
            AgentSpec("", "Refactor auth layer"), connection_id="conn-fb"
        )
        assert record.name == "refactor-auth-layer"

    @pytest.mark.asyncio
    async def test_dedupes_active_agent_names(self):
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-dup")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_orchestrator(True, connection_id="conn-dup")
        pm.set_permission("allowSubagents", True, connection_id="conn-dup")

        r1 = await manager.spawn_agent(AgentSpec("worker", "A"), connection_id="conn-dup")
        r2 = await manager.spawn_agent(AgentSpec("worker", "B"), connection_id="conn-dup")
        r3 = await manager.spawn_agent(AgentSpec("worker", "C"), connection_id="conn-dup")

        assert r1.name == "worker"
        assert r2.name == "worker-2"
        assert r3.name == "worker-3"

    @pytest.mark.asyncio
    async def test_reuses_name_after_agent_closed(self):
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-reuse")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_orchestrator(True, connection_id="conn-reuse")
        pm.set_permission("allowSubagents", True, connection_id="conn-reuse")

        r1 = await manager.spawn_agent(AgentSpec("worker", "A"), connection_id="conn-reuse")
        assert r1.name == "worker"
        # Mark the first agent as terminal
        manager._agents[r1.agent_id].state = AgentState.CLOSED

        r2 = await manager.spawn_agent(AgentSpec("worker", "B"), connection_id="conn-reuse")
        assert r2.name == "worker"  # CLOSED agents free up the name


# ── approve_agent — mode enforcement ─────────────────────────────────────────

class TestApproveAgentModeEnforcement:
    @pytest.mark.asyncio
    async def test_worker_gets_own_mode_in_permission_manager(self):
        """approve_agent must register the worker's mode under its own agent_id."""
        manager = _make_manager()
        collected = await _collect_broadcasts(manager, "conn-mode")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_orchestrator(True, connection_id="conn-mode")
        pm.set_permission("allowSubagents", True, connection_id="conn-mode")

        record = await manager.spawn_agent(
            AgentSpec("planner", "Plan it", mode="plan"), connection_id="conn-mode"
        )
        agent_id = record.agent_id

        # Patch _make_worker_provider to avoid actually spawning a provider
        mock_provider = MagicMock()
        mock_provider.stream_chat = AsyncMock(return_value=_never_yields())

        with patch("backend.orchestrator.manager._make_worker_provider", return_value=mock_provider):
            await manager.approve_agent(agent_id)

        # Worker's own connection_id should have mode="plan"
        assert pm.get_mode(agent_id) == "plan"

    @pytest.mark.asyncio
    async def test_worker_mode_independent_of_parent_mode(self):
        """Parent mode is unaffected by worker; worker gets its own mode."""
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-iso")

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_mode("code", connection_id="conn-iso")
        pm.set_orchestrator(True, connection_id="conn-iso")
        pm.set_permission("allowSubagents", True, connection_id="conn-iso")

        record = await manager.spawn_agent(
            AgentSpec("researcher", "Research", mode="research"), connection_id="conn-iso"
        )

        mock_provider = MagicMock()
        mock_provider.stream_chat = AsyncMock(return_value=_never_yields())

        with patch("backend.orchestrator.manager._make_worker_provider", return_value=mock_provider):
            await manager.approve_agent(record.agent_id)

        assert pm.get_mode("conn-iso") == "code"
        assert pm.get_mode(record.agent_id) == "research"


# ── send_message_to_agent ─────────────────────────────────────────────────────

class TestSendMessageToAgent:
    @pytest.mark.asyncio
    async def test_queues_message_when_no_guidance_pending(self):
        manager = _make_manager()
        collected = await _collect_broadcasts(manager, "conn-q")

        agent_id = "agent-q-334455"
        manager._agents[agent_id] = AgentRecord(
            agent_id=agent_id, name="test", task="t", mode="code",
            state=AgentState.BUSY, owner_connection_id="conn-q",
        )
        manager._message_queues[agent_id] = asyncio.Queue()

        result = await manager.send_message_to_agent(agent_id, "Steer left")

        assert result is True
        assert not manager._message_queues[agent_id].empty()
        msg = await manager._message_queues[agent_id].get()
        assert msg == "Steer left"

    @pytest.mark.asyncio
    async def test_returns_false_when_agent_not_running(self):
        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-nr")

        agent_id = "agent-done-667788"
        manager._agents[agent_id] = AgentRecord(
            agent_id=agent_id, name="test", task="t", mode="code",
            state=AgentState.REVIEW, owner_connection_id="conn-nr",
        )

        result = await manager.send_message_to_agent(agent_id, "Too late")
        assert result is False


# ── _run_agent multi-turn ─────────────────────────────────────────────────────

class TestRunAgentMultiTurn:
    @pytest.mark.asyncio
    async def test_queued_message_triggers_second_turn(self):
        """When a message is queued before ChatDone, _run_agent continues conversation."""
        from core.backend.providers.types import (
            ChatDone, ChatMessage, SystemInfo, TextDelta,
        )

        manager = _make_manager()
        collected = await _collect_broadcasts(manager, "conn-mt")

        agent_id = "agent-mt-aabbcc"
        manager._agents[agent_id] = AgentRecord(
            agent_id=agent_id, name="worker", task="Do task",
            mode="code", state=AgentState.PENDING, owner_connection_id="conn-mt",
        )
        manager._message_queues[agent_id] = asyncio.Queue()

        turn1_events = [
            SystemInfo(model="test", session_id="", tools=[], slash_commands=[], version="1"),
            TextDelta(content="Turn 1 output"),
            ChatDone(usage={}),
        ]
        turn2_events = [
            TextDelta(content="Turn 2 output"),
            ChatDone(usage={}),
        ]

        call_count = 0

        async def fake_stream(messages, system_prompt=None):
            nonlocal call_count
            call_count += 1
            events = turn1_events if call_count == 1 else turn2_events
            # Queue the steering message just before ChatDone on turn 1
            if call_count == 1:
                for evt in events[:-1]:
                    yield evt
                await manager._message_queues[agent_id].put("Now focus on Y")
                yield events[-1]
            else:
                for evt in events:
                    yield evt

        mock_provider = MagicMock()
        mock_provider.stream_chat = fake_stream

        from backend.permissions.manager import get_permission_manager
        get_permission_manager().set_mode("code", connection_id=agent_id)

        await manager._run_agent(agent_id, mock_provider, "Do task")

        assert call_count == 2  # two turns happened
        text_events = [m for m in collected if m.get("event") == "text-delta"]
        text_contents = [m["content"] for m in text_events]
        assert "Turn 1 output" in text_contents
        assert "Turn 2 output" in text_contents

    @pytest.mark.asyncio
    async def test_no_queued_message_goes_to_review(self):
        """Without queued messages, agent finishes in REVIEW state."""
        from core.backend.providers.types import ChatDone, SystemInfo, TextDelta

        manager = _make_manager()
        collected = await _collect_broadcasts(manager, "conn-rev")

        agent_id = "agent-rev-112233"
        manager._agents[agent_id] = AgentRecord(
            agent_id=agent_id, name="worker", task="Do task",
            mode="code", state=AgentState.PENDING, owner_connection_id="conn-rev",
        )
        manager._message_queues[agent_id] = asyncio.Queue()

        async def fake_stream(messages, system_prompt=None):
            yield SystemInfo(model="m", session_id="", tools=[], slash_commands=[], version="1")
            yield TextDelta(content="Done.")
            yield ChatDone(usage={})

        mock_provider = MagicMock()
        mock_provider.stream_chat = fake_stream

        from backend.permissions.manager import get_permission_manager
        get_permission_manager().set_mode("code", connection_id=agent_id)

        await manager._run_agent(agent_id, mock_provider, "Do task")

        record = manager._agents[agent_id]
        assert record.state == AgentState.REVIEW

    @pytest.mark.asyncio
    async def test_permission_context_cleaned_up_after_run(self):
        """Worker's permission state is dropped when _run_agent exits."""
        from core.backend.providers.types import ChatDone, TextDelta

        manager = _make_manager()
        await _collect_broadcasts(manager, "conn-clean")

        agent_id = "agent-clean-998877"
        manager._agents[agent_id] = AgentRecord(
            agent_id=agent_id, name="w", task="t",
            mode="plan", state=AgentState.PENDING, owner_connection_id="conn-clean",
        )
        manager._message_queues[agent_id] = asyncio.Queue()

        from backend.permissions.manager import get_permission_manager
        pm = get_permission_manager()
        pm.set_mode("plan", connection_id=agent_id)

        async def fake_stream(messages, system_prompt=None):
            yield TextDelta(content="x")
            yield ChatDone(usage={})

        mock_provider = MagicMock()
        mock_provider.stream_chat = fake_stream

        await manager._run_agent(agent_id, mock_provider, "t")

        # State for this agent_id should have been dropped
        assert agent_id not in pm._states


# ── Parallel tool execution in APIProvider ────────────────────────────────────

class TestParallelToolExecution:
    @pytest.mark.asyncio
    async def test_two_tools_run_concurrently(self):
        """Both ToolUseStart events appear before either ToolResult."""
        from core.backend.providers.api_provider import APIProvider
        from core.backend.providers.config import ProviderConfig
        from core.backend.providers.tool_executor import ToolRegistry
        from core.backend.providers.types import (
            ChatDone, ChatMessage, ToolDefinition, ToolResult, ToolUseStart,
        )
        from unittest.mock import patch, AsyncMock

        config = ProviderConfig(name="t", type="api", model="m", api_key="k")
        registry = ToolRegistry()

        barrier = asyncio.Event()
        call_order: list[str] = []

        class SlowTool:
            def tool_definitions(self):
                return [ToolDefinition(name=n, description=n,
                                       parameters_schema={"type": "object", "properties": {}})
                        for n in ("tool_a", "tool_b")]

            async def execute_async(self, name: str, arguments: dict) -> str:
                call_order.append(f"start:{name}")
                await asyncio.sleep(0.01)
                call_order.append(f"end:{name}")
                return f"result:{name}"

        executor = SlowTool()
        for defn in executor.tool_definitions():
            registry.register(executor, defn.name)
        # Register under names so execute_async routing works
        registry._executors["tool_a"] = executor
        registry._executors["tool_b"] = executor

        provider = APIProvider(config, tool_registry=registry)

        from backend.tests.test_api_provider import MockToolChunk, MockChunk, MockStreamResponse
        # Two parallel tool calls in one response
        chunks_turn1 = [
            MockToolChunk(0, "id_a", "tool_a", "{}", None),
            MockToolChunk(1, "id_b", "tool_b", "{}", "tool_calls"),
        ]
        chunks_turn2 = [MockChunk("Done")]

        with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
            mock_litellm.acompletion = AsyncMock(side_effect=[
                MockStreamResponse(chunks_turn1),
                MockStreamResponse(chunks_turn2),
            ])

            events = []
            async for evt in provider.stream_chat([ChatMessage(role="user", content="go")]):
                events.append(evt)

        starts = [e for e in events if isinstance(e, ToolUseStart)]
        results = [e for e in events if isinstance(e, ToolResult)]

        assert len(starts) == 2
        assert len(results) == 2

        # Both starts come before any result (concurrent execution pattern)
        start_indices = [events.index(s) for s in starts]
        result_indices = [events.index(r) for r in results]
        assert max(start_indices) < min(result_indices)

        # Both tools actually ran (order may vary with concurrency)
        assert set(call_order) == {"start:tool_a", "end:tool_a", "start:tool_b", "end:tool_b"}


# ── Async generator helpers ───────────────────────────────────────────────────

async def _never_yields():
    """Async generator that yields nothing — for mocking stalled providers."""
    return
    yield  # makes this an async generator
