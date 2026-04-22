"""Tests for the LiteLLM API provider with mocked completions."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.backend.providers.api_provider import APIProvider
from core.backend.providers.config import ProviderConfig
from core.backend.providers.tool_executor import ToolRegistry
from core.backend.providers.types import (
    ChatDone,
    ChatError,
    ChatMessage,
    TextDelta,
    ToolDefinition,
    ToolResult,
    ToolUseStart,
)


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

    def __init__(self, content: str | None = None, usage=None, finish_reason: str | None = None):
        delta = MagicMock()
        delta.content = content
        delta.tool_calls = None  # Ensure no MagicMock false-positive in tool accumulation check
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = finish_reason
        self.choices = [choice]
        self.usage = usage


class MockToolChunk:
    """Simulates a litellm streaming chunk carrying a tool_calls delta."""

    def __init__(
        self,
        index: int,
        tool_id: str | None = None,
        name: str | None = None,
        arguments: str | None = None,
        finish_reason: str | None = None,
    ):
        tc = MagicMock()
        tc.index = index
        tc.id = tool_id
        tc.function = MagicMock()
        tc.function.name = name
        tc.function.arguments = arguments
        delta = MagicMock()
        delta.content = None
        delta.tool_calls = [tc]
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = finish_reason
        self.choices = [choice]
        self.usage = None


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


@pytest.mark.asyncio
async def test_no_tools_when_registry_is_none():
    """Test that tools are not passed to litellm when registry is None."""
    config = ProviderConfig(
        name="test",
        type="api",
        model="gpt-4o-mini",
        api_key="sk-test",
    )
    provider = APIProvider(config)  # No tool_registry
    chunks = [MockChunk("OK")]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            return_value=MockStreamResponse(chunks)
        )

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

        # Verify no tools in kwargs
        call_kwargs = mock_litellm.acompletion.call_args.kwargs
        assert "tools" not in call_kwargs
        assert "tool_choice" not in call_kwargs


@pytest.mark.asyncio
async def test_tool_use_capability():
    """Test that tool_use capability reflects registry presence."""
    config = ProviderConfig(
        name="test",
        type="api",
        model="gpt-4o-mini",
        api_key="sk-test",
    )

    # Without registry
    provider = APIProvider(config)
    assert provider.get_capabilities().tool_use is False

    # With registry
    registry = ToolRegistry()
    provider_with_tools = APIProvider(config, tool_registry=registry)
    assert provider_with_tools.get_capabilities().tool_use is True


@pytest.mark.asyncio
async def test_tool_definitions_passed_to_litellm():
    """Test that tool definitions are converted and passed to litellm."""
    config = ProviderConfig(
        name="test",
        type="api",
        model="gpt-4o-mini",
        api_key="sk-test",
    )

    # Create registry with a test tool
    class TestExecutor:
        def tool_definitions(self):
            return [
                ToolDefinition(
                    name="test_tool",
                    description="A test tool",
                    parameters_schema={"type": "object", "properties": {}},
                )
            ]

        def execute(self, name: str, arguments: dict) -> str:
            return "test result"

    registry = ToolRegistry()
    executor = TestExecutor()
    registry.register(executor, "test_tool")

    provider = APIProvider(config, tool_registry=registry)
    chunks = [MockChunk("OK")]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            return_value=MockStreamResponse(chunks)
        )

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

        # Check tools in kwargs
        call_kwargs = mock_litellm.acompletion.call_args.kwargs
        assert "tools" in call_kwargs
        assert "tool_choice" in call_kwargs
        assert call_kwargs["tool_choice"] == "auto"
        assert len(call_kwargs["tools"]) == 1
        assert call_kwargs["tools"][0]["function"]["name"] == "test_tool"


@pytest.mark.asyncio
async def test_tool_call_accumulation_and_execution():
    """Test tool call delta accumulation and execution.

    Simulates: tool_id chunk → name+arg chunk → finish chunk → execution.
    """
    config = ProviderConfig(
        name="test",
        type="api",
        model="gpt-4o-mini",
        api_key="sk-test",
    )

    # Registry that just echoes the operation
    class EchoExecutor:
        def tool_definitions(self):
            return [
                ToolDefinition(
                    name="echo",
                    description="Echo tool",
                    parameters_schema={"type": "object", "properties": {}},
                )
            ]

        def execute(self, name: str, arguments: dict) -> str:
            return f"Echo: {arguments}"

    registry = ToolRegistry()
    executor = EchoExecutor()
    registry.register(executor, "echo")

    provider = APIProvider(config, tool_registry=registry)

    # Simulate streamed tool calls across chunks
    # JSON is split across: {"text", ":", " hello", "}
    chunks = [
        MockToolChunk(index=0, tool_id="call_1", name="echo", arguments='{"text', finish_reason=None),
        MockToolChunk(index=0, tool_id=None, name=None, arguments='": "hello', finish_reason=None),
        MockToolChunk(index=0, tool_id=None, name=None, arguments='"}', finish_reason="tool_calls"),
        MockChunk("OK", finish_reason=None),  # Next turn: model response
    ]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        # First call: tool_calls, Second call: text response
        mock_litellm.acompletion = AsyncMock(
            side_effect=[
                MockStreamResponse(chunks[:3]),  # tool_calls
                MockStreamResponse(chunks[3:]),  # text response
            ]
        )

        messages = [ChatMessage(role="user", content="Say hello")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

        # Verify events
        tool_starts = [e for e in events if isinstance(e, ToolUseStart)]
        assert len(tool_starts) == 1
        assert tool_starts[0].tool_name == "echo"
        assert tool_starts[0].tool_input == {"text": "hello"}

        tool_results = [e for e in events if isinstance(e, ToolResult)]
        assert len(tool_results) == 1
        assert tool_results[0].tool_name == "echo"
        assert "Echo:" in tool_results[0].content

        text_events = [e for e in events if isinstance(e, TextDelta)]
        assert len(text_events) == 1

        done_events = [e for e in events if isinstance(e, ChatDone)]
        assert len(done_events) == 1


@pytest.mark.asyncio
async def test_tool_execution_error_handling():
    """Test that executor errors are propagated as ToolResult with error status."""
    config = ProviderConfig(
        name="test",
        type="api",
        model="gpt-4o-mini",
        api_key="sk-test",
    )

    # Registry with executor that returns error
    registry = ToolRegistry()

    class ErrorExecutor:
        def tool_definitions(self):
            return [
                ToolDefinition(
                    name="bad_tool",
                    description="Tool that errors",
                    parameters_schema={"type": "object", "properties": {}},
                )
            ]

        def execute(self, name: str, arguments: dict) -> str:
            return "Error: something went wrong"

    executor = ErrorExecutor()
    registry.register(executor, "bad_tool")

    provider = APIProvider(config, tool_registry=registry)

    chunks = [
        MockToolChunk(index=0, tool_id="call_1", name="bad_tool", arguments="{}", finish_reason="tool_calls"),
        MockChunk("Handled", finish_reason=None),
    ]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            side_effect=[
                MockStreamResponse(chunks[:1]),
                MockStreamResponse(chunks[1:]),
            ]
        )

        messages = [ChatMessage(role="user", content="Try bad tool")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

        tool_results = [e for e in events if isinstance(e, ToolResult)]
        assert len(tool_results) == 1
        assert tool_results[0].status == "error"
        assert "Error:" in tool_results[0].content


@pytest.mark.asyncio
async def test_invalid_json_arguments_handled():
    """Test that malformed JSON in tool arguments is handled gracefully."""
    config = ProviderConfig(
        name="test",
        type="api",
        model="gpt-4o-mini",
        api_key="sk-test",
    )

    registry = ToolRegistry()

    class DummyExecutor:
        def tool_definitions(self):
            return [
                ToolDefinition(
                    name="test",
                    description="Test",
                    parameters_schema={"type": "object", "properties": {}},
                )
            ]

        def execute(self, name: str, arguments: dict) -> str:
            return f"Args: {arguments}"

    executor = DummyExecutor()
    registry.register(executor, "test")

    provider = APIProvider(config, tool_registry=registry)

    # Tool call with malformed JSON (unclosed brace)
    chunks = [
        MockToolChunk(index=0, tool_id="call_1", name="test", arguments='{"bad":', finish_reason="tool_calls"),
        MockChunk("OK", finish_reason=None),
    ]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            side_effect=[
                MockStreamResponse(chunks[:1]),
                MockStreamResponse(chunks[1:]),
            ]
        )

        messages = [ChatMessage(role="user", content="Call with bad JSON")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

        tool_results = [e for e in events if isinstance(e, ToolResult)]
        assert len(tool_results) == 1
        # Should handle gracefully: tool_input would be {}
        assert "Args: {}" in tool_results[0].content


@pytest.mark.asyncio
async def test_max_tool_turns_guard():
    """Test that excessive tool loops are prevented."""
    config = ProviderConfig(
        name="test",
        type="api",
        model="gpt-4o-mini",
        api_key="sk-test",
    )

    registry = ToolRegistry()

    class DummyExecutor:
        def tool_definitions(self):
            return [
                ToolDefinition(
                    name="dummy",
                    description="Dummy",
                    parameters_schema={"type": "object", "properties": {}},
                )
            ]

        def execute(self, name: str, arguments: dict) -> str:
            return "OK"

    executor = DummyExecutor()
    registry.register(executor, "dummy")

    provider = APIProvider(config, tool_registry=registry)

    # Create a chain of tool_calls responses that exceeds _MAX_TOOL_TURNS
    chunks_list = [
        [MockToolChunk(index=0, tool_id=f"call_{i}", name="dummy", arguments="{}", finish_reason="tool_calls")]
        for i in range(15)  # More than _MAX_TOOL_TURNS (10)
    ]

    with patch("core.backend.providers.api_provider.litellm") as mock_litellm:
        mock_litellm.acompletion = AsyncMock(
            side_effect=[MockStreamResponse(c) for c in chunks_list]
        )

        messages = [ChatMessage(role="user", content="Loop forever")]
        events = []
        async for event in provider.stream_chat(messages):
            events.append(event)

        # Should hit max turns and yield ChatError
        errors = [e for e in events if isinstance(e, ChatError)]
        assert len(errors) == 1
        assert "maximum" in errors[0].message.lower() or "exceed" in errors[0].message.lower()
