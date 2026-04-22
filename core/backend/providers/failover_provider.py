"""FailoverProvider: transparent failover across multiple providers."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator

from core.backend.providers.base import BaseProvider
from core.backend.providers.types import ChatDone, ChatError, ChatEvent, ChatMessage, ProviderCapabilities

logger = logging.getLogger(__name__)

_INITIAL_COOLDOWN = 60.0  # seconds
_MAX_COOLDOWN = 600.0  # 10 minutes
_BACKOFF_FACTOR = 2.0


class FailoverProvider(BaseProvider):
    """Wraps an ordered list of providers with exponential-backoff cooldown.

    On any provider failure (before output), marks it with an exponential-backoff
    cooldown and tries the next provider in the list. Failures that occur
    after partial output are propagated as-is (can't un-yield).
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

        Tries providers in order. Fails over on error before any output.
        Post-output errors are propagated as-is.
        """
        # Collect healthy candidates; if all in cooldown, include primary as best-effort
        candidates = [p for p in self._providers if self._is_healthy(p)]
        if not candidates:
            candidates = [self._providers[0]]
            logger.warning("All providers in cooldown; attempting primary '%s'", candidates[0].name)

        for provider in candidates:
            yielded_any = False
            had_error = False

            try:
                async for event in provider.stream_chat(messages, system_prompt):
                    if isinstance(event, ChatError) and not yielded_any:
                        # Error before any output — fail over instead of propagating
                        had_error = True
                        break

                    yield event
                    yielded_any = True

                if not had_error:
                    self._mark_healthy(provider)
                    return  # Success

                # Provider returned ChatError before output
                self._mark_failed(provider)
                logger.info("Failing over from '%s' due to pre-output ChatError", provider.name)

            except Exception as e:
                self._mark_failed(provider)
                logger.warning("Provider '%s' raised exception: %s", provider.name, e)
                # Continue to next provider

        # All candidates exhausted
        yield ChatError(
            message=f"All providers failed. Last attempted: {candidates[-1].name}",
            code="failover-exhausted",
        )

    def get_capabilities(self) -> ProviderCapabilities:
        """Delegate to primary provider."""
        return self._providers[0].get_capabilities()
