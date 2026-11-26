"""The permission MCP server is gone, and nothing still points at it.

Claude Code only calls a permission prompt tool when started with
--permission-prompt-tool, and CADE never passes that flag. Chat permissions
go through PermissionManager and the permission UI, which stay.
"""

from __future__ import annotations

import importlib.util
import sys
from unittest.mock import AsyncMock, patch

import pytest

from backend.config import Config, set_config
from backend.main import create_app, parse_args


def test_mcp_server_subcommand_rejects_permissions(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(sys, "argv", ["cade-backend", "mcp-server", "--type", "permissions"])
    with pytest.raises(SystemExit):
        parse_args()


def test_mcp_server_subcommand_still_runs_the_orchestrator(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(sys, "argv", ["cade-backend", "mcp-server", "--type", "orchestrator"])
    assert parse_args().type == "orchestrator"


def test_permission_server_module_is_gone():
    assert importlib.util.find_spec("backend.permissions.mcp_server") is None


def test_prompt_and_wait_endpoint_is_gone(temp_dir):
    cfg = Config(port=0, host="127.0.0.1", working_dir=temp_dir, auto_open_browser=False, dummy_mode=True)
    set_config(cfg)
    with patch("backend.main.unify_sessions"), patch(
        "backend.main._check_wsl_health_async", new_callable=AsyncMock
    ):
        app = create_app(cfg)

    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/permissions/prompt-and-wait" not in paths
    # The endpoints the chat permission UI uses are still there.
    assert "/api/permissions/approve/{request_id}" in paths
