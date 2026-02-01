"""Authentication module for CADE backend.

Provides token-based authentication for remote deployments.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from backend.config import Config, get_config

# Fixed message for HMAC so the cookie is deterministic for a given token
_HMAC_MESSAGE = b"cade_session"


class AuthError(Exception):
    """Raised when authentication fails."""

    pass


def validate_token(token: Optional[str]) -> bool:
    """Validate an authentication token.

    Args:
        token: The token to validate, or None if no token provided.

    Returns:
        True if authentication is disabled or token is valid, False otherwise.
    """
    config = get_config()

    # If auth is disabled, always allow
    if not config.auth_enabled:
        return True

    # If auth is enabled but no token configured, deny all requests
    if not config.auth_token:
        return False

    # If no token provided by client, deny
    if not token:
        return False

    # Use constant-time comparison to prevent timing attacks
    return secrets.compare_digest(token, config.auth_token)


def extract_token_from_query(query_string: str) -> Optional[str]:
    """Extract auth token from WebSocket query string.

    Args:
        query_string: The query string from the WebSocket URL (e.g., "token=abc123")

    Returns:
        The token value if found, None otherwise.
    """
    if not query_string:
        return None

    # Parse query string manually to avoid dependencies
    params = {}
    for part in query_string.split("&"):
        if "=" in part:
            key, value = part.split("=", 1)
            params[key] = value

    return params.get("token")


def generate_token() -> str:
    """Generate a cryptographically secure random token.

    Returns:
        A 64-character hexadecimal token.
    """
    return secrets.token_hex(32)


def create_session_value(auth_token: str) -> str:
    """Create an HMAC-SHA256 session cookie value from an auth token.

    The raw token never appears in the cookie — only the HMAC digest.
    Deterministic: same token always produces the same value.
    """
    return hmac.new(
        auth_token.encode("utf-8"),
        _HMAC_MESSAGE,
        hashlib.sha256,
    ).hexdigest()


def validate_session_cookie(cookie_value: str, cfg: Config | None = None) -> bool:
    """Validate a session cookie against the configured auth token.

    Returns True if auth is disabled or the cookie matches the expected HMAC.
    """
    if cfg is None:
        cfg = get_config()

    if not cfg.auth_enabled:
        return True

    if not cfg.auth_token or not cookie_value:
        return False

    expected = create_session_value(cfg.auth_token)
    return hmac.compare_digest(cookie_value, expected)
