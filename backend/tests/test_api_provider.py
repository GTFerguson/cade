"""Tests for the LiteLLM API provider with mocked completions."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.backend.providers.api_provider import APIProvider
from core.backend.providers.config import ProviderConfig
from core.backend.providers.types import ChatDone, ChatError, ChatMessage, TextDelta


@pytest.fixture
def provider() -> APIProvider:
    """Create an API provider with test config."""
    config = ProviderConfig(
        name="test",
        type="api",
        model="claude-sonnet-4-6",
        api_key="sk-test",
    )
    return APIProvider(config)


class MockChunk:
    """Simulates a litellm streaming chunk."""

    def __init__(self, content: str | None = None, usage=None):
        delta = MagicMock()
        delta.content = content
        choice = MagicMock()
        choice.delta = delta
        self.choices = [choice]
        self.usage = usage


class MockStreamResponse:
    """Async iterator that yields mock chunks."""

    def __init__(self, chunks: list[MockChunk]):
        self._chunks = chunks
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk


@pytest.mark.asyncio
async def test_stream_chat_yields_text_deltas(provider: APIProvider):
    """Test that streaming produces TextDelta events."""
    chunks = [
        MockChunk("Hello"),
        MockChunk(", "),
        MockChunk("world!"),
        MockChunk(None),  # Final chunk with no content
    ]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            return_value=MockStreamResponse(chunks)
        )

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

    text_events = [e for e in events if isinstance(e, TextDelta)]
    assert len(text_events) == 3
    assert text_events[0].content == "Hello"
    assert text_events[1].content == ", "
    assert text_events[2].content == "world!"

    done_events = [e for e in events if isinstance(e, ChatDone)]
    assert len(done_events) == 1


@pytest.mark.asyncio
async def test_stream_chat_handles_error(provider: APIProvider):
    """Test that errors produce ChatError events."""
    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            side_effect=Exception("API rate limited")
        )

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

    assert len(events) == 1
    assert isinstance(events[0], ChatError)
    assert "rate limited" in events[0].message


@pytest.mark.asyncio
async def test_stream_chat_includes_system_prompt(provider: APIProvider):
    """Test that system prompt is prepended to messages."""
    chunks = [MockChunk("OK")]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            return_value=MockStreamResponse(chunks)
        )

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in provider.stream_chat(messages, system_prompt="Be helpful"):
            events.append(event)

        # Check the messages passed to litellm
        call_kwargs = mock_litellm.acompletion.call_args.kwargs
        assert call_kwargs["messages"][0] == {"role": "system", "content": "Be helpful"}
        assert call_kwargs["messages"][1] == {"role": "user", "content": "Hi"}
