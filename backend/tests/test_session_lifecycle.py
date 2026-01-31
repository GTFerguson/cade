"""Tests for PTY session registry and session lifecycle.

Verifies session creation, reattachment, dead session handling,
auto-start behavior, and dual terminal support. Key for diagnosing
desktop startup issues where the shell never starts.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.errors import PTYError
from backend.protocol import SessionKey
from backend.terminal.pty import PTYManager
from backend.terminal.sessions import (
    MAX_SCROLLBACK_SIZE,
    PTYSession,
    SessionRegistry,
    TerminalState,
)
from backend.types import TerminalSize


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_mock_pty(alive: bool = True) -> AsyncMock:
    """Create a mock PTYManager that reports the given alive state."""
    pty = AsyncMock(spec=PTYManager)
    pty.is_alive.return_value = alive
    return pty


# ---------------------------------------------------------------------------
# TerminalState tests
# ---------------------------------------------------------------------------


class TestTerminalState:
    def test_capture_output(self):
        pty = make_mock_pty()
        ts = TerminalState(pty=pty)
        ts.capture_output("hello ")
        ts.capture_output("world")
        assert ts.get_scrollback() == "hello world"

    def test_scrollback_trims_when_exceeding_max(self):
        pty = make_mock_pty()
        ts = TerminalState(pty=pty)
        # Fill beyond max
        chunk = "x" * 1024
        for _ in range((MAX_SCROLLBACK_SIZE // 1024) + 10):
            ts.capture_output(chunk)
        assert ts.scrollback_size <= MAX_SCROLLBACK_SIZE + 1024

    def test_clear_scrollback(self):
        pty = make_mock_pty()
        ts = TerminalState(pty=pty)
        ts.capture_output("data")
        ts.clear_scrollback()
        assert ts.get_scrollback() == ""
        assert ts.scrollback_size == 0

    def test_scrollback_strips_terminal_queries(self):
        """Terminal query sequences should be stripped from scrollback replay
        to prevent xterm.js from sending spurious responses."""
        pty = make_mock_pty()
        ts = TerminalState(pty=pty)
        # DA1 query
        ts.capture_output("before\x1b[cafter")
        result = ts.get_scrollback()
        assert "\x1b[c" not in result
        assert "before" in result
        assert "after" in result

    def test_scrollback_strips_ris_sequence(self):
        """Reset to Initial State (ESC c) should be stripped."""
        pty = make_mock_pty()
        ts = TerminalState(pty=pty)
        ts.capture_output("before\x1bcafter")
        result = ts.get_scrollback()
        assert "\x1bc" not in result


# ---------------------------------------------------------------------------
# PTYSession tests
# ---------------------------------------------------------------------------


class TestPTYSession:
    def test_pty_property_returns_claude_terminal(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        pty = make_mock_pty()
        session.add_terminal(SessionKey.CLAUDE, pty)
        assert session.pty is pty

    def test_has_terminal(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty())
        assert session.has_terminal(SessionKey.CLAUDE)
        assert not session.has_terminal(SessionKey.MANUAL)

    def test_get_terminal(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        pty = make_mock_pty()
        session.add_terminal(SessionKey.CLAUDE, pty)
        terminal = session.get_terminal(SessionKey.CLAUDE)
        assert terminal is not None
        assert terminal.pty is pty

    def test_get_terminal_missing_returns_none(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        assert session.get_terminal(SessionKey.MANUAL) is None

    def test_add_terminal(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        pty = make_mock_pty()
        terminal = session.add_terminal(SessionKey.MANUAL, pty)
        assert terminal.pty is pty
        assert session.has_terminal(SessionKey.MANUAL)

    def test_capture_output_updates_activity(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty())
        old_activity = session.last_activity
        # Small sleep to ensure time difference
        import time
        time.sleep(0.01)
        session.capture_output("data")
        assert session.last_activity > old_activity

    def test_capture_output_to_specific_terminal(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty())
        session.add_terminal(SessionKey.MANUAL, make_mock_pty())

        session.capture_output("claude data", SessionKey.CLAUDE)
        session.capture_output("manual data", SessionKey.MANUAL)

        assert "claude data" in session.get_scrollback(SessionKey.CLAUDE)
        assert "manual data" in session.get_scrollback(SessionKey.MANUAL)
        assert "manual data" not in session.get_scrollback(SessionKey.CLAUDE)

    def test_is_alive_with_live_terminal(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty(alive=True))
        assert session.is_alive()

    def test_is_alive_with_dead_terminal(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty(alive=False))
        assert not session.is_alive()

    def test_is_alive_with_no_terminals(self):
        session = PTYSession(id="test", project_path=Path("/tmp"))
        assert not session.is_alive()

    def test_is_alive_mixed_terminals(self):
        """If any terminal is alive, the session is alive."""
        session = PTYSession(id="test", project_path=Path("/tmp"))
        session.add_terminal(SessionKey.CLAUDE, make_mock_pty(alive=False))
        session.add_terminal(SessionKey.MANUAL, make_mock_pty(alive=True))
        assert session.is_alive()


# ---------------------------------------------------------------------------
# SessionRegistry tests
# ---------------------------------------------------------------------------


class TestSessionRegistry:
    @pytest.mark.asyncio
    async def test_create_new_session(self, temp_dir: Path):
        """Creating a new session should spawn a PTY and return is_new=True."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            session, is_new = await registry.get_or_create(
                "session-1",
                temp_dir,
                "bash",
                TerminalSize(80, 24),
            )

        assert is_new
        assert session.id == "session-1"
        assert session.project_path == temp_dir
        assert session.has_terminal(SessionKey.CLAUDE)
        mock_pty.spawn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reattach_existing_session(self, temp_dir: Path):
        """Getting an existing live session should return is_new=False."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty(alive=True)
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            session1, is_new1 = await registry.get_or_create(
                "session-1", temp_dir, "bash"
            )
            session2, is_new2 = await registry.get_or_create(
                "session-1", temp_dir, "bash"
            )

        assert is_new1
        assert not is_new2
        assert session1 is session2

    @pytest.mark.asyncio
    async def test_recreate_dead_session(self, temp_dir: Path):
        """If an existing session's PTY died, it should be recreated."""
        registry = SessionRegistry()

        dead_pty = make_mock_pty(alive=False)
        new_pty = make_mock_pty(alive=True)

        call_count = 0

        def create_pty():
            nonlocal call_count
            call_count += 1
            return dead_pty if call_count == 1 else new_pty

        with patch("backend.terminal.sessions.PTYManager", side_effect=create_pty):
            session1, is_new1 = await registry.get_or_create(
                "session-1", temp_dir, "bash"
            )

            # Now the PTY is "dead" - next get_or_create should recreate
            session2, is_new2 = await registry.get_or_create(
                "session-1", temp_dir, "bash"
            )

        assert is_new1
        assert is_new2  # Recreated because PTY was dead
        assert session1 is not session2

    @pytest.mark.asyncio
    async def test_auto_start_claude(self, temp_dir: Path):
        """When auto_start_claude=True, 'claude\\n' should be written to PTY."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            with patch("backend.terminal.sessions.wait_for_wsl_network") as mock_wait:
                session, is_new = await registry.get_or_create(
                    "session-1",
                    temp_dir,
                    "bash",  # Not a WSL command, so network wait is skipped
                    auto_start_claude=True,
                )

        mock_pty.write.assert_awaited_with("claude\n")
        mock_wait.assert_not_called()

    @pytest.mark.asyncio
    async def test_auto_start_claude_wsl_waits_for_network(self, temp_dir: Path):
        """When shell command contains 'wsl', should wait for network before starting Claude."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            with patch(
                "backend.terminal.sessions.wait_for_wsl_network",
                return_value=(True, "ready"),
            ) as mock_wait:
                session, is_new = await registry.get_or_create(
                    "session-1",
                    temp_dir,
                    "wsl",
                    auto_start_claude=True,
                    network_timeout=5.0,
                )

        mock_wait.assert_called_once_with(5.0, 1.0)
        mock_pty.write.assert_awaited_with("claude\n")

    @pytest.mark.asyncio
    async def test_auto_start_claude_wsl_network_fail_continues(self, temp_dir: Path):
        """Even if WSL network isn't ready, Claude should still start."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            with patch(
                "backend.terminal.sessions.wait_for_wsl_network",
                return_value=(False, "timeout"),
            ):
                session, is_new = await registry.get_or_create(
                    "session-1",
                    temp_dir,
                    "wsl",
                    auto_start_claude=True,
                )

        # Claude should still be started even if network wait failed
        mock_pty.write.assert_awaited_with("claude\n")

    @pytest.mark.asyncio
    async def test_no_auto_start_in_dummy_mode(self, temp_dir: Path):
        """In dummy mode, 'claude\\n' should not be written."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            session, is_new = await registry.get_or_create(
                "session-1",
                temp_dir,
                "bash",
                auto_start_claude=True,
                dummy_mode=True,
            )

        mock_pty.write.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_dummy_mode_captures_scrollback(self, temp_dir: Path):
        """Dummy mode should capture the dummy output in scrollback."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            session, _ = await registry.get_or_create(
                "session-1",
                temp_dir,
                "bash",
                dummy_mode=True,
            )

        scrollback = session.get_scrollback(SessionKey.CLAUDE)
        assert "dummy mode" in scrollback.lower()

    @pytest.mark.asyncio
    async def test_create_manual_terminal(self, temp_dir: Path):
        """Should be able to create a manual terminal for an existing session."""
        registry = SessionRegistry()

        mock_pty_claude = make_mock_pty()
        mock_pty_manual = make_mock_pty()

        call_count = 0

        def create_pty():
            nonlocal call_count
            call_count += 1
            return mock_pty_claude if call_count == 1 else mock_pty_manual

        with patch("backend.terminal.sessions.PTYManager", side_effect=create_pty):
            await registry.get_or_create("session-1", temp_dir, "bash")
            terminal = await registry.create_manual_terminal("session-1", "bash")

        assert terminal is not None
        mock_pty_manual.spawn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_create_manual_terminal_nonexistent_session(self):
        """Creating manual terminal for nonexistent session returns None."""
        registry = SessionRegistry()
        result = await registry.create_manual_terminal("nonexistent", "bash")
        assert result is None

    @pytest.mark.asyncio
    async def test_create_manual_terminal_already_exists(self, temp_dir: Path):
        """If manual terminal already exists, return the existing one."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            await registry.get_or_create("session-1", temp_dir, "bash")
            terminal1 = await registry.create_manual_terminal("session-1", "bash")
            terminal2 = await registry.create_manual_terminal("session-1", "bash")

        assert terminal1 is terminal2

    @pytest.mark.asyncio
    async def test_attach_detach(self, temp_dir: Path):
        """Attach and detach WebSocket clients."""
        registry = SessionRegistry()
        mock_ws = MagicMock()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            await registry.get_or_create("session-1", temp_dir, "bash")

        session = await registry.attach("session-1", mock_ws)
        assert session is not None
        assert mock_ws in session.connected_clients

        await registry.detach("session-1", mock_ws)
        assert mock_ws not in session.connected_clients

    @pytest.mark.asyncio
    async def test_attach_nonexistent_returns_none(self):
        registry = SessionRegistry()
        mock_ws = MagicMock()
        result = await registry.attach("nonexistent", mock_ws)
        assert result is None

    @pytest.mark.asyncio
    async def test_remove_session(self, temp_dir: Path):
        """Removing a session should close all its terminals."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            await registry.get_or_create("session-1", temp_dir, "bash")

        await registry.remove("session-1")
        assert registry.get("session-1") is None
        mock_pty.close.assert_awaited()

    @pytest.mark.asyncio
    async def test_get_returns_session(self, temp_dir: Path):
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            await registry.get_or_create("session-1", temp_dir, "bash")

        session = registry.get("session-1")
        assert session is not None
        assert session.id == "session-1"

    @pytest.mark.asyncio
    async def test_get_nonexistent_returns_none(self):
        registry = SessionRegistry()
        assert registry.get("nonexistent") is None

    @pytest.mark.asyncio
    async def test_stop_closes_all_sessions(self, temp_dir: Path):
        """Registry stop should close all sessions."""
        registry = SessionRegistry()
        await registry.start()

        mock_pty = make_mock_pty()
        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            await registry.get_or_create("session-1", temp_dir, "bash")
            await registry.get_or_create("session-2", temp_dir, "bash")

        await registry.stop()
        assert registry.get("session-1") is None
        assert registry.get("session-2") is None

    @pytest.mark.asyncio
    async def test_spawn_failure_propagates(self, temp_dir: Path):
        """If PTY spawn fails, the error should propagate through the registry."""
        registry = SessionRegistry()

        mock_pty = make_mock_pty()
        mock_pty.spawn.side_effect = PTYError.spawn_failed("wsl", "WSL not found")

        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            with pytest.raises(PTYError, match="spawn"):
                await registry.get_or_create("session-1", temp_dir, "wsl")
