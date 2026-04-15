"""Generate temporary MCP config for the orchestrator."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

MCP_SERVER_SCRIPT = Path(__file__).parent / "mcp_server.py"
PERMISSION_SERVER_SCRIPT = Path(__file__).parent.parent / "permissions" / "mcp_server.py"

# The venv Python has mcp/httpx installed; sys.executable may not if the
# backend was launched outside the venv.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_VENV_PYTHON = _PROJECT_ROOT / ".venv" / "bin" / "python"


def _get_python() -> str:
    if _VENV_PYTHON.exists():
        return str(_VENV_PYTHON)
    return sys.executable


def create_mcp_config(backend_port: int, auth_token: str = "") -> Path:
    """Create a temp MCP config JSON pointing to the orchestrator server.

    Returns the path to the temp file (caller should not delete it
    while CC is running).
    """
    python = _get_python()
    env: dict[str, str] = {
        "CADE_BACKEND_PORT": str(backend_port),
        "CADE_BACKEND_HOST": "localhost",
    }
    if auth_token:
        env["CADE_AUTH_TOKEN"] = auth_token

    config = {
        "mcpServers": {
            "cade-orchestrator": {
                "command": python,
                "args": [str(MCP_SERVER_SCRIPT)],
                "env": dict(env),
            },
            "cade-permissions": {
                "command": python,
                "args": [str(PERMISSION_SERVER_SCRIPT)],
                "env": dict(env),
            },
        }
    }

    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="cade-mcp-",
        delete=False,
    )
    json.dump(config, tmp, indent=2)
    tmp.close()

    return Path(tmp.name)
