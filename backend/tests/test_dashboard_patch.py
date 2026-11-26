"""Tests for dashboard patch actions and how their failures reach the client.

A patch the backend cannot apply must come back to the client as an error
frame, followed by the source's current rows so the client drops its
optimistic change. It must never escape the handler as an exception.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from backend.protocol import MessageType
from core.backend.dashboard.handler import PATCH_ERROR_CODE, DashboardHandler


class Sent:
    def __init__(self) -> None:
        self.frames: list[dict[str, Any]] = []

    async def __call__(self, frame: dict[str, Any]) -> None:
        self.frames.append(frame)

    def of_type(self, msg_type: str) -> list[dict[str, Any]]:
        return [f for f in self.frames if f["type"] == msg_type]


def _write_config(root: Path, sources: dict, panels: list[dict] | None = None) -> None:
    (root / ".cade").mkdir(exist_ok=True)
    config = {
        "dashboard": {"title": "T"},
        "data_sources": sources,
        "views": [{"id": "v", "title": "V", "panels": panels or []}],
    }
    (root / ".cade" / "dashboard.yml").write_text(yaml.safe_dump(config), encoding="utf-8")


async def _handler(root: Path) -> tuple[DashboardHandler, Sent]:
    sent = Sent()
    handler = DashboardHandler(root, sent)
    await handler.load_and_send_config()
    sent.frames.clear()
    return handler, sent


async def test_patching_a_markdown_source_is_refused_with_an_error(tmp_path: Path):
    todo = tmp_path / "todo.md"
    original = "# Tasks\n- [ ] first\n- [ ] second\n"
    todo.write_text(original, encoding="utf-8")
    _write_config(tmp_path, {"todo": {"type": "markdown", "path": "todo.md", "parse": "list_items"}})
    handler, sent = await _handler(tmp_path)

    await handler.handle_action({
        "action": "patch", "source": "todo", "entityId": "item-0", "patch": {"done": True},
    })

    errors = sent.of_type(MessageType.ERROR)
    assert len(errors) == 1
    assert errors[0]["code"] == PATCH_ERROR_CODE
    assert "read-only" in errors[0]["message"]
    assert todo.read_text(encoding="utf-8") == original
    data = sent.of_type(MessageType.DASHBOARD_DATA)
    assert data and data[-1]["sources"]["todo"][0]["done"] is False


async def test_patching_a_source_type_without_write_back_is_refused(tmp_path: Path):
    (tmp_path / "apps").mkdir()
    (tmp_path / "apps" / "a.md").write_text("---\nstatus: draft\n---\nbody\n", encoding="utf-8")
    _write_config(tmp_path, {"apps": {"type": "vault", "path": "apps"}})
    handler, sent = await _handler(tmp_path)

    await handler.handle_action({
        "action": "patch", "source": "apps", "entityId": "a", "patch": {"status": "active"},
    })

    errors = sent.of_type(MessageType.ERROR)
    assert len(errors) == 1
    assert errors[0]["code"] == PATCH_ERROR_CODE
    assert "vault" in errors[0]["message"]


async def test_patching_an_unknown_source_is_refused(tmp_path: Path):
    _write_config(tmp_path, {})
    handler, sent = await _handler(tmp_path)

    await handler.handle_action({"action": "patch", "source": "nope", "entityId": "1", "patch": {}})

    errors = sent.of_type(MessageType.ERROR)
    assert len(errors) == 1
    assert "nope" in errors[0]["message"]


async def test_a_failing_patch_becomes_an_error_frame(tmp_path: Path):
    # A directory source whose path is a file fails inside the write itself.
    (tmp_path / "plans").write_text("not a directory", encoding="utf-8")
    _write_config(tmp_path, {"plans": {"type": "directory", "path": "plans"}})
    handler, sent = await _handler(tmp_path)

    await handler.handle_action({
        "action": "patch", "source": "plans", "entityId": "a", "patch": {"status": "x"},
    })

    errors = sent.of_type(MessageType.ERROR)
    assert len(errors) == 1
    assert errors[0]["code"] == PATCH_ERROR_CODE


async def test_patching_a_directory_source_rewrites_frontmatter(tmp_path: Path):
    (tmp_path / "plans").mkdir()
    plan = tmp_path / "plans" / "alpha.md"
    plan.write_text("---\nstatus: draft\n---\nbody\n", encoding="utf-8")
    _write_config(tmp_path, {"plans": {"type": "directory", "path": "plans"}})
    handler, sent = await _handler(tmp_path)

    await handler.handle_action({
        "action": "patch", "source": "plans", "entityId": "alpha", "patch": {"status": "active"},
    })

    assert sent.of_type(MessageType.ERROR) == []
    assert "status: active" in plan.read_text(encoding="utf-8")
    rows = sent.of_type(MessageType.DASHBOARD_DATA)[-1]["sources"]["plans"]
    assert rows[0]["status"] == "active"


async def test_patching_a_json_file_source_matches_on_id_field(tmp_path: Path):
    data_file = tmp_path / "jobs.json"
    data_file.write_text(json.dumps([{"key": "j1", "status": "new"}, {"key": "j2", "status": "new"}]), encoding="utf-8")
    _write_config(tmp_path, {"jobs": {"type": "json_file", "path": "jobs.json", "entity": {"id_field": "key"}}})
    handler, sent = await _handler(tmp_path)

    await handler.handle_action({
        "action": "patch", "source": "jobs", "entityId": "j2", "patch": {"status": "applied"},
    })

    rows = json.loads(data_file.read_text(encoding="utf-8"))
    assert rows == [{"key": "j1", "status": "new"}, {"key": "j2", "status": "applied"}]
    assert sent.of_type(MessageType.ERROR) == []


async def test_config_warnings_are_sent_with_the_config(tmp_path: Path):
    _write_config(tmp_path, {"s": {"type": "file", "path": "README.md"}})
    sent = Sent()
    handler = DashboardHandler(tmp_path, sent)

    await handler.load_and_send_config()

    configs = sent.of_type(MessageType.DASHBOARD_CONFIG)
    assert len(configs) == 1
    warnings = configs[0]["config"]["warnings"]
    assert any("unknown type 'file'" in w for w in warnings)
