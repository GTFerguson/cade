"""MCP server for permission prompts — stdio transport.

Claude Code calls this tool via --permission-prompt-tool when it needs
user approval for a tool use. The tool blocks until the user approves
or denies via the CADE frontend.
"""

from __future__ import annotations

import os

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("cade-permissions")

BACKEND_PORT = int(os.environ.get("CADE_BACKEND_PORT", "3000"))
BACKEND_HOST = os.environ.get("CADE_BACKEND_HOST", "localhost")
BASE_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}"

AUTH_TOKEN = os.environ.get("CADE_AUTH_TOKEN", "")


def _get_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if AUTH_TOKEN:
        headers["Cookie"] = f"cade_session={AUTH_TOKEN}"
    return headers


@mcp.tool()
async def permission_prompt(
    tool_name: str,
    input_description: str,
    tool_input: dict | None = None,
) -> str:
    """Request user permission to execute a tool.

    Called by Claude Code when it needs approval before running a tool.
    Blocks until the user approves or denies in the CADE UI.

    Args:
        tool_name: Name of the tool (e.g., "Bash", "Write", "Edit")
        input_description: Human-readable description of what the tool will do
        tool_input: The raw tool input parameters

    Returns:
        JSON string with the user's decision: {"decision": "allow"} or {"decision": "deny", "message": "..."}
    """
    async with httpx.AsyncClient(timeout=3600.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/permissions/prompt-and-wait",
            json={
                "tool_name": tool_name,
                "description": input_description,
                "tool_input": tool_input or {},
            },
            headers=_get_headers(),
        )
        response.raise_for_status()
        return response.text


if __name__ == "__main__":
    mcp.run(transport="stdio")
