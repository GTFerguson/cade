"""LiteLLM-based API provider for any supported LLM."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import litellm

from backend.providers.base import BaseProvider
from backend.providers.config import ProviderConfig
from backend.providers.types import (
    ChatDone,
    ChatError,
    ChatEvent,
    ChatMessage,
    ProviderCapabilities,
    TextDelta,
)

logger = logging.getLogger(__name__)

# Suppress litellm's verbose logging
litellm.suppress_debug_info = True


class APIProvider(BaseProvider):
    """Provider that calls LLM APIs via LiteLLM."""

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        self._name = config.name
        self._model = config.model

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str | None = None,
    ) -> AsyncIterator[ChatEvent]:
        """Stream a chat completion via LiteLLM."""
        litellm_messages: list[dict] = []

        if system_prompt:
            litellm_messages.append({"role": "system", "content": system_prompt})

        for msg in messages:
            litellm_messages.append({"role": msg.role, "content": msg.content})

        kwargs: dict = {
            "model": self._model,
            "messages": litellm_messages,
            "stream": True,
        }

        if self._config.api_key:
            kwargs["api_key"] = self._config.api_key

        if self._config.region:
            kwargs["aws_region_name"] = self._config.region

        # Pass through extra config
        for key, value in self._config.extra.items():
            kwargs[key] = value

        try:
            response = await litellm.acompletion(**kwargs)

            last_chunk = None
            async for chunk in response:
                last_chunk = chunk
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yield TextDelta(content=delta.content)

            usage = {}
            if last_chunk is not None and hasattr(last_chunk, "usage") and last_chunk.usage:
                usage = {
                    "prompt_tokens": getattr(last_chunk.usage, "prompt_tokens", 0),
                    "completion_tokens": getattr(last_chunk.usage, "completion_tokens", 0),
                }

            yield ChatDone(usage=usage)

        except Exception as e:
            logger.exception("LiteLLM streaming error: %s", e)
            yield ChatError(
                message=str(e),
                code=str(getattr(e, "status_code", "unknown")),
            )

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            streaming=True,
            tool_use=False,
            vision=False,
        )
