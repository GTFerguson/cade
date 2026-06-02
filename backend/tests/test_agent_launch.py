"""Tests for CADE-owned CLI-agent launch + handoff resume-on-exit.

Covers the descriptor-driven command building (so swapping agents is a config
change) and the freshness / single-shot guards of the resume shell script
(so a stale or already-resumed brief doesn't ambush a session).
"""

from __future__ import annotations

import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

from backend.config import CliAgent
from backend.terminal.agent_launch import (
    SHELL_SCRIPT_PATH,
    build_launch_command,
    render_resume_script,
)

CLAUDE = CliAgent(command="claude", seed_style="positional")
KIMI = CliAgent(command="kimi", seed_style="flag", seed_flag="-p")


# --- descriptor: how each agent is invoked --------------------------------


def test_direct_command_plain():
    assert CLAUDE.direct_command(None) == "claude"
    assert KIMI.direct_command(None) == "kimi"


def test_direct_command_positional_seed_is_quoted():
    assert CLAUDE.direct_command("read docs/plan.md") == "claude 'read docs/plan.md'"


def test_direct_command_flag_style():
    assert KIMI.direct_command("go") == "kimi -p go"
    assert KIMI.direct_command("a b") == "kimi -p 'a b'"


def test_from_env_overrides(monkeypatch):
    monkeypatch.setenv("CADE_CLI_AGENT", "kimi")
    monkeypatch.setenv("CADE_CLI_AGENT_SEED_STYLE", "flag")
    monkeypatch.setenv("CADE_CLI_AGENT_SEED_FLAG", "--prompt")
    agent = CliAgent.from_env()
    assert (agent.command, agent.seed_style, agent.seed_flag) == ("kimi", "flag", "--prompt")


# --- the line typed into the PTY ------------------------------------------


def test_build_launch_command_sources_wrapper_and_falls_back():
    cmd = build_launch_command(None, CLAUDE)
    assert SHELL_SCRIPT_PATH in cmd
    assert "__cade_run" in cmd
    # A missing/broken wrapper must still start the agent.
    assert "else claude; fi" in cmd


def test_build_launch_command_threads_seed_into_both_paths():
    cmd = build_launch_command("read it", CLAUDE)
    assert "__cade_run 'read it'" in cmd
    assert "else claude 'read it'; fi" in cmd


def test_build_launch_command_respects_agent_descriptor():
    cmd = build_launch_command("go", KIMI)
    assert "else kimi -p go; fi" in cmd


# --- resume guards (run the rendered bash) --------------------------------

bash_required = pytest.mark.skipif(
    shutil.which("bash") is None, reason="bash not available"
)


def _run_resume_brief(tmp_path: Path, project: Path) -> str:
    """Source the rendered script in a sandboxed HOME and echo what it would
    auto-resume into for ``project``."""
    script = tmp_path / "cade-resume.sh"
    # Use `true` as the agent so the functions are harmless if ever invoked.
    script.write_text(render_resume_script(CliAgent(command="true"), window=1800))
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    proc = subprocess.run(
        ["bash", "-c", f'. "{script}"; cd "{project}"; __cade_resume_brief'],
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
    )
    return proc.stdout.strip()


def _make_brief(project: Path, age_seconds: int = 0) -> Path:
    handoff = project / "docs" / "plans" / "handoff"
    handoff.mkdir(parents=True, exist_ok=True)
    brief = handoff / "session.md"
    brief.write_text("# handoff\n")
    if age_seconds:
        subprocess.run(
            ["touch", "-d", f"-{age_seconds} seconds", str(brief)], check=True
        )
    return brief


@bash_required
def test_fresh_brief_is_offered(tmp_path):
    project = tmp_path / "proj"
    brief = _make_brief(project, age_seconds=10)
    assert _run_resume_brief(tmp_path, project) == str(brief)


@bash_required
def test_no_handoff_dir_is_silent(tmp_path):
    project = tmp_path / "proj"
    (project / "docs").mkdir(parents=True)
    assert _run_resume_brief(tmp_path, project) == ""


@bash_required
def test_stale_brief_is_ignored(tmp_path):
    project = tmp_path / "proj"
    _make_brief(project, age_seconds=3600)  # older than the 1800s window
    assert _run_resume_brief(tmp_path, project) == ""


@bash_required
def test_brief_resumed_once_then_marked(tmp_path):
    """After the marker is touched (a resume happened), the same brief is not
    offered again — the single-shot guard that stops a quit from re-firing."""
    project = tmp_path / "proj"
    _make_brief(project, age_seconds=10)
    script = tmp_path / "cade-resume.sh"
    script.write_text(render_resume_script(CliAgent(command="true"), window=1800))
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    program = textwrap.dedent(
        f'''
        . "{script}"
        cd "{project}"
        first=$(__cade_resume_brief)
        touch "$(__cade_marker)"
        second=$(__cade_resume_brief)
        echo "first=${{first:+yes}} second=${{second:+yes}}"
        '''
    )
    proc = subprocess.run(
        ["bash", "-c", program],
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
    )
    assert proc.stdout.strip() == "first=yes second="
