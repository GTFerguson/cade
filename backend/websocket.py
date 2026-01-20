"""WebSocket connection handling and message routing."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import WebSocket, WebSocketDisconnect

from backend.config import load_user_config
from backend.connection_manager import get_connection_manager
from backend.connection_registry import get_connection_registry
from backend.errors import CADEError, ProtocolError
from backend.file_tree import build_file_tree, get_file_type, read_file_content
from backend.file_watcher import FileWatcher
from backend.protocol import ErrorCode, MessageType, SessionKey
from backend.session import load_session, save_session
from backend.session_registry import PTYSession, TerminalState, get_registry
from backend.types import FileChangeEvent, TerminalSize

if TYPE_CHECKING:
    from backend.config import Config

logger = logging.getLogger(__name__)


class ConnectionHandler:
    """Handles a single WebSocket connection."""

    def __init__(
        self,
        websocket: WebSocket,
        config: "Config",
    ) -> None:
        self._ws = websocket
        self._config = config
        self._working_dir: Path = config.working_dir
        self._session: PTYSession | None = None
        self._session_id: str | None = None
        self._watcher: FileWatcher | None = None
        self._closed = False
        self._suppress_output = False
        self._suppress_start_time: float | None = None
        self._project_set = asyncio.Event()
        self._is_new_session = True
        self._output_tasks: dict[str, asyncio.Task] = {}
        self._terminal_sizes: dict[str, TerminalSize] = {}
        self._user_config = None

    async def _send_status(self, message: str) -> None:
        """Send a startup status message."""
        await self._send({
            "type": MessageType.STARTUP_STATUS,
            "message": message,
        })

    async def handle(self) -> None:
        """Main connection handler loop."""
        await self._ws.accept()
        get_connection_manager().register(self._ws)

        try:
            await self._wait_for_project()
            # Register with connection registry for project-aware routing
            get_connection_registry().register(
                self._ws,
                self._working_dir,
                session_id=self._session_id,
            )
            await self._send_status("Starting terminal...")
            await self._setup()
            await self._send_status("Connected")
            await self._send_connected()

            # Start output loop for claude terminal
            self._start_output_loop(SessionKey.CLAUDE)
            watch_task = asyncio.create_task(self._watch_loop())

            # Receive loop controls connection lifetime
            # PTY output and watch loops run as long-lived background tasks
            try:
                await self._receive_loop()
            finally:
                # Cancel background tasks when receive ends
                for task in self._output_tasks.values():
                    task.cancel()
                watch_task.cancel()
                await asyncio.gather(
                    *self._output_tasks.values(), watch_task, return_exceptions=True
                )

        except WebSocketDisconnect:
            logger.debug("WebSocket disconnected")
        except Exception as e:
            logger.exception("Connection handler error: %s", e)
        finally:
            await self._cleanup()

    async def _wait_for_project(self) -> None:
        """Wait for SET_PROJECT message or timeout to default.

        Waits up to 2 seconds for the client to send a SET_PROJECT message.
        If no message is received, falls back to the configured working directory.
        """
        async def wait_for_set_project():
            while not self._project_set.is_set():
                try:
                    data = await asyncio.wait_for(self._ws.receive_json(), timeout=0.1)
                    if data.get("type") == MessageType.SET_PROJECT:
                        path = data.get("path")
                        if path:
                            project_path = Path(path).resolve()
                            if project_path.is_dir():
                                self._working_dir = project_path
                                logger.info("Project set to: %s", self._working_dir)
                            else:
                                logger.warning("Invalid project path: %s", path)
                        self._session_id = data.get("sessionId")
                        if self._session_id:
                            logger.debug("Session ID: %s", self._session_id)
                        self._project_set.set()
                        return
                except asyncio.TimeoutError:
                    continue
                except WebSocketDisconnect:
                    self._project_set.set()
                    raise

        try:
            await asyncio.wait_for(wait_for_set_project(), timeout=2.0)
        except asyncio.TimeoutError:
            logger.debug("No SET_PROJECT received, using default working directory")
            self._project_set.set()

    async def _setup(self) -> None:
        """Initialize PTY session and file watcher."""
        registry = get_registry()

        if self._session_id:
            self._session, self._is_new_session = await registry.get_or_create(
                self._session_id,
                self._working_dir,
                self._config.shell_command,
                TerminalSize(cols=80, rows=24),
                auto_start_claude=self._config.auto_start_claude,
                dummy_mode=self._config.dummy_mode,
            )
            self._session.connected_clients.add(self._ws)
        else:
            from backend.pty_manager import PTYManager
            pty = PTYManager()
            await pty.spawn(
                self._config.shell_command,
                self._working_dir,
                TerminalSize(cols=80, rows=24),
            )
            self._session = PTYSession(
                id="",
                project_path=self._working_dir,
            )
            self._session.add_terminal(SessionKey.CLAUDE, pty)
            self._is_new_session = True

        if self._is_new_session:
            if self._config.auto_start_claude and not self._config.dummy_mode:
                self._suppress_output = True
                self._suppress_start_time = time.monotonic()

            if self._config.dummy_mode:
                await asyncio.sleep(0.5)
                dummy_output = (
                    "\x1b[H\x1b[2J"
                    "\x1b[38;5;75m ▐▛███▜▌\x1b[0m   Claude Code (dummy mode)\r\n"
                    "\x1b[38;5;75m▝▜█████▛▘\x1b[0m  Development UI Preview\r\n"
                    "\x1b[38;5;75m  ▘▘ ▝▝\x1b[0m\r\n"
                    "\r\n"
                    "─────────────────────────────────────────────────────────────────\r\n"
                    "\x1b[38;5;245m❯\x1b[0m Dummy mode - no actual Claude running\r\n"
                    "─────────────────────────────────────────────────────────────────\r\n"
                )
                await self._send({
                    "type": MessageType.OUTPUT,
                    "data": dummy_output,
                })
                self._session.capture_output(dummy_output)

        self._watcher = FileWatcher(self._working_dir)

    async def _cleanup(self) -> None:
        """Clean up resources."""
        self._closed = True
        get_connection_manager().unregister(self._ws)
        get_connection_registry().unregister(self._ws)

        if self._watcher is not None:
            self._watcher.stop()
            self._watcher = None

        if self._session is not None:
            self._session.connected_clients.discard(self._ws)
            if self._session_id:
                registry = get_registry()
                await registry.detach(self._session_id, self._ws)
            else:
                await self._session.pty.close()
            self._session = None

    async def _send(self, message: dict) -> None:
        """Send a message to the client."""
        if not self._closed:
            try:
                await self._ws.send_json(message)
            except Exception:
                pass

    async def _send_error(self, code: str, message: str) -> None:
        """Send an error message to the client."""
        await self._send({
            "type": MessageType.ERROR,
            "code": code,
            "message": message,
        })

    async def _create_manual_terminal(self) -> None:
        """Create the manual terminal for this session."""
        if self._session is None or self._session_id is None:
            return

        size = self._terminal_sizes.get(SessionKey.MANUAL, TerminalSize(cols=80, rows=24))
        registry = get_registry()
        await registry.create_manual_terminal(
            self._session_id,
            self._config.shell_command,
            size,
        )

        # Start output loop for the new terminal
        self._start_output_loop(SessionKey.MANUAL)
        logger.info("Created manual terminal for session: %s", self._session_id)

    async def _send_connected(self) -> None:
        """Send connected message with working directory, session state, and user config."""
        session_restored = not self._is_new_session
        idle_seconds = 0

        if session_restored and self._session is not None:
            # Calculate idle time before updating last_activity
            idle_seconds = int(time.time() - self._session.last_activity)

            # Send scrollback for claude terminal
            scrollback = self._session.get_scrollback(SessionKey.CLAUDE)
            if scrollback:
                await self._send({
                    "type": MessageType.SESSION_RESTORED,
                    "sessionId": self._session_id,
                    "scrollback": scrollback,
                    "sessionKey": SessionKey.CLAUDE,
                })

            # Send scrollback for manual terminal if it exists
            if self._session.has_terminal(SessionKey.MANUAL):
                # Start output loop for existing manual terminal
                self._start_output_loop(SessionKey.MANUAL)
                manual_scrollback = self._session.get_scrollback(SessionKey.MANUAL)
                if manual_scrollback:
                    await self._send({
                        "type": MessageType.SESSION_RESTORED,
                        "sessionId": self._session_id,
                        "scrollback": manual_scrollback,
                        "sessionKey": SessionKey.MANUAL,
                    })

        # Load user config for this working directory
        self._user_config = load_user_config(self._working_dir)

        # Perform WSL health check for restored sessions
        wsl_healthy = True
        if session_restored and not self._config.dummy_mode:
            health_check_timeout = self._user_config.behavior.splash.health_check_timeout
            from backend.wsl_health import check_wsl_health
            wsl_healthy, _ = check_wsl_health(timeout=float(health_check_timeout))

        message: dict = {
            "type": MessageType.CONNECTED,
            "workingDir": str(self._working_dir),
            "config": self._user_config.to_dict(),
            "sessionRestored": session_restored,
            "idleSeconds": idle_seconds,
            "wslHealthy": wsl_healthy,
        }

        session = load_session(self._working_dir)
        if session is not None:
            message["session"] = session

        await self._send(message)

    async def _receive_loop(self) -> None:
        """Receive and handle messages from the client."""
        while not self._closed:
            try:
                data = await self._ws.receive_json()
                await self._handle_message(data)
            except WebSocketDisconnect:
                break
            except RuntimeError as e:
                # WebSocket closed unexpectedly
                if "not connected" in str(e).lower():
                    break
                logger.exception("Runtime error in receive loop: %s", e)
                break
            except json.JSONDecodeError:
                await self._send_error(ErrorCode.INVALID_MESSAGE, "Invalid JSON")
            except Exception as e:
                logger.exception("Error handling message: %s", e)

    async def _handle_message(self, data: dict) -> None:
        """Route incoming message to appropriate handler."""
        msg_type = data.get("type")

        try:
            if msg_type == MessageType.INPUT:
                await self._handle_input(data)
            elif msg_type == MessageType.RESIZE:
                await self._handle_resize(data)
            elif msg_type == MessageType.GET_TREE:
                await self._handle_get_tree()
            elif msg_type == MessageType.GET_FILE:
                await self._handle_get_file(data)
            elif msg_type == MessageType.SAVE_SESSION:
                await self._handle_save_session(data)
            elif msg_type == MessageType.GET_LATEST_PLAN:
                await self._handle_get_latest_plan()
            else:
                raise ProtocolError.invalid_message(f"Unknown message type: {msg_type}")

        except CADEError as e:
            await self._send(e.to_message())
        except Exception as e:
            logger.exception("Error handling message type %s: %s", msg_type, e)
            await self._send_error(ErrorCode.INTERNAL_ERROR, str(e))

    async def _handle_input(self, data: dict) -> None:
        """Handle terminal input."""
        if self._session is None:
            return

        session_key = data.get("sessionKey", SessionKey.CLAUDE)
        input_data = data.get("data", "")

        if not input_data:
            return

        # Lazily create manual terminal on first input
        if session_key == SessionKey.MANUAL and not self._session.has_terminal(SessionKey.MANUAL):
            await self._create_manual_terminal()

        terminal = self._session.get_terminal(session_key)
        if terminal:
            await terminal.pty.write(input_data)

    async def _handle_resize(self, data: dict) -> None:
        """Handle terminal resize."""
        if self._session is None:
            return

        session_key = data.get("sessionKey", SessionKey.CLAUDE)
        cols = data.get("cols", 80)
        rows = data.get("rows", 24)

        # Store size for lazy terminal creation
        self._terminal_sizes[session_key] = TerminalSize(cols=cols, rows=rows)

        # Lazily create manual terminal on first resize
        if session_key == SessionKey.MANUAL and not self._session.has_terminal(SessionKey.MANUAL):
            await self._create_manual_terminal()

        terminal = self._session.get_terminal(session_key)
        if terminal:
            await terminal.pty.resize(cols, rows)

    async def _handle_get_tree(self) -> None:
        """Handle file tree request."""
        show_ignored = self._user_config.behavior.file_tree.show_ignored if self._user_config else True
        tree = build_file_tree(self._working_dir, respect_gitignore=not show_ignored)
        await self._send({
            "type": MessageType.FILE_TREE,
            "data": [node.to_dict() for node in tree],
        })

    async def _handle_get_file(self, data: dict) -> None:
        """Handle file content request."""
        path = data.get("path", "")
        if not path:
            raise ProtocolError.invalid_message("Missing path")

        content = read_file_content(self._working_dir, path)
        file_type = get_file_type(path)

        await self._send({
            "type": MessageType.FILE_CONTENT,
            "path": path,
            "content": content,
            "fileType": file_type,
        })

    async def _handle_save_session(self, data: dict) -> None:
        """Handle session save request."""
        state = data.get("state", {})
        save_session(self._working_dir, state)

    async def _handle_get_latest_plan(self) -> None:
        """Handle request for most recent plan file.

        Finds the most recently modified .md file in ~/.claude/plans/
        and sends it to the client for viewing.
        """
        import asyncio
        import sys
        from backend.wsl_path import get_wsl_home_as_windows_path

        # On Windows, look in WSL home directory
        if sys.platform == "win32":
            # Run subprocess in thread to avoid blocking event loop
            wsl_home = await asyncio.to_thread(get_wsl_home_as_windows_path)
            if wsl_home:
                plans_dir = Path(wsl_home) / ".claude" / "plans"
            else:
                plans_dir = Path.home() / ".claude" / "plans"
        else:
            plans_dir = Path.home() / ".claude" / "plans"

        if not plans_dir.exists():
            logger.debug("Plans directory does not exist: %s", plans_dir)
            return

        md_files = list(plans_dir.glob("*.md"))
        if not md_files:
            logger.debug("No plan files found in: %s", plans_dir)
            return

        # Find most recently modified file
        latest = max(md_files, key=lambda f: f.stat().st_mtime)
        logger.info("Viewing latest plan file: %s", latest)

        try:
            content = latest.read_text(encoding="utf-8")
        except Exception as e:
            logger.exception("Failed to read plan file: %s", e)
            return

        file_type = get_file_type(str(latest))

        await self._send({
            "type": MessageType.VIEW_FILE,
            "path": str(latest),
            "content": content,
            "fileType": file_type,
        })

    def _start_output_loop(self, session_key: str) -> None:
        """Start the output loop for a terminal."""
        if session_key in self._output_tasks:
            return

        task = asyncio.create_task(self._pty_output_loop(session_key))
        self._output_tasks[session_key] = task

    async def _pty_output_loop(self, session_key: str) -> None:
        """Read and send PTY output to client."""
        if self._session is None:
            return

        terminal = self._session.get_terminal(session_key)
        if terminal is None:
            return

        try:
            async for data in terminal.pty.read():
                if self._closed:
                    break

                self._session.capture_output(data, session_key)

                # Only apply startup suppression to claude terminal
                if session_key == SessionKey.CLAUDE and self._suppress_output:
                    # Detect Claude startup via:
                    # - Alternate screen buffer: \x1b[?1049h or \x1b[?47h
                    # - Clear screen: \x1b[2J (often with \x1b[H cursor home)
                    # - Claude logo start (the block characters)
                    if (
                        "\x1b[?1049h" in data
                        or "\x1b[?47h" in data
                        or "\x1b[2J" in data
                        or "▐▛███▜▌" in data
                    ):
                        self._suppress_output = False
                        # Fall through to send this chunk (contains Claude's TUI)
                    # Timeout fallback after 4 seconds
                    elif self._suppress_start_time and time.monotonic() - self._suppress_start_time > 4.0:
                        self._suppress_output = False
                        # Fall through to send this chunk
                    else:
                        continue  # Keep suppressing

                await self._send({
                    "type": MessageType.OUTPUT,
                    "data": data,
                    "sessionKey": session_key,
                })
        except Exception as e:
            if not self._closed:
                logger.exception("PTY output error for %s: %s", session_key, e)

    async def _watch_loop(self) -> None:
        """Watch for file changes and notify client."""
        if self._watcher is None:
            return

        try:
            async for event in self._watcher.watch():
                if self._closed:
                    break
                await self._send({
                    "type": MessageType.FILE_CHANGE,
                    "event": event.event,
                    "path": event.path,
                })
        except asyncio.CancelledError:
            pass
        except Exception as e:
            if not self._closed:
                logger.exception("Watch error: %s", e)


async def websocket_handler(websocket: WebSocket, config: "Config") -> None:
    """Handle a WebSocket connection."""
    handler = ConnectionHandler(websocket, config)
    await handler.handle()
