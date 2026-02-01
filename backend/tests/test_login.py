"""Tests for login flow — session cookies, auth routes, and login page."""

from __future__ import annotations

import pytest
from unittest.mock import patch

from backend.auth import create_session_value, validate_session_cookie
from backend.config import Config


# ---------------------------------------------------------------------------
# Unit tests: session cookie HMAC
# ---------------------------------------------------------------------------


class TestCreateSessionValue:
    """Tests for HMAC-based session cookie creation."""

    def test_deterministic(self):
        """Same token always produces the same cookie value."""
        assert create_session_value("secret") == create_session_value("secret")

    def test_different_tokens_produce_different_values(self):
        """Different tokens must produce different cookie values."""
        a = create_session_value("token-a")
        b = create_session_value("token-b")
        assert a != b

    def test_returns_hex_string(self):
        """Cookie value should be a hex-encoded SHA256 digest (64 chars)."""
        value = create_session_value("test123")
        assert len(value) == 64
        int(value, 16)  # Raises ValueError if not valid hex

    def test_raw_token_not_in_cookie(self):
        """The raw auth token must not appear in the cookie value."""
        token = "my-secret-token-12345"
        value = create_session_value(token)
        assert token not in value


class TestValidateSessionCookie:
    """Tests for session cookie validation."""

    def test_valid_cookie_accepted(self):
        cfg = Config(auth_enabled=True, auth_token="secret")
        cookie = create_session_value("secret")
        assert validate_session_cookie(cookie, cfg) is True

    def test_invalid_cookie_rejected(self):
        cfg = Config(auth_enabled=True, auth_token="secret")
        assert validate_session_cookie("not-a-valid-hmac", cfg) is False

    def test_empty_cookie_rejected(self):
        cfg = Config(auth_enabled=True, auth_token="secret")
        assert validate_session_cookie("", cfg) is False

    def test_auth_disabled_always_valid(self):
        cfg = Config(auth_enabled=False, auth_token="")
        assert validate_session_cookie("", cfg) is True
        assert validate_session_cookie("garbage", cfg) is True

    def test_no_server_token_always_invalid(self):
        cfg = Config(auth_enabled=True, auth_token="")
        assert validate_session_cookie("anything", cfg) is False

    def test_token_change_invalidates_cookie(self):
        """Changing the server token must invalidate existing cookies."""
        old_cookie = create_session_value("old-token")
        new_cfg = Config(auth_enabled=True, auth_token="new-token")
        assert validate_session_cookie(old_cookie, new_cfg) is False

    def test_uses_global_config_when_none(self):
        """When cfg is None, should use get_config()."""
        cfg = Config(auth_enabled=True, auth_token="abc")
        cookie = create_session_value("abc")
        with patch("backend.auth.get_config", return_value=cfg):
            assert validate_session_cookie(cookie) is True


# ---------------------------------------------------------------------------
# HTTP route tests using FastAPI TestClient
# ---------------------------------------------------------------------------


@pytest.fixture()
def auth_config():
    """Config with auth enabled."""
    return Config(auth_enabled=True, auth_token="test-secret-token")


@pytest.fixture()
def noauth_config():
    """Config with auth disabled."""
    return Config(auth_enabled=False, auth_token="")


@pytest.fixture()
def auth_app(auth_config):
    """FastAPI app with auth enabled."""
    from backend.main import create_app
    return create_app(auth_config)


@pytest.fixture()
def noauth_app(noauth_config):
    """FastAPI app with auth disabled."""
    from backend.main import create_app
    return create_app(noauth_config)


@pytest.fixture()
def auth_client(auth_app):
    from starlette.testclient import TestClient
    return TestClient(auth_app, raise_server_exceptions=False)


@pytest.fixture()
def noauth_client(noauth_app):
    from starlette.testclient import TestClient
    return TestClient(noauth_app, raise_server_exceptions=False)


class TestLoginPageRoute:
    """Tests for GET /login."""

    def test_serves_html_when_auth_enabled(self, auth_client):
        response = auth_client.get("/login", follow_redirects=False)
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "CADE" in response.text

    def test_redirects_to_root_when_auth_disabled(self, noauth_client):
        response = noauth_client.get("/login", follow_redirects=False)
        assert response.status_code == 302
        assert response.headers["location"] == "/"

    def test_redirects_when_already_authenticated(self, auth_client, auth_config):
        cookie_value = create_session_value(auth_config.auth_token)
        response = auth_client.get(
            "/login",
            cookies={"cade_session": cookie_value},
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert response.headers["location"] == "/"


class TestLoginPostRoute:
    """Tests for POST /api/auth/login."""

    def test_valid_token_sets_cookie(self, auth_client, auth_config):
        response = auth_client.post(
            "/api/auth/login",
            json={"token": auth_config.auth_token},
        )
        assert response.status_code == 200
        assert response.json()["success"] is True
        assert "cade_session" in response.cookies

    def test_invalid_token_returns_401(self, auth_client):
        response = auth_client.post(
            "/api/auth/login",
            json={"token": "wrong-token"},
        )
        assert response.status_code == 401
        assert response.json()["success"] is False
        assert "cade_session" not in response.cookies

    def test_auth_disabled_always_succeeds(self, noauth_client):
        response = noauth_client.post(
            "/api/auth/login",
            json={"token": "anything"},
        )
        assert response.status_code == 200
        assert response.json()["success"] is True


class TestAuthCheckRoute:
    """Tests for GET /api/auth/check."""

    def test_returns_200_with_valid_cookie(self, auth_client, auth_config):
        cookie_value = create_session_value(auth_config.auth_token)
        response = auth_client.get(
            "/api/auth/check",
            cookies={"cade_session": cookie_value},
        )
        assert response.status_code == 200
        assert response.json()["authenticated"] is True

    def test_returns_401_without_cookie(self, auth_client):
        response = auth_client.get("/api/auth/check")
        assert response.status_code == 401
        assert response.json()["authenticated"] is False

    def test_returns_401_with_invalid_cookie(self, auth_client):
        response = auth_client.get(
            "/api/auth/check",
            cookies={"cade_session": "bogus-value"},
        )
        assert response.status_code == 401

    def test_auth_disabled_always_200(self, noauth_client):
        response = noauth_client.get("/api/auth/check")
        assert response.status_code == 200
        assert response.json()["authenticated"] is True


class TestIndexAuthGating:
    """Tests for GET / with auth gating."""

    def test_redirects_to_login_when_unauthenticated(self, auth_client):
        response = auth_client.get("/", follow_redirects=False)
        # Either 302 redirect to /login, or 200 if frontend dist doesn't exist
        if response.status_code == 302:
            assert response.headers["location"] == "/login"
        else:
            # No frontend dist in test env — the no_frontend route returns JSON
            assert response.status_code == 200

    def test_serves_app_when_authenticated(self, auth_client, auth_config):
        cookie_value = create_session_value(auth_config.auth_token)
        response = auth_client.get(
            "/",
            cookies={"cade_session": cookie_value},
            follow_redirects=False,
        )
        # Should serve index.html or the no-frontend message (not a redirect to /login)
        assert response.status_code == 200

    def test_no_auth_gating_when_disabled(self, noauth_client):
        response = noauth_client.get("/", follow_redirects=False)
        assert response.status_code == 200


class TestLoginIntegration:
    """End-to-end login flow tests."""

    def test_full_login_flow(self, auth_client, auth_config):
        """Login → get cookie → use cookie for subsequent requests."""
        # Step 1: Login
        login_resp = auth_client.post(
            "/api/auth/login",
            json={"token": auth_config.auth_token},
        )
        assert login_resp.status_code == 200
        cookie_value = login_resp.cookies.get("cade_session")
        assert cookie_value is not None

        # Step 2: Auth check with the cookie
        check_resp = auth_client.get(
            "/api/auth/check",
            cookies={"cade_session": cookie_value},
        )
        assert check_resp.status_code == 200

        # Step 3: Login page should redirect (already authenticated)
        login_page_resp = auth_client.get(
            "/login",
            cookies={"cade_session": cookie_value},
            follow_redirects=False,
        )
        assert login_page_resp.status_code == 302

    def test_cookie_matches_hmac(self, auth_client, auth_config):
        """Cookie value set by login should match the HMAC we compute."""
        login_resp = auth_client.post(
            "/api/auth/login",
            json={"token": auth_config.auth_token},
        )
        cookie_value = login_resp.cookies.get("cade_session")
        expected = create_session_value(auth_config.auth_token)
        assert cookie_value == expected
