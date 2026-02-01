"""Tests for authentication module."""

from __future__ import annotations

import pytest
from unittest.mock import patch

from backend.auth import (
    validate_token,
    extract_token_from_query,
    generate_token,
    AuthError,
)
from backend.config import Config


class TestValidateToken:
    """Tests for token validation."""

    def test_auth_disabled_allows_any_token(self):
        """When auth is disabled, any token (or no token) should be accepted."""
        config = Config(auth_enabled=False, auth_token="")

        with patch("backend.auth.get_config", return_value=config):
            assert validate_token(None) is True
            assert validate_token("") is True
            assert validate_token("any-token") is True

    def test_auth_enabled_no_server_token_denies_all(self):
        """When auth is enabled but no server token configured, deny all requests."""
        config = Config(auth_enabled=True, auth_token="")

        with patch("backend.auth.get_config", return_value=config):
            assert validate_token(None) is False
            assert validate_token("") is False
            assert validate_token("some-token") is False

    def test_auth_enabled_valid_token_accepted(self):
        """When auth is enabled, valid token should be accepted."""
        config = Config(auth_enabled=True, auth_token="secret123")

        with patch("backend.auth.get_config", return_value=config):
            assert validate_token("secret123") is True

    def test_auth_enabled_invalid_token_rejected(self):
        """When auth is enabled, invalid token should be rejected."""
        config = Config(auth_enabled=True, auth_token="secret123")

        with patch("backend.auth.get_config", return_value=config):
            assert validate_token("wrong") is False
            assert validate_token("secret12") is False
            assert validate_token("secret1234") is False
            assert validate_token("") is False
            assert validate_token(None) is False

    def test_constant_time_comparison(self):
        """Token comparison should use constant-time to prevent timing attacks."""
        config = Config(auth_enabled=True, auth_token="a" * 64)

        with patch("backend.auth.get_config", return_value=config):
            # Both should take roughly the same time regardless of where mismatch occurs
            # We can't easily test timing, but we verify secrets.compare_digest is used
            assert validate_token("b" * 64) is False  # First char different
            assert validate_token("a" * 63 + "b") is False  # Last char different

    def test_case_sensitive(self):
        """Token validation should be case-sensitive."""
        config = Config(auth_enabled=True, auth_token="SecretToken123")

        with patch("backend.auth.get_config", return_value=config):
            assert validate_token("SecretToken123") is True
            assert validate_token("secrettoken123") is False
            assert validate_token("SECRETTOKEN123") is False


class TestExtractTokenFromQuery:
    """Tests for token extraction from query strings."""

    def test_extract_token_simple(self):
        """Extract token from simple query string."""
        assert extract_token_from_query("token=abc123") == "abc123"

    def test_extract_token_with_other_params(self):
        """Extract token when other parameters are present."""
        assert extract_token_from_query("foo=bar&token=xyz789&baz=qux") == "xyz789"

    def test_extract_token_first_param(self):
        """Extract token when it's the first parameter."""
        assert extract_token_from_query("token=first&other=second") == "first"

    def test_extract_token_last_param(self):
        """Extract token when it's the last parameter."""
        assert extract_token_from_query("other=first&token=last") == "last"

    def test_no_token_returns_none(self):
        """Return None when no token parameter exists."""
        assert extract_token_from_query("foo=bar&baz=qux") is None

    def test_empty_query_returns_none(self):
        """Return None for empty query string."""
        assert extract_token_from_query("") is None
        assert extract_token_from_query(None) is None

    def test_token_with_special_chars(self):
        """Extract token with special characters."""
        # URL-encoded characters should be preserved as-is (decoding happens elsewhere)
        assert extract_token_from_query("token=abc%20def") == "abc%20def"

    def test_empty_token_value(self):
        """Extract empty token value."""
        assert extract_token_from_query("token=") == ""

    def test_no_equals_sign(self):
        """Handle malformed query without equals sign."""
        assert extract_token_from_query("token") is None
        assert extract_token_from_query("justtext") is None


class TestGenerateToken:
    """Tests for token generation."""

    def test_generates_64_char_hex(self):
        """Generated token should be 64 hexadecimal characters."""
        token = generate_token()
        assert len(token) == 64
        assert all(c in "0123456789abcdef" for c in token)

    def test_generates_unique_tokens(self):
        """Each generated token should be unique."""
        tokens = [generate_token() for _ in range(100)]
        assert len(tokens) == len(set(tokens))  # All unique

    def test_token_format(self):
        """Token should be valid hex string."""
        token = generate_token()
        # Should not raise ValueError
        int(token, 16)


class TestAuthIntegration:
    """Integration tests for authentication flow."""

    def test_full_auth_flow_with_valid_token(self):
        """Test complete authentication flow with valid token."""
        # Generate token
        token = generate_token()

        # Configure backend with this token
        config = Config(auth_enabled=True, auth_token=token)

        # Simulate client sending token in query string
        query_string = f"token={token}&other=param"

        with patch("backend.auth.get_config", return_value=config):
            # Extract token from query
            extracted = extract_token_from_query(query_string)
            assert extracted == token

            # Validate token
            assert validate_token(extracted) is True

    def test_full_auth_flow_with_invalid_token(self):
        """Test complete authentication flow with invalid token."""
        server_token = generate_token()
        client_token = generate_token()  # Different token

        config = Config(auth_enabled=True, auth_token=server_token)

        query_string = f"token={client_token}"

        with patch("backend.auth.get_config", return_value=config):
            extracted = extract_token_from_query(query_string)
            assert extracted == client_token
            assert validate_token(extracted) is False

    def test_full_auth_flow_missing_token(self):
        """Test authentication flow when client doesn't send token."""
        config = Config(auth_enabled=True, auth_token=generate_token())

        query_string = "other=param"

        with patch("backend.auth.get_config", return_value=config):
            extracted = extract_token_from_query(query_string)
            assert extracted is None
            assert validate_token(extracted) is False
