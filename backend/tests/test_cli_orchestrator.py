"""Tests for Claude Code CLI orchestrator wiring."""

from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent
from unittest.mock import patch

import pytest

from backend.orchestrator.mcp_config import (
    cli_orchestrator_enabled,
    mcp_config_path,
    prepare_cli_orchestrator_env,
    write_mcp_config,
)
from core.backend.providers.config import (
    ProviderConfig,
    ProvidersConfig,
    load_providers_config,
    resolve_worker_provider,
)


def test_resolve_worker_provider_prefers_worker_provider(tmp_path: Path):
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        default = "mistral"
        worker_provider = "minimax"

        [provider.mistral]
        type = "api"
        model = "mistral/large"

        [provider.minimax]
        type = "api"
        model = "minimax/MiniMax-M2.7"
    """))

    cfg = load_providers_config(config_file)
    worker = resolve_worker_provider(cfg)
    assert worker is not None
    assert worker.name == "minimax"


def test_cli_orchestrator_disabled_when_no_api_provider(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("CADE_CLI_ORCHESTRATOR", raising=False)
    config_file = tmp_path / "providers.toml"
    config_file.write_text("default = \"shell\"\n\n[provider.shell]\ntype = \"cli\"\n")

    cfg = load_providers_config(config_file)
    with patch("core.backend.providers.config.get_providers_config", return_value=cfg):
        assert cli_orchestrator_enabled() is False


def test_cli_orchestrator_enabled_with_worker(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("CADE_CLI_ORCHESTRATOR", raising=False)
    config_file = tmp_path / "providers.toml"
    config_file.write_text(dedent("""\
        default = "minimax"

        [provider.minimax]
        type = "api"
        model = "minimax/MiniMax-M2.7"
    """))

    cfg = load_providers_config(config_file)
    with patch("core.backend.providers.config.get_providers_config", return_value=cfg):
        assert cli_orchestrator_enabled() is True


def test_write_mcp_config_uses_session_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "backend.orchestrator.mcp_config.mcp_config_dir",
        lambda: tmp_path,
    )

    path = write_mcp_config(
        "conn-abc",
        backend_port=3000,
        session_id="tab-123",
    )
    assert path == tmp_path / "session-tab-123.json"
    data = json.loads(path.read_text())
    assert "cade-orchestrator" in data["mcpServers"]
    assert data["mcpServers"]["cade-orchestrator"]["env"]["CADE_CONNECTION_ID"] == "conn-abc"


def test_prepare_cli_orchestrator_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "backend.orchestrator.mcp_config.mcp_config_dir",
        lambda: tmp_path,
    )

    env = prepare_cli_orchestrator_env(
        "conn-xyz",
        backend_port=3000,
        session_id="sess-1",
    )
    assert "CADE_CLI_MCP_CONFIG" in env
    assert env["CADE_CLI_MCP_CONFIG"] == str(mcp_config_path("sess-1", "conn-xyz"))
