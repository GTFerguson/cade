"""Tests for chat session management."""

from __future__ import annotations

import pytest

from backend.chat.session import ChatSession, ChatSessionRegistry


class TestChatSession:
    def test_add_user_message(self):
        session = ChatSession()
        session.add_user_message("Hello")

        messages = session.get_messages()
        assert len(messages) == 1
        assert messages[0].role == "user"
        assert messages[0].content == "Hello"

    def test_streaming_lifecycle(self):
        session = ChatSession()
        session.add_user_message("Hello")

        assert not session.is_streaming

        session.start_response()
        assert session.is_streaming

        session.append_response_chunk("Hi")
        session.append_response_chunk(" there!")
        session.finish_response()

        assert not session.is_streaming

        messages = session.get_messages()
        assert len(messages) == 2
        assert messages[1].role == "assistant"
        assert messages[1].content == "Hi there!"

    def test_history_for_replay(self):
        session = ChatSession()
        session.add_user_message("Hello")
        session.start_response()
        session.append_response_chunk("Hi!")
        session.finish_response()
        session.add_user_message("How are you?")
        session.start_response()
        session.append_response_chunk("Good!")
        session.finish_response()

        history = session.get_history_for_replay()
        assert len(history) == 4
        assert history[0] == {"role": "user", "content": "Hello"}
        assert history[1] == {"role": "assistant", "content": "Hi!"}
        assert history[2] == {"role": "user", "content": "How are you?"}
        assert history[3] == {"role": "assistant", "content": "Good!"}

    def test_empty_response_not_added(self):
        """A response with no chunks should not add an empty message."""
        session = ChatSession()
        session.add_user_message("Hello")
        session.start_response()
        session.finish_response()

        messages = session.get_messages()
        assert len(messages) == 1

    def test_provider_name(self):
        session = ChatSession(provider_name="anthropic")
        assert session.provider_name == "anthropic"
        session.provider_name = "openai"
        assert session.provider_name == "openai"


class TestChatSessionRegistry:
    def test_get_or_create(self):
        registry = ChatSessionRegistry()
        session1 = registry.get_or_create("s1")
        session2 = registry.get_or_create("s1")
        assert session1 is session2

    def test_different_sessions(self):
        registry = ChatSessionRegistry()
        session1 = registry.get_or_create("s1")
        session2 = registry.get_or_create("s2")
        assert session1 is not session2

    def test_remove(self):
        registry = ChatSessionRegistry()
        registry.get_or_create("s1")
        registry.remove("s1")
        assert registry.get("s1") is None

    def test_get_nonexistent(self):
        registry = ChatSessionRegistry()
        assert registry.get("nope") is None
