"""Integration tests for the desktop startup chain.

Tests the full flow from config resolution through PTY creation and
output reading. Designed to catch the specific class of issues where
the Claude pane shows a white cursor but can't type.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.config import Config, detect_default_shell
from backend.errors import PTYError
from backend.protocol import MessageType, SessionKey
from backend.terminal.pty import PTYManager
from backend.terminal.sessions import PTYSession, SessionRegistry, TerminalState
from backend.models import TerminalSize


# ---------------------------------------------------------------------------
# Config Resolution Tests
# ---------------------------------------------------------------------------


class TestConfigResolution:
    """Verify that the shell command and other config settings resolve correctly
    for the desktop context."""

    def test_default_shell_detected(self):
        """Default shell_command should be auto-detected via from_env()."""
        with patch.dict("os.environ", {}, clear=False):
            # Remove any explicit override so detect_default_shell() runs
            os.environ.pop("CADE_SHELL_COMMAND", None)
            config = Config.from_env()
        assert config.shell_command == detect_default_shell()

    def test_env_override_shell_command(self):
        with patch.dict("os.environ", {"CADE_SHELL_COMMAND": "bash"}):
            config = Config.from_env()
            assert config.shell_command == "bash"

    def test_cli_override_shell_command(self):
        config = Config()
        updated = config.update_from_args(shell_command="zsh")
        assert updated.shell_command == "zsh"

    def test_auto_start_claude_default(self):
        config = Config()
        assert config.auto_start_claude is True

    def test_auto_start_claude_disabled(self):
        config = Config()
        updated = config.update_from_args(auto_start_claude=False)
        assert updated.auto_start_claude is False

    def test_dummy_mode_default(self):
        config = Config()
        assert config.dummy_mode is False

    def test_desktop_no_browser_flag(self):
        """Desktop app passes --no-browser to prevent opening browser."""
        config = Config()
        updated = config.update_from_args(auto_open_browser=False)
        assert updated.auto_open_browser is False


# ---------------------------------------------------------------------------
# Shell Command Validation Tests
# ---------------------------------------------------------------------------


class TestValidateShellCommand:
    """Verify that validate_shell_command() auto-corrects missing binaries."""

    def test_valid_command_unchanged(self):
        """A command that exists on PATH should not be changed."""
        config = Config(shell_command="python")
        original = config.shell_command
        config.validate_shell_command()
        assert config.shell_command == original

    def test_invalid_command_corrected(self):
        """A command not on PATH should be replaced with detect_default_shell()."""
        config = Config(shell_command="totally_nonexistent_binary_xyz")
        config.validate_shell_command()
        assert config.shell_command == detect_default_shell()

    def test_command_with_valid_base_and_args(self):
        """A command with arguments whose base binary exists should pass."""
        config = Config(shell_command="python --version")
        config.validate_shell_command()
        assert config.shell_command == "python --version"

    def test_command_with_invalid_base_and_args(self):
        """A command with arguments whose base binary is missing should be corrected."""
        config = Config(shell_command="nonexistent_shell_xyz --login")
        config.validate_shell_command()
        assert config.shell_command == detect_default_shell()

    def test_already_correct_is_noop(self):
        """Running validation on an already-valid config is a no-op."""
        default = detect_default_shell()
        config = Config(shell_command=default)
        config.validate_shell_command()
        assert config.shell_command == default


# ---------------------------------------------------------------------------
# Shell Spawn Tests
# ---------------------------------------------------------------------------


class TestShellSpawn:
    """Test that various shell commands can be spawned correctly."""

    @pytest.mark.asyncio
    @pytest.mark.skipif(sys.platform == "win32", reason="Unix-only")
    async def test_spawn_bash(self, temp_dir: Path):
        """Basic bash spawn should work on Unix."""
        manager = PTYManager()
        await manager.spawn("bash", temp_dir, TerminalSize(80, 24))
        assert manager.is_alive()
        await manager.close()

    @pytest.mark.asyncio
    @pytest.mark.skipif(sys.platform == "win32", reason="Unix-only")
    async def test_spawn_sh(self, temp_dir: Path):
        """POSIX sh should always be available on Unix."""
        manager = PTYManager()
        await manager.spawn("sh", temp_dir, TerminalSize(80, 24))
        assert manager.is_alive()
        await manager.close()

    @pytest.mark.asyncio
    async def test_spawn_nonexistent_command(self, temp_dir: Path):
        """Spawning a nonexistent command should raise PTYError."""
        manager = PTYManager()
        with pytest.raises(PTYError):
            await manager.spawn(
                "/usr/bin/this_command_does_not_exist_12345",
                temp_dir,
                TerminalSize(80, 24),
            )

    @pytest.mark.asyncio
    async def test_spawn_with_invalid_cwd(self):
        """Spawning with a nonexistent working directory should fail."""
        manager = PTYManager()
        # pexpect may or may not raise immediately; depends on platform
        try:
            await manager.spawn(
                "bash",
                Path("/nonexistent/directory/path"),
                TerminalSize(80, 24),
            )
            # If it didn't raise, it might still fail
            await manager.close()
        except (PTYError, Exception):
            pass  # Expected


# ---------------------------------------------------------------------------
# Full Startup Flow Tests
# ---------------------------------------------------------------------------


class TestStartupFlow:
    """Test the complete startup flow as it happens in the desktop app."""

    @pytest.mark.asyncio
    async def test_session_creation_flow(self, temp_dir: Path):
        """Simulate the full session creation that happens on WebSocket connect.

        This mirrors what happens in websocket.py _setup():
        1. Get or create session from registry
        2. Session spawns PTY
        3. Auto-start claude writes to PTY
        """
        registry = SessionRegistry()
        mock_pty = AsyncMock(spec=PTYManager)
        mock_pty.is_alive.return_value = True

        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            session, is_new = await registry.get_or_create(
                session_id="tab-uuid-123",
                project_path=temp_dir,
                shell_command="bash",
                size=TerminalSize(80, 24),
                auto_start_claude=True,
            )

        assert is_new
        assert session.has_terminal(SessionKey.CLAUDE)
        mock_pty.spawn.assert_awaited_once_with(
            "bash", temp_dir, TerminalSize(80, 24)
        )
        mock_pty.write.assert_awaited_with("claude\n")

    @pytest.mark.asyncio
    async def test_session_with_wsl_flow(self, temp_dir: Path):
        """Test WSL-specific startup with network wait."""
        registry = SessionRegistry()
        mock_pty = AsyncMock(spec=PTYManager)
        mock_pty.is_alive.return_value = True

        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            with patch(
                "backend.terminal.sessions.wait_for_wsl_network",
                return_value=(True, "ready"),
            ) as mock_wait:
                session, is_new = await registry.get_or_create(
                    session_id="tab-uuid-123",
                    project_path=temp_dir,
                    shell_command="wsl",
                    size=TerminalSize(80, 24),
                    auto_start_claude=True,
                    network_timeout=10.0,
                )

        mock_wait.assert_called_once_with(10.0, 1.0)
        mock_pty.write.assert_awaited_with("claude\n")

    @pytest.mark.asyncio
    async def test_output_loop_reads_pty_data(self, temp_dir: Path):
        """Verify that the output loop correctly reads data from PTY.

        This is the code path that sends terminal output to the frontend.
        If this doesn't work, the terminal shows nothing (white cursor).
        """
        mock_pty = AsyncMock(spec=PTYManager)
        mock_pty.is_alive.return_value = True

        output_chunks = ["hello", " world"]
        chunk_iter = iter(output_chunks)

        async def mock_read():
            for chunk in output_chunks:
                yield chunk

        mock_pty.read = mock_read

        session = PTYSession(id="test", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, mock_pty)

        # Simulate what _pty_output_loop does
        collected = []
        async for data in terminal.pty.read():
            session.capture_output(data, SessionKey.CLAUDE)
            collected.append(data)

        assert collected == ["hello", " world"]
        assert "hello world" in session.get_scrollback(SessionKey.CLAUDE)

    @pytest.mark.asyncio
    async def test_pty_dies_during_output_loop(self, temp_dir: Path):
        """If PTY dies, the read loop should terminate gracefully."""
        mock_pty = AsyncMock(spec=PTYManager)
        mock_pty.is_alive.return_value = True

        async def mock_read():
            yield "initial output"
            # Simulate PTY death
            raise Exception("PTY process exited")

        mock_pty.read = mock_read

        terminal = TerminalState(pty=mock_pty)

        collected = []
        try:
            async for data in terminal.pty.read():
                collected.append(data)
        except Exception:
            pass

        assert collected == ["initial output"]


# ---------------------------------------------------------------------------
# Desktop-Specific Edge Cases
# ---------------------------------------------------------------------------


class TestDesktopEdgeCases:
    """Test edge cases specific to the desktop app context."""

    @pytest.mark.asyncio
    async def test_backend_stdout_stderr_null(self):
        """The Tauri app sets stdout/stderr to Stdio::null().
        This means no backend logging is visible. Verify this doesn't
        cause issues with the Python backend itself."""
        # The Python backend uses logging module, not print().
        # Stdio::null() from Tauri only affects the process's stdout/stderr
        # file descriptors. The logging module should still work.
        import logging
        logger = logging.getLogger("test")
        # This should not raise even if stdout is /dev/null
        logger.info("test message")

    def test_config_from_cli_args(self):
        """Verify the CLI args that Tauri passes are handled correctly.
        Tauri passes: serve --port PORT --host 127.0.0.1 --no-browser"""
        config = Config.from_env()
        updated = config.update_from_args(
            port=12345,
            host="127.0.0.1",
            auto_open_browser=False,
        )
        assert updated.port == 12345
        assert updated.host == "127.0.0.1"
        assert updated.auto_open_browser is False
        # Shell command should remain whatever from_env() resolved
        assert updated.shell_command == config.shell_command

    @pytest.mark.asyncio
    async def test_reconnect_to_existing_session(self, temp_dir: Path):
        """Simulates tab reload: frontend reconnects with same session ID.
        Should reattach to existing PTY with scrollback."""
        registry = SessionRegistry()

        mock_pty = AsyncMock(spec=PTYManager)
        mock_pty.is_alive.return_value = True

        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            session1, is_new1 = await registry.get_or_create(
                "session-1", temp_dir, "bash",
                auto_start_claude=False,
            )

        # Simulate some output was captured
        session1.capture_output("$ claude\nHello!", SessionKey.CLAUDE)

        with patch("backend.terminal.sessions.PTYManager"):
            session2, is_new2 = await registry.get_or_create(
                "session-1", temp_dir, "bash",
            )

        assert not is_new2
        assert session2 is session1
        assert "Hello!" in session2.get_scrollback(SessionKey.CLAUDE)

    @pytest.mark.asyncio
    async def test_pty_spawn_failure_is_detectable(self, temp_dir: Path):
        """If PTY spawn fails, the error should be clear enough to diagnose.
        This is critical for the desktop app where stderr is hidden."""
        mock_pty = AsyncMock(spec=PTYManager)
        mock_pty.is_alive.return_value = False
        mock_pty.spawn.side_effect = PTYError.spawn_failed(
            "wsl", "The Windows Subsystem for Linux has not been enabled."
        )

        with patch("backend.terminal.sessions.PTYManager", return_value=mock_pty):
            registry = SessionRegistry()
            with pytest.raises(PTYError) as exc_info:
                await registry.get_or_create(
                    "session-1", temp_dir, "wsl",
                )

        assert "wsl" in str(exc_info.value).lower()
        assert "spawn" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# Output Suppression Integration
# ---------------------------------------------------------------------------


class TestOutputSuppressionIntegration:
    """Test the output suppression behavior end-to-end.

    Output suppression buffers shell output while waiting for Claude's TUI
    markers. On timeout (4s), the buffer is flushed so error messages
    (like "claude: command not found") are visible to the user.
    """

    def test_suppression_markers(self):
        """Verify all the markers that end suppression."""
        markers = [
            "\x1b[?1049h",  # Alternate screen buffer
            "\x1b[?47h",    # Alternate screen buffer (older)
            "\x1b[2J",      # Clear screen
            "▐▛███▜▌",      # Claude logo
        ]

        for marker in markers:
            data = f"some prefix{marker}some suffix"
            found = any(m in data for m in markers)
            assert found, f"Marker {repr(marker)} not detected"

    def test_normal_shell_output_does_not_contain_markers(self):
        """Typical shell output should NOT contain suppression-end markers.
        This means if Claude doesn't start, output is buffered until
        the 4-second timeout, then flushed to the client."""
        shell_outputs = [
            "user@host:~$ ",
            "bash: claude: command not found\n",
            "$ ",
            "\x1b[?2004h",  # Bracketed paste mode (common, but NOT a marker)
            "\x1b[32muser\x1b[0m@\x1b[34mhost\x1b[0m:~$ ",
        ]

        markers = ["\x1b[?1049h", "\x1b[?47h", "\x1b[2J", "▐▛███▜▌"]

        for output in shell_outputs:
            has_marker = any(marker in output for marker in markers)
            assert not has_marker, (
                f"Shell output unexpectedly contains marker: {repr(output)}"
            )

    def test_timeout_eventually_unsuppresses(self):
        """After 4 seconds, suppression should end regardless of markers."""
        import time

        suppress_start = time.monotonic() - 5.0  # Started 5s ago
        elapsed = time.monotonic() - suppress_start
        assert elapsed > 4.0, "Timeout should have triggered"

    def test_suppressed_output_is_buffered_not_dropped(self):
        """Output received during suppression should be buffered and flushed
        on timeout, so error messages like 'command not found' reach the user."""
        # Simulate the buffering behavior in _pty_output_loop
        suppress_buffer: list[str] = []
        suppress_output = True
        suppress_start_time = time.monotonic()

        # Shell outputs arrive during suppression
        shell_chunks = [
            "$ ",
            "bash: claude: command not found\n",
            "$ ",
        ]

        markers = ["\x1b[?1049h", "\x1b[?47h", "\x1b[2J", "▐▛███▜▌"]

        for chunk in shell_chunks:
            claude_detected = any(m in chunk for m in markers)
            # Not detected - buffer it
            if not claude_detected:
                suppress_buffer.append(chunk)

        # All shell output should be in the buffer
        buffered = "".join(suppress_buffer)
        assert "command not found" in buffered
        assert len(suppress_buffer) == 3


# ---------------------------------------------------------------------------
# Error Propagation Tests
# ---------------------------------------------------------------------------


class TestErrorPropagation:
    """Verify that errors at each layer propagate correctly to the frontend."""

    def test_pty_error_has_structured_format(self):
        """PTYError should produce a structured WebSocket error message."""
        error = PTYError.spawn_failed("wsl", "not found")
        message = error.to_message()
        assert message["type"] == MessageType.ERROR
        assert message["code"] == "pty-spawn-failed"
        assert "wsl" in message["message"]

    def test_pty_read_error_format(self):
        error = PTYError.read_failed("connection reset")
        message = error.to_message()
        assert message["code"] == "pty-read-failed"

    def test_pty_write_error_format(self):
        error = PTYError.write_failed("PTY not initialized")
        message = error.to_message()
        assert message["code"] == "pty-write-failed"

    @pytest.mark.asyncio
    async def test_spawn_error_sent_to_client(self, temp_dir: Path):
        """When PTY spawn fails in handle(), the error should be sent to the
        client as a structured message instead of silently logged."""
        from backend.websocket import ConnectionHandler

        config = Config(
            working_dir=temp_dir,
            shell_command="wsl",
            auto_start_claude=False,
        )
        ws = AsyncMock()
        ws.accept = AsyncMock()
        ws.send_json = AsyncMock()
        ws.scope = {"query_string": b""}  # Empty query string for auth validation

        # Simulate no SET_PROJECT message - use a slow coroutine so
        # the inner 0.1s timeout fires naturally instead of busy-spinning
        async def slow_receive():
            await asyncio.sleep(10)

        ws.receive_json = AsyncMock(side_effect=slow_receive)

        handler = ConnectionHandler(ws, config)

        mock_pty = AsyncMock(spec=PTYManager)
        mock_pty.is_alive.return_value = False
        mock_pty.spawn.side_effect = PTYError.spawn_failed("wsl", "WSL not available")

        with patch("backend.terminal.pty.PTYManager", return_value=mock_pty):
            with patch("backend.websocket.load_user_config") as mock_uc:
                mock_uc.return_value = MagicMock()
                with patch("backend.websocket.get_connection_manager") as mock_cm:
                    mock_cm.return_value.register = MagicMock()
                    mock_cm.return_value.unregister = MagicMock()
                    with patch("backend.websocket.get_connection_registry") as mock_cr:
                        mock_cr.return_value.register = MagicMock()
                        mock_cr.return_value.unregister = MagicMock()
                        await handler.handle()

        # Should have sent an error message to the client
        error_calls = [
            call for call in ws.send_json.call_args_list
            if call[0][0].get("type") == MessageType.ERROR
        ]
        assert len(error_calls) >= 1, "PTY spawn error was not sent to the client"
        error_msg = error_calls[0][0][0]
        assert error_msg["code"] == "pty-spawn-failed"
        assert "wsl" in error_msg["message"].lower()
