"""Tests for the tool registry each chat provider is built with."""

from __future__ import annotations

import logging
import sys
from unittest.mock import patch

import pytest

from backend.orchestrator import mcp_config
from backend.providers.registry import ProviderRegistry, _create_tool_registry
from core.backend.providers.config import ProviderConfig, ProvidersConfig
from core.backend.providers.mcp_tools import MCPToolAdapter

_ORCHESTRATOR_KEY = "__orchestrator__"


def _config() -> ProviderConfig:
    return ProviderConfig(name="chat", type="api", model="test-model")


def _orchestrator_adapter(registry) -> MCPToolAdapter:
    adapter = registry._executors.get(_ORCHESTRATOR_KEY)
    assert isinstance(adapter, MCPToolAdapter), "orchestrator MCP adapter was not registered"
    return adapter


def test_every_api_provider_gets_the_orchestrator_adapter():
    registry = ProviderRegistry.from_config(
        ProvidersConfig(default_provider="chat", providers={"chat": _config()}),
        connection_id="conn-1",
    )

    provider = registry.get("chat")
    adapter = _orchestrator_adapter(provider._tool_registry)
    assert adapter.env["CADE_CONNECTION_ID"] == "conn-1"


@pytest.mark.parametrize("frozen", [False, True], ids=["source", "frozen"])
def test_orchestrator_command_comes_from_server_command(frozen: bool):
    with patch.object(mcp_config, "_is_frozen", return_value=frozen):
        expected = mcp_config.server_command("orchestrator")
        adapter = _orchestrator_adapter(_create_tool_registry(_config()))

    assert (adapter.command, adapter.args) == expected
    if frozen:
        assert expected == (sys.executable, ["mcp-server", "--type", "orchestrator"])
    else:
        assert expected[1] == [str(mcp_config._MCP_SERVER_SCRIPT)]


def test_failure_to_wire_the_orchestrator_is_a_warning(caplog: pytest.LogCaptureFixture):
    with patch.object(mcp_config, "server_command", side_effect=RuntimeError("no binary")):
        with caplog.at_level(logging.WARNING, logger="backend.providers.registry"):
            registry = _create_tool_registry(_config())

    assert _ORCHESTRATOR_KEY not in registry._executors
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert any("no binary" in r.getMessage() for r in warnings)


def test_unregistered_tool_classes_are_gone():
    """Chat agents get spawn_agent from the orchestrator server and nkrdn
    through bash, and /compact does not use a compactor class. Classes that
    look like the live path but are not wired in mislead whoever extends it."""
    import importlib.util

    from core.backend.providers import tool_executor

    assert importlib.util.find_spec("core.backend.providers.agent_spawner") is None
    assert importlib.util.find_spec("backend.providers.handoff_compactor") is None
    assert not hasattr(tool_executor, "NkrdnExecutor")
    assert not hasattr(tool_executor, "make_nkrdn_registry")
