"""Whether a new terminal starts the CLI agent (ConnectionHandler._auto_start_agent).

The user can ask for idle shells (`auto-start-claude = false`), so that any
agent can be started by hand. A tab opened from the project picker has said
which agent it wants, or which handoff to start from: that is a request to
start it, and the idle-shell setting does not apply to it.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

from backend.config import Config
from backend.files.user_config import UserConfig
from backend.websocket import ConnectionHandler


def handler(tmp_path: Path, *, server_starts: bool = True, user_starts: bool = True) -> ConnectionHandler:
    config = Config(
        port=3000, host="127.0.0.1", working_dir=tmp_path,
        shell_command="bash", auto_start_claude=server_starts,
    )
    h = ConnectionHandler(AsyncMock(), config)
    h._user_config = UserConfig()
    h._user_config.behavior.session.auto_start_claude = user_starts
    return h


def test_starts_the_agent_by_default(tmp_path: Path):
    assert handler(tmp_path)._auto_start_agent is True


def test_leaves_an_idle_shell_when_the_user_asked_for_one(tmp_path: Path):
    assert handler(tmp_path, user_starts=False)._auto_start_agent is False


def test_a_tab_that_asks_for_its_agent_gets_it_despite_the_idle_shell_setting(tmp_path: Path):
    h = handler(tmp_path, user_starts=False)
    h._start_agent_requested = True
    assert h._auto_start_agent is True


def test_a_tab_opened_on_a_handoff_starts_the_agent_despite_the_idle_shell_setting(tmp_path: Path):
    h = handler(tmp_path, user_starts=False)
    h._initial_prompt = "Read `docs/plans/handoff/x.md` and resume."
    assert h._auto_start_agent is True


def test_a_server_run_without_an_agent_never_starts_one(tmp_path: Path):
    h = handler(tmp_path, server_starts=False)
    h._start_agent_requested = True
    h._initial_prompt = "Read the handoff."
    assert h._auto_start_agent is False
