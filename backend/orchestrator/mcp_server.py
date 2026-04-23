"""MCP server for CADE — stdio transport.

Provides tools for agent orchestration and file viewing.
Claude Code calls these tools via MCP to interact with CADE.
"""

from __future__ import annotations

import os

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("cade-orchestrator")

BACKEND_PORT = int(os.environ.get("CADE_BACKEND_PORT", "3000"))
BACKEND_HOST = os.environ.get("CADE_BACKEND_HOST", "localhost")
BASE_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}"

# Auth token for API calls (optional, used in remote deployments)
AUTH_TOKEN = os.environ.get("CADE_AUTH_TOKEN", "")


def _get_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if AUTH_TOKEN:
        headers["Cookie"] = f"cade_session={AUTH_TOKEN}"
    return headers


@mcp.tool()
async def spawn_agent(name: str, task: str, mode: str = "code") -> str:
    """Spawn a new agent to work on a task. Blocks until the agent completes and returns its report.

    The user will see an approval dialog before the agent starts. After the agent
    finishes, the user reviews and approves/rejects the report. The report text
    is returned directly.

    Args:
        name: Short identifier for the agent (e.g. "test-writer", "refactor")
        task: Full task description — what the agent should do
        mode: Agent mode — "code" (full access) or "architect" (read-only planning)

    Returns:
        Agent report text (approved), rejection message, or error
    """
    async with httpx.AsyncClient(timeout=3700.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/orchestrator/spawn-and-wait",
            json={"name": name, "task": task, "mode": mode},
            headers=_get_headers(),
        )
        response.raise_for_status()
        return response.text


@mcp.tool()
async def list_agents() -> str:
    """List all orchestrator agents and their current states.

    Returns:
        JSON array of agent summaries
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{BASE_URL}/api/orchestrator/agents",
            headers=_get_headers(),
        )
        response.raise_for_status()
        return response.text


# ─── UI Tools ────────────────────────────────────────────────

@mcp.tool()
async def view_file(path: str) -> str:
    """Open a file in the CADE viewer pane.

    Shows the file in the markdown/code viewer. The user sees it
    immediately without leaving their current context.

    Args:
        path: File path relative to the project root (e.g. "src/main.ts", "docs/plans/roadmap.md")

    Returns:
        Confirmation message
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/ui/view-file",
            json={"path": path},
            headers=_get_headers(),
        )
        response.raise_for_status()
        return response.text


if __name__ == "__main__":
    mcp.run(transport="stdio")
