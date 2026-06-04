"""Tests for CADE-owned CLI-agent launch + handoff resume-on-exit.

Covers the descriptor-driven command building (so swapping agents is a config
change) and the freshness / single-shot guards of the resume shell script
(so a stale or already-resumed brief doesn't ambush a session).
"""

from __future__ import annotations

import json
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
from backend.terminal.cli_agent_adapters import (
    CADE_MCP_SERVER_NAMES,
    ClaudeCodeAdapter,
    CodexAdapter,
    CursorAdapter,
    adapter_from_descriptor,
)

CLAUDE = CliAgent(command="claude", seed_style="positional")
KIMI = CliAgent(command="kimi", seed_style="flag", seed_flag="-p")
CODEX = CliAgent(command="codex", adapter_id="codex", seed_style="positional")
CURSOR = CliAgent(command="cursor-agent", adapter_id="cursor", seed_style="positional")


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
    monkeypatch.setenv("CADE_CLI_AGENT_ADAPTER", "claude-compatible")
    monkeypatch.setenv("CADE_CLI_AGENT_SEED_STYLE", "flag")
    monkeypatch.setenv("CADE_CLI_AGENT_SEED_FLAG", "--prompt")
    agent = CliAgent.from_env()
    assert (agent.command, agent.adapter_id, agent.seed_style, agent.seed_flag) == (
        "kimi",
        "claude-compatible",
        "flag",
        "--prompt",
    )


# --- adapter boundary ------------------------------------------------------


def test_claude_adapter_declares_current_integrations():
    adapter = ClaudeCodeAdapter()
    assert adapter.id == "claude-code"
    assert adapter.capabilities.mcp is True
    assert adapter.capabilities.hooks is True
    assert adapter.capabilities.session_resolution is True


def test_claude_adapter_builds_current_mcp_fallback_command():
    adapter = ClaudeCodeAdapter()
    assert (
        adapter.direct_command("go", "/tmp/mcp.json")
        == "claude --mcp-config /tmp/mcp.json -- go"
    )


def test_adapter_from_descriptor_preserves_env_escape_hatch():
    adapter = adapter_from_descriptor(
        CliAgent(command="kimi", adapter_id="claude-compatible", seed_style="flag")
    )
    assert adapter.id == "claude-code"
    assert adapter.direct_command("go") == "kimi -p go"


def test_unknown_adapter_fails_fast():
    with pytest.raises(ValueError, match="Unknown CLI coding agent adapter"):
        adapter_from_descriptor(CliAgent(adapter_id="nonexistent"))


# --- Codex adapter --------------------------------------------------------


def test_codex_adapter_capabilities():
    adapter = CodexAdapter()
    assert adapter.id == "codex"
    assert adapter.display_name == "Codex"
    assert adapter.capabilities.mcp is True
    assert adapter.capabilities.hooks is False
    assert adapter.capabilities.session_resolution is False
    assert adapter.capabilities.handoff_resume is True


def test_codex_direct_command_plain():
    adapter = CodexAdapter()
    assert adapter.direct_command(None) == "codex"


def test_codex_direct_command_with_prompt():
    adapter = CodexAdapter()
    assert adapter.direct_command("fix the bug") == "codex 'fix the bug'"


def test_codex_direct_command_ignores_mcp_config_path():
    adapter = CodexAdapter()
    assert adapter.direct_command("go", "/tmp/mcp.json") == "codex go"


def test_codex_shell_mcp_array_is_empty():
    adapter = CodexAdapter()
    assert adapter.shell_mcp_array_assignment() == "mcp=()"


def test_codex_from_descriptor():
    adapter = adapter_from_descriptor(CliAgent(command="codex", adapter_id="codex"))
    assert adapter.id == "codex"
    assert adapter.command == "codex"


def test_codex_install_mcp_config_creates_toml(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.terminal.cli_agent_adapters._codex_config_path",
        lambda: tmp_path / "config.toml",
    )
    servers = {
        "cade-orchestrator": {
            "command": "/usr/bin/python3",
            "args": ["mcp_server.py"],
            "env": {"CADE_PORT": "3000"},
        },
    }
    adapter = CodexAdapter()
    adapter.install_mcp_config(servers)
    content = (tmp_path / "config.toml").read_text()
    assert "[mcp_servers." in content
    assert "cade-orchestrator" in content
    assert "enabled = true" in content


def test_codex_install_mcp_config_preserves_existing(tmp_path, monkeypatch):
    config_path = tmp_path / "config.toml"
    config_path.write_text('[model]\ndefault = "gpt-4"\n')
    monkeypatch.setattr(
        "backend.terminal.cli_agent_adapters._codex_config_path",
        lambda: config_path,
    )
    servers = {
        "cade-orchestrator": {
            "command": "python3",
            "args": ["server.py"],
        },
    }
    adapter = CodexAdapter()
    adapter.install_mcp_config(servers)
    content = config_path.read_text()
    assert 'default = "gpt-4"' in content
    assert "cade-orchestrator" in content


def test_codex_remove_mcp_config(tmp_path, monkeypatch):
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        '[model]\ndefault = "gpt-4"\n\n'
        '[mcp_servers."cade-orchestrator"]\ncommand = "python3"\nenabled = true\n'
        "# __cade_managed\n"
    )
    monkeypatch.setattr(
        "backend.terminal.cli_agent_adapters._codex_config_path",
        lambda: config_path,
    )
    adapter = CodexAdapter()
    adapter.remove_mcp_config()
    content = config_path.read_text()
    assert "cade-orchestrator" not in content
    assert 'default = "gpt-4"' in content


# --- Cursor adapter -------------------------------------------------------


def test_cursor_adapter_capabilities():
    adapter = CursorAdapter()
    assert adapter.id == "cursor"
    assert adapter.display_name == "Cursor"
    assert adapter.capabilities.mcp is True
    assert adapter.capabilities.hooks is False
    assert adapter.capabilities.session_resolution is False
    assert adapter.capabilities.handoff_resume is True


def test_cursor_direct_command_plain():
    adapter = CursorAdapter()
    assert adapter.direct_command(None) == "cursor-agent --approve-mcps"


def test_cursor_direct_command_with_prompt():
    adapter = CursorAdapter()
    assert adapter.direct_command("fix it") == "cursor-agent --approve-mcps 'fix it'"


def test_cursor_direct_command_ignores_mcp_config_path():
    adapter = CursorAdapter()
    assert adapter.direct_command("go", "/tmp/mcp.json") == "cursor-agent --approve-mcps go"


def test_cursor_shell_mcp_array_approves():
    adapter = CursorAdapter()
    assert adapter.shell_mcp_array_assignment() == "mcp=(--approve-mcps)"


def test_cursor_from_descriptor():
    adapter = adapter_from_descriptor(
        CliAgent(command="cursor-agent", adapter_id="cursor")
    )
    assert adapter.id == "cursor"
    assert adapter.command == "cursor-agent"


def test_cursor_install_mcp_config_creates_json(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.terminal.cli_agent_adapters._cursor_mcp_json_path",
        lambda project_dir: tmp_path / "mcp.json",
    )
    servers = {
        "cade-orchestrator": {
            "command": "python3",
            "args": ["mcp_server.py"],
            "env": {"CADE_PORT": "3000"},
        },
    }
    adapter = CursorAdapter()
    adapter.install_mcp_config(servers, tmp_path)
    data = json.loads((tmp_path / "mcp.json").read_text())
    assert "cade-orchestrator" in data["mcpServers"]
    assert data["mcpServers"]["cade-orchestrator"]["command"] == "python3"


def test_cursor_install_mcp_config_merges_existing(tmp_path, monkeypatch):
    mcp_json = tmp_path / "mcp.json"
    mcp_json.write_text(json.dumps({
        "mcpServers": {
            "user-server": {"command": "node", "args": ["server.js"]},
        }
    }))
    monkeypatch.setattr(
        "backend.terminal.cli_agent_adapters._cursor_mcp_json_path",
        lambda project_dir: mcp_json,
    )
    servers = {
        "cade-orchestrator": {"command": "python3", "args": ["mcp_server.py"]},
    }
    adapter = CursorAdapter()
    adapter.install_mcp_config(servers, tmp_path)
    data = json.loads(mcp_json.read_text())
    assert "user-server" in data["mcpServers"]
    assert "cade-orchestrator" in data["mcpServers"]


def test_cursor_remove_mcp_config_preserves_user_servers(tmp_path, monkeypatch):
    mcp_json = tmp_path / "mcp.json"
    mcp_json.write_text(json.dumps({
        "mcpServers": {
            "user-server": {"command": "node", "args": ["server.js"]},
            "cade-orchestrator": {"command": "python3", "args": ["mcp_server.py"]},
            "cade-permissions": {"command": "python3", "args": ["perm_server.py"]},
        }
    }))
    monkeypatch.setattr(
        "backend.terminal.cli_agent_adapters._cursor_mcp_json_path",
        lambda project_dir: mcp_json,
    )
    adapter = CursorAdapter()
    adapter.remove_mcp_config(tmp_path)
    data = json.loads(mcp_json.read_text())
    assert "user-server" in data["mcpServers"]
    assert "cade-orchestrator" not in data["mcpServers"]
    assert "cade-permissions" not in data["mcpServers"]


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
    assert "else claude -- 'read it'; fi" in cmd


def test_build_launch_command_respects_agent_descriptor():
    cmd = build_launch_command("go", KIMI)
    assert "else kimi -p go; fi" in cmd


def test_build_launch_command_includes_mcp_config_in_fallback():
    cmd = build_launch_command("go", CLAUDE, "/tmp/mcp.json")
    assert "else claude --mcp-config /tmp/mcp.json -- go; fi" in cmd


def test_resume_script_honours_cade_cli_mcp_config():
    script = render_resume_script(CLAUDE)
    assert "CADE_CLI_MCP_CONFIG" in script
    assert "--mcp-config" in script


def test_build_launch_command_codex_no_mcp_args_in_fallback():
    cmd = build_launch_command("go", CODEX)
    assert "else codex go; fi" in cmd
    assert "--mcp-config" not in cmd


def test_build_launch_command_codex_ignores_mcp_config_path():
    cmd = build_launch_command("go", CODEX, "/tmp/mcp.json")
    assert "else codex go; fi" in cmd
    assert "--mcp-config" not in cmd


def test_build_launch_command_cursor_includes_approve_mcps():
    cmd = build_launch_command("go", CURSOR)
    assert "else cursor-agent --approve-mcps go; fi" in cmd


def test_resume_script_codex_empty_mcp_array():
    script = render_resume_script(CODEX)
    assert "mcp=()" in script


def test_resume_script_cursor_approve_mcps():
    script = render_resume_script(CURSOR)
    assert "mcp=(--approve-mcps)" in script


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
