"""Tests for the in-place upgrade: manifest, export/import, coordinator, exec.

The point of the upgrade is that a shell started under one program image is
still usable from the next one. The exec test proves that with a real
``execv``; the in-process tests pin the pieces around it.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from backend import upgrade
from backend.models import TerminalSize
from backend.terminal.sessions import SessionRegistry
from core.backend.chat.session import ChatSession, ChatSessionRegistry

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="exec-in-place is Unix only")

SHELL = "bash --norc --noprofile"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


async def _wait_for(predicate, timeout: float = 10.0) -> None:
    for _ in range(int(timeout / 0.05)):
        if predicate():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("timed out waiting for terminal output")


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def test_manifest_round_trips_through_json(tmp_path: Path):
    manifest = upgrade.Manifest(
        sessions=[upgrade.SessionHandoff(
            id="s1", project_path="/p", label="L", last_activity=1.0, created_at=0.5,
            mcp_config_path=None, attention="input", attention_message="m", attention_at=2.0,
            terminals=[upgrade.TerminalHandoff(
                session_key="claude", master_fd=7, pid=99, last_seq=12,
                scrollback=[(11, "a"), (12, "b")], size={"cols": 100, "rows": 30}, exited=False,
            )],
        )],
        chat={"s1": {"provider_name": "p", "messages": []}},
        listener_fd=5,
        old_meipass="/tmp/_MEIold",
    )
    path = upgrade.write_manifest(manifest, tmp_path / "h.json")
    back = upgrade.read_manifest(path)
    assert back.to_dict() == manifest.to_dict()
    assert back.inherited_fds == [7, 5]


def test_unknown_manifest_version_is_refused(tmp_path: Path):
    path = tmp_path / "h.json"
    path.write_text(json.dumps({"version": 99}))
    with pytest.raises(upgrade.UpgradeError):
        upgrade.read_manifest(path)


def test_exec_argv_restarts_serve_with_the_manifest(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    argv = upgrade.exec_argv("/usr/bin/python3", ["serve", "--port", "1"], tmp_path / "h.json")
    assert argv == [
        "/usr/bin/python3", "-m", "backend.main", "serve", "--port", "1",
        upgrade.RESUME_FLAG, str(tmp_path / "h.json"),
    ]


def test_exec_argv_drops_an_earlier_resume_flag_and_is_frozen_aware(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    argv = upgrade.exec_argv(
        "/usr/bin/cade-backend",
        ["serve", "--port", "1", upgrade.RESUME_FLAG, "/old.json", "--debug"],
        tmp_path / "new.json",
    )
    assert argv == [
        "/usr/bin/cade-backend", "serve", "--port", "1", "--debug",
        upgrade.RESUME_FLAG, str(tmp_path / "new.json"),
    ]


def test_exec_argv_inserts_serve_when_only_flags_were_given(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    argv = upgrade.exec_argv("/x", ["--port", "1"], tmp_path / "h.json")
    assert argv[1:3] == ["serve", "--port"]


def test_build_id_is_stable_within_a_process():
    assert upgrade.build_id() == upgrade.build_id()


# ---------------------------------------------------------------------------
# Listener
# ---------------------------------------------------------------------------


def test_listener_is_adopted_from_its_descriptor():
    sock = upgrade.bind_listener("127.0.0.1", 0)
    try:
        manifest = upgrade.Manifest(sessions=[], chat={}, listener_fd=sock.fileno(), old_meipass=None)
        adopted = upgrade.adopt_listener(manifest)
        assert adopted is not None
        assert adopted.getsockname() == sock.getsockname()
        assert not adopted.get_inheritable()
        adopted.detach()  # shares the fd with sock; let sock own the close
    finally:
        sock.close()


def test_missing_listener_descriptor_gives_none():
    manifest = upgrade.Manifest(sessions=[], chat={}, listener_fd=None, old_meipass=None)
    assert upgrade.adopt_listener(manifest) is None


# ---------------------------------------------------------------------------
# Chat sessions
# ---------------------------------------------------------------------------


def test_chat_history_round_trips_and_keeps_a_partial_reply():
    session = ChatSession(provider_name="mistral")
    session.add_user_message("hello")
    session.start_response()
    session.append_response_chunk("partial ")
    session.append_response_chunk("answer")
    data = session.to_handoff()
    back = ChatSession.from_handoff(data)
    assert back.provider_name == "mistral"
    assert back.get_history_for_replay() == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "partial answer"},
    ]
    assert not back.is_streaming


def test_chat_registry_carries_only_sessions_with_content():
    registry = ChatSessionRegistry()
    registry.get_or_create("empty")
    registry.get_or_create("full").add_user_message("x")
    data = registry.to_handoff()
    assert set(data) == {"full"}
    other = ChatSessionRegistry()
    other.adopt(data)
    assert other.get("full") is not None
    assert other.get("full").get_history_for_replay() == [{"role": "user", "content": "x"}]


def test_any_streaming_reports_a_response_in_flight():
    registry = ChatSessionRegistry()
    s = registry.get_or_create("a")
    assert not registry.any_streaming()
    s.start_response()
    assert registry.any_streaming()
    s.finish_response()
    assert not registry.any_streaming()


# ---------------------------------------------------------------------------
# Export / import in one process
# ---------------------------------------------------------------------------


async def test_sessions_survive_export_and_import(tmp_path: Path):
    old = SessionRegistry()
    session, _ = await old.get_or_create("tab-1", tmp_path, SHELL, TerminalSize(cols=80, rows=24))
    session.label = "first"
    await session.pty.write("echo one_$((1+1))\n")
    await _wait_for(lambda: "one_2" in session.get_scrollback())
    seq = session.terminals["claude"].last_seq

    sessions = await upgrade.export_sessions(old)
    assert [s.id for s in sessions] == ["tab-1"]
    assert sessions[0].terminals[0].last_seq == seq
    # The reader is paused, not ended: no output is read while the manifest exists.
    assert session.terminals["claude"].output_task.done()

    manifest = upgrade.Manifest(sessions=sessions, chat={}, listener_fd=None, old_meipass=None)
    new = SessionRegistry()
    assert upgrade.import_sessions(manifest, new) == 1
    adopted = new.get("tab-1")
    assert adopted is not None and adopted.label == "first"
    terminal = adopted.terminals["claude"]
    assert terminal.last_seq == seq
    assert "one_2" in adopted.get_scrollback()

    await adopted.pty.write("echo two_$((2+2))\n")
    await _wait_for(lambda: "two_4" in adopted.get_scrollback())
    assert terminal.last_seq > seq

    await new.stop()
    assert not adopted.pty.is_alive()
    # `old` still references the pexpect object; keep it alive until here so
    # its finaliser cannot kill the shell under the test.
    del old


def test_import_skips_descriptors_not_open_here():
    closed_fd = os.dup(0)
    os.close(closed_fd)
    manifest = upgrade.Manifest(
        sessions=[upgrade.SessionHandoff(
            id="s", project_path="/p", label=None, last_activity=0, created_at=0,
            mcp_config_path=None, attention=None, attention_message=None, attention_at=0,
            terminals=[upgrade.TerminalHandoff("claude", closed_fd, 1, 0, [], None, False)],
        )],
        chat={}, listener_fd=None, old_meipass=None,
    )
    registry = SessionRegistry()
    assert upgrade.import_sessions(manifest, registry) == 0
    assert registry.sessions() == []


def test_old_extraction_dir_is_removed_only_when_it_is_a_sibling(tmp_path: Path, monkeypatch):
    ours = tmp_path / "_MEIours"
    old = tmp_path / "_MEIold"
    unrelated = tmp_path / "important"
    for d in (ours, old, unrelated):
        d.mkdir()
    monkeypatch.setattr(sys, "_MEIPASS", str(ours), raising=False)

    upgrade.remove_old_extraction(upgrade.Manifest([], {}, None, str(unrelated)))
    assert unrelated.exists()
    upgrade.remove_old_extraction(upgrade.Manifest([], {}, None, str(old)))
    assert not old.exists()
    assert ours.exists()


# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------


class Performed:
    def __init__(self) -> None:
        self.executables: list[str] = []
        self.event = asyncio.Event()

    async def __call__(self, executable: str) -> None:
        self.executables.append(executable)
        self.event.set()


def _coordinator(busy, performed, **kw) -> upgrade.UpgradeCoordinator:
    return upgrade.UpgradeCoordinator(
        busy=busy, perform=performed, verify=lambda exe: f"v-{Path(exe).name}", poll=0.01, **kw,
    )


async def test_upgrade_runs_at_once_when_idle():
    performed = Performed()
    coord = _coordinator(lambda: None, performed)
    status = await coord.request("/new/cade-backend")
    assert status.state == "pending" and status.version == "v-cade-backend"
    await asyncio.wait_for(performed.event.wait(), 2.0)
    assert performed.executables == ["/new/cade-backend"]
    assert coord.status.state == "upgrading"


async def test_upgrade_waits_for_the_backend_to_go_idle():
    performed = Performed()
    reasons = ["streaming", "streaming", "streaming", None]
    coord = _coordinator(lambda: reasons.pop(0) if reasons else None, performed)
    await coord.request("/x")
    await asyncio.sleep(0.02)
    assert coord.status.busy_reason == "streaming"
    await asyncio.wait_for(performed.event.wait(), 2.0)
    assert performed.executables == ["/x"]


async def test_upgrade_proceeds_after_the_idle_cap():
    performed = Performed()
    coord = _coordinator(lambda: "forever busy", performed, idle_cap=0.05)
    await coord.request("/x")
    await asyncio.wait_for(performed.event.wait(), 2.0)
    assert performed.executables == ["/x"]


async def test_now_skips_the_idle_wait():
    performed = Performed()
    coord = _coordinator(lambda: "busy", performed, idle_cap=60)
    await coord.request("/x", now=True)
    await asyncio.wait_for(performed.event.wait(), 2.0)


async def test_a_second_request_retargets_a_pending_upgrade():
    performed = Performed()
    gate = {"busy": "busy"}
    coord = _coordinator(lambda: gate["busy"], performed)
    await coord.request("/first")
    await coord.request("/second")
    gate["busy"] = None
    await asyncio.wait_for(performed.event.wait(), 2.0)
    await asyncio.sleep(0.05)
    assert performed.executables == ["/second"]


async def test_cancel_clears_a_pending_upgrade():
    performed = Performed()
    coord = _coordinator(lambda: "busy", performed)
    await coord.request("/x")
    status = coord.cancel()
    assert status.state == "idle"
    await asyncio.sleep(0.05)
    assert performed.executables == []


async def test_a_binary_that_does_not_verify_is_refused():
    performed = Performed()

    def verify(exe: str) -> str:
        raise upgrade.UpgradeError("no such binary")

    coord = upgrade.UpgradeCoordinator(busy=lambda: None, perform=performed, verify=verify)
    with pytest.raises(upgrade.UpgradeError):
        await coord.request("/missing")
    assert coord.status.state == "idle"
    assert performed.executables == []


async def test_a_failed_handoff_leaves_the_backend_idle_with_the_error():
    async def perform(exe: str) -> None:
        raise RuntimeError("exec blew up")

    coord = upgrade.UpgradeCoordinator(busy=lambda: None, perform=perform, verify=lambda e: "v")
    await coord.request("/x")
    for _ in range(50):
        if coord.status.state == "idle":
            break
        await asyncio.sleep(0.01)
    assert coord.status.state == "idle"
    assert "exec blew up" in (coord.status.error or "")


def test_verify_runs_the_real_version_flag():
    version = upgrade.verify_executable(sys.executable)
    assert version.startswith("cade-backend ")


# ---------------------------------------------------------------------------
# The real thing: a shell outlives an exec
# ---------------------------------------------------------------------------


def test_a_shell_outlives_a_real_exec(tmp_path: Path):
    manifest_path = tmp_path / "handoff" / "handoff.json"
    manifest_path.parent.mkdir()
    workdir = tmp_path / "work"
    workdir.mkdir()
    result = subprocess.run(
        [sys.executable, str(PROJECT_ROOT / "backend" / "tests" / "handoff_exec_driver.py"),
         "phase1", str(manifest_path), str(workdir)],
        capture_output=True, text=True, timeout=60, cwd=PROJECT_ROOT,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert "HANDOFF_OK" in result.stdout
