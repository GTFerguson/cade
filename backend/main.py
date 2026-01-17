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

from backend.config import Config, get_config, set_config
from backend.websocket import websocket_handler

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)

# Paths
BACKEND_DIR = Path(__file__).parent
PROJECT_ROOT = BACKEND_DIR.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler."""
    config = get_config()

    if config.auto_open_browser:
        webbrowser.open(config.server_url)

    logger.info("ccplus started at %s", config.server_url)
    logger.info("Working directory: %s", config.working_dir)

    yield

    logger.info("ccplus shutting down")


def create_app(config: Config | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if config is not None:
        set_config(config)

    app = FastAPI(
        title="ccplus",
        description="Unified terminal environment",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        """WebSocket endpoint for terminal and file operations."""
        await websocket_handler(websocket, get_config())

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
        description="ccplus - Unified terminal environment",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument(
        "-p", "--port",
        type=int,
        default=None,
        help="Server port (default: 3000, or CCPLUS_PORT env var)",
    )

    parser.add_argument(
        "-H", "--host",
        type=str,
        default=None,
        help="Server host (default: localhost, or CCPLUS_HOST env var)",
    )

    parser.add_argument(
        "-d", "--dir",
        type=str,
        default=None,
        dest="working_dir",
        help="Working directory (default: current directory)",
    )

    parser.add_argument(
        "-c", "--command",
        type=str,
        default=None,
        dest="shell_command",
        help="Shell command to run (default: claude)",
    )

    parser.add_argument(
        "--no-claude",
        action="store_true",
        help="Don't auto-start claude in shell",
    )

    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't open browser automatically",
    )

    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug mode",
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


def main() -> None:
    """Main entry point."""
    args = parse_args()

    config = Config.from_env()
    config = config.update_from_args(
        port=args.port,
        host=args.host,
        working_dir=args.working_dir,
        shell_command=args.shell_command,
        auto_start_claude=not args.no_claude if args.no_claude else None,
        auto_open_browser=not args.no_browser if args.no_browser else None,
        debug=args.debug if args.debug else None,
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


if __name__ == "__main__":
    main()
