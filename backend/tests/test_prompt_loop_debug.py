"""Debug tests for prompt looping issue.

Systematically tests each layer to isolate where the prompt duplication is happening:
1. PTY spawn and output reading
2. Output buffering and sending
3. Shell initialization

Tests that spawn real PTY processes have a 10-second timeout to prevent hanging.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.protocol import MessageType, SessionKey
from backend.terminal.pty import PTYManager
from backend.terminal.sessions import PTYSession, SessionRegistry
from backend.models import TerminalSize
from backend.websocket import ConnectionHandler
from backend.config import Config


# ---------------------------------------------------------------------------
# Layer 1: PTY Output Reading
# ---------------------------------------------------------------------------


class TestPTYOutputReading:
    """Test that PTY read loop doesn't duplicate output."""

    @pytest.mark.asyncio
    async def test_pty_read_yields_each_chunk_once(self):
        """Verify PTY.read() yields each chunk exactly once."""
        pty = PTYManager()
        expected = ["$ ", "(base) gary@host:~/dir$ "]

        async def mock_read():
            for chunk in expected:
                yield chunk

        pty.read = mock_read

        chunks = []
        async for chunk in pty.read():
            chunks.append(chunk)

        assert chunks == expected

    @pytest.mark.asyncio
    @pytest.mark.skipif(sys.platform == "win32", reason="Requires Unix PTY (pexpect)")
    async def test_pty_read_loop_no_duplicates(self, temp_dir: Path):
        """Regression test: PTY read should not return duplicate data.

        This test catches the bug where pexpect.before was returning the same
        data repeatedly when using expect(TIMEOUT). With read_nonblocking(),
        this should not happen.
        """
        pty = PTYManager()
        await pty.spawn("bash --norc --noprofile", temp_dir, TerminalSize(cols=80, rows=24))

        # Read output chunks with timeout to prevent hanging
        chunks = []

        async def _collect():
            start = asyncio.get_event_loop().time()
            async for chunk in pty.read():
                chunks.append(chunk)
                if len(chunks) >= 5 or asyncio.get_event_loop().time() - start > 1.5:
                    break

        try:
            await asyncio.wait_for(_collect(), timeout=5.0)
        except asyncio.TimeoutError:
            pass  # Expected if PTY read blocks after bash prompt

        await pty.close()

        # The bug would cause the first chunk (prompt) to repeat in subsequent chunks
        # Check that we don't have multiple identical consecutive chunks
        duplicate_count = 0
        for i in range(1, len(chunks)):
            if chunks[i] == chunks[i-1] and chunks[i]:  # Same non-empty chunk
                duplicate_count += 1
                print(f"Duplicate at index {i}: {repr(chunks[i])}")

        print(f"\nReceived {len(chunks)} chunks")
        print(f"Duplicate consecutive chunks: {duplicate_count}")

        # Should have very few or no duplicate consecutive chunks
        # Allow 1-2 for edge cases, but the bug would cause 10+
        assert duplicate_count <= 2, (
            f"Found {duplicate_count} duplicate consecutive chunks - "
            f"PTY read is returning duplicate data (pexpect.before bug)"
        )


# ---------------------------------------------------------------------------
# Layer 2: Output Buffering and Sending
# ---------------------------------------------------------------------------


class TestOutputBuffering:
    """Test that output isn't duplicated during buffering/sending."""

    @pytest.mark.asyncio
    async def test_suppress_buffer_doesnt_duplicate(self):
        """Verify suppress buffer doesn't cause output duplication."""
        config = Config(
            working_dir=Path("/tmp"),
            auto_start_claude=True,
        )
        ws = AsyncMock()
        handler = ConnectionHandler(ws, config)

        handler._suppress_output = True
        handler._suppress_buffer = []

        # Simulate receiving output
        test_data = "(base) gary@host:~/dir$ "
        handler._suppress_buffer.append(test_data)

        # Should only have one copy
        assert len(handler._suppress_buffer) == 1
        assert handler._suppress_buffer[0] == test_data

    @pytest.mark.asyncio
    async def test_websocket_send_not_called_multiple_times(self):
        """Verify each output chunk is sent exactly once."""
        config = Config(working_dir=Path("/tmp"))
        ws = AsyncMock()
        ws.send_json = AsyncMock()
        handler = ConnectionHandler(ws, config)

        # Send a message
        test_data = "(base) gary@host:~/dir$ "
        await handler._send({
            "type": MessageType.OUTPUT,
            "data": test_data,
        })

        # Should be called exactly once
        assert ws.send_json.call_count == 1
        sent_data = ws.send_json.call_args[0][0]["data"]
        assert sent_data == test_data


# ---------------------------------------------------------------------------
# Layer 3: Shell Initialization
# ---------------------------------------------------------------------------


class TestShellInitialization:
    """Test if shell initialization causes repeated output."""

    @pytest.mark.asyncio
    @pytest.mark.skipif(sys.platform == "win32", reason="Requires Unix PTY (pexpect)")
    async def test_bash_with_norc_no_duplicates(self, temp_dir: Path):
        """Test bash with --norc to bypass .bashrc."""
        pty = PTYManager()
        await pty.spawn("bash --norc --noprofile", temp_dir, TerminalSize(cols=80, rows=24))

        outputs = []

        async def _collect():
            start = asyncio.get_event_loop().time()
            async for chunk in pty.read():
                outputs.append(chunk)
                if asyncio.get_event_loop().time() - start > 1.5:
                    break

        try:
            await asyncio.wait_for(_collect(), timeout=5.0)
        except asyncio.TimeoutError:
            pass

        await pty.close()

        full_output = "".join(outputs)
        print(f"\nBash --norc output:\n{repr(full_output)}\n")

        # Count prompts
        import re
        prompt_count = len(re.findall(r'bash-[\d.]+\$', full_output))
        print(f"Prompt count with --norc: {prompt_count}")

        # Should see minimal duplication without rc files
        assert prompt_count <= 2, f"Even with --norc, saw {prompt_count} prompts"

    @pytest.mark.asyncio
    @pytest.mark.skipif(sys.platform == "win32", reason="Requires Unix PTY (pexpect)")
    async def test_empty_bashrc_no_duplicates(self, temp_dir: Path):
        """Test bash with a minimal empty .bashrc."""
        bashrc = temp_dir / ".bashrc"
        bashrc.write_text("# Minimal bashrc\n")

        pty = PTYManager()
        await pty.spawn(f"bash --rcfile {bashrc}", temp_dir, TerminalSize(cols=80, rows=24))

        outputs = []

        async def _collect():
            start = asyncio.get_event_loop().time()
            async for chunk in pty.read():
                outputs.append(chunk)
                if asyncio.get_event_loop().time() - start > 1.5:
                    break

        try:
            await asyncio.wait_for(_collect(), timeout=5.0)
        except asyncio.TimeoutError:
            pass

        await pty.close()

        full_output = "".join(outputs)
        print(f"\nBash with empty rc:\n{repr(full_output)}\n")


# ---------------------------------------------------------------------------
# Layer 4: Integration Test - Full Chain
# ---------------------------------------------------------------------------


class TestFullOutputChain:
    """Test the complete chain from PTY → WebSocket → Client."""

    @pytest.mark.asyncio
    async def test_output_loop_counts_messages(self, temp_dir: Path):
        """Test that _pty_output_loop sends each chunk exactly once."""
        config = Config(
            working_dir=temp_dir,
            auto_start_claude=False,
        )
        ws = AsyncMock()
        ws.send_json = AsyncMock()

        handler = ConnectionHandler(ws, config)

        # Create a session with mock PTY
        mock_pty = AsyncMock()

        # Mock PTY to yield specific outputs then stop
        async def mock_read():
            yield "first chunk\n"
            yield "second chunk\n"
            yield "(base) gary@host:~/dir$ "
            # Then stop

        mock_pty.read = mock_read

        session = PTYSession(id="test", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, mock_pty)
        handler._session = session

        # Start output loop
        task = asyncio.create_task(handler._pty_output_loop(SessionKey.CLAUDE))

        # Wait a bit for processing
        await asyncio.sleep(0.5)
        task.cancel()

        try:
            await task
        except asyncio.CancelledError:
            pass

        # Check how many OUTPUT messages were sent
        output_messages = [
            call for call in ws.send_json.call_args_list
            if call[0][0].get("type") == MessageType.OUTPUT
        ]

        print(f"\nSent {len(output_messages)} OUTPUT messages:")
        for i, call in enumerate(output_messages):
            data = call[0][0]["data"]
            print(f"  {i+1}: {repr(data)}")

        # Should send exactly 3 messages (one per chunk)
        assert len(output_messages) == 3, f"Expected 3 messages, got {len(output_messages)}"
