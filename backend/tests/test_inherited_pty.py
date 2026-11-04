"""Tests for InheritedPTY: driving a PTY by descriptor and pid alone.

After an in-place upgrade the pexpect object that spawned a shell is gone
with the old program image, but the master descriptor and the child are
still ours. InheritedPTY has to do everything the spawner did with just
those two numbers.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest

from backend.models import TerminalSize
from backend.terminal.pty import InheritedPTY, PTYManager

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="Unix PTYs only")

SHELL = "bash --norc --noprofile"


async def _read_until(pty, marker: str, timeout: float = 5.0) -> str:
    seen = ""

    async def collect() -> None:
        nonlocal seen
        async for chunk in pty.read():
            seen += chunk
            if marker in seen:
                return

    await asyncio.wait_for(collect(), timeout)
    return seen


@pytest.fixture
async def spawned(tmp_path: Path):
    """A real shell in a UnixPTY, plus the descriptor pair to adopt."""
    manager = PTYManager()
    await manager.spawn(SHELL, tmp_path, TerminalSize(cols=80, rows=24))
    descriptor = manager.handoff_descriptor()
    assert descriptor is not None
    yield manager, descriptor
    await manager.close()


async def test_adopted_pty_echoes_what_it_is_sent(spawned):
    manager, (fd, pid) = spawned
    adopted = PTYManager.adopt(fd, pid)

    await adopted.write("echo marker_$((20+3))\n")
    seen = await _read_until(adopted, "marker_23")
    assert "marker_23" in seen
    assert adopted.pid == pid
    assert adopted.is_alive()


async def test_adopted_pty_resizes_the_terminal(spawned):
    manager, (fd, pid) = spawned
    adopted = PTYManager.adopt(fd, pid)

    await adopted.resize(132, 43)
    await adopted.write("echo cols=$(tput cols) lines=$(tput lines)\n")
    seen = await _read_until(adopted, "lines=43")
    assert "cols=132 lines=43" in seen


async def test_stop_reading_ends_the_loop_without_dropping_the_chunk_in_flight(spawned):
    manager, (fd, pid) = spawned
    adopted = PTYManager.adopt(fd, pid)
    chunks: list[str] = []

    async def reader() -> None:
        async for chunk in adopted.read():
            chunks.append(chunk)

    task = asyncio.create_task(reader())
    await adopted.write("echo first_line\n")
    for _ in range(50):
        if any("first_line" in c for c in chunks):
            break
        await asyncio.sleep(0.1)
    adopted.stop_reading()
    await asyncio.wait_for(task, 2.0)
    assert any("first_line" in c for c in chunks)

    # Output written while nobody reads waits in the PTY for the next reader.
    await adopted.write("echo second_line\n")
    seen = await _read_until(adopted, "second_line")
    assert "second_line" in seen


async def test_close_ends_the_child(spawned):
    manager, (fd, pid) = spawned
    adopted = PTYManager.adopt(fd, pid)
    assert adopted.is_alive()

    await adopted.close()

    assert not adopted.is_alive()
    with pytest.raises(OSError):
        os.fstat(fd)


async def test_adopted_pty_notices_when_the_child_exits(spawned):
    manager, (fd, pid) = spawned
    adopted = PTYManager.adopt(fd, pid)

    await adopted.write("exit 0\n")
    chunks: list[str] = []
    async for chunk in adopted.read():
        chunks.append(chunk)
    assert not adopted.is_alive()


async def test_split_utf8_sequences_are_reassembled(tmp_path: Path):
    """A read boundary inside a multi-byte character must not corrupt it."""
    read_fd, write_fd = os.pipe()
    pty = InheritedPTY(read_fd, os.getpid())
    try:
        snowman = "☃".encode("utf-8")
        os.write(write_fd, snowman[:1])
        first = pty._read_chunk()
        os.write(write_fd, snowman[1:])
        second = pty._read_chunk()
        assert first + second == "☃"
    finally:
        os.close(write_fd)
        os.close(read_fd)


async def test_spawn_is_refused():
    pty = InheritedPTY(0, os.getpid())
    with pytest.raises(Exception):
        await pty.spawn("bash", Path.cwd(), TerminalSize(cols=80, rows=24))
