"""Generate MCP config for Claude Code CLI orchestration."""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

# The venv Python has mcp/httpx installed; sys.executable may not if the
# backend was launched outside the venv.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_VENV_PYTHON = _PROJECT_ROOT / ".venv" / "bin" / "python"

# Source script paths — only valid in dev (not in a PyInstaller package).
_MCP_SERVER_SCRIPT = Path(__file__).parent / "mcp_server.py"
_PERMISSION_SERVER_SCRIPT = Path(__file__).parent.parent / "permissions" / "mcp_server.py"


def _is_frozen() -> bool:
    """True when running inside a PyInstaller-packaged binary."""
    return getattr(sys, "frozen", False)


def _get_python() -> str:
    if _VENV_PYTHON.exists():
        return str(_VENV_PYTHON)
    return sys.executable


def _server_command(server_type: str) -> tuple[str, list[str]]:
    """Return (command, args) to launch the given MCP server.

    In the packaged binary we can't run .py scripts from the extraction dir,
    so we delegate to the binary's own ``mcp-server`` subcommand instead.
    """
    if _is_frozen():
        return sys.executable, ["mcp-server", "--type", server_type]
    python = _get_python()
    script = _MCP_SERVER_SCRIPT if server_type == "orchestrator" else _PERMISSION_SERVER_SCRIPT
    return python, [str(script)]


def mcp_config_dir() -> Path:
    """Directory for per-connection Claude Code MCP config files."""
    return Path.home() / ".cade" / "mcp"


def mcp_config_path(session_id: str | None, connection_id: str) -> Path:
    """Stable path for a tab's MCP config.

    Prefer ``session_id`` so reconnecting websockets can refresh the baked-in
    ``CADE_CONNECTION_ID`` without changing the path Claude Code already has in
    its PTY environment.
    """
    key = session_id or connection_id
    prefix = "session-" if session_id else "conn-"
    return mcp_config_dir() / f"{prefix}{key}.json"


def write_mcp_config(
    connection_id: str,
    *,
    backend_port: int,
    auth_token: str = "",
    backend_host: str = "localhost",
    session_id: str | None = None,
) -> Path:
    """Write (or overwrite) the MCP config for a CADE websocket connection."""
    env: dict[str, str] = {
        "CADE_BACKEND_PORT": str(backend_port),
        "CADE_BACKEND_HOST": backend_host,
        "CADE_CONNECTION_ID": connection_id,
    }
    if auth_token:
        env["CADE_AUTH_TOKEN"] = auth_token

    orch_cmd, orch_args = _server_command("orchestrator")
    perm_cmd, perm_args = _server_command("permissions")

    config = {
        "mcpServers": {
            "cade-orchestrator": {
                "command": orch_cmd,
                "args": orch_args,
                "env": dict(env),
            },
            "cade-permissions": {
                "command": perm_cmd,
                "args": perm_args,
                "env": dict(env),
            },
        }
    }

    path = mcp_config_path(session_id, connection_id)
    # The config embeds CADE_AUTH_TOKEN, so keep the dir and file owner-only.
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    logger.info("Wrote CLI MCP config → %s (connection=%s)", path, connection_id)
    return path


def remove_mcp_config(path: str | Path | None) -> None:
    """Delete a CLI MCP config file (best effort).

    Called when the owning PTY session is torn down — these live at stable,
    session-keyed paths and would otherwise accumulate (each one holding the
    auth token) for the life of ``~/.cade/mcp``.
    """
    if not path:
        return
    try:
        Path(path).unlink()
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.debug("Could not remove MCP config %s: %s", path, e)


def cli_orchestrator_enabled() -> bool:
    """Return whether CC terminal tabs should get orchestrator MCP wiring."""
    if os.getenv("CADE_CLI_ORCHESTRATOR", "true").lower() in ("0", "false", "no", "off"):
        return False
    from core.backend.providers.config import get_providers_config, resolve_worker_provider

    cfg = get_providers_config()
    if not cfg.cli_orchestrator:
        return False
    return resolve_worker_provider(cfg) is not None


def prepare_cli_orchestrator_env(
    connection_id: str,
    *,
    backend_port: int,
    auth_token: str = "",
    session_id: str | None = None,
    project_dir: Path | None = None,
) -> dict[str, str]:
    """Build PTY env vars wiring the CLI coding agent to CADE's orchestrator MCP.

    For Claude Code the agent reads the generated JSON via ``--mcp-config``.
    For Codex/Cursor the adapter merges the server entries into the agent's
    native config file so auto-discovery picks them up.
    """
    path = write_mcp_config(
        connection_id,
        backend_port=backend_port,
        auth_token=auth_token,
        session_id=session_id,
    )

    # Let the adapter install the servers into its native config location.
    from backend.config import get_config
    from backend.terminal.cli_agent_adapters import adapter_from_descriptor

    adapter = adapter_from_descriptor(get_config().cli_agent)
    if adapter.capabilities.mcp:
        servers = json.loads(path.read_text(encoding="utf-8")).get("mcpServers", {})
        try:
            adapter.install_mcp_config(servers, project_dir)
        except Exception as exc:
            logger.warning(
                "Failed to install MCP config for %s: %s",
                adapter.display_name,
                exc,
            )

    env = {"CADE_CLI_MCP_CONFIG": str(path)}
    if session_id:
        # The resume-on-exit wrapper and the edit hook both key handoff-brief
        # ownership off this, so a tab only auto-resumes the brief it wrote
        # rather than whichever sibling tab's brief is newest in the project.
        env["CADE_SESSION_ID"] = session_id
    return env


def remove_adapter_mcp_config(project_dir: Path | None = None) -> None:
    """Remove CADE-managed MCP entries from the active adapter's native config.

    Called alongside ``remove_mcp_config`` during session teardown.
    """
    from backend.config import get_config
    from backend.terminal.cli_agent_adapters import adapter_from_descriptor

    try:
        adapter = adapter_from_descriptor(get_config().cli_agent)
        adapter.remove_mcp_config(project_dir)
    except Exception as exc:
        logger.debug("Adapter MCP cleanup skipped: %s", exc)
