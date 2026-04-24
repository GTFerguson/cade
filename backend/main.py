"""Main entry point for CADE backend."""

from __future__ import annotations

import argparse
import logging
import secrets
import subprocess

from backend.subprocess_utils import run_silent
import sys
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING

import uvicorn
from fastapi import Cookie, FastAPI, Request, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel

from backend.auth import create_session_value, validate_session_cookie
from backend.config import Config, get_config, set_config
from backend.login_page import get_login_page_html
from backend.terminal.connections import get_connection_manager
from backend.connection_registry import get_connection_registry
from backend.files.tree import get_file_type
from backend.protocol import MessageType
from backend.terminal.sessions import get_registry
from backend.websocket import websocket_handler
from backend.cc_session_resolver import resolve_slug_to_project
from backend.wsl.health import ensure_wsl_ready
from backend.wsl.paths import wsl_to_windows_path
from backend.wsl.session_unifier import unify_sessions
from backend.middleware import setup_cors

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)

# Paths
# When running as PyInstaller bundle, __file__ points to the executable
# and bundled files are in sys._MEIPASS
BACKEND_DIR = Path(__file__).parent
PROJECT_ROOT = BACKEND_DIR.parent

# Check if running as PyInstaller bundle
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    # Running as PyInstaller bundle
    FRONTEND_DIST = Path(sys._MEIPASS) / "frontend" / "dist"
else:
    # Running as normal Python script
    FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


async def _check_wsl_health_async() -> None:
    """Run WSL health check in a thread to avoid blocking."""
    import asyncio

    config = get_config()

    # Skip WSL check in dummy mode or if not using WSL
    if config.dummy_mode:
        return
    if "wsl" not in config.shell_command.lower():
        return

    logger.info("Checking WSL health...")
    ready, msg = await asyncio.to_thread(ensure_wsl_ready)
    if ready:
        logger.info("WSL ready")
    else:
        logger.warning("WSL not ready: %s", msg)


def _write_discovery_files(config: Config) -> list[Path]:
    """Write port and host files so hook scripts can find the server.

    Returns list of files written (for cleanup on shutdown).
    """
    from backend.hooks.wsl_path import get_wsl_cade_dir

    cade_dir = get_wsl_cade_dir()
    written: list[Path] = []

    try:
        cade_dir.mkdir(parents=True, exist_ok=True)

        port_file = cade_dir / "port"
        port_file.write_text(str(config.port), encoding="utf-8")
        written.append(port_file)
        logger.info("Wrote %s", port_file)

        host_file = cade_dir / "host"
        host_value = _resolve_host_for_hooks()
        host_file.write_text(host_value, encoding="utf-8")
        written.append(host_file)
        logger.info("Wrote %s (host=%s)", host_file, host_value)

    except Exception as e:
        logger.warning("Failed to write discovery files: %s", e)

    return written


def _resolve_host_for_hooks() -> str:
    """Determine the host value that hook scripts should use to reach us.

    On Windows (where CADE server runs), the hook runs in WSL and needs
    the gateway IP. On Linux, both server and hook are local.
    """
    if sys.platform == "win32":
        try:
            result = run_silent(
                ["wsl", "ip", "route", "show", "default"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            # Output: "default via 172.x.x.x dev eth0"
            parts = result.stdout.strip().split()
            if len(parts) >= 3 and parts[0] == "default":
                return parts[2]
        except Exception as e:
            logger.warning("Failed to get WSL gateway IP: %s", e)

    return "localhost"


def _cleanup_discovery_files(files: list[Path]) -> None:
    """Remove discovery files written at startup."""
    for f in files:
        try:
            f.unlink(missing_ok=True)
        except Exception:
            pass


def _read_existing_filter_mode() -> bool:
    """Read the filter mode from an existing hook script.

    Preserves user customization (e.g. --all-files) across restarts.

    Returns:
        True if the existing script uses all_files mode, False otherwise.
    """
    from backend.hooks.installer import SCRIPT_FILENAME
    from backend.hooks.wsl_path import get_wsl_cade_dir

    try:
        script = get_wsl_cade_dir() / "hooks" / SCRIPT_FILENAME
        content = script.read_text(encoding="utf-8")
        return 'FILTER_MODE = "all_files"' in content
    except Exception:
        return False


def _auto_setup_hook() -> None:
    """Ensure the CADE hook is installed and up to date.

    Runs every startup. Idempotent — safe to call repeatedly:
    - Writes/refreshes the hook script (preserving existing filter mode)
    - Upgrades old one-liner hooks in settings.json to script-based
    - Adds the hook if missing entirely
    """
    from backend.hooks import CADEHookOptions, setup_cade_hooks

    try:
        all_files = _read_existing_filter_mode()
        options = CADEHookOptions(all_files=all_files)

        result = setup_cade_hooks(options, dry_run=False)
        if result.success:
            logger.info("Hook setup: %s", result.message)
        else:
            logger.warning("Hook setup failed: %s", result.message)

    except Exception as e:
        logger.debug("Auto hook setup skipped: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler."""
    config = get_config()
    config.validate_shell_command()

    try:
        unify_sessions(config.working_dir)
    except Exception as e:
        logger.debug("Session unification skipped: %s", e)

    registry = get_registry()
    await registry.start()

    # Run WSL-dependent startup tasks in the background so the HTTP server
    # starts accepting connections immediately. These tasks involve multiple
    # subprocess calls (wsl -l, wsl whoami, wsl ip route) that can each
    # block for up to 5 seconds if WSL is slow or unresponsive.
    import asyncio

    async def _deferred_wsl_setup() -> list[Path]:
        """Write discovery files and install hooks in a background thread."""
        loop = asyncio.get_running_loop()
        files = await loop.run_in_executor(None, _write_discovery_files, config)
        await loop.run_in_executor(None, _auto_setup_hook)
        return files

    deferred_setup_task = asyncio.create_task(_deferred_wsl_setup())

    wsl_task = asyncio.create_task(_check_wsl_health_async())

    if config.auto_open_browser:
        webbrowser.open(config.server_url)

    logger.info("CADE started at %s", config.server_url)
    logger.info("Working directory: %s", config.working_dir)
    logger.info(
        "Platform: %s, frozen: %s, shell: %s",
        sys.platform,
        getattr(sys, "frozen", False),
        config.shell_command,
    )

    yield

    logger.info("CADE shutting down")

    # Retrieve discovery files from the deferred setup task
    discovery_files: list[Path] = []
    if deferred_setup_task.done() and not deferred_setup_task.cancelled():
        try:
            discovery_files = deferred_setup_task.result()
        except Exception:
            pass
    else:
        deferred_setup_task.cancel()

    _cleanup_discovery_files(discovery_files)

    wsl_task.cancel()
    try:
        await wsl_task
    except asyncio.CancelledError:
        pass

    # Shut down Neovim instances
    from backend.neovim.manager import get_neovim_manager
    await get_neovim_manager().stop()

    await registry.stop()


class ViewFileRequest(BaseModel):
    """Request body for /api/view endpoint."""

    path: str
    session_id: str | None = None
    cwd: str | None = None


class LoginRequest(BaseModel):
    """Request body for /api/auth/login endpoint."""

    token: str


class SpawnAgentRequest(BaseModel):
    name: str
    task: str
    mode: str = "code"


async def _send_to_connections(connections: list, message: dict) -> int:
    """Send a message to a list of WebSocket connections.

    Args:
        connections: List of WebSocket connections.
        message: The message to send.

    Returns:
        Number of successful sends.
    """
    sent_count = 0
    for ws in connections:
        try:
            await ws.send_json(message)
            sent_count += 1
        except Exception as e:
            logger.warning("Failed to send to client: %s", e)
    return sent_count


def create_app(config: Config | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if config is not None:
        set_config(config)

    cfg = config or get_config()

    app = FastAPI(
        title="CADE",
        description="Unified terminal environment",
        version="0.1.0",
        lifespan=lifespan,
        root_path=cfg.root_path,
    )

    # Setup CORS middleware for remote access
    setup_cors(app)

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        """WebSocket endpoint for terminal and file operations."""
        await websocket_handler(websocket, get_config())

    @app.post("/api/view")
    async def view_file(request: ViewFileRequest) -> dict:
        """Broadcast a file to all connected clients for viewing.

        This endpoint is called by external tools (like Claude Code hooks)
        to display a file in the markdown viewer.
        """
        logger.info("API /api/view called with path: %s", request.path)

        # Translate WSL paths to Windows UNC paths
        path_str = wsl_to_windows_path(request.path)
        if path_str != request.path:
            logger.info("Translated to Windows path: %s", path_str)

        file_path = Path(path_str).expanduser().resolve()

        if not file_path.exists():
            return {"error": "File not found", "path": str(file_path)}

        if not file_path.is_file():
            return {"error": "Not a file", "path": str(file_path)}

        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as e:
            return {"error": f"Failed to read file: {e}", "path": str(file_path)}

        file_type = get_file_type(str(file_path))

        message = {
            "type": MessageType.VIEW_FILE,
            "path": str(file_path),
            "content": content,
            "fileType": file_type,
        }

        # Use targeted routing: only send to connections whose project contains this file
        registry = get_connection_registry()
        target_connections = registry.get_connections_for_file(file_path)

        if target_connections:
            # Send to matching project connections
            sent_count = await _send_to_connections(target_connections, message)
            logger.info(
                "Sent VIEW_FILE to %d connection(s) for project containing: %s",
                sent_count,
                file_path,
            )
            return {
                "success": True,
                "path": str(file_path),
                "connections": sent_count,
            }

        # Try slug-based routing for plan files (outside project directories)
        # Normalize path separators to handle Windows UNC paths from WSL
        normalized_path = str(file_path).replace("\\", "/")
        if "/.claude/plans/" in normalized_path:
            slug = file_path.stem  # e.g., "jazzy-crunching-moonbeam"
            message["isPlan"] = True  # Mark as plan for overlay behavior

            # First try direct slug-based routing (connection has associated itself with this slug)
            target_ws = registry.get_connection_for_slug(slug)
            if target_ws:
                sent_count = await _send_to_connections([target_ws], message)
                logger.info(
                    "Sent VIEW_FILE to connection via slug match '%s'",
                    slug,
                )
                return {
                    "success": True,
                    "path": str(file_path),
                    "connections": sent_count,
                }

            # Fall back to project-based routing (for first-time associations)
            project_path = resolve_slug_to_project(slug)
            if project_path:
                target_connections = registry.get_connections_for_project(project_path)
                if target_connections:
                    sent_count = await _send_to_connections(target_connections, message)
                    logger.info(
                        "Sent VIEW_FILE to %d connection(s) via slug '%s' for project: %s",
                        sent_count,
                        slug,
                        project_path,
                    )
                    return {
                        "success": True,
                        "path": str(file_path),
                        "connections": sent_count,
                    }

        # Fallback: use cwd from hook context to route to the right project
        if request.cwd:
            cwd_connections = registry.get_connections_for_project(request.cwd)
            if cwd_connections:
                sent_count = await _send_to_connections(cwd_connections, message)
                logger.info(
                    "Sent VIEW_FILE to %d connection(s) via cwd '%s': %s",
                    sent_count,
                    request.cwd,
                    file_path,
                )
                return {
                    "success": True,
                    "path": str(file_path),
                    "connections": sent_count,
                }

        # No routing match - don't broadcast to avoid cross-project leakage
        logger.warning(
            "No routing match for %s - not broadcasting",
            file_path,
        )
        return {
            "success": True,
            "path": str(file_path),
            "connections": 0,
        }

    # --- Auth routes (must be registered before StaticFiles catch-all) ---

    @app.get("/login")
    async def login_page(
        cade_session: str | None = Cookie(default=None),
    ) -> Response:
        """Serve the login page, or redirect to app if already authenticated."""
        cfg = get_config()
        if not cfg.auth_enabled or validate_session_cookie(cade_session or "", cfg):
            return RedirectResponse(url=f"{cfg.root_path}/", status_code=302)
        return HTMLResponse(content=get_login_page_html(cfg.root_path))

    @app.post("/api/auth/login")
    async def login(request: LoginRequest) -> JSONResponse:
        """Validate token, set session cookie, return result."""
        cfg = get_config()

        if not cfg.auth_enabled:
            return JSONResponse({"success": True})

        if not cfg.auth_token or not secrets.compare_digest(request.token, cfg.auth_token):
            return JSONResponse(
                {"success": False, "error": "Invalid token"},
                status_code=401,
            )

        cookie_path = f"{cfg.root_path}/" if cfg.root_path else "/"
        response = JSONResponse({"success": True})
        response.set_cookie(
            key="cade_session",
            value=create_session_value(cfg.auth_token),
            httponly=True,
            samesite="strict",
            max_age=86400,
            path=cookie_path,
        )
        return response

    @app.get("/api/auth/check")
    async def auth_check(
        cade_session: str | None = Cookie(default=None),
    ) -> JSONResponse:
        """Check if the current session is authenticated."""
        cfg = get_config()
        if not cfg.auth_enabled or validate_session_cookie(cade_session or "", cfg):
            return JSONResponse({"authenticated": True})
        return JSONResponse({"authenticated": False}, status_code=401)

    # --- Orchestrator API ---

    @app.post("/api/orchestrator/spawn")
    async def orchestrator_spawn(request: Request, body: SpawnAgentRequest) -> JSONResponse:
        """Spawn an orchestrator agent."""
        from backend.orchestrator.manager import get_orchestrator_manager
        from backend.orchestrator.models import AgentSpec

        connection_id = request.headers.get("X-Connection-Id", "")
        manager = get_orchestrator_manager()
        spec = AgentSpec(name=body.name, task=body.task, mode=body.mode)
        record = await manager.spawn_agent(spec, connection_id=connection_id)
        return JSONResponse({
            "agent_id": record.agent_id,
            "name": record.name,
            "state": record.state.value,
        })

    @app.get("/api/orchestrator/status/{agent_id}")
    async def orchestrator_status(agent_id: str) -> JSONResponse:
        """Get agent status."""
        from backend.orchestrator.manager import get_orchestrator_manager

        manager = get_orchestrator_manager()
        status = manager.get_status(agent_id)
        if status is None:
            return JSONResponse({"error": "Agent not found"}, status_code=404)
        return JSONResponse(status)

    @app.get("/api/orchestrator/report/{agent_id}")
    async def orchestrator_report(agent_id: str) -> JSONResponse:
        """Get agent report."""
        from backend.orchestrator.manager import get_orchestrator_manager

        manager = get_orchestrator_manager()
        report = manager.get_report(agent_id)
        if report is None:
            return JSONResponse({"error": "Agent not found"}, status_code=404)
        return JSONResponse(report)

    @app.get("/api/orchestrator/agents")
    async def orchestrator_list() -> JSONResponse:
        """List all agents."""
        from backend.orchestrator.manager import get_orchestrator_manager

        manager = get_orchestrator_manager()
        return JSONResponse(manager.list_agents())

    @app.post("/api/orchestrator/approve/{agent_id}")
    async def orchestrator_approve(agent_id: str) -> JSONResponse:
        """Approve a pending agent to start execution."""
        from backend.orchestrator.manager import get_orchestrator_manager

        manager = get_orchestrator_manager()
        ok = await manager.approve_agent(agent_id)
        if not ok:
            return JSONResponse({"error": "Agent not found or not pending"}, status_code=400)
        return JSONResponse({"status": "approved"})

    @app.post("/api/orchestrator/reject/{agent_id}")
    async def orchestrator_reject(agent_id: str) -> JSONResponse:
        """Reject a pending agent."""
        from backend.orchestrator.manager import get_orchestrator_manager

        manager = get_orchestrator_manager()
        ok = await manager.reject_agent(agent_id)
        if not ok:
            return JSONResponse({"error": "Agent not found or not pending"}, status_code=400)
        return JSONResponse({"status": "rejected"})

    @app.post("/api/orchestrator/spawn-and-wait")
    async def orchestrator_spawn_and_wait(request: Request, body: SpawnAgentRequest) -> JSONResponse:
        """Spawn an agent and block until its full lifecycle completes."""
        from backend.orchestrator.manager import get_orchestrator_manager
        from backend.orchestrator.models import AgentSpec

        connection_id = request.headers.get("X-Connection-Id", "")
        manager = get_orchestrator_manager()
        spec = AgentSpec(name=body.name, task=body.task, mode=body.mode)
        record = await manager.spawn_agent(spec, connection_id=connection_id)
        result = await manager.await_completion(record.agent_id, timeout=3600.0)
        return JSONResponse(result)

    @app.post("/api/orchestrator/approve-report/{agent_id}")
    async def orchestrator_approve_report(agent_id: str) -> JSONResponse:
        """Approve an agent's report."""
        from backend.orchestrator.manager import get_orchestrator_manager

        manager = get_orchestrator_manager()
        ok = await manager.approve_report(agent_id)
        if not ok:
            return JSONResponse({"error": "Agent not found or not in review"}, status_code=400)
        return JSONResponse({"status": "approved"})

    @app.post("/api/orchestrator/reject-report/{agent_id}")
    async def orchestrator_reject_report(agent_id: str) -> JSONResponse:
        """Reject an agent's report."""
        from backend.orchestrator.manager import get_orchestrator_manager

        manager = get_orchestrator_manager()
        ok = await manager.reject_report(agent_id)
        if not ok:
            return JSONResponse({"error": "Agent not found or not in review"}, status_code=400)
        return JSONResponse({"status": "rejected"})

    # --- Permission Prompt API ---

    # Tool name sets for auto-classification at the MCP permission boundary
    _READ_TOOLS = frozenset({"Read", "Glob", "Grep", "LS", "list_directory", "View", "Cat"})
    _WRITE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "Create", "Delete", "Move", "Rename"})

    class PermissionPromptRequest(BaseModel):
        tool_name: str
        description: str
        tool_input: dict = {}

    @app.post("/api/permissions/prompt-and-wait")
    async def permission_prompt_and_wait(body: PermissionPromptRequest) -> JSONResponse:
        """Request user permission for a tool use.

        - Category ON  → auto-approve (no prompt)
        - Category OFF → interactive prompt so the user can allow/deny per-request
        - allow_tools OFF → interactive prompt for all tool calls
        """
        from backend.permissions.manager import get_permission_manager
        manager = get_permission_manager()

        tool = body.tool_name

        if tool in _READ_TOOLS:
            if manager.allow_read:
                return JSONResponse({"decision": "allow"})
            # Read is off — fall through to interactive prompt below

        elif tool in _WRITE_TOOLS:
            if manager.allow_write:
                return JSONResponse({"decision": "allow"})
            # Write is off — fall through to interactive prompt below

        elif manager.allow_tools:
            # Unclassified tool and tools are enabled — auto-approve
            return JSONResponse({"decision": "allow"})
        # else: tools off — fall through to interactive prompt below

        # Interactive prompt: blocks until the user approves or denies in the UI
        result = await manager.request_permission(
            tool_name=body.tool_name,
            description=body.description,
            tool_input=body.tool_input,
        )
        return JSONResponse(result)

    @app.post("/api/permissions/approve/{request_id}")
    async def permission_approve(request_id: str) -> JSONResponse:
        """Approve a pending permission request."""
        from backend.permissions.manager import get_permission_manager
        ok = await get_permission_manager().approve(request_id)
        if not ok:
            return JSONResponse({"error": "Request not found"}, status_code=400)
        return JSONResponse({"status": "approved"})

    @app.post("/api/permissions/deny/{request_id}")
    async def permission_deny(request_id: str) -> JSONResponse:
        """Deny a pending permission request."""
        from backend.permissions.manager import get_permission_manager
        ok = await get_permission_manager().deny(request_id)
        if not ok:
            return JSONResponse({"error": "Request not found"}, status_code=400)
        return JSONResponse({"status": "denied"})

    class AcceptEditsRequest(BaseModel):
        enabled: bool

    @app.post("/api/permissions/accept-edits")
    async def set_accept_edits(body: AcceptEditsRequest) -> JSONResponse:
        """Toggle accept-edits (alias for allow_write)."""
        from backend.permissions.manager import get_permission_manager
        get_permission_manager().set_accept_edits(body.enabled)
        return JSONResponse({"acceptEdits": body.enabled})

    class SetPermissionRequest(BaseModel):
        name: str
        value: bool

    @app.post("/api/permissions/set")
    async def set_permission(body: SetPermissionRequest) -> JSONResponse:
        """Set a named permission toggle."""
        from backend.permissions.manager import get_permission_manager
        ok = get_permission_manager().set_permission(body.name, body.value)
        if not ok:
            return JSONResponse({"error": f"Unknown permission: {body.name}"}, status_code=400)
        return JSONResponse(get_permission_manager().get_permissions())

    @app.get("/api/permissions/state")
    async def get_permissions_state() -> JSONResponse:
        """Return current permission state."""
        from backend.permissions.manager import get_permission_manager
        perms = get_permission_manager()
        return JSONResponse({
            "mode": perms.get_mode(),
            **perms.get_permissions(),
        })

    # --- Project config API ---

    class ProjectFiltersResponse(BaseModel):
        include: list[str] = []
        exclude: list[str] = []

    class ProjectFiltersRequest(BaseModel):
        project: str
        include: list[str] = []
        exclude: list[str] = []

    @app.get("/api/project/filters")
    async def get_project_filters(project: str) -> JSONResponse:
        """Read .cade/hook-filters.json for the given project directory."""
        import json as _json
        project_path = Path(project).expanduser().resolve()
        filters_file = project_path / ".cade" / "hook-filters.json"
        if not filters_file.exists():
            return JSONResponse({"include": [], "exclude": []})
        try:
            data = _json.loads(filters_file.read_text(encoding="utf-8"))
            return JSONResponse({
                "include": data.get("include", []),
                "exclude": data.get("exclude", []),
            })
        except Exception as e:
            return JSONResponse({"error": str(e), "include": [], "exclude": []}, status_code=500)

    @app.post("/api/project/filters")
    async def set_project_filters(body: ProjectFiltersRequest) -> JSONResponse:
        """Write .cade/hook-filters.json for the given project directory."""
        import json as _json
        project_path = Path(body.project).expanduser().resolve()
        cade_dir = project_path / ".cade"
        filters_file = cade_dir / "hook-filters.json"
        try:
            cade_dir.mkdir(parents=True, exist_ok=True)
            data: dict = {}
            if body.include:
                data["include"] = body.include
            if body.exclude:
                data["exclude"] = body.exclude
            filters_file.write_text(_json.dumps(data, indent=2), encoding="utf-8")
            return JSONResponse({"success": True})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # --- UI Tools API (called by MCP tools) ---

    class ViewFileRequest(BaseModel):
        path: str

    class PushPanelRequest(BaseModel):
        id: str
        title: str
        component: str
        data: list[dict] = []

    class NotifyRequest(BaseModel):
        message: str
        style: str = "info"

    @app.post("/api/ui/view-file")
    async def ui_view_file(body: ViewFileRequest) -> JSONResponse:
        """Open a file in the viewer for all connected clients."""
        from backend.connection_registry import get_connection_registry
        registry = get_connection_registry()
        # Broadcast to all connections (the file path is project-relative)
        for ws_conn in registry.get_all_connections():
            try:
                await ws_conn.send_json({
                    "type": "view-file",
                    "path": body.path,
                })
            except Exception:
                pass
        return JSONResponse({"status": "ok", "path": body.path})

    @app.post("/api/ui/push-panel")
    async def ui_push_panel(body: PushPanelRequest) -> JSONResponse:
        """Push a dashboard panel to all connected clients."""
        from backend.connection_registry import get_connection_registry
        registry = get_connection_registry()
        for ws_conn in registry.get_all_connections():
            try:
                await ws_conn.send_json({
                    "type": "dashboard-push-panel",
                    "panel": {
                        "id": body.id,
                        "title": body.title,
                        "component": body.component,
                    },
                    "data": body.data,
                })
            except Exception:
                pass
        return JSONResponse({"status": "ok", "panelId": body.id})

    class FixDiagramRequest(BaseModel):
        code: str
        format: str
        error: str

    @app.post("/api/fix-diagram")
    async def fix_diagram(body: FixDiagramRequest) -> JSONResponse:
        """Use the configured adaptive provider to fix a broken diagram."""
        from core.backend.providers.config import get_providers_config
        from core.backend.providers.types import ChatMessage
        from backend.providers.registry import ProviderRegistry

        prompt = (
            f"Fix the following broken {body.format} diagram. "
            f"Return ONLY the corrected diagram code with no explanation, "
            f"no markdown fences, no preamble.\n\n"
            f"Error: {body.error}\n\n"
            f"Broken code:\n{body.code}"
        )
        try:
            providers_config = get_providers_config()
            registry = ProviderRegistry.from_config(providers_config)
            provider = registry.get_default()
            if provider is None:
                return JSONResponse({"error": "No provider configured"}, status_code=503)

            from core.backend.providers.types import TextDelta
            text_chunks: list[str] = []
            async for event in provider.stream_chat([ChatMessage(role="user", content=prompt)]):
                if isinstance(event, TextDelta):
                    text_chunks.append(event.content)

            fixed = "".join(text_chunks).strip()
            # Strip markdown fences if the model added them anyway
            if fixed.startswith("```"):
                lines = fixed.split("\n")
                fixed = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
            return JSONResponse({"code": fixed})
        except Exception as e:
            logger.error("fix-diagram failed: %s", e)
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.post("/api/ui/notify")
    async def ui_notify(body: NotifyRequest) -> JSONResponse:
        """Send a notification to all connected clients."""
        from backend.connection_registry import get_connection_registry
        registry = get_connection_registry()
        for ws_conn in registry.get_all_connections():
            try:
                await ws_conn.send_json({
                    "type": "notification",
                    "message": body.message,
                    "style": body.style,
                })
            except Exception:
                pass
        return JSONResponse({"status": "ok"})

    # --- Frontend serving ---

    if FRONTEND_DIST.exists():
        @app.get("/")
        async def serve_index(
            cade_session: str | None = Cookie(default=None),
        ) -> Response:
            """Serve index.html, or redirect to login if auth required."""
            cfg = get_config()
            if cfg.auth_enabled and not validate_session_cookie(cade_session or "", cfg):
                return RedirectResponse(url=f"{cfg.root_path}/login", status_code=302)
            return FileResponse(FRONTEND_DIST / "index.html")

        app.mount(
            "/",
            StaticFiles(directory=FRONTEND_DIST, html=True),
            name="static",
        )
    else:
        @app.get("/")
        async def no_frontend() -> dict:
            """Return message when frontend is not built."""
            return {
                "message": "Frontend not built. Run 'npm run build' in the frontend directory.",
                "status": "ok",
            }

    return app


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="CADE - Unified terminal environment",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Serve command (default)
    serve_parser = subparsers.add_parser(
        "serve",
        help="Start the CADE server (default)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    serve_parser.add_argument(
        "-p", "--port",
        type=int,
        default=None,
        help="Server port (default: 3000, or CADE_PORT env var)",
    )
    serve_parser.add_argument(
        "-H", "--host",
        type=str,
        default=None,
        help="Server host (default: localhost, or CADE_HOST env var)",
    )
    serve_parser.add_argument(
        "-d", "--dir",
        type=str,
        default=None,
        dest="working_dir",
        help="Working directory (default: current directory)",
    )
    serve_parser.add_argument(
        "-c", "--command",
        type=str,
        default=None,
        dest="shell_command",
        help="Shell command to run (default: claude)",
    )
    serve_parser.add_argument(
        "--no-claude",
        action="store_true",
        help="Don't auto-start claude in shell",
    )
    serve_parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't open browser automatically",
    )
    serve_parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug mode",
    )
    serve_parser.add_argument(
        "--dummy",
        action="store_true",
        help="Show fake Claude UI for development",
    )

    # View command
    view_parser = subparsers.add_parser(
        "view",
        help="Send a file to the viewer",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    view_parser.add_argument(
        "path",
        type=str,
        help="Path to the file to view",
    )
    view_parser.add_argument(
        "-p", "--port",
        type=int,
        default=None,
        help="Server port (default: 3000, or CADE_PORT env var)",
    )
    view_parser.add_argument(
        "-H", "--host",
        type=str,
        default=None,
        help="Server host (default: localhost, or CADE_HOST env var)",
    )

    # Setup-hook command
    setup_hook_parser = subparsers.add_parser(
        "setup-hook",
        help="Configure Claude Code hook for plan file viewing",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    setup_hook_parser.add_argument(
        "--all-files",
        action="store_true",
        help="View all file edits, not just plan files",
    )
    setup_hook_parser.add_argument(
        "-p", "--port",
        type=int,
        default=3001,
        help="CADE server port for the hook",
    )
    setup_hook_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without modifying settings",
    )

    return parser.parse_args()


def setup_logging(debug: bool = False) -> None:
    """Configure logging to console and rotating log file.

    Log file: ~/.cade/logs/cade.log (5 MB max, 3 backups).
    """
    from logging.handlers import RotatingFileHandler

    level = logging.DEBUG if debug else logging.INFO
    fmt = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    handlers: list[logging.Handler] = [logging.StreamHandler()]

    log_dir = Path.home() / ".cade" / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_dir / "cade.log",
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setFormatter(logging.Formatter(fmt))
        handlers.append(file_handler)
    except OSError:
        pass  # Fall back to console-only if directory creation fails

    logging.basicConfig(level=level, format=fmt, handlers=handlers)

    if not debug:
        logging.getLogger("uvicorn").setLevel(logging.WARNING)
        logging.getLogger("watchfiles").setLevel(logging.WARNING)


def run_serve(args: argparse.Namespace) -> None:
    """Run the server."""
    config = Config.from_env()
    config = config.update_from_args(
        port=getattr(args, "port", None),
        host=getattr(args, "host", None),
        working_dir=getattr(args, "working_dir", None),
        shell_command=getattr(args, "shell_command", None),
        auto_start_claude=not args.no_claude if getattr(args, "no_claude", False) else None,
        auto_open_browser=not args.no_browser if getattr(args, "no_browser", False) else None,
        debug=args.debug if getattr(args, "debug", False) else None,
        dummy_mode=args.dummy if getattr(args, "dummy", False) else None,
    )
    set_config(config)

    setup_logging(config.debug)

    app = create_app(config)

    try:
        uvicorn.run(
            app,
            host=config.host,
            port=config.port,
            log_level="debug" if config.debug else "warning",
            ws_ping_interval=30,
            ws_ping_timeout=60,
        )
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)


def run_view(args: argparse.Namespace) -> None:
    """Send a file to the viewer via HTTP API."""
    import json
    import os
    import urllib.error
    import urllib.request

    config = Config.from_env()
    host = args.host if args.host is not None else config.host
    port = args.port if args.port is not None else config.port

    file_path = os.path.abspath(os.path.expanduser(args.path))
    url = f"http://{host}:{port}/api/view"

    data = json.dumps({"path": file_path}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read())
            if "error" in result:
                print(f"Error: {result['error']}", file=sys.stderr)
                sys.exit(1)
            elif result.get("success"):
                connections = result.get("connections", 0)
                if connections > 0:
                    print(f"Sent to {connections} client(s): {file_path}")
                else:
                    print(f"No clients connected. File: {file_path}")
    except urllib.error.URLError as e:
        print(f"Failed to connect to server at {url}: {e}", file=sys.stderr)
        sys.exit(1)


def run_setup_hook(args: argparse.Namespace) -> None:
    """Configure Claude Code hook for plan file viewing."""
    import json

    from backend.hooks import CADEHookOptions, setup_cade_hooks
    from backend.hooks.settings import ClaudeSettings
    from backend.hooks.wsl_path import get_wsl_settings_path

    options = CADEHookOptions(port=args.port, all_files=args.all_files)

    if args.dry_run:
        # For dry run, show what would be written
        settings_path, is_wsl = get_wsl_settings_path()
        settings = ClaudeSettings(settings_path)

        try:
            settings.load()
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON in {settings_path}: {e}", file=sys.stderr)
            sys.exit(1)

        from backend.hooks.commands import build_hook_config
        from backend.hooks.config import HookType
        from backend.hooks.installer import install_hook_script

        script_path = install_hook_script(options, dry_run=True)
        hook_config = build_hook_config(options)
        hook_updated = settings.add_hook(HookType.POST_TOOL_USE, hook_config)

        action = "Would update existing" if hook_updated else "Would add new"
        print(f"{action} PostToolUse hook")
        print(f"\nHook script: {script_path}")
        print(f"Settings path: {settings_path}")
        if is_wsl:
            print("(Writing to WSL home directory from Windows)")
        print("\nSettings that would be written:")
        print(json.dumps(settings.data, indent=2))
        return

    try:
        result = setup_cade_hooks(options, dry_run=False)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in settings: {e}", file=sys.stderr)
        sys.exit(1)

    if not result.success:
        print(f"Error: {result.message}", file=sys.stderr)
        sys.exit(1)

    print(result.message)

    if result.script_path:
        print(f"Hook script installed: {result.script_path}")

    if result.backup_created:
        backup_path = result.settings_path.parent / "settings.json.backup"
        print(f"Backed up existing settings to {backup_path}")

    file_filter = "all file edits" if options.all_files else "plan files (plans/*.md)"
    print(f"Hook configured to POST {file_filter} to CADE server")
    print(f"Settings: {result.settings_path}")

    if result.is_wsl:
        print("(Written to WSL home directory from Windows)")


def main() -> None:
    """Main entry point."""
    args = parse_args()

    if args.command == "view":
        run_view(args)
    elif args.command == "setup-hook":
        run_setup_hook(args)
    else:
        # Default to serve (either explicit "serve" or no command)
        run_serve(args)


if __name__ == "__main__":
    main()
