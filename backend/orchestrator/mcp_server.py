"""MCP server for CADE — stdio transport.

Provides tools for agent orchestration and file viewing.
Claude Code calls these tools via MCP to interact with CADE.
"""

from __future__ import annotations

import os

import httpx
from mcp.server.fastmcp import FastMCP


BACKEND_PORT = int(os.environ.get("CADE_BACKEND_PORT", "3000"))
BACKEND_HOST = os.environ.get("CADE_BACKEND_HOST", "localhost")
BASE_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}"

AUTH_TOKEN = os.environ.get("CADE_AUTH_TOKEN", "")
CONNECTION_ID = os.environ.get("CADE_CONNECTION_ID", "")


def _get_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if AUTH_TOKEN:
        headers["Cookie"] = f"cade_session={AUTH_TOKEN}"
    if CONNECTION_ID:
        headers["X-Connection-Id"] = CONNECTION_ID
    return headers


async def spawn_agent(name: str, task: str, mode: str = "code") -> str:
    """Spawn a CADE worker agent (LiteLLM/API) to execute a task on your behalf.

    Use this to delegate implementation work while you stay on your Max plan for
    planning and review. The worker runs in CADE with file/bash tools; you receive
    its report when it finishes.

    Delegate: implementation, refactors, test writing, multi-file edits, grep-heavy
    exploration, research-with-files.
    Keep on Claude Code: planning, architecture, brainstorming, ambiguous requirements,
    final sign-off review.

    Each task must be self-contained with goal, relevant files, constraints, and
    acceptance criteria. Parallel independent tasks with concurrent spawn_agent calls.
    Spawns and reports are auto-approved for Claude Code CLI — no user confirmation.

    Args:
        name: Short identifier for the agent (e.g. "test-writer", "refactor")
        task: Full task description — what the agent should do
        mode: Agent mode — "code" (full access), "plan" (read-only), "research"
            (PROVEN research pipeline), "review" (code review), "orchestrator"
            (spawn further sub-agents)

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

async def _post_ui(endpoint: str, payload: dict) -> str:
    """Call a viewer endpoint, returning its error text instead of raising.

    A refusal ("no CADE tab is connected", "html is empty") is something the
    agent can act on, so it is passed back as the tool result.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{BASE_URL}/api/ui/{endpoint}",
            # The working directory lets the backend find the right tab when
            # the connection id this process was launched with has gone stale.
            json={**payload, "cwd": os.getcwd()},
            headers=_get_headers(),
        )
        return response.text


async def view_file(path: str) -> str:
    """Open a file in the CADE viewer pane.

    The user sees it immediately, beside the terminal, without leaving their
    current context. Markdown, code, JSON, images and PDFs each get their own
    rendering, and .html files are shown as live pages.

    Args:
        path: File path relative to the project root (e.g. "src/main.ts", "docs/plans/roadmap.md")

    Returns:
        Confirmation message
    """
    return await _post_ui("view-file", {"path": path})


async def show_html(html: str, name: str = "canvas") -> str:
    """Draw a page in the CADE viewer pane, beside the terminal.

    Use this to show the user something visual without making them leave CADE:
    a diagram, chart, UI mockup, comparison table, or interactive explainer.
    The page is rendered live, scripts included, in an isolated frame.

    Pass a complete, self-contained HTML document. Inline its CSS and
    JavaScript, or load libraries from a CDN by absolute URL; relative paths
    to local files do not resolve.

    The page is saved to .cade/canvas/<name>.html in the project. Calling
    again with the same name replaces it. For a small change, edit that file
    and call view_file on it. Use different names to keep several pages.

    Args:
        html: The full HTML document to display
        name: Short label for the page (e.g. "auth-flow", "latency-chart")

    Returns:
        The saved file path, or an error message
    """
    return await _post_ui("show-html", {"html": html, "name": name})


_TOOLS = (spawn_agent, list_agents, view_file, show_html)

# Must match DISABLED_TOOLS_ENV in backend/orchestrator/mcp_config.py. Not
# imported from there: run as a script, this file sees only its own folder.
_DISABLED_TOOLS_ENV = "CADE_DISABLED_TOOLS"


def build_server() -> FastMCP:
    """The server, offering every tool not turned off in providers.toml."""
    off = {n.strip() for n in os.environ.get(_DISABLED_TOOLS_ENV, "").split(",") if n.strip()}
    server = FastMCP("cade-orchestrator")
    for tool in _TOOLS:
        if tool.__name__ not in off:
            server.add_tool(tool)
    return server


if __name__ == "__main__":
    build_server().run(transport="stdio")
