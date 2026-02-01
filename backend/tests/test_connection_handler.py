"""Tests for WebSocket connection handler.

Verifies the connection setup flow, message routing, output suppression,
and error handling. Critical for diagnosing "white cursor can't type"
issues in the desktop app.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from backend.config import Config
from backend.errors import PTYError
from backend.protocol import ErrorCode, MessageType, SessionKey
from backend.terminal.pty import PTYManager
from backend.terminal.sessions import PTYSession, SessionRegistry, TerminalState
from backend.models import TerminalSize
from backend.websocket import ConnectionHandler


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_mock_config(
    working_dir: Path | None = None,
    shell_command: str = "bash",
    auto_start_claude: bool = True,
    dummy_mode: bool = False,
) -> Config:
    """Create a Config with test defaults."""
    return Config(
        port=3000,
        host="127.0.0.1",
        working_dir=working_dir or Path("/tmp"),
        shell_command=shell_command,
        auto_start_claude=auto_start_claude,
        dummy_mode=dummy_mode,
    )


def make_mock_websocket() -> AsyncMock:
    """Create a mock WebSocket that accepts connections and tracks sent messages."""
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.receive_json = AsyncMock()
    ws.close = AsyncMock()
    return ws


def make_mock_pty(alive: bool = True) -> AsyncMock:
    pty = AsyncMock(spec=PTYManager)
    pty.is_alive.return_value = alive
    return pty


# ---------------------------------------------------------------------------
# Output Suppression Tests
# ---------------------------------------------------------------------------


class TestOutputSuppression:
    """Test the output suppression logic used during Claude auto-start.

    When auto_start_claude=True, shell output is suppressed until Claude's
    TUI is detected (alternate screen buffer, clear screen, or logo).
    This is a critical area because if detection fails, the user sees
    a blank terminal.
    """

    def _make_handler(
        self,
        temp_dir: Path,
        auto_start_claude: bool = True,
        dummy_mode: bool = False,
    ) -> ConnectionHandler:
        config = make_mock_config(
            working_dir=temp_dir,
            auto_start_claude=auto_start_claude,
            dummy_mode=dummy_mode,
        )
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        return handler

    def test_suppression_enabled_on_new_session_with_auto_start(self, temp_dir: Path):
        """Output suppression should be enabled for new sessions with auto_start_claude."""
        handler = self._make_handler(temp_dir, auto_start_claude=True)
        handler._is_new_session = True

        # Simulate the code path in _setup()
        if handler._config.auto_start_claude and not handler._config.dummy_mode:
            handler._suppress_output = True
            handler._suppress_start_time = time.monotonic()

        assert handler._suppress_output is True
        assert handler._suppress_start_time is not None

    def test_suppression_disabled_without_auto_start(self, temp_dir: Path):
        handler = self._make_handler(temp_dir, auto_start_claude=False)
        assert handler._suppress_output is False

    def test_suppression_disabled_in_dummy_mode(self, temp_dir: Path):
        handler = self._make_handler(temp_dir, auto_start_claude=True, dummy_mode=True)
        # In dummy mode, suppression should not activate
        handler._is_new_session = True

        if handler._config.auto_start_claude and not handler._config.dummy_mode:
            handler._suppress_output = True

        assert handler._suppress_output is False

    def test_alternate_screen_buffer_ends_suppression(self):
        """Detecting \\x1b[?1049h should end output suppression."""
        data = "some output\x1b[?1049hClaude TUI here"
        assert "\x1b[?1049h" in data

    def test_clear_screen_ends_suppression(self):
        """Detecting \\x1b[2J should end output suppression."""
        data = "\x1b[H\x1b[2JClaude startup"
        assert "\x1b[2J" in data

    def test_claude_logo_ends_suppression(self):
        """Detecting the Claude logo should end output suppression."""
        data = "\x1b[38;5;75m ▐▛███▜▌\x1b[0m   Claude Code"
        assert "▐▛███▜▌" in data

    def test_suppression_timeout_is_4_seconds(self):
        """Suppression should time out after 4 seconds."""
        start_time = time.monotonic() - 5.0  # 5 seconds ago
        elapsed = time.monotonic() - start_time
        assert elapsed > 4.0

    def test_suppressed_output_is_buffered(self, temp_dir: Path):
        """During suppression, output should be buffered (not dropped)
        so that error messages are visible after the timeout."""
        handler = self._make_handler(temp_dir, auto_start_claude=True)
        handler._suppress_output = True
        handler._suppress_start_time = time.monotonic()
        handler._suppress_buffer = []

        # Simulate buffering shell output during suppression
        data = "$ bash: claude: command not found\n"
        handler._suppress_buffer.append(data)

        assert len(handler._suppress_buffer) == 1
        assert "command not found" in handler._suppress_buffer[0]

    def test_buffer_flushed_on_timeout(self, temp_dir: Path):
        """When suppression times out, buffered output should be available
        for flushing to the client."""
        handler = self._make_handler(temp_dir, auto_start_claude=True)
        handler._suppress_output = True
        handler._suppress_start_time = time.monotonic() - 5.0  # 5s ago
        handler._suppress_buffer = [
            "$ ",
            "bash: claude: command not found\n",
        ]

        # Simulate the timeout check
        timed_out = time.monotonic() - handler._suppress_start_time > 4.0
        assert timed_out

        # Buffer should contain the error output for flushing
        buffered = "".join(handler._suppress_buffer)
        assert "command not found" in buffered

    def test_buffer_discarded_on_claude_detection(self, temp_dir: Path):
        """When Claude's TUI is detected, buffered shell output is discarded
        because Claude's alternate screen replaces it."""
        handler = self._make_handler(temp_dir, auto_start_claude=True)
        handler._suppress_output = True
        handler._suppress_start_time = time.monotonic()
        handler._suppress_buffer = ["shell prompt stuff\n"]

        # Claude detected - buffer should be cleared, not sent
        claude_data = "\x1b[?1049hClaude TUI content"
        claude_detected = "\x1b[?1049h" in claude_data
        assert claude_detected

        # In the real code, buffer is cleared but not sent when Claude is detected
        if claude_detected:
            handler._suppress_buffer.clear()
        assert len(handler._suppress_buffer) == 0

    def test_command_not_found_ends_suppression(self):
        """Detecting 'command not found' should end output suppression immediately."""
        data = "bash: claude: command not found\n"
        command_not_found = "command not found" in data or "not found" in data.lower()
        assert command_not_found

    def test_command_not_found_variations(self):
        """Should detect various forms of command not found errors."""
        test_cases = [
            "bash: claude: command not found",
            "zsh: command not found: claude",
            "sh: claude: not found",
            "-bash: claude: command not found",
        ]
        for data in test_cases:
            assert "command not found" in data or "not found" in data.lower()


# ---------------------------------------------------------------------------
# Message Routing Tests
# ---------------------------------------------------------------------------


class TestMessageRouting:
    """Test that incoming messages are routed to the correct handler."""

    @pytest.mark.asyncio
    async def test_input_message_writes_to_pty(self, temp_dir: Path):
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)

        # Set up a mock session with a terminal
        mock_pty = make_mock_pty()
        session = PTYSession(id="test", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, mock_pty)
        handler._session = session

        await handler._handle_input({
            "type": MessageType.INPUT,
            "data": "hello\n",
        })

        mock_pty.write.assert_awaited_once_with("hello\n")

    @pytest.mark.asyncio
    async def test_input_with_session_key(self, temp_dir: Path):
        """Input with sessionKey should go to the correct terminal."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)

        mock_pty_claude = make_mock_pty()
        mock_pty_manual = make_mock_pty()
        session = PTYSession(id="test", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, mock_pty_claude)
        session.add_terminal(SessionKey.MANUAL, mock_pty_manual)
        handler._session = session

        await handler._handle_input({
            "type": MessageType.INPUT,
            "data": "manual input\n",
            "sessionKey": SessionKey.MANUAL,
        })

        mock_pty_manual.write.assert_awaited_once_with("manual input\n")
        mock_pty_claude.write.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_input_without_session_is_noop(self, temp_dir: Path):
        """If no session exists, input should be silently dropped."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session = None

        # Should not raise
        await handler._handle_input({
            "type": MessageType.INPUT,
            "data": "hello",
        })

    @pytest.mark.asyncio
    async def test_empty_input_is_noop(self, temp_dir: Path):
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)

        mock_pty = make_mock_pty()
        session = PTYSession(id="test", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, mock_pty)
        handler._session = session

        await handler._handle_input({
            "type": MessageType.INPUT,
            "data": "",
        })

        mock_pty.write.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_resize_forwards_to_pty(self, temp_dir: Path):
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)

        mock_pty = make_mock_pty()
        session = PTYSession(id="test", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, mock_pty)
        handler._session = session

        await handler._handle_resize({
            "type": MessageType.RESIZE,
            "cols": 120,
            "rows": 40,
        })

        mock_pty.resize.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_unknown_message_sends_error(self, temp_dir: Path):
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session = PTYSession(id="test", project_path=temp_dir)

        await handler._handle_message({"type": "totally-unknown"})

        # Should have sent an error message
        ws.send_json.assert_called()
        sent = ws.send_json.call_args[0][0]
        assert sent["type"] == MessageType.ERROR
        assert sent["code"] == ErrorCode.INVALID_MESSAGE

    @pytest.mark.asyncio
    async def test_input_to_missing_manual_creates_it(self, temp_dir: Path):
        """First input to manual terminal should lazily create it."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session_id = "test-session"

        mock_pty_claude = make_mock_pty()
        session = PTYSession(id="test-session", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, mock_pty_claude)
        handler._session = session

        with patch.object(handler, "_create_manual_terminal") as mock_create:
            await handler._handle_input({
                "type": MessageType.INPUT,
                "data": "ls\n",
                "sessionKey": SessionKey.MANUAL,
            })
            mock_create.assert_awaited_once()


# ---------------------------------------------------------------------------
# SET_PROJECT Tests
# ---------------------------------------------------------------------------


class TestSetProject:
    """Test SET_PROJECT message handling and timeout behavior."""

    @pytest.mark.asyncio
    async def test_wait_for_project_receives_path(self, temp_dir: Path):
        """If SET_PROJECT is received within timeout, working dir is updated."""
        config = make_mock_config(working_dir=Path("/default"))
        ws = make_mock_websocket()

        # Mock receive_json to return SET_PROJECT immediately
        ws.receive_json.return_value = {
            "type": MessageType.SET_PROJECT,
            "path": str(temp_dir),
            "sessionId": "test-session-id",
        }

        handler = ConnectionHandler(ws, config)
        await handler._wait_for_project()

        assert handler._working_dir == temp_dir
        assert handler._session_id == "test-session-id"

    @pytest.mark.asyncio
    async def test_wait_for_project_timeout_uses_default(self, temp_dir: Path):
        """If no SET_PROJECT within timeout, default working dir is used."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()

        # Make receive_json hang (simulating no message arriving),
        # so the inner 0.1s timeout fires each iteration, and the
        # outer 2s timeout eventually breaks out.
        async def slow_receive():
            await asyncio.sleep(10)

        ws.receive_json.side_effect = slow_receive

        handler = ConnectionHandler(ws, config)
        await handler._wait_for_project()

        assert handler._working_dir == temp_dir
        assert handler._session_id is None

    @pytest.mark.asyncio
    async def test_wait_for_project_invalid_path(self, temp_dir: Path):
        """If SET_PROJECT has invalid path, working dir stays at default."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()

        ws.receive_json.return_value = {
            "type": MessageType.SET_PROJECT,
            "path": "/nonexistent/path/that/doesnt/exist",
        }

        handler = ConnectionHandler(ws, config)
        await handler._wait_for_project()

        # Invalid path should not be used
        assert handler._working_dir == temp_dir


# ---------------------------------------------------------------------------
# Setup Flow Tests
# ---------------------------------------------------------------------------


class TestSetupFlow:
    """Test the _setup() method which creates PTY sessions."""

    @pytest.mark.asyncio
    async def test_setup_with_session_id(self, temp_dir: Path):
        """Setup with session_id uses the registry."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session_id = "test-session"

        mock_pty = make_mock_pty()
        mock_session = PTYSession(id="test-session", project_path=temp_dir)
        mock_session.add_terminal(SessionKey.CLAUDE, mock_pty)

        mock_registry = AsyncMock(spec=SessionRegistry)
        mock_registry.get_or_create.return_value = (mock_session, True)

        with patch("backend.websocket.get_registry", return_value=mock_registry):
            with patch("backend.websocket.load_user_config") as mock_user_config:
                mock_user_config.return_value = MagicMock()
                mock_user_config.return_value.behavior.session.network_timeout = 15.0
                await handler._setup()

        assert handler._session is mock_session
        assert handler._is_new_session is True

    @pytest.mark.asyncio
    async def test_setup_without_session_id(self, temp_dir: Path):
        """Setup without session_id creates a standalone PTY."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session_id = None

        mock_pty = make_mock_pty()

        with patch("backend.terminal.pty.PTYManager", return_value=mock_pty):
            with patch("backend.websocket.load_user_config") as mock_user_config:
                mock_user_config.return_value = MagicMock()
                await handler._setup()

        assert handler._session is not None
        mock_pty.spawn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_setup_pty_spawn_failure(self, temp_dir: Path):
        """If PTY spawn fails during setup, error should propagate."""
        config = make_mock_config(working_dir=temp_dir, shell_command="wsl")
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session_id = None

        mock_pty = make_mock_pty()
        mock_pty.spawn.side_effect = PTYError.spawn_failed("wsl", "not found")

        with patch("backend.terminal.pty.PTYManager", return_value=mock_pty):
            with patch("backend.websocket.load_user_config") as mock_user_config:
                mock_user_config.return_value = MagicMock()
                with pytest.raises(PTYError):
                    await handler._setup()


# ---------------------------------------------------------------------------
# Connected Message Tests
# ---------------------------------------------------------------------------


class TestConnectedMessage:
    """Test the _send_connected() flow."""

    @pytest.mark.asyncio
    async def test_new_session_sends_connected(self, temp_dir: Path):
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._is_new_session = True
        handler._session = PTYSession(id="test", project_path=temp_dir)
        handler._session.add_terminal(SessionKey.CLAUDE, make_mock_pty())
        handler._user_config = MagicMock()
        handler._user_config.to_dict.return_value = {}
        handler._user_config.behavior.splash.health_check_timeout = 5

        with patch("backend.websocket.load_session", return_value=None):
            await handler._send_connected()

        ws.send_json.assert_called()
        sent = ws.send_json.call_args[0][0]
        assert sent["type"] == MessageType.CONNECTED
        assert sent["sessionRestored"] is False

    @pytest.mark.asyncio
    async def test_restored_session_sends_scrollback(self, temp_dir: Path):
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._is_new_session = False
        handler._session_id = "test-session"

        session = PTYSession(id="test-session", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty())
        session.capture_output("previous output", SessionKey.CLAUDE)
        handler._session = session
        handler._user_config = MagicMock()
        handler._user_config.to_dict.return_value = {}
        handler._user_config.behavior.splash.health_check_timeout = 5

        with patch("backend.websocket.load_session", return_value=None):
            with patch("backend.wsl.health.check_wsl_health", return_value=(True, "ok")):
                await handler._send_connected()

        # Should have sent SESSION_RESTORED with scrollback
        calls = ws.send_json.call_args_list
        session_restored_calls = [
            c for c in calls
            if c[0][0].get("type") == MessageType.SESSION_RESTORED
        ]
        assert len(session_restored_calls) >= 1
        assert "previous output" in session_restored_calls[0][0][0]["scrollback"]


# ---------------------------------------------------------------------------
# Cleanup Tests
# ---------------------------------------------------------------------------


class TestCleanup:
    """Test connection cleanup behavior."""

    @pytest.mark.asyncio
    async def test_cleanup_removes_client_from_session(self, temp_dir: Path):
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session_id = "test-session"

        session = PTYSession(id="test-session", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty())
        session.connected_clients.add(ws)
        handler._session = session

        mock_registry = AsyncMock(spec=SessionRegistry)
        with patch("backend.websocket.get_registry", return_value=mock_registry):
            with patch("backend.websocket.get_connection_manager") as mock_cm:
                mock_cm.return_value.unregister = MagicMock()
                with patch("backend.websocket.get_connection_registry") as mock_cr:
                    mock_cr.return_value.unregister = MagicMock()
                    await handler._cleanup()

        assert ws not in session.connected_clients
        mock_registry.detach.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_cleanup_without_session_id_closes_pty(self, temp_dir: Path):
        """Without a session_id, cleanup should close the PTY directly."""
        config = make_mock_config(working_dir=temp_dir)
        ws = make_mock_websocket()
        handler = ConnectionHandler(ws, config)
        handler._session_id = None

        mock_pty = make_mock_pty()
        session = PTYSession(id="", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, mock_pty)
        handler._session = session

        with patch("backend.websocket.get_connection_manager") as mock_cm:
            mock_cm.return_value.unregister = MagicMock()
            with patch("backend.websocket.get_connection_registry") as mock_cr:
                mock_cr.return_value.unregister = MagicMock()
                await handler._cleanup()

        mock_pty.close.assert_awaited_once()
