"""FailoverProvider: transparent failover across multiple providers."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator

from core.backend.providers.base import BaseProvider
from core.backend.providers.errors import error_code, is_failover_code
from core.backend.providers.types import ChatError, ChatEvent, ChatMessage, ProviderCapabilities, SystemInfo

logger = logging.getLogger(__name__)

_INITIAL_COOLDOWN = 60.0  # seconds
_MAX_COOLDOWN = 600.0  # 10 minutes
_BACKOFF_FACTOR = 2.0


class FailoverProvider(BaseProvider):
    """Wraps an ordered list of providers with exponential-backoff cooldown.

    A provider that fails before producing content, with an error another
    provider could plausibly not have (see `is_failover_code`), gets a
    cooldown and the next provider is tried. Other errors reach the user
    straight away. Once content has been passed on, a later error is passed
    on too, because output already sent cannot be withdrawn.
    """

    def __init__(self, name: str, providers: list[BaseProvider]) -> None:
        if not providers:
            raise ValueError("FailoverProvider requires at least one provider")
        self._name = name
        self._providers = providers
        # {provider_name: (expiry_timestamp, next_cooldown_seconds)}
        self._cooldowns: dict[str, tuple[float, float]] = {}

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._providers[0].model

    @property
    def mode(self) -> str:
        # Raises AttributeError when the primary has no mode, so callers that
        # check hasattr(provider, "mode") treat the chain like its primary.
        return self._providers[0].mode

    def set_mode(self, mode: str) -> None:
        """Pass a mode switch to every sub-provider that takes one.

        Any of them may answer the next message, so all must be in the same mode.
        """
        for provider in self._providers:
            if hasattr(provider, "set_mode"):
                provider.set_mode(mode)

    def set_orchestrator(self, enabled: bool) -> None:
        """Pass the orchestrator overlay to every sub-provider that takes it."""
        for provider in self._providers:
            if hasattr(provider, "set_orchestrator"):
                provider.set_orchestrator(enabled)

    def _is_healthy(self, provider: BaseProvider) -> bool:
        """Check if provider is outside its cooldown window."""
        entry = self._cooldowns.get(provider.name)
        if entry is None:
            return True
        expiry, _ = entry
        return time.monotonic() >= expiry

    def _mark_failed(self, provider: BaseProvider) -> None:
        """Mark provider as failed; set exponential-backoff cooldown."""
        entry = self._cooldowns.get(provider.name)
        if entry is None:
            cooldown = _INITIAL_COOLDOWN
        else:
            _, prev_cooldown = entry
            cooldown = min(prev_cooldown * _BACKOFF_FACTOR, _MAX_COOLDOWN)
        self._cooldowns[provider.name] = (time.monotonic() + cooldown, cooldown)
        logger.warning(
            "Provider '%s' marked unhealthy; cooldown %.0fs",
            provider.name,
            cooldown,
        )

    def _mark_healthy(self, provider: BaseProvider) -> None:
        """Clear provider's cooldown entry after successful stream."""
        self._cooldowns.pop(provider.name, None)

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str | None = None,
    ) -> AsyncIterator[ChatEvent]:
        """Stream chat with failover.

        Providers announce themselves with `SystemInfo` before calling the
        model, so an error that follows it has still produced nothing the
        user needs. Leading `SystemInfo` events are held back and released
        with the first other event. If an error comes first, they are dropped
        and the next provider's `SystemInfo` is the one the user sees, which
        keeps the model name in the chat header true.
        """
        # Collect healthy candidates; if all in cooldown, include primary as best-effort
        candidates = [p for p in self._providers if self._is_healthy(p)]
        if not candidates:
            candidates = [self._providers[0]]
            logger.warning("All providers in cooldown; attempting primary '%s'", candidates[0].name)

        last_error = ""
        for provider in candidates:
            held: list[ChatEvent] = []
            released = False
            later_error: ChatError | None = None

            try:
                async for event in provider.stream_chat(messages, system_prompt):
                    if not released:
                        if isinstance(event, SystemInfo):
                            held.append(event)
                            continue
                        if isinstance(event, ChatError) and is_failover_code(event.code):
                            raise _FailOver(event.code, event.message)
                        released = True
                        for info in held:
                            yield info
                        held = []
                    if isinstance(event, ChatError):
                        later_error = event
                    yield event
            except _FailOver as failure:
                self._mark_failed(provider)
                last_error = f"{failure.code}: {failure.message}"
                logger.info("Failing over from '%s' after error %s", provider.name, failure.code)
                continue
            except Exception as e:
                code = error_code(e)
                if is_failover_code(code):
                    self._mark_failed(provider)
                    if not released:
                        last_error = f"{code}: {e}"
                        logger.warning("Provider '%s' raised %s; failing over: %s", provider.name, code, e)
                        continue
                for info in held:
                    yield info
                raise

            # A stream with nothing but SystemInfo still counts as an answer.
            for info in held:
                yield info

            if later_error is None:
                self._mark_healthy(provider)
            elif is_failover_code(later_error.code):
                # The output is already with the user, but the next message
                # should not go back to a provider that is rate limited or down.
                self._mark_failed(provider)
            return

        # All candidates exhausted
        yield ChatError(
            message=f"All providers failed. Last attempted: {candidates[-1].name} ({last_error})",
            code="failover-exhausted",
        )

    def get_capabilities(self) -> ProviderCapabilities:
        """Delegate to primary provider."""
        return self._providers[0].get_capabilities()


class _FailOver(Exception):
    """Raised inside `stream_chat` to leave a provider's stream for the next one."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
