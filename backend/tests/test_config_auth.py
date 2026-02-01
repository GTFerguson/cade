"""Tests for authentication-related configuration."""

from __future__ import annotations

import os
import pytest
from unittest.mock import patch

from backend.config import Config


class TestConfigAuthFields:
    """Tests for authentication configuration fields."""

    def test_default_auth_disabled(self):
        """By default, authentication should be disabled."""
        config = Config()
        assert config.auth_enabled is False
        assert config.auth_token == ""
        assert config.cors_origins == []

    def test_load_auth_enabled_from_env(self):
        """Load CADE_AUTH_ENABLED from environment."""
        with patch.dict(os.environ, {"CADE_AUTH_ENABLED": "true"}):
            config = Config.from_env()
            assert config.auth_enabled is True

        with patch.dict(os.environ, {"CADE_AUTH_ENABLED": "false"}):
            config = Config.from_env()
            assert config.auth_enabled is False

    def test_load_auth_token_from_env(self):
        """Load CADE_AUTH_TOKEN from environment."""
        test_token = "test-token-12345"
        with patch.dict(os.environ, {"CADE_AUTH_TOKEN": test_token}):
            config = Config.from_env()
            assert config.auth_token == test_token

    def test_load_cors_origins_from_env(self):
        """Load CADE_CORS_ORIGINS from environment."""
        origins = "https://example.com,http://localhost:3000,https://app.domain.com"
        with patch.dict(os.environ, {"CADE_CORS_ORIGINS": origins}):
            config = Config.from_env()
            assert config.cors_origins == [
                "https://example.com",
                "http://localhost:3000",
                "https://app.domain.com",
            ]

    def test_cors_origins_whitespace_handling(self):
        """CORS origins should handle whitespace correctly."""
        origins = " https://example.com , http://localhost:3000 , https://app.domain.com "
        with patch.dict(os.environ, {"CADE_CORS_ORIGINS": origins}):
            config = Config.from_env()
            assert config.cors_origins == [
                "https://example.com",
                "http://localhost:3000",
                "https://app.domain.com",
            ]

    def test_empty_cors_origins(self):
        """Empty CADE_CORS_ORIGINS should result in empty list."""
        with patch.dict(os.environ, {"CADE_CORS_ORIGINS": ""}):
            config = Config.from_env()
            assert config.cors_origins == []

    def test_update_from_args_preserves_auth(self):
        """update_from_args should preserve auth fields."""
        config = Config(
            auth_enabled=True,
            auth_token="secret",
            cors_origins=["https://example.com"],
        )

        updated = config.update_from_args(port=4000)

        assert updated.port == 4000
        assert updated.auth_enabled is True
        assert updated.auth_token == "secret"
        assert updated.cors_origins == ["https://example.com"]

    def test_auth_case_insensitive(self):
        """Auth enabled should accept various case combinations."""
        test_cases = ["true", "True", "TRUE", "TrUe"]

        for value in test_cases:
            with patch.dict(os.environ, {"CADE_AUTH_ENABLED": value}):
                config = Config.from_env()
                assert config.auth_enabled is True, f"Failed for value: {value}"

        test_cases = ["false", "False", "FALSE", "FaLsE"]

        for value in test_cases:
            with patch.dict(os.environ, {"CADE_AUTH_ENABLED": value}):
                config = Config.from_env()
                assert config.auth_enabled is False, f"Failed for value: {value}"


class TestAuthConfigIntegration:
    """Integration tests for authentication configuration."""

    def test_complete_auth_config_from_env(self):
        """Test loading complete auth configuration from environment."""
        env = {
            "CADE_AUTH_ENABLED": "true",
            "CADE_AUTH_TOKEN": "my-secret-token-12345",
            "CADE_CORS_ORIGINS": "https://app.example.com,http://localhost:5173",
            "CADE_PORT": "3000",
            "CADE_HOST": "0.0.0.0",
        }

        with patch.dict(os.environ, env, clear=True):
            config = Config.from_env()

            assert config.auth_enabled is True
            assert config.auth_token == "my-secret-token-12345"
            assert config.cors_origins == [
                "https://app.example.com",
                "http://localhost:5173",
            ]
            assert config.port == 3000
            assert config.host == "0.0.0.0"

    def test_production_security_config(self):
        """Test configuration for production deployment."""
        env = {
            "CADE_AUTH_ENABLED": "true",
            "CADE_AUTH_TOKEN": "a" * 64,  # Long secure token
            "CADE_CORS_ORIGINS": "https://cade.example.com",
            "CADE_HOST": "0.0.0.0",
        }

        with patch.dict(os.environ, env, clear=True):
            config = Config.from_env()

            assert config.auth_enabled is True
            assert len(config.auth_token) == 64
            assert config.cors_origins == ["https://cade.example.com"]

    def test_local_dev_config(self):
        """Test configuration for local development (no auth)."""
        env = {
            "CADE_AUTH_ENABLED": "false",
            "CADE_HOST": "127.0.0.1",
        }

        with patch.dict(os.environ, env, clear=True):
            config = Config.from_env()

            assert config.auth_enabled is False
            assert config.auth_token == ""
            assert config.cors_origins == []
            assert config.host == "127.0.0.1"
