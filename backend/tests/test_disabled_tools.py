"""Tools turned off in providers.toml are not offered to any agent.

One list, `[tools] disabled`, governs chat agents, orchestrator workers and
the orchestrator MCP server that CLI agents are given, so a tool switched
off is off everywhere CADE hands it out.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from textwrap import dedent
from unittest.mock import patch

import pytest

from backend.orchestrator import mcp_config, mcp_server
from core.backend.providers.config import load_providers_config
from core.backend.providers.tool_executor import ToolRegistry
from core.backend.providers.types import ToolDefinition


def _write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "providers.toml"
    path.write_text(dedent(body))
    return path


class TestConfig:
    def test_reads_the_disabled_list(self, tmp_path):
        cfg = load_providers_config(_write(tmp_path, """\
            [tools]
            disabled = ["spawn_agent", "list_agents"]
        """))
        assert cfg.disabled_tools == frozenset({"spawn_agent", "list_agents"})

    def test_nothing_is_disabled_by_default(self, tmp_path):
        cfg = load_providers_config(_write(tmp_path, 'default = "x"\n'))
        assert cfg.disabled_tools == frozenset()

    def test_ignores_entries_that_are_not_names(self, tmp_path):
        cfg = load_providers_config(_write(tmp_path, """\
            [tools]
            disabled = ["bash", 3, "", "  "]
        """))
        assert cfg.disabled_tools == frozenset({"bash"})

    def test_a_disabled_value_that_is_not_a_list_disables_nothing(self, tmp_path):
        cfg = load_providers_config(_write(tmp_path, """\
            [tools]
            disabled = "spawn_agent"
        """))
        assert cfg.disabled_tools == frozenset()


class _Executor:
    def tool_definitions(self):
        return [
            ToolDefinition(name="read_file", description="", parameters_schema={}),
            ToolDefinition(name="bash", description="", parameters_schema={}),
        ]

    def execute(self, name, arguments):
        return f"ran {name}"


class _McpLike:
    """Stands in for an MCP adapter, which reports its tools on discovery."""

    async def _list_tools(self):
        return {
            "spawn_agent": ToolDefinition(name="spawn_agent", description="", parameters_schema={}),
            "view_file": ToolDefinition(name="view_file", description="", parameters_schema={}),
        }

    async def execute_async(self, name, arguments):
        return f"ran {name}"


class TestRegistry:
    def _registry(self) -> ToolRegistry:
        registry = ToolRegistry(disabled={"bash", "spawn_agent"})
        executor = _Executor()
        registry.register(executor, "read_file", "bash")
        registry.register(_McpLike(), "__mcp__")
        return registry

    def test_definitions_leave_out_disabled_tools(self):
        names = [d.name for d in self._registry().definitions()]
        assert names == ["read_file"]

    def test_discovered_tools_are_filtered_too(self):
        names = {d.name for d in asyncio.run(self._registry().definitions_async())}
        assert names == {"read_file", "view_file"}

    def test_a_disabled_tool_called_anyway_is_refused(self):
        # A model can name a tool it was not offered, from memory or a stale
        # transcript; the switch has to hold at execution too.
        registry = self._registry()
        asyncio.run(registry.definitions_async())
        assert "turned off" in registry.execute("bash", {})
        assert "turned off" in asyncio.run(registry.execute_async("spawn_agent", {}))
        assert asyncio.run(registry.execute_async("view_file", {})) == "ran view_file"


class TestServer:
    def test_server_launches_carry_the_disabled_list(self, tmp_path):
        with patch.object(mcp_config, "mcp_config_dir", lambda: tmp_path), patch.object(
            mcp_config, "disabled_tools", lambda: frozenset({"spawn_agent", "list_agents"})
        ):
            path = mcp_config.write_mcp_config("conn", backend_port=1)
        import json

        env = json.loads(path.read_text())["mcpServers"]["cade-orchestrator"]["env"]
        assert env[mcp_config.DISABLED_TOOLS_ENV] == "list_agents,spawn_agent"

    def test_server_drops_the_tools_it_is_told_are_off(self, monkeypatch):
        monkeypatch.setenv(mcp_config.DISABLED_TOOLS_ENV, "spawn_agent,list_agents")
        server = mcp_server.build_server()
        names = {t.name for t in asyncio.run(server.list_tools())}
        assert "spawn_agent" not in names
        assert "list_agents" not in names
        assert {"view_file", "show_html"} <= names

    def test_server_offers_everything_when_nothing_is_off(self, monkeypatch):
        monkeypatch.delenv(mcp_config.DISABLED_TOOLS_ENV, raising=False)
        names = {t.name for t in asyncio.run(mcp_server.build_server().list_tools())}
        assert {"spawn_agent", "list_agents", "view_file", "show_html"} <= names
