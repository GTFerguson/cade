"""Tests for FailoverProvider."""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.backend.providers.failover_provider import (
    FailoverProvider,
    _BACKOFF_FACTOR,
    _INITIAL_COOLDOWN,
    _MAX_COOLDOWN,
)
from core.backend.providers.types import ChatDone, ChatError, ChatMessage, ProviderCapabilities, TextDelta


class MockProvider:
    """Mock provider for testing."""

    def __init__(self, name: str, stream_result=None):
        self._name = name
        self._model = f"model-{name}"
        self._stream_result = stream_result or []
        self._stream_calls = 0

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    async def stream_chat(self, messages, system_prompt=None):
        """Stream chat by yielding pre-defined events."""
        self._stream_calls += 1
        for event in self._stream_result:
            yield event

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(streaming=True, tool_use=False, vision=False)


class TestFailoverProvider:
    """Tests for FailoverProvider."""

    def test_requires_at_least_one_provider(self):
        """Test that FailoverProvider requires at least one provider."""
        with pytest.raises(ValueError, match="requires at least one"):
            FailoverProvider("failover", [])

    def test_delegates_model_to_primary(self):
        """Test that model property delegates to primary provider."""
        primary = MockProvider("primary")
        fallback = MockProvider("fallback")

        failover = FailoverProvider("combined", [primary, fallback])
        assert failover.model == "model-primary"

    def test_delegates_capabilities_to_primary(self):
        """Test that get_capabilities delegates to primary."""
        primary = MockProvider("primary")
        fallback = MockProvider("fallback")

        failover = FailoverProvider("combined", [primary, fallback])
        caps = failover.get_capabilities()
        assert caps.streaming is True

    @pytest.mark.asyncio
    async def test_primary_success(self):
        """Test that successful primary response is returned."""
        primary = MockProvider(
            "primary",
            [
                TextDelta(content="Hello"),
                ChatDone(),
            ],
        )
        fallback = MockProvider("fallback")

        failover = FailoverProvider("combined", [primary, fallback])

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in failover.stream_chat(messages):
            events.append(event)

        assert len(events) == 2
        assert isinstance(events[0], TextDelta)
        assert isinstance(events[1], ChatDone)
        assert primary._stream_calls == 1
        assert fallback._stream_calls == 0

    @pytest.mark.asyncio
    async def test_failover_on_pre_output_chat_error(self):
        """Test failover when primary yields ChatError before any output."""
        primary = MockProvider(
            "primary",
            [ChatError(message="Primary failed", code="error")],
        )
        fallback = MockProvider(
            "fallback",
            [TextDelta(content="Fallback OK"), ChatDone()],
        )

        failover = FailoverProvider("combined", [primary, fallback])

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in failover.stream_chat(messages):
            events.append(event)

        # Primary's error should not be yielded; fallback should succeed
        assert len(events) == 2
        assert isinstance(events[0], TextDelta)
        assert events[0].content == "Fallback OK"
        assert primary._stream_calls == 1
        assert fallback._stream_calls == 1

    @pytest.mark.asyncio
    async def test_no_failover_on_post_output_chat_error(self):
        """Test that errors after output are propagated, not failed over."""
        primary = MockProvider(
            "primary",
            [
                TextDelta(content="Partial"),
                ChatError(message="Post-output error", code="error"),
            ],
        )
        fallback = MockProvider("fallback")

        failover = FailoverProvider("combined", [primary, fallback])

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in failover.stream_chat(messages):
            events.append(event)

        # Primary's partial output AND error should be yielded
        assert len(events) == 2
        assert isinstance(events[0], TextDelta)
        assert isinstance(events[1], ChatError)
        assert fallback._stream_calls == 0

    @pytest.mark.asyncio
    async def test_all_providers_exhausted(self):
        """Test that all-providers failure yields final error."""
        primary = MockProvider(
            "primary",
            [ChatError(message="Primary failed", code="error")],
        )
        fallback = MockProvider(
            "fallback",
            [ChatError(message="Fallback failed", code="error")],
        )

        failover = FailoverProvider("combined", [primary, fallback])

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in failover.stream_chat(messages):
            events.append(event)

        assert len(events) == 1
        assert isinstance(events[0], ChatError)
        assert "failover-exhausted" in events[0].code

    @pytest.mark.asyncio
    async def test_cooldown_skips_failed_provider(self):
        """Test that failed provider is skipped on next call due to cooldown."""
        primary = MockProvider(
            "primary",
            [ChatError(message="Failed", code="error")],
        )
        fallback = MockProvider(
            "fallback",
            [TextDelta(content="OK"), ChatDone()],
        )

        failover = FailoverProvider("combined", [primary, fallback])

        # First call: primary fails, falls back to secondary
        messages = [ChatMessage(role="user", content="Hi")]
        events1 = []
        async for event in failover.stream_chat(messages):
            events1.append(event)

        # Second call immediately after: primary should be in cooldown, skip to fallback
        events2 = []
        async for event in failover.stream_chat(messages):
            events2.append(event)

        # Both calls should succeed via fallback
        assert len(events1) == 2
        assert len(events2) == 2
        # Primary should only be called once (first call)
        assert primary._stream_calls == 1
        # Fallback called twice
        assert fallback._stream_calls == 2

    @pytest.mark.asyncio
    async def test_cooldown_expiry_allows_retry(self):
        """Test that provider is retried after cooldown expires."""
        primary = MockProvider(
            "primary",
            [ChatError(message="Failed", code="error")],
        )
        fallback = MockProvider(
            "fallback",
            [TextDelta(content="OK"), ChatDone()],
        )

        failover = FailoverProvider("combined", [primary, fallback])

        # First call: primary fails
        messages = [ChatMessage(role="user", content="Hi")]
        async for event in failover.stream_chat(messages):
            pass

        # Verify primary is in cooldown
        assert primary.name in failover._cooldowns

        # Patch time.monotonic to return a time far in the future (simulating cooldown expiry)
        current_time = time.monotonic()
        future_time = current_time + _INITIAL_COOLDOWN + 10

        with patch("core.backend.providers.failover_provider.time.monotonic") as mock_time:
            mock_time.return_value = future_time

            # Second call: primary should be tried again
            events2 = []
            async for event in failover.stream_chat(messages):
                events2.append(event)

            # Primary should be attempted (still fails), falls back to fallback
            assert primary._stream_calls == 2

    @pytest.mark.asyncio
    async def test_exponential_backoff(self):
        """Test that repeated failures increase cooldown exponentially."""
        # Create providers that both fail so primary gets retried
        primary = MockProvider("primary", [ChatError(message="Fail", code="error")])
        fallback = MockProvider("fallback", [ChatError(message="Fail", code="error")])

        failover = FailoverProvider("combined", [primary, fallback])

        cooldowns = []

        # Three failed requests: each time primary gets marked with increased cooldown
        for i in range(3):
            messages = [ChatMessage(role="user", content="Hi")]
            async for event in failover.stream_chat(messages):
                pass

            if primary.name in failover._cooldowns:
                _, cooldown_secs = failover._cooldowns[primary.name]
                cooldowns.append(cooldown_secs)

        # Cooldowns should follow exponential backoff
        assert len(cooldowns) == 3
        # Second cooldown should be roughly 2x the first
        assert cooldowns[1] >= cooldowns[0] * _BACKOFF_FACTOR
        # Third cooldown should be roughly 2x the second
        assert cooldowns[2] >= cooldowns[1] * _BACKOFF_FACTOR
        # But all should be capped at MAX_COOLDOWN
        assert all(c <= _MAX_COOLDOWN for c in cooldowns)

    @pytest.mark.asyncio
    async def test_all_in_cooldown_tries_primary(self):
        """Test that primary is attempted when all providers are in cooldown."""
        primary = MockProvider(
            "primary",
            [TextDelta(content="Primary OK"), ChatDone()],
        )
        fallback = MockProvider("fallback")

        failover = FailoverProvider("combined", [primary, fallback])

        # Manually mark all providers in cooldown
        far_future = time.monotonic() + 1000
        failover._cooldowns[primary.name] = (far_future, 100)
        failover._cooldowns[fallback.name] = (far_future, 100)

        messages = [ChatMessage(role="user", content="Hi")]
        events = []
        async for event in failover.stream_chat(messages):
            events.append(event)

        # Primary should be attempted (best-effort recovery)
        assert primary._stream_calls == 1
        assert len(events) == 2
