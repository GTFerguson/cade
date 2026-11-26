"""Tests for FailoverProvider."""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import litellm
import pytest

from core.backend.providers.api_provider import APIProvider
from core.backend.providers.config import ProviderConfig
from core.backend.providers.failover_provider import (
    FailoverProvider,
    _BACKOFF_FACTOR,
    _INITIAL_COOLDOWN,
    _MAX_COOLDOWN,
)
from core.backend.providers.types import ChatDone, ChatError, ChatMessage, ProviderCapabilities, SystemInfo, TextDelta


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
            [ChatError(message="Primary failed", code="429")],
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
                ChatError(message="Post-output error", code="429"),
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
            [ChatError(message="Primary failed", code="429")],
        )
        fallback = MockProvider(
            "fallback",
            [ChatError(message="Fallback failed", code="429")],
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
            [ChatError(message="Failed", code="429")],
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
            [ChatError(message="Failed", code="429")],
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
        primary = MockProvider("primary", [ChatError(message="Fail", code="429")])
        fallback = MockProvider("fallback", [ChatError(message="Fail", code="429")])

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


# --- Sub-providers that announce themselves first ---
#
# APIProvider yields SystemInfo before it calls the model, so a failed call
# arrives as SystemInfo followed by ChatError. Failover has to look past the
# SystemInfo to see that nothing the user cares about was produced.


def _system_info(model: str) -> SystemInfo:
    return SystemInfo(model=model, session_id="", tools=[], slash_commands=[], version="1.0")


async def _collect(provider, messages=None) -> list:
    messages = messages or [ChatMessage(role="user", content="Hi")]
    return [event async for event in provider.stream_chat(messages)]


@pytest.mark.asyncio
async def test_fails_over_when_error_follows_system_info():
    primary = MockProvider(
        "primary",
        [_system_info("model-primary"), ChatError(message="rate limited", code="429")],
    )
    fallback = MockProvider(
        "fallback",
        [_system_info("model-fallback"), TextDelta(content="Fallback OK"), ChatDone()],
    )
    failover = FailoverProvider("combined", [primary, fallback])

    events = await _collect(failover)

    assert fallback._stream_calls == 1
    assert primary.name in failover._cooldowns
    # Only the fallback's SystemInfo reaches the user, so the chat header
    # names the model that actually answered.
    infos = [e for e in events if isinstance(e, SystemInfo)]
    assert [i.model for i in infos] == ["model-fallback"]
    assert not any(isinstance(e, ChatError) for e in events)
    assert [type(e) for e in events] == [SystemInfo, TextDelta, ChatDone]


@pytest.mark.asyncio
async def test_system_info_is_released_with_first_content_event():
    primary = MockProvider(
        "primary",
        [_system_info("model-primary"), TextDelta(content="Hello"), ChatDone()],
    )
    failover = FailoverProvider("combined", [primary, MockProvider("fallback")])

    events = await _collect(failover)

    assert [type(e) for e in events] == [SystemInfo, TextDelta, ChatDone]
    assert events[0].model == "model-primary"
    assert failover._cooldowns == {}


@pytest.mark.asyncio
async def test_post_output_rate_limit_is_passed_on_and_cools_the_provider():
    primary = MockProvider(
        "primary",
        [_system_info("m"), TextDelta(content="Partial"), ChatError(message="429", code="429")],
    )
    fallback = MockProvider("fallback", [TextDelta(content="never"), ChatDone()])
    failover = FailoverProvider("combined", [primary, fallback])

    events = await _collect(failover)

    assert [type(e) for e in events] == [SystemInfo, TextDelta, ChatError]
    assert fallback._stream_calls == 0
    assert primary.name in failover._cooldowns


@pytest.mark.asyncio
async def test_exhausted_error_carries_the_last_failure():
    primary = MockProvider("primary", [_system_info("a"), ChatError(message="slow down", code="429")])
    fallback = MockProvider("fallback", [_system_info("b"), ChatError(message="upstream down", code="503")])
    failover = FailoverProvider("combined", [primary, fallback])

    events = await _collect(failover)

    assert len(events) == 1
    assert events[0].code == "failover-exhausted"
    assert "upstream down" in events[0].message


# --- Which errors fail over ---
#
# Driven through a real APIProvider with litellm.acompletion raising, so the
# test covers the code APIProvider builds from the exception as well as the
# decision FailoverProvider makes on it.

_REQ = httpx.Request("POST", "https://example.invalid")


def _resp(status: int) -> httpx.Response:
    return httpx.Response(status, request=_REQ)


_FAILOVER_ERRORS = {
    "rate-limit": lambda: litellm.RateLimitError("slow down", "p", "m", response=_resp(429)),
    "server-error": lambda: litellm.InternalServerError("boom", "p", "m", response=_resp(500)),
    "bad-gateway": lambda: litellm.BadGatewayError("bad gateway", "p", "m", response=_resp(502)),
    "unavailable": lambda: litellm.ServiceUnavailableError("down", "p", "m", response=_resp(503)),
    "timeout": lambda: litellm.Timeout("timed out", "m", "p"),
    "connection": lambda: litellm.APIConnectionError("refused", "p", "m"),
}

_USER_ERRORS = {
    "bad-request": lambda: litellm.BadRequestError("bad", "m", "p", response=_resp(400)),
    "auth": lambda: litellm.AuthenticationError("bad key", "p", "m", response=_resp(401)),
    "forbidden": lambda: litellm.PermissionDeniedError("no", "p", "m", response=_resp(403)),
    "not-found": lambda: litellm.NotFoundError("no model", "m", "p", response=_resp(404)),
    "context-length": lambda: litellm.ContextWindowExceededError("too long", "m", "p", response=_resp(400)),
}


def _api_provider(name: str) -> APIProvider:
    return APIProvider(ProviderConfig(name=name, type="api", model=f"model-{name}"))


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", sorted(_FAILOVER_ERRORS))
async def test_api_provider_error_fails_over(kind):
    exc = _FAILOVER_ERRORS[kind]()
    fallback = MockProvider(
        "fallback", [_system_info("model-fallback"), TextDelta(content="OK"), ChatDone()]
    )
    failover = FailoverProvider("combined", [_api_provider("primary"), fallback])

    with patch(
        "core.backend.providers.api_provider.litellm.acompletion",
        new=AsyncMock(side_effect=exc),
    ), patch("core.backend.providers.api_provider.asyncio.sleep", new=AsyncMock()):
        events = await _collect(failover)

    assert fallback._stream_calls == 1
    assert "primary" in failover._cooldowns
    assert [e.model for e in events if isinstance(e, SystemInfo)] == ["model-fallback"]
    assert not any(isinstance(e, ChatError) for e in events)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", sorted(_USER_ERRORS))
async def test_api_provider_error_reaches_user_without_failover(kind):
    exc = _USER_ERRORS[kind]()
    fallback = MockProvider("fallback", [TextDelta(content="never"), ChatDone()])
    failover = FailoverProvider("combined", [_api_provider("primary"), fallback])

    with patch(
        "core.backend.providers.api_provider.litellm.acompletion",
        new=AsyncMock(side_effect=exc),
    ):
        events = await _collect(failover)

    assert fallback._stream_calls == 0
    assert failover._cooldowns == {}
    errors = [e for e in events if isinstance(e, ChatError)]
    assert len(errors) == 1
    assert errors[0].code != "failover-exhausted"


class _RaisingProvider(MockProvider):
    """Yields SystemInfo, then raises, as an error mid-stream would."""

    def __init__(self, name: str, exc: Exception):
        super().__init__(name)
        self._exc = exc

    async def stream_chat(self, messages, system_prompt=None):
        self._stream_calls += 1
        yield _system_info(f"model-{self._name}")
        raise self._exc


@pytest.mark.asyncio
async def test_raised_retryable_error_fails_over():
    primary = _RaisingProvider("primary", _FAILOVER_ERRORS["unavailable"]())
    fallback = MockProvider("fallback", [TextDelta(content="OK"), ChatDone()])
    failover = FailoverProvider("combined", [primary, fallback])

    events = await _collect(failover)

    assert fallback._stream_calls == 1
    assert "primary" in failover._cooldowns
    assert [type(e) for e in events] == [TextDelta, ChatDone]


@pytest.mark.asyncio
async def test_raised_user_error_propagates_without_failover():
    primary = _RaisingProvider("primary", _USER_ERRORS["auth"]())
    fallback = MockProvider("fallback", [TextDelta(content="never"), ChatDone()])
    failover = FailoverProvider("combined", [primary, fallback])

    with pytest.raises(litellm.AuthenticationError):
        await _collect(failover)

    assert fallback._stream_calls == 0
    assert failover._cooldowns == {}


# --- Per-provider settings reach every sub-provider ---


class _ModalProvider(MockProvider):
    def __init__(self, name: str):
        super().__init__(name)
        self._mode = "code"
        self.orchestrator = False

    @property
    def mode(self) -> str:
        return self._mode

    def set_mode(self, mode: str) -> None:
        self._mode = mode

    def set_orchestrator(self, enabled: bool) -> None:
        self.orchestrator = enabled


def test_set_mode_reaches_every_sub_provider():
    subs = [_ModalProvider("a"), _ModalProvider("b")]
    failover = FailoverProvider("combined", subs)

    failover.set_mode("architect")

    assert [s.mode for s in subs] == ["architect", "architect"]
    assert failover.mode == "architect"


def test_set_orchestrator_reaches_every_sub_provider():
    subs = [_ModalProvider("a"), _ModalProvider("b")]
    failover = FailoverProvider("combined", subs)

    failover.set_orchestrator(True)

    assert [s.orchestrator for s in subs] == [True, True]


def test_setters_skip_sub_providers_without_them():
    plain = MockProvider("plain")
    modal = _ModalProvider("modal")
    failover = FailoverProvider("combined", [plain, modal])

    failover.set_mode("review")
    failover.set_orchestrator(True)

    assert modal.mode == "review"
    assert modal.orchestrator is True
    # The primary has no mode, so neither does the chain.
    assert not hasattr(failover, "mode")
