"""Lightweight async event bus for internal component communication.

Provides publish-subscribe between backend components (e.g. chat session
events, tool execution results). No subscribers are wired in Phase 1 —
this is the infrastructure for Phase 2 tool integration.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)

Handler = Callable[["CadeEvent"], Coroutine[Any, Any, None]]


@dataclass
class CadeEvent:
    """An internal event."""

    type: str
    data: dict = field(default_factory=dict)


class EventBus:
    """Async event bus with typed event dispatch."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def on(self, event_type: str, handler: Handler) -> None:
        """Subscribe to an event type."""
        self._handlers[event_type].append(handler)

    def off(self, event_type: str, handler: Handler) -> None:
        """Unsubscribe from an event type."""
        handlers = self._handlers.get(event_type)
        if handlers:
            try:
                handlers.remove(handler)
            except ValueError:
                pass

    async def emit(self, event: CadeEvent) -> None:
        """Emit an event to all subscribers."""
        handlers = self._handlers.get(event.type, [])
        for handler in handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.exception(
                    "Error in event handler for %s: %s", event.type, e,
                )


# Singleton
_event_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """Get the global event bus instance."""
    global _event_bus
    if _event_bus is None:
        _event_bus = EventBus()
    return _event_bus
