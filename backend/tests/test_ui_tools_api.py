"""Tests for the viewer endpoints agents call through MCP: view-file and show-html.

The chain under test: caller identity (connection id or working directory)
-> owning tab -> file written to that project -> view-file sent to that tab
only.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from backend.config import Config, set_config
from backend.connection_registry import ConnectionRegistry
from backend.main import create_app
from backend.orchestrator.manager import OrchestratorManager
from backend.terminal.sessions import SessionRegistry, set_registry
from backend.ui_canvas import (
    DEFAULT_CANVAS_NAME,
    MAX_CANVAS_BYTES,
    MAX_CANVAS_NAME_LENGTH,
    CanvasError,
    canvas_slug,
    write_canvas,
)

PAGE = "<!doctype html><title>t</title><p>hello</p>"


class TestCanvasStorage:
    def test_writes_under_the_canvas_directory(self, temp_dir: Path) -> None:
        relative = write_canvas(temp_dir, "Auth Flow", PAGE)
        assert relative == ".cade/canvas/auth-flow.html"
        assert (temp_dir / relative).read_text(encoding="utf-8") == PAGE

    def test_same_name_replaces_the_page(self, temp_dir: Path) -> None:
        write_canvas(temp_dir, "chart", PAGE)
        relative = write_canvas(temp_dir, "chart", "<p>second</p>")
        assert (temp_dir / relative).read_text(encoding="utf-8") == "<p>second</p>"

    @pytest.mark.parametrize(
        "name", ["../../etc/passwd", "/abs/path", "..", "a/../../b", "x\\..\\y"]
    )
    def test_name_cannot_escape_the_canvas_directory(self, temp_dir: Path, name: str) -> None:
        relative = write_canvas(temp_dir, name, PAGE)
        canvas_dir = (temp_dir / ".cade" / "canvas").resolve()
        assert (temp_dir / relative).resolve().parent == canvas_dir

    def test_unusable_names_fall_back_to_the_default(self) -> None:
        assert canvas_slug("") == DEFAULT_CANVAS_NAME
        assert canvas_slug("!!!") == DEFAULT_CANVAS_NAME

    def test_long_names_are_truncated(self) -> None:
        assert len(canvas_slug("a" * 500)) == MAX_CANVAS_NAME_LENGTH

    def test_rejects_empty_and_oversized_pages(self, temp_dir: Path) -> None:
        with pytest.raises(CanvasError):
            write_canvas(temp_dir, "x", "   \n")
        with pytest.raises(CanvasError):
            write_canvas(temp_dir, "x", "a" * (MAX_CANVAS_BYTES + 1))
        assert not (temp_dir / ".cade").exists()


class _Tab:
    """A connected CADE tab: the websocket and the frames it was sent."""

    def __init__(self, project: Path) -> None:
        self.project = project
        self.frames: list[dict] = []
        self.ws = MagicMock()
        self.ws.send_json = AsyncMock(side_effect=self._record)

    async def _record(self, message: dict) -> None:
        self.frames.append(message)


@pytest.fixture
def env(temp_dir: Path):
    """App with two tabs on two projects, registered the way a websocket does."""
    config = Config(
        port=0, host="127.0.0.1", working_dir=temp_dir, shell_command="bash",
        auto_start_claude=False, auto_open_browser=False, dummy_mode=True,
    )
    set_config(config)
    set_registry(SessionRegistry())

    manager = OrchestratorManager()
    connections = ConnectionRegistry()
    tabs: dict[str, _Tab] = {}
    for name in ("a", "b"):
        project = temp_dir / f"project_{name}"
        project.mkdir()
        tab = _Tab(project)
        tabs[name] = tab
        manager.register_connection(f"conn-{name}", tab.ws.send_json, project)
        connections.register(tab.ws, project)

    with patch("backend.main.unify_sessions"), patch(
        "backend.main._check_wsl_health_async", new_callable=AsyncMock
    ), patch(
        "backend.orchestrator.manager.get_orchestrator_manager", return_value=manager
    ), patch("backend.main.get_connection_registry", return_value=connections):
        yield TestClient(create_app(config)), tabs
    set_registry(SessionRegistry())


class TestShowHtml:
    def test_draws_in_the_calling_tab_only(self, env) -> None:
        client, tabs = env
        res = client.post(
            "/api/ui/show-html",
            json={"html": PAGE, "name": "flow"},
            headers={"X-Connection-Id": "conn-a"},
        )
        assert res.status_code == 200
        path = res.json()["path"]
        assert (tabs["a"].project / path).read_text(encoding="utf-8") == PAGE
        assert tabs["a"].frames == [{"type": "view-file", "path": path}]
        assert tabs["b"].frames == []
        assert not (tabs["b"].project / ".cade").exists()

    def test_stale_connection_id_falls_back_to_working_directory(self, env) -> None:
        client, tabs = env
        subdir = tabs["b"].project / "src"
        subdir.mkdir()
        res = client.post(
            "/api/ui/show-html",
            json={"html": PAGE, "cwd": str(subdir)},
            headers={"X-Connection-Id": "conn-from-before-reconnect"},
        )
        assert res.status_code == 200
        path = res.json()["path"]
        assert (tabs["b"].project / path).exists()
        assert tabs["b"].frames == [{"type": "view-file", "path": path}]
        assert tabs["a"].frames == []

    def test_reports_when_no_tab_matches(self, env, temp_dir: Path) -> None:
        client, tabs = env
        res = client.post(
            "/api/ui/show-html",
            json={"html": PAGE, "cwd": str(temp_dir / "elsewhere")},
            headers={"X-Connection-Id": "gone"},
        )
        assert res.status_code == 409
        assert "error" in res.json()
        assert tabs["a"].frames == [] and tabs["b"].frames == []

    def test_rejects_an_empty_page_without_notifying_the_tab(self, env) -> None:
        client, tabs = env
        res = client.post(
            "/api/ui/show-html", json={"html": ""}, headers={"X-Connection-Id": "conn-a"},
        )
        assert res.status_code == 400
        assert tabs["a"].frames == []


class TestViewFile:
    def test_opens_in_the_calling_tab_only(self, env) -> None:
        client, tabs = env
        res = client.post(
            "/api/ui/view-file", json={"path": "README.md"}, headers={"X-Connection-Id": "conn-b"},
        )
        assert res.status_code == 200
        assert tabs["b"].frames == [{"type": "view-file", "path": "README.md"}]
        assert tabs["a"].frames == []

    def test_stale_connection_id_falls_back_to_working_directory(self, env) -> None:
        client, tabs = env
        res = client.post(
            "/api/ui/view-file",
            json={"path": "README.md", "cwd": str(tabs["a"].project)},
            headers={"X-Connection-Id": "gone"},
        )
        assert res.status_code == 200
        assert len(tabs["a"].frames) == 1 and tabs["b"].frames == []

    def test_reports_when_the_caller_matches_no_tab(self, env, temp_dir: Path) -> None:
        client, tabs = env
        res = client.post(
            "/api/ui/view-file",
            json={"path": "README.md", "cwd": str(temp_dir / "elsewhere")},
            headers={"X-Connection-Id": "gone"},
        )
        assert res.status_code == 409
        assert tabs["a"].frames == [] and tabs["b"].frames == []

    def test_unidentified_caller_reaches_every_tab(self, env) -> None:
        client, tabs = env
        res = client.post("/api/ui/view-file", json={"path": "README.md"})
        assert res.status_code == 200
        assert len(tabs["a"].frames) == 1 and len(tabs["b"].frames) == 1


def test_htm_extension_is_treated_as_html() -> None:
    from backend.files.tree import get_file_type

    assert get_file_type("page.htm") == "html"
    assert get_file_type("page.HTML") == "html"
