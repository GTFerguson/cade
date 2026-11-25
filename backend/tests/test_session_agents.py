"""Tests for per-tab agent choice and the projects listing the picker uses."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.config import CliAgent, Config, set_config
from backend.main import create_app
from backend.projects import doc_title, list_handoffs, list_projects
from backend.terminal.agent_launch import build_launch_command, render_resume_script
from backend.terminal.session_agents import (
    agent_descriptor,
    agent_env,
    clean_agent_id,
    selectable_agents,
)
from backend.terminal.session_listing import describe_session
from backend.terminal.sessions import PTYSession, SessionRegistry, set_registry

CLAUDE = CliAgent()


class TestDescriptor:
    def test_no_choice_is_the_configured_agent(self):
        assert agent_descriptor(None, CLAUDE) is CLAUDE

    def test_choosing_the_configured_agent_keeps_its_configuration(self):
        custom = CliAgent(command="/opt/claude", adapter_id="claude-code")
        assert agent_descriptor("claude-code", custom) is custom

    def test_another_agent_gets_its_own_command(self):
        codex = agent_descriptor("codex", CLAUDE)
        assert (codex.adapter_id, codex.command) == ("codex", "codex")

    def test_unknown_agent_falls_back_to_the_configured_one(self):
        assert agent_descriptor("nonsense", CLAUDE) is CLAUDE

    @pytest.mark.parametrize("value", [None, 3, "nonsense", ""])
    def test_only_known_adapter_ids_are_accepted(self, value):
        assert clean_agent_id(value) is None

    def test_known_adapter_id_is_accepted(self):
        assert clean_agent_id("codex") == "codex"

    def test_codex_launch_line_runs_codex(self):
        cmd = build_launch_command("go", agent_descriptor("codex", CLAUDE), "/tmp/mcp.json")
        assert "else codex go; fi" in cmd


class TestSelectable:
    def test_lists_claude_code_and_codex_with_the_configured_one_marked(self):
        agents = selectable_agents(CLAUDE)
        assert [(a["id"], a["default"]) for a in agents] == [
            ("claude-code", True),
            ("codex", False),
        ]

    def test_reports_whether_each_is_installed(self):
        with patch("backend.terminal.session_agents.shutil.which", side_effect=lambda c: None if c == "codex" else "/bin/x"):
            agents = {a["id"]: a["available"] for a in selectable_agents(CLAUDE)}
        assert agents == {"claude-code": True, "codex": False}

    def test_a_configured_agent_outside_the_usual_two_is_still_offered(self):
        cursor = CliAgent(command="cursor-agent", adapter_id="cursor")
        assert selectable_agents(cursor)[0]["id"] == "cursor"


bash_required = pytest.mark.skipif(shutil.which("bash") is None, reason="bash not available")


@bash_required
class TestResumeWrapperFollowsTheTab:
    """One wrapper on disk serves tabs running different agents."""

    def _run(self, tmp_path: Path, env: dict[str, str]) -> str:
        """Run the wrapper's agent function with fake agents that echo their argv."""
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        for name in ("claude", "codex"):
            fake = bin_dir / name
            fake.write_text(f'#!/bin/sh\necho "{name} $*"\n')
            fake.chmod(0o755)
        mcp = tmp_path / "mcp.json"
        mcp.write_text("{}")
        script = tmp_path / "resume.sh"
        script.write_text(render_resume_script(CLAUDE))
        result = subprocess.run(
            ["bash", "-c", f'. "{script}"; __cade_agent "go"'],
            capture_output=True, text=True, timeout=20,
            env={
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "HOME": str(tmp_path),
                "CADE_CLI_MCP_CONFIG": str(mcp),
                **env,
            },
        )
        return result.stdout.strip()

    def test_without_a_choice_it_runs_the_configured_agent_with_its_mcp_flag(self, tmp_path: Path):
        out = self._run(tmp_path, {})
        assert out == f"claude --mcp-config {tmp_path / 'mcp.json'} -- go"

    def test_a_codex_tab_runs_codex_without_claude_arguments(self, tmp_path: Path):
        out = self._run(tmp_path, agent_env(agent_descriptor("codex", CLAUDE)))
        assert out.startswith("codex")
        assert "--mcp-config" not in out
        assert out.endswith("go")


class TestSessionRemembersItsAgent:
    def test_listing_reports_the_sessions_own_agent(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir, agent="codex")
        assert describe_session(session, "claude-code")["agent"] == "codex"

    def test_listing_falls_back_to_the_configured_agent(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        assert describe_session(session, "claude-code")["agent"] == "claude-code"


def touch(path: Path, mtime: float, text: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    os.utime(path, (mtime, mtime))


class TestProjects:
    def test_most_recently_worked_on_comes_first(self, temp_dir: Path):
        for name, when in (("old", 1000), ("new", 3000), ("mid", 2000)):
            touch(temp_dir / name / "file.txt", when)
            os.utime(temp_dir / name, (when, when))
        assert [p["name"] for p in list_projects(temp_dir)] == ["new", "mid", "old"]

    def test_git_activity_counts_as_work(self, temp_dir: Path):
        touch(temp_dir / "quiet" / "a.txt", 2000)
        os.utime(temp_dir / "quiet", (2000, 2000))
        touch(temp_dir / "committed" / "a.txt", 1000)
        os.utime(temp_dir / "committed", (1000, 1000))
        touch(temp_dir / "committed" / ".git" / "index", 5000)
        assert [p["name"] for p in list_projects(temp_dir)] == ["committed", "quiet"]

    def test_hidden_folders_and_files_are_not_projects(self, temp_dir: Path):
        (temp_dir / ".cache").mkdir()
        (temp_dir / "notes.txt").write_text("x")
        (temp_dir / "real").mkdir()
        assert [p["name"] for p in list_projects(temp_dir)] == ["real"]

    def test_counts_handoffs(self, temp_dir: Path):
        touch(temp_dir / "p" / "docs" / "plans" / "handoff" / "a.md", 1000)
        touch(temp_dir / "p" / "docs" / "plans" / "handoff" / "README.md", 1000)
        assert list_projects(temp_dir)[0]["handoffs"] == 1

    def test_missing_root_is_no_projects(self, temp_dir: Path):
        assert list_projects(temp_dir / "nowhere") == []


class TestHandoffs:
    def test_most_recently_edited_first_with_titles(self, temp_dir: Path):
        folder = temp_dir / "docs" / "plans" / "handoff"
        touch(folder / "older.md", 1000, "---\ntitle: Older work\n---\n")
        touch(folder / "newer.md", 2000, "# Newer work\n")
        touch(folder / "readme.md", 3000, "# Index\n")
        assert [(h["relPath"], h["title"]) for h in list_handoffs(temp_dir)] == [
            ("docs/plans/handoff/newer.md", "Newer work"),
            ("docs/plans/handoff/older.md", "Older work"),
        ]

    def test_project_without_handoffs(self, temp_dir: Path):
        assert list_handoffs(temp_dir) == []

    def test_untitled_doc_is_named_by_its_file(self, temp_dir: Path):
        (temp_dir / "plain.md").write_text("no heading here\n")
        assert doc_title(temp_dir / "plain.md") == "plain"


@pytest.fixture
def api_client(temp_dir: Path):
    config = Config(
        port=0, host="127.0.0.1", working_dir=temp_dir, shell_command="bash",
        auto_start_claude=False, auto_open_browser=False, dummy_mode=True,
        projects_root=temp_dir / "projects",
    )
    set_config(config)
    set_registry(SessionRegistry())
    with patch("backend.main.unify_sessions"), patch(
        "backend.main._check_wsl_health_async", new_callable=AsyncMock
    ):
        yield TestClient(create_app(config))
    set_registry(SessionRegistry())


class TestRoutes:
    def test_projects_route_lists_projects_and_agents(self, api_client, temp_dir: Path):
        touch(temp_dir / "projects" / "cade" / "docs" / "plans" / "handoff" / "x.md", 1000, "# X\n")
        body = api_client.get("/api/projects").json()
        assert body["root"] == str(temp_dir / "projects")
        assert [(p["name"], p["handoffs"]) for p in body["projects"]] == [("cade", 1)]
        assert [a["id"] for a in body["agents"]] == ["claude-code", "codex"]

    def test_handoffs_route(self, api_client, temp_dir: Path):
        project = temp_dir / "projects" / "cade"
        touch(project / "docs" / "plans" / "handoff" / "x.md", 1000, "# X\n")
        body = api_client.get("/api/projects/handoffs", params={"path": str(project)}).json()
        assert [h["title"] for h in body["handoffs"]] == ["X"]
