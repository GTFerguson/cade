"""A terminal session runs in its own systemd scope, so a memory kill aimed at
one heavy agent does not take the backend and every other session with it."""

from __future__ import annotations

import asyncio
import logging
import subprocess
from pathlib import Path

import pytest

from backend.main import setup_logging
from backend.models import TerminalSize
from backend.terminal import pty as pty_module
from backend.terminal.pty import UnixPTY, session_scope_prefix


def own_cgroup() -> str:
    return Path("/proc/self/cgroup").read_text().strip()


async def run_in_pty(command: str, env: dict[str, str] | None = None) -> tuple[str, int]:
    """Spawn a command in a real PTY; return its output and the spawned pid."""
    pty = UnixPTY()
    await pty.spawn(command, Path("/tmp"), TerminalSize(80, 24), env)
    pid = pty.pid
    chunks: list[str] = []

    async def collect() -> None:
        async for chunk in pty.read():
            chunks.append(chunk)

    try:
        await asyncio.wait_for(collect(), timeout=10)
    finally:
        await pty.close()
    return "".join(chunks), pid


@pytest.fixture(autouse=True)
def fresh_probe(monkeypatch):
    monkeypatch.setattr(pty_module, "_session_scope_prefix_cache", None)


@pytest.fixture
def scopes_available():
    if not session_scope_prefix():
        pytest.skip("no usable systemd user manager on this machine")


class TestScopedSpawn:
    @pytest.mark.asyncio
    async def test_session_gets_a_cgroup_of_its_own(self, scopes_available):
        out, _ = await run_in_pty("cat /proc/self/cgroup")
        session_cgroup = out.strip()
        assert session_cgroup.endswith(".scope")
        assert session_cgroup != own_cgroup()

    @pytest.mark.asyncio
    async def test_two_sessions_do_not_share_a_cgroup(self, scopes_available):
        first, _ = await run_in_pty("cat /proc/self/cgroup")
        second, _ = await run_in_pty("cat /proc/self/cgroup")
        assert first.strip() != second.strip()

    @pytest.mark.asyncio
    async def test_reported_pid_is_the_command_itself(self, scopes_available):
        # Signals and liveness checks go to this pid, so it must not be a
        # wrapper process that outlives or predeceases the shell.
        out, pid = await run_in_pty("sh -c 'echo pid=$$'")
        assert f"pid={pid}" in out

    @pytest.mark.asyncio
    async def test_environment_and_quoted_arguments_survive(self, scopes_available):
        out, _ = await run_in_pty(
            "sh -c 'echo \"$CADE_SESSION_ID / two  spaces\"'",
            {"CADE_SESSION_ID": "tab-42"},
        )
        assert "tab-42 / two  spaces" in out


class TestFallback:
    @pytest.mark.asyncio
    async def test_runs_as_a_plain_child_without_systemd(self, monkeypatch):
        monkeypatch.setattr(pty_module, "_session_scope_prefix_cache", [])
        out, _ = await run_in_pty("cat /proc/self/cgroup")
        assert out.strip() == own_cgroup()

    def test_no_prefix_when_systemd_run_is_missing(self, monkeypatch):
        monkeypatch.setattr(pty_module.shutil, "which", lambda _: None)
        assert session_scope_prefix() == []

    def test_no_prefix_when_the_probe_fails(self, monkeypatch):
        monkeypatch.setattr(pty_module.shutil, "which", lambda _: "/usr/bin/systemd-run")
        failed = subprocess.CompletedProcess([], 1, b"", b"Failed to connect to bus")
        monkeypatch.setattr(pty_module.subprocess, "run", lambda *a, **k: failed)
        assert session_scope_prefix() == []

    def test_no_prefix_when_the_probe_hangs(self, monkeypatch):
        monkeypatch.setattr(pty_module.shutil, "which", lambda _: "/usr/bin/systemd-run")

        def hang(*a, **k):
            raise subprocess.TimeoutExpired("systemd-run", 5)

        monkeypatch.setattr(pty_module.subprocess, "run", hang)
        assert session_scope_prefix() == []

    def test_probe_runs_once(self, monkeypatch):
        monkeypatch.setattr(pty_module.shutil, "which", lambda _: "/usr/bin/systemd-run")
        calls = []

        def ok(*a, **k):
            calls.append(a)
            return subprocess.CompletedProcess([], 0, b"", b"")

        monkeypatch.setattr(pty_module.subprocess, "run", ok)
        assert session_scope_prefix() == session_scope_prefix() != []
        assert len(calls) == 1


class TestLogNoise:
    @pytest.mark.parametrize("debug", [True, False])
    def test_file_watcher_chatter_is_kept_out_of_the_log(self, debug, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        root = logging.getLogger()
        saved_handlers, saved_level = root.handlers[:], root.level
        root.handlers.clear()
        try:
            setup_logging(debug=debug)
            assert not logging.getLogger("watchfiles.main").isEnabledFor(logging.DEBUG)
            assert logging.getLogger("backend.x").isEnabledFor(logging.DEBUG) is debug
        finally:
            for h in root.handlers:
                h.close()
            root.handlers[:] = saved_handlers
            root.setLevel(saved_level)
            logging.getLogger("watchfiles").setLevel(logging.NOTSET)
            logging.getLogger("uvicorn").setLevel(logging.NOTSET)
