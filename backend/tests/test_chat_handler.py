"""Tests for WebSocket chat message handling with mocked provider."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.providers.config import ProviderConfig, ProvidersConfig
from backend.providers.registry import ProviderRegistry
from backend.providers.types import ChatDone, ChatError, TextDelta


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
    from backend.chat.session import ChatSession

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

    await handler._handle_chat_message({
        "type": "chat-message",
        "content": "Hi",
    })

    stream_msgs = [m for m in ws.sent if m.get("type") == "chat-stream"]
    assert len(stream_msgs) == 1
    assert stream_msgs[0]["event"] == "error"
    assert "No provider configured" in stream_msgs[0]["message"]
