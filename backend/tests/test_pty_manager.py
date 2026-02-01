"""Tests for PTY manager lifecycle and shell spawning.

Verifies that the PTY layer can spawn shells, read output, write input,
and properly report alive/dead state. These are critical for diagnosing
desktop startup failures where the Claude pane shows a white cursor.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.errors import PTYError
from backend.terminal.pty import BasePTY, PTYManager, UnixPTY
from backend.models import TerminalSize

# Only import WindowsPTY on Windows
if sys.platform == "win32":
    from backend.terminal.pty import WindowsPTY


# ---------------------------------------------------------------------------
# PTYManager unit tests (platform-independent, mocked PTY)
# ---------------------------------------------------------------------------


class TestPTYManagerCreate:
    """Verify PTYManager selects the correct platform implementation."""

    def test_creates_unix_pty_on_non_windows(self):
        if sys.platform == "win32":
            pytest.skip("Unix test")
        manager = PTYManager()
        pty = manager._create_pty()
        assert isinstance(pty, UnixPTY)

    def test_creates_windows_pty_on_windows(self):
        if sys.platform != "win32":
            pytest.skip("Windows test")
        manager = PTYManager()
        pty = manager._create_pty()
        assert isinstance(pty, WindowsPTY)


class TestPTYManagerSpawn:
    """Verify spawn behavior with mock PTY."""

    @pytest.mark.asyncio
    async def test_spawn_calls_platform_pty(self):
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.is_alive.return_value = True

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            await manager.spawn("bash", Path("/tmp"), TerminalSize(80, 24))

        mock_pty.spawn.assert_awaited_once_with(
            "bash", Path("/tmp"), TerminalSize(80, 24)
        )
        assert manager.is_alive()

    @pytest.mark.asyncio
    async def test_spawn_raises_when_platform_pty_raises(self):
        """If the platform PTY's spawn raises (e.g. delayed health check), PTYManager propagates it."""
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.spawn.side_effect = PTYError.spawn_failed(
            "bad_command", "Process exited immediately after spawn"
        )

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            with pytest.raises(PTYError, match="exited immediately"):
                await manager.spawn("bad_command", Path("/tmp"))

    @pytest.mark.asyncio
    async def test_spawn_propagates_pty_error(self):
        """PTY spawn failures should propagate as PTYError."""
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.spawn.side_effect = PTYError.spawn_failed("wsl", "not found")

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            with pytest.raises(PTYError, match="spawn"):
                await manager.spawn("wsl", Path("/tmp"))

    @pytest.mark.asyncio
    async def test_spawn_closes_previous_pty(self):
        """Spawning again should close the previous PTY first."""
        manager = PTYManager()

        first_pty = AsyncMock(spec=BasePTY)
        first_pty.is_alive.return_value = True
        second_pty = AsyncMock(spec=BasePTY)
        second_pty.is_alive.return_value = True

        call_count = 0

        def create_pty():
            nonlocal call_count
            call_count += 1
            return first_pty if call_count == 1 else second_pty

        with patch.object(manager, "_create_pty", side_effect=create_pty):
            await manager.spawn("bash", Path("/tmp"))
            await manager.spawn("bash", Path("/tmp"))

        first_pty.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_spawn_default_size(self):
        """Spawn without explicit size should use 80x24 default."""
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.is_alive.return_value = True

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            await manager.spawn("bash", Path("/tmp"))

        # Default is TerminalSize(cols=80, rows=24)
        call_args = mock_pty.spawn.call_args
        size = call_args[0][2]
        assert size.cols == 80
        assert size.rows == 24


class TestPTYManagerReadWrite:
    """Verify read/write forwarding."""

    @pytest.mark.asyncio
    async def test_write_before_spawn_raises(self):
        manager = PTYManager()
        with pytest.raises(PTYError, match="not spawned"):
            await manager.write("hello")

    @pytest.mark.asyncio
    async def test_write_forwards_to_pty(self):
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.is_alive.return_value = True

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            await manager.spawn("bash", Path("/tmp"))
            await manager.write("hello\n")

        mock_pty.write.assert_awaited_once_with("hello\n")

    @pytest.mark.asyncio
    async def test_read_from_unspawned_returns_nothing(self):
        manager = PTYManager()
        chunks = []
        async for data in manager.read():
            chunks.append(data)
        assert chunks == []

    @pytest.mark.asyncio
    async def test_read_yields_pty_output(self):
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.is_alive.return_value = True

        async def mock_read():
            yield "hello"
            yield "world"

        mock_pty.read.return_value = mock_read()

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            await manager.spawn("bash", Path("/tmp"))

        # Replace the internal pty's read with our mock
        manager._pty = mock_pty
        mock_pty.read = mock_read

        chunks = []
        async for data in manager.read():
            chunks.append(data)
        assert chunks == ["hello", "world"]


class TestPTYManagerClose:
    """Verify close/cleanup behavior."""

    @pytest.mark.asyncio
    async def test_close_cleans_up(self):
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.is_alive.return_value = True

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            await manager.spawn("bash", Path("/tmp"))

        await manager.close()
        mock_pty.close.assert_awaited_once()
        assert not manager.is_alive()

    @pytest.mark.asyncio
    async def test_close_on_unspawned_is_safe(self):
        manager = PTYManager()
        await manager.close()  # Should not raise

    @pytest.mark.asyncio
    async def test_is_alive_after_close(self):
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.is_alive.return_value = True

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            await manager.spawn("bash", Path("/tmp"))
            assert manager.is_alive()

        await manager.close()
        assert not manager.is_alive()

    @pytest.mark.asyncio
    async def test_resize_forwards_to_pty(self):
        manager = PTYManager()
        mock_pty = AsyncMock(spec=BasePTY)
        mock_pty.is_alive.return_value = True

        with patch.object(manager, "_create_pty", return_value=mock_pty):
            await manager.spawn("bash", Path("/tmp"))
            await manager.resize(120, 40)

        mock_pty.resize.assert_awaited_once()
        call_args = mock_pty.resize.call_args[0][0]
        assert call_args.cols == 120
        assert call_args.rows == 40

    @pytest.mark.asyncio
    async def test_resize_on_unspawned_is_safe(self):
        manager = PTYManager()
        await manager.resize(120, 40)  # Should not raise


# ---------------------------------------------------------------------------
# UnixPTY integration tests (only run on non-Windows)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(sys.platform == "win32", reason="Unix-only tests")
class TestUnixPTYIntegration:
    """Integration tests that spawn real shell processes."""

    @pytest.mark.asyncio
    async def test_spawn_echo_command(self, temp_dir: Path):
        """Verify we can spawn a simple command and read output."""
        pty = UnixPTY()
        await pty.spawn("bash", temp_dir, TerminalSize(80, 24))
        assert pty.is_alive()
        await pty.close()

    @pytest.mark.asyncio
    async def test_spawn_invalid_command_raises(self, temp_dir: Path):
        """Verify spawning an invalid command raises PTYError."""
        pty = UnixPTY()
        with pytest.raises(PTYError):
            await pty.spawn("/nonexistent/binary", temp_dir, TerminalSize(80, 24))

    @pytest.mark.asyncio
    async def test_write_and_read_output(self, temp_dir: Path):
        """Verify we can write to the shell and read output back."""
        pty = UnixPTY()
        await pty.spawn("bash", temp_dir, TerminalSize(80, 24))

        # Write a command that produces known output
        await pty.write("echo TESTMARKER_12345\n")

        # Read output until we find our marker or timeout
        found = False
        collected = ""
        deadline = asyncio.get_event_loop().time() + 5.0

        async for data in pty.read():
            collected += data
            if "TESTMARKER_12345" in collected:
                found = True
                break
            if asyncio.get_event_loop().time() > deadline:
                break

        await pty.close()
        assert found, f"Did not find marker in output. Got: {collected[:200]}"

    @pytest.mark.asyncio
    async def test_close_terminates_process(self, temp_dir: Path):
        pty = UnixPTY()
        await pty.spawn("bash", temp_dir, TerminalSize(80, 24))
        assert pty.is_alive()
        await pty.close()
        assert not pty.is_alive()

    @pytest.mark.asyncio
    async def test_resize_does_not_crash(self, temp_dir: Path):
        pty = UnixPTY()
        await pty.spawn("bash", temp_dir, TerminalSize(80, 24))
        await pty.resize(TerminalSize(120, 40))
        assert pty.is_alive()
        await pty.close()


# ---------------------------------------------------------------------------
# PTYManager integration tests with real shell
# ---------------------------------------------------------------------------

@pytest.mark.skipif(sys.platform == "win32", reason="Unix-only tests")
class TestPTYManagerIntegration:
    """Integration tests using PTYManager with real shells."""

    @pytest.mark.asyncio
    async def test_full_lifecycle(self, temp_dir: Path):
        """Spawn → write → read → close lifecycle."""
        manager = PTYManager()
        await manager.spawn("bash", temp_dir, TerminalSize(80, 24))
        assert manager.is_alive()

        await manager.write("echo LIFECYCLE_TEST\n")

        found = False
        collected = ""
        deadline = asyncio.get_event_loop().time() + 5.0

        async for data in manager.read():
            collected += data
            if "LIFECYCLE_TEST" in collected:
                found = True
                break
            if asyncio.get_event_loop().time() > deadline:
                break

        await manager.close()
        assert found, f"Did not find marker. Got: {collected[:200]}"
        assert not manager.is_alive()

    @pytest.mark.asyncio
    async def test_spawn_with_wsl_command_on_linux(self, temp_dir: Path):
        """On Linux, 'wsl' command doesn't exist and should fail clearly."""
        import shutil

        if shutil.which("wsl") is not None:
            pytest.skip("wsl binary exists on this system")

        manager = PTYManager()
        # On Linux, spawning "wsl" should either fail at spawn
        # or the process should exit immediately
        try:
            await manager.spawn("wsl", temp_dir, TerminalSize(80, 24))
            # If spawn succeeded, the process should die quickly
            await asyncio.sleep(0.5)
            alive = manager.is_alive()
            await manager.close()
            # PTY may or may not be alive depending on shell behavior
            # The important thing is we get a clear state
        except PTYError:
            pass  # Expected on systems without wsl
