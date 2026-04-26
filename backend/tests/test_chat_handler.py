"""Tests for WebSocket chat message handling with mocked provider."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.backend.providers.config import ProviderConfig, ProvidersConfig
from backend.providers.registry import ProviderRegistry
from core.backend.providers.types import ChatDone, ChatError, TextDelta


class MockWebSocket:
    """Minimal WebSocket mock for testing chat handlers."""

    def __init__(self):
        self.sent: list[dict] = []
        self.scope = {"query_string": b"token=test"}

    async def send_json(self, data: dict):
        self.sent.append(data)

    async def accept(self):
        pass

    async def close(self, code=None, reason=None):
        pass


def make_provider_config() -> ProvidersConfig:
    """Create a test provider config."""
    return ProvidersConfig(
        providers={
            "test": ProviderConfig(
                name="test",
                type="api",
                model="test-model",
                api_key="sk-test",
            ),
        },
        default_provider="test",
    )


@pytest.mark.asyncio
async def test_chat_stream_sends_text_deltas():
    """Test that chat-message triggers streaming text-delta events."""
    from core.backend.chat.session import ChatSession

    # Create a mock provider that yields known events
    mock_provider = MagicMock()
    mock_provider.name = "test"
    mock_provider.model = "test-model"

    async def fake_stream(messages, system_prompt=None):
        yield TextDelta(content="Hello")
        yield TextDelta(content=" world")
        yield ChatDone(usage={"prompt_tokens": 10})

    mock_provider.stream_chat = fake_stream

    # Build a registry with our mock
    registry = ProviderRegistry()
    registry.register("test", mock_provider)

    ws = MockWebSocket()

    # Import and instantiate a minimal ConnectionHandler
    # We'll test the handler methods directly
    from backend.websocket import ConnectionHandler

    config = MagicMock()
    config.working_dir = "/tmp"
    handler = ConnectionHandler(ws, config)
    handler._closed = False
    handler._provider_registry = registry
    handler._session_id = "test-session"
    handler._current_mode = "code"

    # Simulate chat-message
    await handler._handle_chat_message({
        "type": "chat-message",
        "content": "Hi there",
    })

    # Wait for the background task to complete
    if handler._chat_task is not None:
        await handler._chat_task

    # Verify events were sent
    stream_msgs = [m for m in ws.sent if m.get("type") == "chat-stream"]
    assert len(stream_msgs) == 3

    assert stream_msgs[0]["event"] == "text-delta"
    assert stream_msgs[0]["content"] == "Hello"

    assert stream_msgs[1]["event"] == "text-delta"
    assert stream_msgs[1]["content"] == " world"

    assert stream_msgs[2]["event"] == "done"
    assert stream_msgs[2]["usage"]["prompt_tokens"] == 10


@pytest.mark.asyncio
async def test_chat_stream_sends_error():
    """Test that provider errors result in error events."""
    mock_provider = MagicMock()
    mock_provider.name = "test"

    async def fake_stream(messages, system_prompt=None):
        yield ChatError(message="Rate limited", code="429")

    mock_provider.stream_chat = fake_stream

    registry = ProviderRegistry()
    registry.register("test", mock_provider)

    ws = MockWebSocket()

    from backend.websocket import ConnectionHandler

    config = MagicMock()
    config.working_dir = "/tmp"
    handler = ConnectionHandler(ws, config)
    handler._closed = False
    handler._provider_registry = registry
    handler._session_id = "test-session"
    handler._current_mode = "code"

    await handler._handle_chat_message({
        "type": "chat-message",
        "content": "Hi",
    })

    if handler._chat_task is not None:
        await handler._chat_task

    stream_msgs = [m for m in ws.sent if m.get("type") == "chat-stream"]
    assert any(m["event"] == "error" and "Rate limited" in m["message"] for m in stream_msgs)


@pytest.mark.asyncio
async def test_no_provider_returns_error():
    """Test that missing provider config returns an error."""
    ws = MockWebSocket()

    from backend.websocket import ConnectionHandler

    config = MagicMock()
    config.working_dir = "/tmp"
    handler = ConnectionHandler(ws, config)
    handler._closed = False
    handler._provider_registry = ProviderRegistry()
    handler._session_id = "test-session"
    handler._current_mode = "code"

    await handler._handle_chat_message({
        "type": "chat-message",
        "content": "Hi",
    })

    stream_msgs = [m for m in ws.sent if m.get("type") == "chat-stream"]
    assert len(stream_msgs) == 1
    assert stream_msgs[0]["event"] == "error"
    assert "No provider configured" in stream_msgs[0]["message"]


# --- /clear and /compact regression tests ---

def _make_handler(ws, working_dir: str = "/tmp") -> "ConnectionHandler":
    from backend.websocket import ConnectionHandler
    config = MagicMock()
    config.working_dir = working_dir
    handler = ConnectionHandler(ws, config)
    handler._closed = False
    handler._session_id = "test-session"
    handler._current_mode = "code"
    return handler


@pytest.mark.asyncio
async def test_clear_wipes_session_and_sends_compact(tmp_path):
    """/clear resets the session and sends chat-compact with empty context."""
    ws = MockWebSocket()
    handler = _make_handler(ws, str(tmp_path))

    # Seed a session with some history first
    from core.backend.chat.session import get_chat_registry
    registry = get_chat_registry()
    session = registry.get_or_create("test-session", provider_name="test")
    session.add_user_message("hello")
    session.add_assistant_message("hi there")
    handler._chat_session = session

    await handler._do_clear()

    compact_msgs = [m for m in ws.sent if m.get("type") == "chat-compact"]
    assert len(compact_msgs) == 1
    assert compact_msgs[0]["context"] == ""

    # Session should be fresh — no history
    assert len(handler._chat_session.get_messages()) == 0


@pytest.mark.asyncio
async def test_compact_approved_resets_session_and_sends_opening(tmp_path):
    """/compact: approved preview resets session and sends opening message with file path."""
    ws = MockWebSocket()
    handler = _make_handler(ws, str(tmp_path))

    # Seed a session with an assistant message (the generated handoff)
    from core.backend.chat.session import get_chat_registry
    registry = get_chat_registry()
    session = registry.get_or_create("test-session-compact", provider_name="test")
    session.add_user_message("please compact")
    session.add_assistant_message("# Handoff\nWe built the context bar.")
    handler._chat_session = session
    handler._session_id = "test-session-compact"

    # Run _do_compact as a task, then approve it
    task = asyncio.create_task(handler._do_compact())
    await asyncio.sleep(0)  # let it reach the future await

    assert handler._compact_preview_future is not None
    preview_msgs = [m for m in ws.sent if m.get("type") == "compact-preview"]
    assert len(preview_msgs) == 1
    assert "context bar" in preview_msgs[0]["content"]
    assert preview_msgs[0]["filePath"] is not None

    # Approve
    handler._compact_preview_future.set_result(True)
    await task

    compact_msgs = [m for m in ws.sent if m.get("type") == "chat-compact"]
    assert len(compact_msgs) == 1
    assert compact_msgs[0]["filePath"] is not None
    # Opening message mentions the file path
    assert compact_msgs[0]["filePath"] in compact_msgs[0]["context"]

    # Old session replaced — fresh history
    assert len(handler._chat_session.get_messages()) == 1  # seeded assistant message

    # Handoff file exists on disk
    handoff_files = list((tmp_path / "docs" / "plans" / "handoff").glob("*.md"))
    assert len(handoff_files) == 1
    assert "context bar" in handoff_files[0].read_text()


@pytest.mark.asyncio
async def test_compact_rejected_leaves_session_intact(tmp_path):
    """/compact: rejected preview does not reset the session."""
    ws = MockWebSocket()
    handler = _make_handler(ws, str(tmp_path))

    from core.backend.chat.session import get_chat_registry
    registry = get_chat_registry()
    session = registry.get_or_create("test-session-reject", provider_name="test")
    session.add_user_message("compact please")
    session.add_assistant_message("# Handoff\nSome work done.")
    handler._chat_session = session
    handler._session_id = "test-session-reject"

    task = asyncio.create_task(handler._do_compact())
    await asyncio.sleep(0)

    # Reject
    handler._compact_preview_future.set_result(False)
    await task

    # No chat-compact should have been sent
    compact_msgs = [m for m in ws.sent if m.get("type") == "chat-compact"]
    assert len(compact_msgs) == 0

    # Session unchanged — original messages still there
    assert len(handler._chat_session.get_messages()) == 2


@pytest.mark.asyncio
async def test_compact_preview_resolved_routes_to_future():
    """compact-preview-resolved message resolves the pending future."""
    ws = MockWebSocket()
    handler = _make_handler(ws)

    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    handler._compact_preview_future = fut

    await handler._handle_message({"type": "compact-preview-resolved", "approved": True})

    assert fut.done()
    assert fut.result() is True


@pytest.mark.asyncio
async def test_chat_clear_message_triggers_clear():
    """chat-clear message from client triggers _do_clear."""
    ws = MockWebSocket()
    handler = _make_handler(ws)

    handler._closed = False
    handler._provider_registry = ProviderRegistry()

    await handler._handle_message({"type": "chat-clear"})

    compact_msgs = [m for m in ws.sent if m.get("type") == "chat-compact"]
    assert len(compact_msgs) == 1
    assert compact_msgs[0]["context"] == ""
