"""Chat session with message history using langchain-core types."""

from __future__ import annotations

import logging

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from backend.providers.types import ChatMessage

logger = logging.getLogger(__name__)


class ChatSession:
    """Manages conversation history and streaming state for a chat session."""

    def __init__(self, provider_name: str = "") -> None:
        self._messages: list[BaseMessage] = []
        self._streaming = False
        self._current_response: list[str] = []
        self._provider_name = provider_name

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @provider_name.setter
    def provider_name(self, value: str) -> None:
        self._provider_name = value

    @property
    def is_streaming(self) -> bool:
        return self._streaming

    def add_user_message(self, content: str) -> None:
        """Add a user message to the conversation."""
        self._messages.append(HumanMessage(content=content))

    def start_response(self) -> None:
        """Mark the beginning of a streamed assistant response."""
        self._streaming = True
        self._current_response = []

    def append_response_chunk(self, chunk: str) -> None:
        """Accumulate a streaming chunk."""
        self._current_response.append(chunk)

    def finish_response(self) -> None:
        """Finalize the streamed response into a complete assistant message."""
        content = "".join(self._current_response)
        if content:
            self._messages.append(AIMessage(content=content))
        self._streaming = False
        self._current_response = []

    def get_messages(self) -> list[ChatMessage]:
        """Get all messages as ChatMessage DTOs for the provider."""
        result: list[ChatMessage] = []
        for msg in self._messages:
            if isinstance(msg, HumanMessage):
                result.append(ChatMessage(role="user", content=msg.content))
            elif isinstance(msg, AIMessage):
                result.append(ChatMessage(role="assistant", content=msg.content))
            elif isinstance(msg, SystemMessage):
                result.append(ChatMessage(role="system", content=msg.content))
        return result

    def get_history_for_replay(self) -> list[dict]:
        """Get message history for sending to frontend on reconnect."""
        result: list[dict] = []
        for msg in self._messages:
            if isinstance(msg, HumanMessage):
                result.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                result.append({"role": "assistant", "content": msg.content})
        return result


class ChatSessionRegistry:
    """Registry for chat sessions, keyed by connection/session ID."""

    def __init__(self) -> None:
        self._sessions: dict[str, ChatSession] = {}

    def get_or_create(self, session_id: str, provider_name: str = "") -> ChatSession:
        """Get existing session or create a new one."""
        if session_id not in self._sessions:
            self._sessions[session_id] = ChatSession(provider_name=provider_name)
        return self._sessions[session_id]

    def get(self, session_id: str) -> ChatSession | None:
        """Get a session by ID."""
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        """Remove a session."""
        self._sessions.pop(session_id, None)


# Singleton
_chat_registry: ChatSessionRegistry | None = None


def get_chat_registry() -> ChatSessionRegistry:
    """Get the global chat session registry."""
    global _chat_registry
    if _chat_registry is None:
        _chat_registry = ChatSessionRegistry()
    return _chat_registry
