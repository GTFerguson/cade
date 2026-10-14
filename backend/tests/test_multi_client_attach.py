"""Connection-handler tests for several clients sharing one PTY session.

Covers attach (warm delta vs cold scrollback), fan-out to every client,
the one-size policy as seen on the wire, liveness ping and the session list.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from backend.config import Config
from backend.protocol import MessageType, SessionKey
from backend.terminal.pty import PTYManager
from backend.terminal.sessions import PTYSession, SessionRegistry, set_registry
from backend.websocket import ConnectionHandler


def make_config(working_dir: Path) -> Config:
    return Config(
        port=3000, host="127.0.0.1", working_dir=working_dir,
        shell_command="bash", auto_start_claude=False, dummy_mode=False,
    )


def make_ws() -> AsyncMock:
    ws = AsyncMock()
    ws.send_json = AsyncMock()
    return ws


def make_pty() -> AsyncMock:
    pty = AsyncMock(spec=PTYManager)
    pty.is_alive.return_value = True

    async def never_ends():
        await asyncio.sleep(3600)
        yield ""

    pty.read = never_ends
    return pty


def sent(ws: AsyncMock, msg_type: str) -> list[dict]:
    return [c.args[0] for c in ws.send_json.await_args_list if c.args[0]["type"] == msg_type]


def attach_handler(
    session: PTYSession, temp_dir: Path, *, new_session: bool = False,
    last_seq: dict[str, int] | None = None,
) -> ConnectionHandler:
    ws = make_ws()
    handler = ConnectionHandler(ws, make_config(temp_dir))
    handler._session = session
    handler._session_id = session.id
    handler._is_new_session = new_session
    handler._client_seqs = dict(last_seq or {})
    session.connected_clients.add(ws)
    return handler


async def settle() -> None:
    for _ in range(3):
        await asyncio.sleep(0)


class TestAttach:
    @pytest.mark.asyncio
    async def test_both_clients_receive_live_output(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        a = attach_handler(session, temp_dir)
        b = attach_handler(session, temp_dir)
        await a._attach_terminal(SessionKey.CLAUDE)
        await b._attach_terminal(SessionKey.CLAUDE)

        terminal.publish("hello")
        await settle()

        for h in (a, b):
            out = sent(h._ws, MessageType.OUTPUT)
            assert [(m["seq"], m["data"]) for m in out] == [(1, "hello")]
        await a._cleanup()
        await b._cleanup()

    @pytest.mark.asyncio
    async def test_cold_attach_sends_scrollback_with_seq(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        terminal.publish("old ")
        terminal.publish("news")
        h = attach_handler(session, temp_dir)
        await h._attach_terminal(SessionKey.CLAUDE)

        restored = sent(h._ws, MessageType.SESSION_RESTORED)
        assert len(restored) == 1
        assert restored[0]["scrollback"] == "old news"
        assert restored[0]["seq"] == 2
        assert sent(h._ws, MessageType.OUTPUT) == []
        await h._cleanup()

    @pytest.mark.asyncio
    async def test_warm_attach_replays_only_the_gap(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        for c in "abcd":
            terminal.publish(c)
        h = attach_handler(session, temp_dir, last_seq={SessionKey.CLAUDE: 2})
        await h._attach_terminal(SessionKey.CLAUDE)

        assert sent(h._ws, MessageType.SESSION_RESTORED) == []
        out = sent(h._ws, MessageType.OUTPUT)
        assert [(m["seq"], m["data"]) for m in out] == [(3, "c"), (4, "d")]
        await h._cleanup()

    @pytest.mark.asyncio
    async def test_replayed_chunks_are_not_sent_twice_by_the_drain(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        terminal.publish("a")
        h = attach_handler(session, temp_dir, last_seq={SessionKey.CLAUDE: 0})
        await h._attach_terminal(SessionKey.CLAUDE)
        terminal.publish("b")
        await settle()
        out = sent(h._ws, MessageType.OUTPUT)
        assert [m["seq"] for m in out] == [1, 2]
        await h._cleanup()

    @pytest.mark.asyncio
    async def test_new_session_startup_output_goes_through_chunk_path(self, temp_dir: Path):
        """Output buffered before the first client arrives must still be
        subject to startup suppression, so it is sent as chunks, not scrollback."""
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        terminal.publish("$ prompt")
        h = attach_handler(session, temp_dir, new_session=True)
        await h._attach_terminal(SessionKey.CLAUDE)
        assert sent(h._ws, MessageType.SESSION_RESTORED) == []
        assert [m["data"] for m in sent(h._ws, MessageType.OUTPUT)] == ["$ prompt"]
        await h._cleanup()

    @pytest.mark.asyncio
    async def test_queued_burst_is_coalesced_into_one_frame(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        h = attach_handler(session, temp_dir)
        await h._attach_terminal(SessionKey.CLAUDE)

        # Published before the drain task gets to run: all queued at once.
        terminal.publish("a")
        terminal.publish("b")
        terminal.publish("c")
        await settle()

        out = sent(h._ws, MessageType.OUTPUT)
        assert [(m["seq"], m["data"]) for m in out] == [(3, "abc")]
        await h._cleanup()

    @pytest.mark.asyncio
    async def test_eof_behind_a_burst_still_ends_the_drain(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        h = attach_handler(session, temp_dir)
        await h._attach_terminal(SessionKey.CLAUDE)
        sub = h._subscribers[SessionKey.CLAUDE]

        terminal.publish("a")
        terminal.publish("b")
        sub._end()
        await settle()

        assert [(m["seq"], m["data"]) for m in sent(h._ws, MessageType.OUTPUT)] == [(2, "ab")]
        assert h._output_tasks[SessionKey.CLAUDE].done()
        await h._cleanup()

    @pytest.mark.asyncio
    async def test_cleanup_unsubscribes(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        h = attach_handler(session, temp_dir)
        await h._attach_terminal(SessionKey.CLAUDE)
        assert len(terminal.subscribers) == 1
        await h._cleanup()
        assert len(terminal.subscribers) == 0


class TestSizePolicyOnTheWire:
    @pytest.mark.asyncio
    async def test_refused_resize_tells_client_the_real_size(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        desktop = attach_handler(session, temp_dir)
        phone = attach_handler(session, temp_dir)
        await desktop._handle_input({"type": MessageType.INPUT, "data": "x"})
        await desktop._handle_resize({"type": MessageType.RESIZE, "cols": 200, "rows": 50})
        await phone._handle_resize({"type": MessageType.RESIZE, "cols": 40, "rows": 20})

        sizes = sent(phone._ws, MessageType.PTY_SIZE)
        assert sizes[-1]["cols"] == 200 and sizes[-1]["rows"] == 50
        assert sizes[-1]["controller"] == desktop._connection_id

    @pytest.mark.asyncio
    async def test_typing_takes_over_and_everyone_hears(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        desktop = attach_handler(session, temp_dir)
        phone = attach_handler(session, temp_dir)
        await desktop._handle_input({"type": MessageType.INPUT, "data": "x"})
        await desktop._handle_resize({"type": MessageType.RESIZE, "cols": 200, "rows": 50})
        await phone._handle_resize({"type": MessageType.RESIZE, "cols": 40, "rows": 20})

        await phone._handle_input({"type": MessageType.INPUT, "data": "y"})

        assert terminal.controller == phone._connection_id
        assert terminal.size.cols == 40
        desktop_sizes = sent(desktop._ws, MessageType.PTY_SIZE)
        assert desktop_sizes[-1]["cols"] == 40
        assert desktop_sizes[-1]["controller"] == phone._connection_id

    @pytest.mark.asyncio
    async def test_applied_resize_is_broadcast_to_the_others(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        desktop = attach_handler(session, temp_dir)
        phone = attach_handler(session, temp_dir)
        await desktop._handle_resize({"type": MessageType.RESIZE, "cols": 120, "rows": 40})
        assert sent(phone._ws, MessageType.PTY_SIZE)[-1]["cols"] == 120
        assert sent(desktop._ws, MessageType.PTY_SIZE) == []

    @pytest.mark.asyncio
    async def test_repaint_message_nudges_the_pty(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        h = attach_handler(session, temp_dir)
        await h._handle_resize({"type": MessageType.RESIZE, "cols": 80, "rows": 24})
        await h._handle_message({"type": MessageType.REPAINT})
        calls = [c.args for c in terminal.pty.resize.await_args_list]
        assert calls[-2:] == [(80, 23), (80, 24)]


class TestLiveness:
    @pytest.mark.asyncio
    async def test_ping_is_answered_with_same_token(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        h = attach_handler(session, temp_dir)
        await h._handle_message({"type": MessageType.PING, "t": 1234})
        assert sent(h._ws, MessageType.PONG) == [{"type": MessageType.PONG, "t": 1234}]


class TestSessionList:
    @pytest.mark.asyncio
    async def test_lists_registered_sessions_with_terminal_state(self, temp_dir: Path):
        registry = SessionRegistry()
        set_registry(registry)
        session = PTYSession(id="live-1", project_path=temp_dir, label="cade")
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        terminal.publish("x")
        registry._sessions["live-1"] = session

        h = attach_handler(session, temp_dir)
        await h._handle_resize({"type": MessageType.RESIZE, "cols": 100, "rows": 30})
        await h._handle_message({"type": MessageType.LIST_SESSIONS})

        listing = sent(h._ws, MessageType.SESSION_LIST)[0]["sessions"]
        assert len(listing) == 1
        entry = listing[0]
        assert entry["id"] == "live-1"
        assert entry["label"] == "cade"
        assert entry["projectPath"] == str(temp_dir)
        assert entry["agent"] == "claude-code"
        assert entry["clients"] == 1
        claude = entry["terminals"][SessionKey.CLAUDE]
        assert claude["cols"] == 100 and claude["rows"] == 30
        assert claude["lastSeq"] == 1
        assert claude["alive"] is True


class TestFileMessages:
    @pytest.mark.asyncio
    async def test_list_files_returns_relative_paths(self, temp_dir: Path):
        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "a.py").write_text("")
        session = PTYSession(id="s", project_path=temp_dir)
        h = attach_handler(session, temp_dir)
        await h._handle_message({"type": MessageType.LIST_FILES})
        listing = sent(h._ws, MessageType.FILE_LIST)[0]
        assert listing["files"] == ["src/a.py"]
        assert listing["truncated"] is False

    @pytest.mark.asyncio
    async def test_get_file_diff_outside_git(self, temp_dir: Path):
        (temp_dir / "a.txt").write_text("x")
        session = PTYSession(id="s", project_path=temp_dir)
        h = attach_handler(session, temp_dir)
        await h._handle_message({"type": MessageType.GET_FILE_DIFF, "path": "a.txt"})
        reply = sent(h._ws, MessageType.FILE_DIFF)[0]
        assert reply["path"] == "a.txt"
        assert reply["error"] == "not a git repository"

    @pytest.mark.asyncio
    async def test_get_file_diff_requires_path(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        h = attach_handler(session, temp_dir)
        await h._handle_message({"type": MessageType.GET_FILE_DIFF})
        assert sent(h._ws, MessageType.ERROR)
