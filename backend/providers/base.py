"""Base provider abstract class."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from backend.providers.types import ChatEvent, ChatMessage, ProviderCapabilities

# (event_type, payload) — event_type is provider-defined ("connected",
# "scene_update", "chat_history", etc); payload is the parsed JSON frame
# minus the `type` field. Registered by the connection handler so
# unsolicited server-pushed frames can land in chat as assistant-only
# messages or history replays.
UnsolicitedEventHandler = Callable[[str, dict[str, Any]], Awaitable[None]]


class BaseProvider(ABC):
    """Abstract base class for LLM providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name."""
        ...

    @property
    @abstractmethod
    def model(self) -> str:
        """Model identifier."""
        ...

    @abstractmethod
    def stream_chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str | None = None,
    ) -> AsyncIterator[ChatEvent]:
        """Stream a chat response.

        Args:
            messages: Conversation history.
            system_prompt: Optional system prompt.

        Yields:
            ChatEvent instances (TextDelta, ChatDone, ChatError).
        """
        ...

    def get_capabilities(self) -> ProviderCapabilities:
        """Return provider capabilities."""
        return ProviderCapabilities()

    async def start(self) -> None:
        """Open any persistent resources the provider needs (e.g. WebSocket
        connection to a game server). Default: no-op for request/response
        providers like SubprocessProvider and APIProvider."""
        return

    async def stop(self) -> None:
        """Close any persistent resources. Default: no-op."""
        return

    def set_event_handler(self, handler: UnsolicitedEventHandler | None) -> None:
        """Register a callback for unsolicited server-pushed events (frames
        that aren't responses to a specific stream_chat call). Default: no-op;
        providers that don't emit unsolicited events can ignore this."""
        return

    async def send_frame(self, frame: dict[str, Any]) -> None:
        """Send an arbitrary frame over the provider's persistent channel to
        the server. Used by interactive dashboard panels that need to dispatch
        actions (trade commits, macro triggers) to the server without routing
        through chat.

        Default: raises NotImplementedError. Only providers with a persistent
        engine channel (WebsocketProvider) implement this. Request/response
        providers (APIProvider, ClaudeCodeProvider, per-turn SubprocessProvider)
        can't support it and leave the default.
        """
        raise NotImplementedError(
            f"Provider '{self.name}' does not support send_frame; "
            f"interactive panels require a provider with a persistent "
            f"engine connection (e.g. WebsocketProvider)"
        )
