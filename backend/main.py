"""Main entry point for ccplus backend."""

from __future__ import annotations

import argparse
import logging
import sys
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING

import uvicorn
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.config import Config, get_config, set_config
from backend.connection_manager import get_connection_manager
from backend.file_tree import get_file_type
from backend.protocol import MessageType
from backend.session_registry import get_registry
from backend.websocket import websocket_handler
from backend.wsl_health import ensure_wsl_ready
from backend.wsl_path import wsl_to_windows_path
from backend.wsl_session_unifier import unify_sessions

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)

# Paths
BACKEND_DIR = Path(__file__).parent
PROJECT_ROOT = BACKEND_DIR.parent
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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler."""
    config = get_config()

    try:
        unify_sessions(config.working_dir)
    except Exception as e:
        logger.debug("Session unification skipped: %s", e)

    registry = get_registry()
    await registry.start()

    # Start WSL health check in background (non-blocking)
    import asyncio
    wsl_task = asyncio.create_task(_check_wsl_health_async())

    if config.auto_open_browser:
        webbrowser.open(config.server_url)

    logger.info("CADE started at %s", config.server_url)
    logger.info("Working directory: %s", config.working_dir)

    yield

    logger.info("CADE shutting down")
    wsl_task.cancel()
    try:
        await wsl_task
    except asyncio.CancelledError:
        pass
    await registry.stop()


class ViewFileRequest(BaseModel):
    """Request body for /api/view endpoint."""

    path: str


def create_app(config: Config | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if config is not None:
        set_config(config)

    app = FastAPI(
        title="CADE",
        description="Unified terminal environment",
        version="0.1.0",
        lifespan=lifespan,
    )

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

        manager = get_connection_manager()
        await manager.broadcast({
            "type": MessageType.VIEW_FILE,
            "path": str(file_path),
            "content": content,
            "fileType": file_type,
        })

        return {
            "success": True,
            "path": str(file_path),
            "connections": manager.connection_count,
        }

    if FRONTEND_DIST.exists():
        @app.get("/")
        async def serve_index() -> FileResponse:
            """Serve the frontend index.html."""
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
        help="Server port (default: 3000, or CCPLUS_PORT env var)",
    )
    serve_parser.add_argument(
        "-H", "--host",
        type=str,
        default=None,
        help="Server host (default: localhost, or CCPLUS_HOST env var)",
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
        help="Server port (default: 3000, or CCPLUS_PORT env var)",
    )
    view_parser.add_argument(
        "-H", "--host",
        type=str,
        default=None,
        help="Server host (default: localhost, or CCPLUS_HOST env var)",
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
        help="ccplus server port for the hook",
    )
    setup_hook_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without modifying settings",
    )

    return parser.parse_args()


def setup_logging(debug: bool = False) -> None:
    """Configure logging."""
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[logging.StreamHandler()],
    )

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


def _get_wsl_settings_path() -> tuple[Path, bool]:
    """Get the Claude Code settings path, handling Windows/WSL correctly.

    Returns:
        Tuple of (settings_path, is_wsl_via_windows).
        is_wsl_via_windows is True if running on Windows and need to write to WSL.
    """
    import subprocess

    if sys.platform != "win32":
        # Running in WSL or native Linux - use standard path
        return Path.home() / ".claude" / "settings.json", False

    # Running on Windows - need to write to WSL home
    try:
        # Get default WSL distro
        result = subprocess.run(
            ["wsl", "-l", "-q"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            print("Warning: Could not detect WSL distro, using Windows path")
            return Path.home() / ".claude" / "settings.json", False

        # Parse output - first non-empty line is the default distro
        lines = [line.strip().replace("\x00", "") for line in result.stdout.split("\n")]
        distro = next((line for line in lines if line), None)
        if not distro:
            print("Warning: No WSL distro found, using Windows path")
            return Path.home() / ".claude" / "settings.json", False

        # Get WSL username
        result = subprocess.run(
            ["wsl", "-d", distro, "whoami"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            print("Warning: Could not get WSL username, using Windows path")
            return Path.home() / ".claude" / "settings.json", False

        wsl_user = result.stdout.strip()

        # Construct UNC path
        wsl_path = Path(f"\\\\wsl$\\{distro}\\home\\{wsl_user}\\.claude\\settings.json")
        return wsl_path, True

    except subprocess.TimeoutExpired:
        print("Warning: WSL command timed out, using Windows path")
        return Path.home() / ".claude" / "settings.json", False
    except FileNotFoundError:
        print("Warning: WSL not available, using Windows path")
        return Path.home() / ".claude" / "settings.json", False


def run_setup_hook(args: argparse.Namespace) -> None:
    """Configure Claude Code hook for plan file viewing."""
    import json
    import shutil

    settings_path, is_wsl = _get_wsl_settings_path()
    backup_path = settings_path.parent / "settings.json.backup"

    port = args.port
    all_files = args.all_files
    dry_run = args.dry_run

    # Hook command reads JSON from stdin (Claude Code passes tool input via stdin)
    # Use Python since it's always available
    # Use Windows host IP from default gateway for WSL->Windows connectivity
    get_host_ip = "$(ip route show default | awk '{print $3}')"

    if all_files:
        # View all file edits
        hook_command = (
            f"python3 -c \"import sys,json; print(json.load(sys.stdin)['tool_input']['file_path'])\" "
            f"| xargs -I {{}} curl -s -X POST -H 'Content-Type: application/json' "
            f"-d '{{\"path\":\"{{}}\"}}' http://{get_host_ip}:{port}/api/view > /dev/null"
        )
    else:
        # Only trigger for files in plans/ with .md extension
        hook_command = (
            f"python3 -c \"import sys,json; p=json.load(sys.stdin)['tool_input']['file_path']; "
            f"print(p) if 'plans/' in p and p.endswith('.md') else None\" 2>/dev/null "
            f"| xargs -r -I {{}} curl -s -X POST -H 'Content-Type: application/json' "
            f"-d '{{\"path\":\"{{}}\"}}' http://{get_host_ip}:{port}/api/view > /dev/null"
        )

    new_hook = {
        "matcher": "Edit|Write",
        "hooks": [
            {
                "type": "command",
                "command": hook_command,
            }
        ],
    }

    # Load existing settings or create empty
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON in {settings_path}: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        settings = {}

    # Ensure hooks structure exists
    if "hooks" not in settings:
        settings["hooks"] = {}
    if "PostToolUse" not in settings["hooks"]:
        settings["hooks"]["PostToolUse"] = []

    # Check if a similar hook already exists and update/add as needed
    existing_hooks = settings["hooks"]["PostToolUse"]
    hook_exists = False
    for i, hook in enumerate(existing_hooks):
        if hook.get("matcher") == "Edit|Write":
            # Check if this is our hook (contains api/view)
            hook_cmds = hook.get("hooks", [])
            for cmd in hook_cmds:
                if "api/view" in cmd.get("command", ""):
                    hook_exists = True
                    existing_hooks[i] = new_hook
                    if dry_run:
                        print(f"Would update existing hook at index {i}")
                    else:
                        print("Updated existing plan viewer hook")
                    break
            if hook_exists:
                break

    if not hook_exists:
        existing_hooks.append(new_hook)
        if dry_run:
            print("Would add new PostToolUse hook")

    if dry_run:
        print(f"\nSettings path: {settings_path}")
        if is_wsl:
            print("(Writing to WSL home directory from Windows)")
        print("\nSettings that would be written:")
        print(json.dumps(settings, indent=2))
        return

    # Backup existing settings
    if settings_path.exists():
        shutil.copy2(settings_path, backup_path)
        print(f"Backed up existing settings to {backup_path}")

    # Ensure .claude directory exists
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    # Write updated settings
    settings_path.write_text(json.dumps(settings, indent=2) + "\n")

    if not hook_exists:
        print("Added PostToolUse hook for plan file viewing")

    file_filter = "all file edits" if all_files else "plan files (plans/*.md)"
    print(f"Hook configured to POST {file_filter} to http://localhost:{port}/api/view")
    if is_wsl:
        print(f"Settings written to WSL path: {settings_path}")


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
