"""Single source of truth for known MCP server URLs.

The handshake (websocket.py) and the post-auth broadcast (main.py) both
need to publish `serverUrl` for each MCP server so the frontend can start
an OAuth flow. Both call get_known_server_url so the URL only lives here.
"""

from __future__ import annotations

KNOWN_SERVERS: dict[str, str] = {
    "alphaxiv": "https://api.alphaxiv.org/mcp/v1",
}


def get_known_server_url(server_name: str) -> str | None:
    return KNOWN_SERVERS.get(server_name)
