"""Tests for HTTPMCPToolAdapter and alphaxiv OAuth helpers."""

from __future__ import annotations

import json
import time
import tempfile
import pathlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.backend.providers.http_mcp_tools import (
    HTTPMCPToolAdapter,
    load_claude_oauth_token,
    get_mcp_oauth_status,
)
from core.backend.providers.types import ToolDefinition


# ─── Credential helpers ──────────────────────────────────────────────────────

class TestLoadClaudeOauthToken:

    def test_returns_none_when_file_missing(self, tmp_path: pathlib.Path) -> None:
        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            result = load_claude_oauth_token("alphaxiv")
        assert result is None

    def test_returns_none_when_server_not_found(self, tmp_path: pathlib.Path) -> None:
        creds = {"mcpOAuth": {}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            result = load_claude_oauth_token("alphaxiv")
        assert result is None

    def test_returns_token_when_valid(self, tmp_path: pathlib.Path) -> None:
        future_expiry = int(time.time() * 1000) + 3_600_000  # 1 hour from now
        creds = {"mcpOAuth": {"alphaxiv|abc123": {"accessToken": "tok_valid", "expiresAt": future_expiry}}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            result = load_claude_oauth_token("alphaxiv")
        assert result == "tok_valid"

    def test_returns_none_when_token_expired(self, tmp_path: pathlib.Path) -> None:
        past_expiry = int(time.time() * 1000) - 1000  # already expired
        creds = {"mcpOAuth": {"alphaxiv|abc123": {"accessToken": "tok_old", "expiresAt": past_expiry}}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            result = load_claude_oauth_token("alphaxiv")
        assert result is None

    def test_matches_by_prefix(self, tmp_path: pathlib.Path) -> None:
        """Key in credentials uses 'name|hash' format — should match on prefix."""
        future_expiry = int(time.time() * 1000) + 3_600_000
        creds = {"mcpOAuth": {"alphaxiv|d940b2c4": {"accessToken": "tok_prefix", "expiresAt": future_expiry}}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            result = load_claude_oauth_token("alphaxiv")
        assert result == "tok_prefix"

    def test_returns_none_for_missing_access_token(self, tmp_path: pathlib.Path) -> None:
        creds = {"mcpOAuth": {"alphaxiv|abc": {"expiresAt": int(time.time() * 1000) + 3_600_000}}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            result = load_claude_oauth_token("alphaxiv")
        assert result is None


class TestGetMcpOauthStatus:

    def test_not_authenticated_when_no_credentials(self, tmp_path: pathlib.Path) -> None:
        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            status = get_mcp_oauth_status("alphaxiv")
        assert status["authenticated"] is False
        assert status["reason"] == "no_credentials"

    def test_not_authenticated_when_not_found(self, tmp_path: pathlib.Path) -> None:
        creds = {"mcpOAuth": {}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            status = get_mcp_oauth_status("alphaxiv")
        assert status["authenticated"] is False
        assert status["reason"] == "not_found"

    def test_authenticated_when_valid(self, tmp_path: pathlib.Path) -> None:
        future = int(time.time() * 1000) + 3_600_000
        creds = {"mcpOAuth": {"alphaxiv|x": {"accessToken": "t", "expiresAt": future}}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            status = get_mcp_oauth_status("alphaxiv")
        assert status["authenticated"] is True

    def test_not_authenticated_when_expired(self, tmp_path: pathlib.Path) -> None:
        past = int(time.time() * 1000) - 1000
        creds = {"mcpOAuth": {"alphaxiv|x": {"accessToken": "old", "expiresAt": past}}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            status = get_mcp_oauth_status("alphaxiv")
        assert status["authenticated"] is False
        assert status["reason"] == "token_expired"


# ─── HTTPMCPToolAdapter ───────────────────────────────────────────────────────

class TestHTTPMCPToolAdapterInit:

    def test_stores_url_and_headers(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp", {"Authorization": "Bearer tok"})
        assert adapter.url == "https://api.example.com/mcp"
        assert adapter.headers == {"Authorization": "Bearer tok"}

    def test_defaults_to_empty_headers(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp")
        assert adapter.headers == {}

    def test_from_claude_oauth_sets_bearer_header(self, tmp_path: pathlib.Path) -> None:
        future = int(time.time() * 1000) + 3_600_000
        creds = {"mcpOAuth": {"alphaxiv|x": {"accessToken": "mytoken", "expiresAt": future}}}
        creds_file = tmp_path / ".claude" / ".credentials.json"
        creds_file.parent.mkdir(parents=True)
        creds_file.write_text(json.dumps(creds))

        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            adapter = HTTPMCPToolAdapter.from_claude_oauth("https://api.alphaxiv.org/mcp/v1", "alphaxiv")

        assert adapter.headers.get("Authorization") == "Bearer mytoken"

    def test_from_claude_oauth_no_token_gives_empty_headers(self, tmp_path: pathlib.Path) -> None:
        with patch("core.backend.providers.http_mcp_tools.pathlib.Path.home", return_value=tmp_path):
            adapter = HTTPMCPToolAdapter.from_claude_oauth("https://api.alphaxiv.org/mcp/v1", "alphaxiv")
        assert "Authorization" not in adapter.headers

    def test_implements_tool_executor_protocol(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp")
        assert hasattr(adapter, "execute")
        assert callable(adapter.execute)
        assert hasattr(adapter, "tool_definitions")
        assert callable(adapter.tool_definitions)
        assert hasattr(adapter, "_list_tools")
        assert callable(adapter._list_tools)
        assert hasattr(adapter, "execute_async")
        assert callable(adapter.execute_async)


class TestHTTPMCPToolAdapterConnectionFailure:
    """Mock the transport so tests don't hit the network."""

    def _patch_connect(self, exc: Exception):
        """Return a context manager that patches _ensure_connected to raise exc."""
        return patch(
            "core.backend.providers.http_mcp_tools.HTTPMCPToolAdapter._ensure_connected",
            side_effect=exc,
        )

    def test_list_tools_returns_empty_on_connection_failure(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp")
        with self._patch_connect(OSError("connection refused")):
            result = adapter.tool_definitions()
        assert result == []

    def test_execute_returns_error_string_on_connection_failure(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp")
        with self._patch_connect(OSError("connection refused")):
            result = adapter.execute("some_tool", {})
        assert isinstance(result, str)
        assert "Error" in result

    @pytest.mark.asyncio
    async def test_execute_async_returns_error_on_connection_failure(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp")
        with self._patch_connect(OSError("connection refused")):
            result = await adapter.execute_async("some_tool", {})
        assert isinstance(result, str)
        assert "Error" in result

    @pytest.mark.asyncio
    async def test_list_tools_propagates_cancelled_error(self) -> None:
        """CancelledError must propagate so the owning task can be cancelled."""
        import asyncio
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp")
        with self._patch_connect(asyncio.CancelledError()):
            with pytest.raises(asyncio.CancelledError):
                await adapter._list_tools()

    @pytest.mark.asyncio
    async def test_execute_async_propagates_cancelled_error(self) -> None:
        """CancelledError during connect must propagate from execute_async."""
        import asyncio
        adapter = HTTPMCPToolAdapter("https://api.example.com/mcp")
        with self._patch_connect(asyncio.CancelledError()):
            with pytest.raises(asyncio.CancelledError):
                await adapter.execute_async("tool", {})


class TestHTTPMCPToolAdapterWithMockSession:

    @pytest.mark.asyncio
    async def test_list_tools_converts_mcp_format(self) -> None:
        """_list_tools() should convert MCP ToolInfo objects to ToolDefinition."""
        adapter = HTTPMCPToolAdapter("https://api.alphaxiv.org/mcp/v1", {"Authorization": "Bearer tok"})

        mock_tool = MagicMock()
        mock_tool.name = "embedding_similarity_search"
        mock_tool.description = "Search papers by embedding similarity"
        mock_tool.inputSchema = {"type": "object", "properties": {"query": {"type": "string"}}}

        mock_list_response = MagicMock()
        mock_list_response.tools = [mock_tool]

        mock_session = AsyncMock()
        mock_session.list_tools = AsyncMock(return_value=mock_list_response)
        adapter._session = mock_session

        result = await adapter._list_tools()

        assert "embedding_similarity_search" in result
        defn = result["embedding_similarity_search"]
        assert isinstance(defn, ToolDefinition)
        assert defn.name == "embedding_similarity_search"
        assert defn.description == "Search papers by embedding similarity"

    @pytest.mark.asyncio
    async def test_list_tools_caches_result(self) -> None:
        """Second call to _list_tools() must not hit the session again."""
        adapter = HTTPMCPToolAdapter("https://api.alphaxiv.org/mcp/v1")

        mock_tool = MagicMock()
        mock_tool.name = "search"
        mock_tool.description = "Search"
        mock_tool.inputSchema = {}

        mock_session = AsyncMock()
        mock_session.list_tools = AsyncMock(return_value=MagicMock(tools=[mock_tool]))
        adapter._session = mock_session

        await adapter._list_tools()
        await adapter._list_tools()  # second call

        mock_session.list_tools.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_async_extracts_text_content(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.alphaxiv.org/mcp/v1")

        content_block = MagicMock()
        content_block.text = "Paper: Attention is All You Need"

        mock_result = MagicMock()
        mock_result.content = [content_block]

        mock_session = AsyncMock()
        mock_session.call_tool = AsyncMock(return_value=mock_result)
        adapter._session = mock_session

        result = await adapter.execute_async("get_paper", {"id": "1706.03762"})
        assert result == "Paper: Attention is All You Need"

    @pytest.mark.asyncio
    async def test_execute_async_joins_multiple_content_blocks(self) -> None:
        adapter = HTTPMCPToolAdapter("https://api.alphaxiv.org/mcp/v1")

        blocks = [MagicMock(text="Block 1"), MagicMock(text="Block 2")]
        mock_result = MagicMock()
        mock_result.content = blocks

        mock_session = AsyncMock()
        mock_session.call_tool = AsyncMock(return_value=mock_result)
        adapter._session = mock_session

        result = await adapter.execute_async("search", {"query": "transformers"})
        assert result == "Block 1\nBlock 2"


# ─── Registry HTTP MCP wiring ────────────────────────────────────────────────

class TestRegistryHTTPMCPWiring:

    def test_http_type_creates_http_adapter(self) -> None:
        """mcp_servers with type='http' must create an HTTPMCPToolAdapter."""
        from backend.providers.registry import _create_tool_registry
        from core.backend.providers.http_mcp_tools import HTTPMCPToolAdapter

        mock_config = MagicMock()
        mock_config.extra = {
            "mcp_servers": {
                "alphaxiv": {
                    "type": "http",
                    "url": "https://api.alphaxiv.org/mcp/v1",
                    "auth": "claude-oauth",
                }
            }
        }

        with patch("core.backend.providers.http_mcp_tools.load_claude_oauth_token", return_value="tok"):
            registry = _create_tool_registry(mock_config, working_dir=None)

        executor = registry._executors.get("mcp_alphaxiv")
        assert executor is not None
        assert isinstance(executor, HTTPMCPToolAdapter)
        assert executor.url == "https://api.alphaxiv.org/mcp/v1"
        assert executor.headers.get("Authorization") == "Bearer tok"

    def test_http_type_without_auth_skips_bearer(self) -> None:
        """type='http' without auth='claude-oauth' uses custom headers only."""
        from backend.providers.registry import _create_tool_registry
        from core.backend.providers.http_mcp_tools import HTTPMCPToolAdapter

        mock_config = MagicMock()
        mock_config.extra = {
            "mcp_servers": {
                "myserver": {
                    "type": "http",
                    "url": "https://internal.example.com/mcp",
                    "headers": {"X-API-Key": "secret"},
                }
            }
        }

        registry = _create_tool_registry(mock_config, working_dir=None)

        executor = registry._executors.get("mcp_myserver")
        assert isinstance(executor, HTTPMCPToolAdapter)
        assert executor.headers == {"X-API-Key": "secret"}
        assert "Authorization" not in executor.headers

    def test_stdio_type_still_creates_mcp_adapter(self) -> None:
        """Existing stdio-based MCP servers (no type field) are unchanged."""
        from backend.providers.registry import _create_tool_registry
        from core.backend.providers.mcp_tools import MCPToolAdapter

        mock_config = MagicMock()
        mock_config.extra = {
            "mcp_servers": {
                "local": {
                    "command": "python",
                    "args": ["-m", "my_server"],
                }
            }
        }

        registry = _create_tool_registry(mock_config, working_dir=None)

        executor = registry._executors.get("mcp_local")
        assert isinstance(executor, MCPToolAdapter)

    def test_http_server_without_url_is_skipped(self) -> None:
        """type='http' with no url should not register anything."""
        from backend.providers.registry import _create_tool_registry

        mock_config = MagicMock()
        mock_config.extra = {
            "mcp_servers": {
                "broken": {"type": "http"}  # missing url
            }
        }

        registry = _create_tool_registry(mock_config, working_dir=None)
        assert "mcp_broken" not in registry._executors
