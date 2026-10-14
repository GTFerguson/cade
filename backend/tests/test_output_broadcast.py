"""Tests for per-terminal output fan-out, sequenced replay and size policy.

One reader per PTY feeds a sequenced ring buffer that any number of attached
clients subscribe to. A reconnecting client hands back the last sequence it
saw and receives only what it missed; a client that fell too far behind gets
a cold attach instead. The PTY has one size at a time, owned by the client
that last typed.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from backend.models import TerminalSize
from backend.protocol import SessionKey
from backend.terminal.pty import PTYManager
from backend.terminal.sessions import (
    MAX_SCROLLBACK_SIZE,
    SUBSCRIBER_QUEUE_LIMIT,
    PTYSession,
    TerminalState,
)


def make_mock_pty(alive: bool = True) -> AsyncMock:
    pty = AsyncMock(spec=PTYManager)
    pty.is_alive.return_value = alive
    return pty


class TestPublish:
    def test_chunks_are_sequenced_from_one(self):
        ts = TerminalState(pty=make_mock_pty())
        assert ts.last_seq == 0
        ts.publish("a")
        ts.publish("b")
        assert ts.last_seq == 2
        assert ts.get_scrollback() == "ab"

    def test_every_subscriber_receives_every_chunk(self):
        ts = TerminalState(pty=make_mock_pty())
        first, _ = ts.subscribe(None)
        second, _ = ts.subscribe(None)
        ts.publish("x")
        ts.publish("y")
        assert first.drain() == [(1, "x"), (2, "y")]
        assert second.drain() == [(1, "x"), (2, "y")]

    def test_unsubscribed_queue_stops_receiving(self):
        ts = TerminalState(pty=make_mock_pty())
        sub, _ = ts.subscribe(None)
        ts.unsubscribe(sub)
        ts.publish("x")
        assert sub.drain() == []

    def test_trimming_keeps_sequence_numbers(self):
        ts = TerminalState(pty=make_mock_pty())
        chunk = "x" * 1024
        for _ in range((MAX_SCROLLBACK_SIZE // 1024) + 10):
            ts.publish(chunk)
        assert ts.first_seq > 1
        assert ts.last_seq == (MAX_SCROLLBACK_SIZE // 1024) + 10
        assert ts.scrollback_size <= MAX_SCROLLBACK_SIZE


class TestReplay:
    def test_unknown_position_is_cold_attach(self):
        ts = TerminalState(pty=make_mock_pty())
        ts.publish("a")
        _, replay = ts.subscribe(None)
        assert replay is None

    def test_delta_replay_after_known_position(self):
        ts = TerminalState(pty=make_mock_pty())
        for c in "abcd":
            ts.publish(c)
        _, replay = ts.subscribe(2)
        assert replay == [(3, "c"), (4, "d")]

    def test_up_to_date_client_gets_empty_replay(self):
        ts = TerminalState(pty=make_mock_pty())
        ts.publish("a")
        _, replay = ts.subscribe(1)
        assert replay == []

    def test_position_ahead_of_buffer_is_cold(self):
        """A seq the terminal never produced (e.g. from a restarted backend)
        cannot be trusted, so the client is re-synced from scratch."""
        ts = TerminalState(pty=make_mock_pty())
        ts.publish("a")
        _, replay = ts.subscribe(5)
        assert replay is None

    def test_position_before_buffer_start_is_cold(self):
        ts = TerminalState(pty=make_mock_pty())
        chunk = "x" * 1024
        for _ in range((MAX_SCROLLBACK_SIZE // 1024) + 10):
            ts.publish(chunk)
        _, replay = ts.subscribe(1)
        assert replay is None

    def test_fresh_terminal_with_zero_position_is_warm(self):
        ts = TerminalState(pty=make_mock_pty())
        _, replay = ts.subscribe(0)
        assert replay == []


class TestSlowSubscriber:
    def test_overflowing_subscriber_is_dropped_not_blocked(self):
        ts = TerminalState(pty=make_mock_pty())
        sub, _ = ts.subscribe(None)
        for i in range(SUBSCRIBER_QUEUE_LIMIT + 5):
            ts.publish(str(i))
        items = sub.drain()
        assert sub.dropped is True
        # The sentinel is the last thing delivered so the consumer can resync.
        assert items[-1] is None
        assert sub not in ts.subscribers


class TestReader:
    @pytest.mark.asyncio
    async def test_reader_publishes_then_signals_eof(self):
        pty = make_mock_pty()

        async def fake_read():
            yield "one"
            yield "two"

        pty.read = fake_read
        ts = TerminalState(pty=pty)
        sub, _ = ts.subscribe(None)
        ts.ensure_reader()
        await asyncio.wait_for(ts.output_task, timeout=1)
        assert ts.exited is True
        assert sub.drain() == [(1, "one"), (2, "two"), None]

    @pytest.mark.asyncio
    async def test_ensure_reader_is_idempotent(self):
        pty = make_mock_pty()

        async def fake_read():
            await asyncio.sleep(10)
            yield ""

        pty.read = fake_read
        ts = TerminalState(pty=pty)
        ts.ensure_reader()
        task = ts.output_task
        ts.ensure_reader()
        assert ts.output_task is task
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_late_subscriber_sees_eof(self):
        pty = make_mock_pty()

        async def fake_read():
            yield "one"

        pty.read = fake_read
        ts = TerminalState(pty=pty)
        ts.ensure_reader()
        await asyncio.wait_for(ts.output_task, timeout=1)
        sub, replay = ts.subscribe(1)
        assert replay == []
        assert sub.drain() == [None]


class TestSizePolicy:
    def _session(self) -> tuple[PTYSession, TerminalState]:
        session = PTYSession(id="s", project_path=__import__("pathlib").Path("/tmp"))
        ts = session.add_terminal(SessionKey.CLAUDE, make_mock_pty())
        return session, ts

    @pytest.mark.asyncio
    async def test_first_client_sizes_an_unowned_terminal(self):
        session, ts = self._session()
        applied = await session.request_size(SessionKey.CLAUDE, "phone", TerminalSize(cols=40, rows=20))
        assert applied is True
        assert ts.size == TerminalSize(cols=40, rows=20)
        ts.pty.resize.assert_awaited_once_with(40, 20)

    @pytest.mark.asyncio
    async def test_non_controller_resize_is_refused(self):
        session, ts = self._session()
        await session.claim_control(SessionKey.CLAUDE, "desktop")
        await session.request_size(SessionKey.CLAUDE, "desktop", TerminalSize(cols=200, rows=50))
        applied = await session.request_size(SessionKey.CLAUDE, "phone", TerminalSize(cols=40, rows=20))
        assert applied is False
        assert ts.size == TerminalSize(cols=200, rows=50)

    @pytest.mark.asyncio
    async def test_typing_takes_control_and_applies_that_clients_size(self):
        session, ts = self._session()
        await session.claim_control(SessionKey.CLAUDE, "desktop")
        await session.request_size(SessionKey.CLAUDE, "desktop", TerminalSize(cols=200, rows=50))
        await session.request_size(SessionKey.CLAUDE, "phone", TerminalSize(cols=40, rows=20))

        changed = await session.claim_control(SessionKey.CLAUDE, "phone")
        assert changed is True
        assert ts.controller == "phone"
        assert ts.size == TerminalSize(cols=40, rows=20)

    @pytest.mark.asyncio
    async def test_reclaiming_control_is_a_noop(self):
        session, ts = self._session()
        await session.claim_control(SessionKey.CLAUDE, "desktop")
        changed = await session.claim_control(SessionKey.CLAUDE, "desktop")
        assert changed is False

    @pytest.mark.asyncio
    async def test_controller_leaving_releases_the_terminal(self):
        session, ts = self._session()
        await session.claim_control(SessionKey.CLAUDE, "desktop")
        session.release_client("desktop")
        assert ts.controller is None
        applied = await session.request_size(SessionKey.CLAUDE, "phone", TerminalSize(cols=40, rows=20))
        assert applied is True

    @pytest.mark.asyncio
    async def test_unchanged_size_is_not_reapplied(self):
        session, ts = self._session()
        await session.request_size(SessionKey.CLAUDE, "desktop", TerminalSize(cols=80, rows=24))
        await session.request_size(SessionKey.CLAUDE, "desktop", TerminalSize(cols=80, rows=24))
        assert ts.pty.resize.await_count == 1

    @pytest.mark.asyncio
    async def test_repaint_nudge_resizes_down_and_back(self):
        session, ts = self._session()
        await session.request_size(SessionKey.CLAUDE, "desktop", TerminalSize(cols=80, rows=24))
        await session.nudge_repaint(SessionKey.CLAUDE)
        calls = [c.args for c in ts.pty.resize.await_args_list]
        assert calls == [(80, 24), (80, 23), (80, 24)]
        assert ts.size == TerminalSize(cols=80, rows=24)

    @pytest.mark.asyncio
    async def test_repaint_without_known_size_is_noop(self):
        session, ts = self._session()
        await session.nudge_repaint(SessionKey.CLAUDE)
        ts.pty.resize.assert_not_awaited()
