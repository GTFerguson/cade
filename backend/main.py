"""Main entry point for CADE backend."""

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
from backend.connection_registry import get_connection_registry
from backend.file_tree import get_file_type
from backend.protocol import MessageType
from backend.session_registry import get_registry
from backend.websocket import websocket_handler
from backend.cc_session_resolver import resolve_slug_to_project
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
        if "/.claude/plans/" in str(file_path):
            slug = file_path.stem  # e.g., "jazzy-crunching-moonbeam"
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

        hook_config = build_hook_config(options)
        hook_updated = settings.add_hook(HookType.POST_TOOL_USE, hook_config)

        action = "Would update existing" if hook_updated else "Would add new"
        print(f"{action} PostToolUse hook")
        print(f"\nSettings path: {settings_path}")
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

    if result.backup_created:
        backup_path = result.settings_path.parent / "settings.json.backup"
        print(f"Backed up existing settings to {backup_path}")

    file_filter = "all file edits" if options.all_files else "plan files (plans/*.md)"
    print(f"Hook configured to POST {file_filter} to http://localhost:{options.port}/api/view")

    if result.is_wsl:
        print(f"Settings written to WSL path: {result.settings_path}")


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
