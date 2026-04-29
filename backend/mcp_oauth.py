"""OAuth 2.1 client for MCP servers.

Implements the discovery → DCR → PKCE → token flow described in RFC 9728
(OAuth 2.0 Protected Resource Metadata) + RFC 8414 (Authorization Server
Metadata) + RFC 7591 (Dynamic Client Registration). Tokens are written
to ~/.claude/.credentials.json so they survive backend restarts and so
the existing http_mcp_tools.load_claude_oauth_token reader continues to
work.

Flow:
  1. Caller provides the MCP server URL (e.g. https://api.alphaxiv.org/mcp/v1).
  2. _discover_metadata() resolves authorization-server metadata via the
     resource's well-known endpoint.
  3. _register_client() runs DCR if no client_id is cached.
  4. start_flow() generates PKCE state, builds the authorization URL,
     and stores in-flight context keyed by `request_id`.
  5. The user authenticates in a browser; the auth server redirects
     back to /api/mcp/oauth/callback?code=...&state=<request_id>.
  6. complete_flow() exchanges the code for tokens and persists them.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import urlencode, urlparse

import httpx

logger = logging.getLogger(__name__)

CREDS_PATH = Path.home() / ".claude" / ".credentials.json"
CLIENT_NAME = "CADE"

# How long an in-flight flow is kept before we discard it.
FLOW_TTL_SECONDS = 600


@dataclass
class _Metadata:
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None
    scopes_supported: list[str]
    code_challenge_methods_supported: list[str]


@dataclass
class _Flow:
    request_id: str
    server_name: str
    server_url: str
    authorization_server: str
    metadata: _Metadata
    client_id: str
    redirect_uri: str
    code_verifier: str
    state: str
    scope: str
    created_at: float = field(default_factory=time.monotonic)


_pending: dict[str, _Flow] = {}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _resource_origin(server_url: str) -> str:
    """Extract origin from URL: https://api.alphaxiv.org/mcp/v1 → https://api.alphaxiv.org."""
    parsed = urlparse(server_url)
    return f"{parsed.scheme}://{parsed.netloc}"


async def _discover_metadata(client: httpx.AsyncClient, server_url: str) -> _Metadata:
    """Resolve authorization-server metadata via RFC 9728 + RFC 8414."""
    origin = _resource_origin(server_url)

    auth_server: str | None = None
    try:
        r = await client.get(f"{origin}/.well-known/oauth-protected-resource", timeout=5.0)
        if r.status_code == 200:
            data = r.json()
            servers = data.get("authorization_servers") or []
            if servers:
                auth_server = servers[0]
    except Exception as e:  # noqa: BLE001 — network discovery is best-effort
        logger.debug("oauth-protected-resource probe failed for %s: %s", origin, e)

    candidates: list[str] = []
    if auth_server:
        candidates.append(auth_server)
    candidates.append(origin)

    last_err: Exception | None = None
    for base in candidates:
        for path in (
            "/.well-known/oauth-authorization-server",
            "/.well-known/openid-configuration",
        ):
            try:
                r = await client.get(f"{base}{path}", timeout=5.0)
                if r.status_code == 200:
                    md = r.json()
                    return _Metadata(
                        authorization_endpoint=md["authorization_endpoint"],
                        token_endpoint=md["token_endpoint"],
                        registration_endpoint=md.get("registration_endpoint"),
                        scopes_supported=md.get("scopes_supported") or [],
                        code_challenge_methods_supported=md.get(
                            "code_challenge_methods_supported"
                        ) or [],
                    )
            except Exception as e:  # noqa: BLE001
                last_err = e

    raise RuntimeError(
        f"Could not discover OAuth metadata for {server_url}: {last_err}"
    )


async def _register_client(
    client: httpx.AsyncClient,
    metadata: _Metadata,
    redirect_uri: str,
) -> str:
    """Run Dynamic Client Registration (RFC 7591). Returns the client_id."""
    if not metadata.registration_endpoint:
        raise RuntimeError(
            "Authorization server does not advertise a registration_endpoint; "
            "static client_id required (not yet supported)."
        )
    body = {
        "client_name": CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    r = await client.post(metadata.registration_endpoint, json=body, timeout=10.0)
    r.raise_for_status()
    data = r.json()
    return data["client_id"]


def _gc_pending() -> None:
    """Drop stale in-flight flows so the dict doesn't grow unbounded."""
    now = time.monotonic()
    stale = [k for k, f in _pending.items() if now - f.created_at > FLOW_TTL_SECONDS]
    for rid in stale:
        _pending.pop(rid, None)


async def start_flow(
    server_name: str,
    server_url: str,
    backend_origin: str,
) -> tuple[str, str]:
    """Begin an OAuth flow and return (authorization_url, request_id).

    `backend_origin` is the URL the user's browser will reach the CADE
    backend at — used to build the redirect_uri (callback). Typically
    http://localhost:<port>.
    """
    _gc_pending()
    request_id = _b64url(secrets.token_bytes(16))
    redirect_uri = f"{backend_origin}/api/mcp/oauth/callback"

    async with httpx.AsyncClient() as client:
        metadata = await _discover_metadata(client, server_url)
        client_id = await _register_client(client, metadata, redirect_uri)

    code_verifier = _b64url(secrets.token_bytes(32))
    code_challenge = _b64url(hashlib.sha256(code_verifier.encode("ascii")).digest())
    state = request_id

    preferred = ["openid", "profile", "email", "offline_access"]
    scopes = [s for s in preferred if s in metadata.scopes_supported] or [
        s for s in metadata.scopes_supported if s
    ]
    scope = " ".join(scopes)

    flow = _Flow(
        request_id=request_id,
        server_name=server_name,
        server_url=server_url,
        authorization_server=metadata.authorization_endpoint.rsplit("/oauth/", 1)[0],
        metadata=metadata,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_verifier=code_verifier,
        state=state,
        scope=scope,
    )
    _pending[request_id] = flow

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": state,
        "scope": scope,
    }
    auth_url = f"{metadata.authorization_endpoint}?{urlencode(params)}"
    logger.info(
        "MCP OAuth start: server=%s client_id=%s redirect=%s",
        server_name, client_id, redirect_uri,
    )
    return auth_url, request_id


async def complete_flow(state: str, code: str) -> dict:
    """Exchange `code` for tokens and persist them. Returns saved entry."""
    flow = _pending.pop(state, None)
    if flow is None:
        raise RuntimeError("No pending OAuth flow for that state (expired?)")

    async with httpx.AsyncClient() as client:
        body = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": flow.redirect_uri,
            "client_id": flow.client_id,
            "code_verifier": flow.code_verifier,
        }
        r = await client.post(
            flow.metadata.token_endpoint,
            data=body,
            timeout=10.0,
            headers={"Accept": "application/json"},
        )
        r.raise_for_status()
        token_data = r.json()

    access_token = token_data.get("access_token")
    if not access_token:
        raise RuntimeError(f"Token response missing access_token: {token_data}")
    expires_in = int(token_data.get("expires_in") or 0)
    expires_at_ms = int((time.time() + expires_in) * 1000) if expires_in else 0

    entry = {
        "serverName": flow.server_name,
        "serverUrl": flow.server_url,
        "accessToken": access_token,
        "discoveryState": {
            "authorizationServerUrl": flow.authorization_server,
            "oauthMetadataFound": True,
        },
        "clientId": flow.client_id,
        "expiresAt": expires_at_ms,
        "scope": flow.scope,
    }
    refresh = token_data.get("refresh_token")
    if refresh:
        entry["refreshToken"] = refresh

    _save_credential(flow.server_name, entry)
    logger.info(
        "MCP OAuth complete: server=%s scope=%s expires_in=%ds",
        flow.server_name, flow.scope, expires_in,
    )

    # Live providers cache the bearer header at construction time. With a
    # fresh token sitting on disk, we still need to walk every running
    # adapter for this server and reset its session + connect-failed flag.
    # Without this, the user has to reload CADE for tools to come alive.
    try:
        from core.backend.providers.http_mcp_tools import refresh_adapters_for_server
        refreshed = await refresh_adapters_for_server(flow.server_name)
        logger.info(
            "MCP OAuth: refreshed %d live adapter(s) for %s",
            refreshed, flow.server_name,
        )
    except Exception:  # noqa: BLE001
        logger.exception("MCP OAuth: adapter refresh failed for %s", flow.server_name)

    return entry


def _save_credential(server_name: str, entry: dict) -> None:
    """Write entry to ~/.claude/.credentials.json under mcpOAuth.<server>|<rand>.

    Same key shape Claude Code uses, so http_mcp_tools.load_claude_oauth_token
    finds it via prefix match.
    """
    CREDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if CREDS_PATH.exists():
        try:
            creds = json.loads(CREDS_PATH.read_text() or "{}")
        except Exception:  # noqa: BLE001 — corrupt file shouldn't block auth
            creds = {}
    else:
        creds = {}
    if not isinstance(creds, dict):
        creds = {}
    mcp = creds.setdefault("mcpOAuth", {})
    if not isinstance(mcp, dict):
        mcp = {}
        creds["mcpOAuth"] = mcp

    for key in list(mcp.keys()):
        if key == server_name or key.startswith(f"{server_name}|"):
            mcp.pop(key, None)
    rand = _b64url(secrets.token_bytes(8))[:16]
    mcp[f"{server_name}|{rand}"] = entry

    tmp = CREDS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(creds, indent=2))
    tmp.replace(CREDS_PATH)
    try:
        CREDS_PATH.chmod(0o600)
    except Exception:  # noqa: BLE001 — best-effort on Windows
        pass


# --- Status broadcaster registration ---------------------------------------
#
# main.py registers a callback so the OAuth callback handler can push
# refreshed mcpStatus to the frontend without a circular import.

_status_broadcast: Callable[[str], Awaitable[None]] | None = None


def register_status_broadcaster(fn: Callable[[str], Awaitable[None]]) -> None:
    global _status_broadcast
    _status_broadcast = fn


async def broadcast_status_change(server_name: str) -> None:
    if _status_broadcast is None:
        return
    try:
        await _status_broadcast(server_name)
    except Exception:  # noqa: BLE001
        logger.exception("MCP status broadcast failed")
