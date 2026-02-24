"""Tests for WebSocket authentication."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import WebSocket

from backend.websocket import ConnectionHandler
from backend.config import Config


class TestWebSocketAuthentication:
    """Tests for WebSocket connection authentication."""

    @pytest.mark.asyncio
    async def test_accept_connection_when_auth_disabled(self):
        """When auth is disabled, accept connection without token."""
        config = Config(auth_enabled=False)

        # Mock WebSocket
        ws = MagicMock(spec=WebSocket)
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        ws.scope = {"query_string": b""}  # No token

        handler = ConnectionHandler(ws, config)

        # Mock the rest of the handler to avoid full setup
        with patch.object(handler, "_wait_for_project", new=AsyncMock()):
            with patch.object(handler, "_setup", new=AsyncMock()):
                with patch.object(handler, "_send_connected", new=AsyncMock()):
                    with patch.object(handler, "_receive_loop", new=AsyncMock()):
                        with patch.object(handler, "_start_output_loop"):
                            with patch("backend.websocket.get_connection_manager"):
                                with patch("backend.websocket.get_connection_registry"):
                                    with patch("asyncio.create_task"):
                                        await handler.handle()

        # Should accept connection
        ws.accept.assert_called_once()
        ws.close.assert_not_called()

    @pytest.mark.asyncio
    async def test_reject_connection_when_auth_enabled_no_token(self):
        """When auth is enabled and no token provided, reject connection."""
        config = Config(auth_enabled=True, auth_token="secret123")

        ws = MagicMock(spec=WebSocket)
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        ws.scope = {"query_string": b""}  # No token

        handler = ConnectionHandler(ws, config)
        await handler.handle()

        # Handler accepts first so the close frame is transmitted properly
        ws.accept.assert_called_once()
        ws.close.assert_called_once_with(code=1008, reason="Authentication failed")

    @pytest.mark.asyncio
    async def test_reject_connection_when_auth_enabled_invalid_token(self):
        """When auth is enabled and invalid token provided, reject connection."""
        config = Config(auth_enabled=True, auth_token="secret123")

        ws = MagicMock(spec=WebSocket)
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        ws.scope = {"query_string": b"token=wrong"}  # Invalid token

        handler = ConnectionHandler(ws, config)
        await handler.handle()

        # Handler accepts first so the close frame is transmitted properly
        ws.accept.assert_called_once()
        ws.close.assert_called_once_with(code=1008, reason="Authentication failed")

    @pytest.mark.asyncio
    async def test_accept_connection_when_auth_enabled_valid_token(self):
        """When auth is enabled and valid token provided, accept connection."""
        config = Config(auth_enabled=True, auth_token="secret123")

        ws = MagicMock(spec=WebSocket)
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        ws.scope = {"query_string": b"token=secret123"}  # Valid token

        handler = ConnectionHandler(ws, config)

        # Mock the rest of the handler
        with patch.object(handler, "_wait_for_project", new=AsyncMock()):
            with patch.object(handler, "_setup", new=AsyncMock()):
                with patch.object(handler, "_send_connected", new=AsyncMock()):
                    with patch.object(handler, "_receive_loop", new=AsyncMock()):
                        with patch.object(handler, "_start_output_loop"):
                            with patch("backend.websocket.get_connection_manager"):
                                with patch("backend.websocket.get_connection_registry"):
                                    with patch("asyncio.create_task"):
                                        await handler.handle()

        # Should accept connection
        ws.accept.assert_called_once()

    @pytest.mark.asyncio
    async def test_token_in_query_with_other_params(self):
        """Token should be extracted even when other query parameters exist."""
        config = Config(auth_enabled=True, auth_token="mytoken")

        ws = MagicMock(spec=WebSocket)
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        ws.scope = {"query_string": b"foo=bar&token=mytoken&baz=qux"}

        handler = ConnectionHandler(ws, config)

        with patch.object(handler, "_wait_for_project", new=AsyncMock()):
            with patch.object(handler, "_setup", new=AsyncMock()):
                with patch.object(handler, "_send_connected", new=AsyncMock()):
                    with patch.object(handler, "_receive_loop", new=AsyncMock()):
                        with patch.object(handler, "_start_output_loop"):
                            with patch("backend.websocket.get_connection_manager"):
                                with patch("backend.websocket.get_connection_registry"):
                                    with patch("asyncio.create_task"):
                                        await handler.handle()

        ws.accept.assert_called_once()

    @pytest.mark.asyncio
    async def test_empty_token_rejected(self):
        """Empty token should be rejected when auth is enabled."""
        config = Config(auth_enabled=True, auth_token="secret")

        ws = MagicMock(spec=WebSocket)
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        ws.scope = {"query_string": b"token="}  # Empty token

        handler = ConnectionHandler(ws, config)
        await handler.handle()

        # Handler accepts first so the close frame is transmitted properly
        ws.accept.assert_called_once()
        ws.close.assert_called_once_with(code=1008, reason="Authentication failed")


class TestWebSocketAuthIntegration:
    """Integration tests for WebSocket authentication flow."""

    @pytest.mark.asyncio
    async def test_secure_deployment_scenario(self):
        """Test typical secure deployment with auth enabled."""
        # Production config
        config = Config(
            auth_enabled=True,
            auth_token="a" * 64,  # Long token
            cors_origins=["https://app.example.com"],
        )

        # Client with valid token
        ws_valid = MagicMock(spec=WebSocket)
        ws_valid.accept = AsyncMock()
        ws_valid.close = AsyncMock()
        ws_valid.scope = {"query_string": f"token={'a' * 64}".encode()}

        handler_valid = ConnectionHandler(ws_valid, config)

        with patch.object(handler_valid, "_wait_for_project", new=AsyncMock()):
            with patch.object(handler_valid, "_setup", new=AsyncMock()):
                with patch.object(handler_valid, "_send_connected", new=AsyncMock()):
                    with patch.object(handler_valid, "_receive_loop", new=AsyncMock()):
                        with patch.object(handler_valid, "_start_output_loop"):
                            with patch("backend.websocket.get_connection_manager"):
                                with patch("backend.websocket.get_connection_registry"):
                                    with patch("asyncio.create_task"):
                                        await handler_valid.handle()

        ws_valid.accept.assert_called_once()

        # Attacker without token
        ws_invalid = MagicMock(spec=WebSocket)
        ws_invalid.accept = AsyncMock()
        ws_invalid.close = AsyncMock()
        ws_invalid.scope = {"query_string": b""}

        handler_invalid = ConnectionHandler(ws_invalid, config)
        await handler_invalid.handle()

        # Handler accepts first so the close frame is transmitted properly
        ws_invalid.accept.assert_called_once()
        ws_invalid.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_local_development_scenario(self):
        """Test local development with auth disabled."""
        config = Config(auth_enabled=False)

        # Client without token (local development)
        ws = MagicMock(spec=WebSocket)
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        ws.scope = {"query_string": b""}

        handler = ConnectionHandler(ws, config)

        with patch.object(handler, "_wait_for_project", new=AsyncMock()):
            with patch.object(handler, "_setup", new=AsyncMock()):
                with patch.object(handler, "_send_connected", new=AsyncMock()):
                    with patch.object(handler, "_receive_loop", new=AsyncMock()):
                        with patch.object(handler, "_start_output_loop"):
                            with patch("backend.websocket.get_connection_manager"):
                                with patch("backend.websocket.get_connection_registry"):
                                    with patch("asyncio.create_task"):
                                        await handler.handle()

        ws.accept.assert_called_once()
