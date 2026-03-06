"""WebSocket connection handling and message routing."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import WebSocket, WebSocketDisconnect

from backend.auth import extract_token_from_query, validate_token
from backend.chat.session import ChatSession, get_chat_registry
from backend.config import load_user_config
from backend.terminal.connections import get_connection_manager
from backend.connection_registry import get_connection_registry
from backend.errors import CADEError, ProtocolError
from backend.files.operations import create_file, write_file_content
from backend.files.tree import build_directory_children, build_file_tree_cached, get_file_type, read_file_content
from backend.files.watcher import FileWatcher
from backend.neovim.manager import get_neovim_manager
from backend.protocol import ErrorCode, MessageType, SessionKey
from backend.providers.config import get_providers_config
from backend.providers.registry import ProviderRegistry
from backend.providers.claude_code_provider import ClaudeCodeProvider
from backend.providers.types import ChatDone, ChatError, SystemInfo, TextDelta, ThinkingDelta, ToolResult, ToolUseStart
from backend.session import load_session, save_session
from backend.terminal.pty import PTYManager
from backend.terminal.sessions import PTYSession, TerminalState, get_registry
from backend.models import FileChangeEvent, TerminalSize

if TYPE_CHECKING:
    from backend.config import Config
    from backend.doc_index import DocIndexService

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
        self._suppress_buffer: list[str] = []
        self._suppress_timeout_task: asyncio.Task | None = None
        self._project_set = asyncio.Event()
        self._is_new_session = True
        self._output_tasks: dict[str, asyncio.Task] = {}
        self._terminal_sizes: dict[str, TerminalSize] = {}
        self._user_config = None
        self._doc_index: "DocIndexService | None" = None
        self._chat_session: ChatSession | None = None
        self._chat_task: asyncio.Task | None = None
        self._provider_registry: ProviderRegistry | None = None

    async def _send_status(self, message: str) -> None:
        """Send a startup status message."""
        await self._send({
            "type": MessageType.STARTUP_STATUS,
            "message": message,
        })

    async def handle(self) -> None:
        """Main connection handler loop."""
        # Validate auth token before accepting WebSocket connection
        query_string = self._ws.scope.get("query_string", b"").decode("utf-8")
        token = extract_token_from_query(query_string)

        if not validate_token(token, cfg=self._config):
            logger.warning("WebSocket connection rejected: invalid or missing auth token")
            # Accept first so the close frame (with code 1008) is actually
            # transmitted over the WebSocket — closing before accept causes
            # the HTTP upgrade to be rejected and the client only sees code 1006
            await self._ws.accept()
            await self._ws.close(code=1008, reason="Authentication failed")
            return

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

            try:
                await self._setup()
            except CADEError as e:
                logger.error("Terminal setup failed: %s", e)
                await self._send(e.to_message())
                return

            await self._send_status("Connected")
            await self._send_connected()

            # Start output loop for claude terminal
            self._start_output_loop(SessionKey.CLAUDE)
            watch_task = asyncio.create_task(self._watch_loop())

            # For WSL sessions, run the network check + Claude start as a
            # background task so the WebSocket stays responsive
            deferred_task: asyncio.Task | None = None
            if (
                self._is_new_session
                and self._config.auto_start_claude
                and not self._config.dummy_mode
                and "wsl" in self._config.shell_command.lower()
            ):
                deferred_task = asyncio.create_task(self._deferred_claude_start())

            # Build doc-index in background on project open
            doc_index_task: asyncio.Task | None = None
            if self._doc_index is not None:
                doc_index_task = asyncio.create_task(
                    self._doc_index.initial_build()
                )

            # Receive loop controls connection lifetime
            # PTY output and watch loops run as long-lived background tasks
            try:
                await self._receive_loop()
            finally:
                # Cancel background tasks when receive ends
                self._cancel_suppress_timeout()
                for task in self._output_tasks.values():
                    task.cancel()
                watch_task.cancel()
                if deferred_task is not None:
                    deferred_task.cancel()
                if doc_index_task is not None:
                    doc_index_task.cancel()
                await asyncio.gather(
                    *self._output_tasks.values(),
                    watch_task,
                    *([] if deferred_task is None else [deferred_task]),
                    *([] if doc_index_task is None else [doc_index_task]),
                    return_exceptions=True,
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
                            # expanduser() needs HOME in env; fall back to
                            # pwd-based Path.home() when it isn't set
                            if path.startswith("~"):
                                home = str(Path.home())
                                path = home + path[1:]
                            project_path = Path(path).resolve()
                            logger.debug(
                                "Path validation: input=%s, resolved=%s, exists=%s, is_dir=%s",
                                path,
                                project_path,
                                project_path.exists(),
                                project_path.is_dir(),
                            )
                            if project_path.is_dir():
                                self._working_dir = project_path
                                logger.info("Project set to: %s", self._working_dir)
                            else:
                                logger.warning(
                                    "Invalid project path: %s (resolved: %s)",
                                    path,
                                    project_path,
                                )
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
        """Initialize PTY session, file watcher, and provider registry."""
        # Load user config first so we can use network_timeout setting
        self._user_config = load_user_config(self._working_dir)

        # Initialize provider registry from config
        try:
            providers_config = get_providers_config()
            self._provider_registry = ProviderRegistry.from_config(providers_config)
        except Exception as e:
            logger.warning("Failed to initialize provider registry: %s", e)
            self._provider_registry = ProviderRegistry()

        registry = get_registry()

        if self._session_id:
            self._session, self._is_new_session = await registry.get_or_create(
                self._session_id,
                self._working_dir,
                self._config.shell_command,
                TerminalSize(cols=80, rows=24),
                auto_start_claude=self._config.auto_start_claude,
                dummy_mode=self._config.dummy_mode,
                network_timeout=self._user_config.behavior.session.network_timeout,
            )
            self._session.connected_clients.add(self._ws)
        else:
            from backend.terminal.pty import PTYManager
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
                self._suppress_timeout_task = asyncio.create_task(
                    self._suppress_timeout(4.0)
                )

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

        from backend.doc_index import DOC_INDEX_AVAILABLE, DocIndexService
        if DOC_INDEX_AVAILABLE:
            self._doc_index = DocIndexService(self._working_dir)
            self._watcher.on_change(self._doc_index.on_file_change)

    async def _cleanup(self) -> None:
        """Clean up resources."""
        self._closed = True
        get_connection_manager().unregister(self._ws)
        get_connection_registry().unregister(self._ws)

        # Cancel in-progress chat stream
        if self._chat_task is not None and not self._chat_task.done():
            self._chat_task.cancel()
            try:
                await self._chat_task
            except asyncio.CancelledError:
                pass
            self._chat_task = None

        # Clean up Neovim instance for this session
        if self._session_id is not None:
            manager = get_neovim_manager()
            await manager.kill(self._session_id)

        if self._doc_index is not None:
            self._doc_index.cancel()
            self._doc_index = None

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

    @staticmethod
    def _is_manual_session_key(session_key: str) -> bool:
        """Check if a session key represents a manual shell terminal."""
        return (
            session_key == SessionKey.MANUAL
            or session_key.endswith("-manual")
        )

    async def _create_manual_terminal(self, session_key: str = SessionKey.MANUAL) -> None:
        """Create a manual terminal for this session.

        Supports both the primary manual terminal ("manual") and
        per-agent manual terminals ("agent-tests-manual").
        """
        if self._session is None or self._session_id is None:
            return

        if self._session.has_terminal(session_key):
            return

        size = self._terminal_sizes.get(session_key, TerminalSize(cols=80, rows=24))

        # Create the PTY directly on the session
        pty = PTYManager()
        await pty.spawn(
            self._config.shell_command,
            self._session.project_path,
            size,
        )
        self._session.add_terminal(session_key, pty)

        # Start output loop for the new terminal
        self._start_output_loop(session_key)
        logger.info("Created manual terminal '%s' for session: %s", session_key, self._session_id)

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

            # Send scrollback for all non-claude terminals (manual + agent terminals)
            for session_key in self._session.terminals:
                if session_key == SessionKey.CLAUDE:
                    continue
                self._start_output_loop(session_key)
                terminal_scrollback = self._session.get_scrollback(session_key)
                if terminal_scrollback:
                    await self._send({
                        "type": MessageType.SESSION_RESTORED,
                        "sessionId": self._session_id,
                        "scrollback": terminal_scrollback,
                        "sessionKey": session_key,
                    })

        # Perform WSL health check for restored sessions
        wsl_healthy = True
        if session_restored and not self._config.dummy_mode:
            health_check_timeout = self._user_config.behavior.splash.health_check_timeout
            from backend.wsl.health import check_wsl_health
            wsl_healthy, _ = check_wsl_health(timeout=float(health_check_timeout))

        message: dict = {
            "type": MessageType.CONNECTED,
            "workingDir": str(self._working_dir),
            "config": self._user_config.to_dict(),
            "sessionRestored": session_restored,
            "idleSeconds": idle_seconds,
            "wslHealthy": wsl_healthy,
        }

        # Include provider information
        if self._provider_registry is not None:
            providers = self._provider_registry.list_providers()
            if providers:
                message["providers"] = providers
                default = self._provider_registry.get_default()
                if default:
                    message["defaultProvider"] = default.name
                    if isinstance(default, ClaudeCodeProvider):
                        message["chatMode"] = default.mode

        session = load_session(self._working_dir)
        if session is not None:
            message["session"] = session

        await self._send(message)

        # Replay chat history on reconnect
        if session_restored and self._session_id:
            chat_session = get_chat_registry().get(self._session_id)
            if chat_session is not None:
                history = chat_session.get_history_for_replay()
                if history:
                    self._chat_session = chat_session
                    await self._send({
                        "type": MessageType.CHAT_HISTORY,
                        "messages": history,
                    })

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
                await self._handle_get_tree(data)
            elif msg_type == MessageType.GET_FILE:
                await self._handle_get_file(data)
            elif msg_type == MessageType.WRITE_FILE:
                await self._handle_write_file(data)
            elif msg_type == MessageType.CREATE_FILE:
                await self._handle_create_file(data)
            elif msg_type == MessageType.SAVE_SESSION:
                await self._handle_save_session(data)
            elif msg_type == MessageType.GET_CHILDREN:
                await self._handle_get_children(data)
            elif msg_type == MessageType.BROWSE_CHILDREN:
                await self._handle_browse_children(data)
            elif msg_type == MessageType.GET_LATEST_PLAN:
                await self._handle_get_latest_plan()
            elif msg_type == MessageType.CHAT_MESSAGE:
                await self._handle_chat_message(data)
            elif msg_type == MessageType.CHAT_CANCEL:
                await self._handle_chat_cancel()
            elif msg_type == MessageType.PROVIDER_SWITCH:
                await self._handle_provider_switch(data)
            elif msg_type == MessageType.NEOVIM_SPAWN:
                await self._handle_neovim_spawn(data)
            elif msg_type == MessageType.NEOVIM_KILL:
                await self._handle_neovim_kill()
            elif msg_type == MessageType.NEOVIM_INPUT:
                await self._handle_neovim_input(data)
            elif msg_type == MessageType.NEOVIM_RESIZE:
                await self._handle_neovim_resize(data)
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

        # Lazily create manual terminals on first input
        if self._is_manual_session_key(session_key) and not self._session.has_terminal(session_key):
            await self._create_manual_terminal(session_key)

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

        # Lazily create manual terminals on first resize
        if self._is_manual_session_key(session_key) and not self._session.has_terminal(session_key):
            await self._create_manual_terminal(session_key)

        terminal = self._session.get_terminal(session_key)
        if terminal:
            await terminal.pty.resize(cols, rows)

    async def _handle_get_tree(self, data: dict | None = None) -> None:
        """Handle file tree request."""
        # Use client override if provided, otherwise use config
        if data and "showIgnored" in data:
            show_ignored = data["showIgnored"]
        else:
            show_ignored = self._user_config.behavior.file_tree.show_ignored if self._user_config else True

        # Run in thread pool to avoid blocking the async event loop —
        # scanning large directories (e.g. /home/user with datasets)
        # can take minutes synchronously
        tree = await asyncio.to_thread(
            build_file_tree_cached, self._working_dir, max_depth=2, respect_gitignore=not show_ignored
        )
        await self._send({
            "type": MessageType.FILE_TREE,
            "data": [node.to_dict() for node in tree],
        })

    async def _handle_get_children(self, data: dict) -> None:
        """Handle lazy-load request for directory children."""
        path = data.get("path", "")
        if data and "showIgnored" in data:
            show_ignored = data["showIgnored"]
        else:
            show_ignored = self._user_config.behavior.file_tree.show_ignored if self._user_config else True

        children = await asyncio.to_thread(
            build_directory_children,
            self._working_dir,
            path,
            max_depth=2,
            respect_gitignore=not show_ignored,
        )
        await self._send({
            "type": MessageType.FILE_CHILDREN,
            "path": path,
            "children": [n.to_dict() for n in children],
        })

    async def _handle_browse_children(self, data: dict) -> None:
        """Handle filesystem browse request for project directory selection.

        Unlike get-children, this resolves absolute paths and expands ~,
        allowing navigation anywhere on the filesystem. Used by the
        remote project selector's browse screen.
        """
        raw_path = data.get("path", "~")
        target = Path(raw_path).expanduser().resolve()

        if not target.is_dir():
            await self._send({
                "type": MessageType.BROWSE_CHILDREN,
                "path": raw_path,
                "children": [],
            })
            return

        entries = []
        try:
            for child in sorted(target.iterdir(), key=lambda p: p.name.lower()):
                if child.name.startswith("."):
                    continue
                entries.append({
                    "name": child.name,
                    "path": str(child),
                    "type": "directory" if child.is_dir() else "file",
                })
        except PermissionError:
            pass

        await self._send({
            "type": MessageType.BROWSE_CHILDREN,
            "path": str(target),
            "children": entries,
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

    async def _handle_write_file(self, data: dict) -> None:
        """Handle file write request."""
        path = data.get("path", "")
        content = data.get("content")

        if not path:
            raise ProtocolError.invalid_message("Missing path")

        if content is None:
            raise ProtocolError.invalid_message("Missing content")

        write_file_content(self._working_dir, path, content)

        await self._send({
            "type": MessageType.FILE_WRITTEN,
            "path": path,
        })

    async def _handle_create_file(self, data: dict) -> None:
        """Handle file creation request."""
        path = data.get("path", "")
        content = data.get("content", "")

        if not path:
            raise ProtocolError.invalid_message("Missing path")

        create_file(self._working_dir, path, content)

        await self._send({
            "type": MessageType.FILE_CREATED,
            "path": path,
        })

    async def _handle_save_session(self, data: dict) -> None:
        """Handle session save request."""
        state = data.get("state", {})
        save_session(self._working_dir, state)

    async def _handle_get_latest_plan(self) -> None:
        """Handle request for plan file associated with current project.

        Finds the Claude Code session for this project and opens its specific
        plan file. Returns nothing if no plan is found for the current project.
        """
        import asyncio
        import sys
        from backend.wsl.paths import get_wsl_home_as_windows_path
        from backend.cc_session_resolver import resolve_project_to_slug

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

        # Try to find the plan file for this specific project's CC session
        plan_file = None
        slug = await asyncio.to_thread(resolve_project_to_slug, self._working_dir)
        logger.debug(
            "Plan lookup: working_dir=%s, resolved_slug=%s",
            self._working_dir,
            slug,
        )
        if slug:
            session_plan = plans_dir / f"{slug}.md"
            if session_plan.exists():
                plan_file = session_plan
                logger.info("Found session-specific plan file: %s", plan_file)
                # Associate this CC session slug with this connection for targeted routing
                get_connection_registry().set_cc_session_slug(self._ws, slug)

        # No fallback - only show the plan for this specific project
        if plan_file is None:
            logger.info("No plan found for project: %s (slug=%s)", self._working_dir, slug)
            return

        try:
            content = plan_file.read_text(encoding="utf-8")
        except Exception as e:
            logger.exception("Failed to read plan file: %s", e)
            return

        file_type = get_file_type(str(plan_file))

        await self._send({
            "type": MessageType.VIEW_FILE,
            "path": str(plan_file),
            "content": content,
            "fileType": file_type,
            "isPlan": True,
        })

    # --- Chat handlers ---

    async def _handle_chat_cancel(self) -> None:
        """Cancel the in-progress chat stream."""
        if self._chat_task is not None and not self._chat_task.done():
            self._chat_task.cancel()
            try:
                await self._chat_task
            except asyncio.CancelledError:
                pass
            self._chat_task = None
            await self._send({
                "type": MessageType.CHAT_STREAM,
                "event": "done",
                "cancelled": True,
            })

    CADE_MODE_COMMANDS = {
        "/plan": "architect",
        "/architect": "architect",
        "/code": "code",
        "/review": "review",
    }

    async def _handle_mode_switch(self, mode: str) -> None:
        """Switch the active Claude Code provider's mode and notify the client."""
        provider = None
        if self._provider_registry is not None:
            provider = self._provider_registry.get_default()

        if isinstance(provider, ClaudeCodeProvider):
            provider.set_mode(mode)

        await self._send({
            "type": MessageType.CHAT_MODE_CHANGE,
            "mode": mode,
        })

    async def _handle_chat_message(self, data: dict) -> None:
        """Handle a chat message from the client."""
        content = data.get("content", "").strip()
        if not content:
            return

        # Intercept CADE-native mode commands before forwarding to provider
        if content in self.CADE_MODE_COMMANDS:
            await self._handle_mode_switch(self.CADE_MODE_COMMANDS[content])
            return

        provider_id = data.get("providerId")

        # Get or create chat session
        session_key = self._session_id or id(self)
        chat_registry = get_chat_registry()
        if self._chat_session is None:
            self._chat_session = chat_registry.get_or_create(
                str(session_key),
                provider_name=provider_id or "",
            )

        # Cancel any in-progress stream
        if self._chat_task is not None and not self._chat_task.done():
            self._chat_task.cancel()
            try:
                await self._chat_task
            except asyncio.CancelledError:
                pass

        # Resolve provider
        provider = None
        if self._provider_registry is not None:
            if provider_id:
                provider = self._provider_registry.get(provider_id)
            if provider is None:
                provider = self._provider_registry.get_default()

        if provider is None:
            await self._send({
                "type": MessageType.CHAT_STREAM,
                "event": "error",
                "message": "No provider configured. Add providers to ~/.cade/providers.toml",
            })
            return

        self._chat_session.add_user_message(content)

        # Launch streaming task
        self._chat_task = asyncio.create_task(
            self._stream_chat_response(provider)
        )

    async def _stream_chat_response(self, provider) -> None:
        """Stream a chat response from the provider to the client."""
        if self._chat_session is None:
            return

        # Set working directory for providers that need it (e.g. ClaudeCodeProvider)
        if isinstance(provider, ClaudeCodeProvider):
            provider.set_working_dir(self._working_dir)

        self._chat_session.start_response()

        try:
            messages = self._chat_session.get_messages()
            async for event in provider.stream_chat(messages):
                if self._closed:
                    break

                if isinstance(event, SystemInfo):
                    await self._send({
                        "type": MessageType.CHAT_STREAM,
                        "event": "system-info",
                        "model": event.model,
                        "sessionId": event.session_id,
                        "tools": event.tools,
                        "slashCommands": event.slash_commands,
                        "version": event.version,
                    })
                elif isinstance(event, TextDelta):
                    self._chat_session.append_response_chunk(event.content)
                    await self._send({
                        "type": MessageType.CHAT_STREAM,
                        "event": "text-delta",
                        "content": event.content,
                    })
                elif isinstance(event, ThinkingDelta):
                    await self._send({
                        "type": MessageType.CHAT_STREAM,
                        "event": "thinking-delta",
                        "content": event.content,
                    })
                elif isinstance(event, ToolUseStart):
                    await self._send({
                        "type": MessageType.CHAT_STREAM,
                        "event": "tool-use-start",
                        "toolId": event.tool_id,
                        "toolName": event.tool_name,
                    })
                elif isinstance(event, ToolResult):
                    await self._send({
                        "type": MessageType.CHAT_STREAM,
                        "event": "tool-result",
                        "toolId": event.tool_id,
                        "toolName": event.tool_name,
                        "status": event.status,
                    })
                elif isinstance(event, ChatDone):
                    await self._send({
                        "type": MessageType.CHAT_STREAM,
                        "event": "done",
                        "usage": event.usage,
                        "cost": event.cost,
                    })
                elif isinstance(event, ChatError):
                    await self._send({
                        "type": MessageType.CHAT_STREAM,
                        "event": "error",
                        "message": event.message,
                    })

        except asyncio.CancelledError:
            logger.debug("Chat stream cancelled")
            # Terminate subprocess if running
            if isinstance(provider, ClaudeCodeProvider):
                await provider.cancel()
        except Exception as e:
            logger.exception("Chat stream error: %s", e)
            await self._send({
                "type": MessageType.CHAT_STREAM,
                "event": "error",
                "message": str(e),
            })
        finally:
            self._chat_session.finish_response()

    async def _handle_provider_switch(self, data: dict) -> None:
        """Handle provider switch request."""
        provider_id = data.get("providerId", "")
        if not provider_id:
            return

        if self._provider_registry is not None:
            provider = self._provider_registry.get(provider_id)
            if provider is not None:
                if self._chat_session is not None:
                    self._chat_session.provider_name = provider_id
                logger.info("Switched to provider: %s", provider_id)
            else:
                await self._send_error(
                    ErrorCode.INTERNAL_ERROR,
                    f"Unknown provider: {provider_id}",
                )

    # --- Neovim handlers ---

    async def _handle_neovim_spawn(self, data: dict) -> None:
        """Spawn a Neovim instance for this session."""
        if self._session_id is None:
            await self._send_error(ErrorCode.INTERNAL_ERROR, "No session ID")
            return

        file_path = data.get("filePath")

        manager = get_neovim_manager()
        try:
            # Kill existing instance when opening a specific file so we get
            # a fresh Neovim with that file instead of reusing the old one
            if file_path:
                await manager.kill(self._session_id)

            cols = data.get("cols", 80)
            rows = data.get("rows", 24)
            instance = await manager.spawn(
                self._session_id,
                self._working_dir,
                TerminalSize(cols=cols, rows=rows),
                file_path=file_path,
            )

            # Start forwarding Neovim PTY output to the client
            task = asyncio.create_task(
                self._neovim_output_loop(self._session_id)
            )
            instance.output_task = task

            await self._send({
                "type": MessageType.NEOVIM_READY,
                "pid": instance.pty.pid,
            })

        except FileNotFoundError:
            logger.warning("Neovim not found on PATH")
            await self._send_error(
                ErrorCode.NEOVIM_NOT_FOUND,
                "Neovim (nvim) is not installed or not on PATH",
            )
        except Exception as e:
            logger.exception("Failed to spawn Neovim: %s", e)
            await self._send_error(
                ErrorCode.NEOVIM_SPAWN_FAILED,
                f"Failed to spawn Neovim: {e}",
            )

    async def _handle_neovim_kill(self) -> None:
        """Kill the Neovim instance for this session."""
        if self._session_id is None:
            return
        manager = get_neovim_manager()
        await manager.kill(self._session_id)

    async def _handle_neovim_input(self, data: dict) -> None:
        """Forward terminal input to Neovim."""
        if self._session_id is None:
            return
        manager = get_neovim_manager()
        instance = manager.get(self._session_id)
        if instance is not None and instance.is_alive():
            input_data = data.get("data", "")
            if input_data:
                await instance.pty.write(input_data)

    async def _handle_neovim_resize(self, data: dict) -> None:
        """Resize the Neovim terminal."""
        if self._session_id is None:
            return
        manager = get_neovim_manager()
        instance = manager.get(self._session_id)
        if instance is not None and instance.is_alive():
            cols = data.get("cols", 80)
            rows = data.get("rows", 24)
            await instance.pty.resize(cols, rows)

    async def _neovim_output_loop(self, session_id: str) -> None:
        """Read Neovim PTY output and send to client."""
        manager = get_neovim_manager()
        instance = manager.get(session_id)
        if instance is None:
            return

        try:
            async for data in instance.pty.read():
                if self._closed:
                    break
                await self._send({
                    "type": MessageType.NEOVIM_OUTPUT,
                    "data": data,
                })
        except Exception as e:
            if not self._closed:
                logger.exception("Neovim output error: %s", e)

        # Neovim process exited
        if not self._closed:
            await self._send({
                "type": MessageType.NEOVIM_EXITED,
                "exitCode": -1,
            })

    async def _suppress_timeout(self, timeout: float) -> None:
        """Force-end output suppression after timeout, independent of PTY output.

        Without this, the suppression timeout in _pty_output_loop only triggers
        when new data arrives — if the shell goes quiet after its initial prompt,
        the check never runs and the frontend never receives output.
        """
        try:
            await asyncio.sleep(timeout)
            if not self._suppress_output or self._closed:
                return

            logger.info("Output suppression timed out after %.1fs, flushing buffer", timeout)
            self._suppress_output = False

            if self._suppress_buffer:
                buffered = "".join(self._suppress_buffer)
                self._suppress_buffer.clear()
                await self._send({
                    "type": MessageType.OUTPUT,
                    "data": buffered,
                    "sessionKey": SessionKey.CLAUDE,
                })
        except asyncio.CancelledError:
            pass

    def _cancel_suppress_timeout(self) -> None:
        """Cancel the suppression timeout task if still running."""
        if self._suppress_timeout_task is not None:
            self._suppress_timeout_task.cancel()
            self._suppress_timeout_task = None

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

        received_output = False
        try:
            async for data in terminal.pty.read():
                if self._closed:
                    break

                received_output = True
                self._session.capture_output(data, session_key)

                # Only apply startup suppression to claude terminal
                if session_key == SessionKey.CLAUDE and self._suppress_output:
                    # Detect Claude startup via:
                    # - Alternate screen buffer: \x1b[?1049h or \x1b[?47h
                    # - Clear screen: \x1b[2J (often with \x1b[H cursor home)
                    # - Claude logo start (the block characters)
                    claude_detected = (
                        "\x1b[?1049h" in data
                        or "\x1b[?47h" in data
                        or "\x1b[2J" in data
                        or "▐▛███▜▌" in data
                    )

                    # Detect if Claude command failed (not installed)
                    command_not_found = (
                        "command not found" in data
                        or "not found" in data.lower()
                    )

                    timed_out = (
                        self._suppress_start_time
                        and time.monotonic() - self._suppress_start_time > 4.0
                    )

                    if claude_detected or timed_out or command_not_found:
                        self._suppress_output = False
                        self._cancel_suppress_timeout()
                        # Flush buffered output so error messages are visible
                        if self._suppress_buffer:
                            buffered = "".join(self._suppress_buffer)
                            self._suppress_buffer.clear()
                            if not claude_detected:
                                # Send buffered shell output on timeout or error
                                await self._send({
                                    "type": MessageType.OUTPUT,
                                    "data": buffered,
                                    "sessionKey": session_key,
                                })

                        # If Claude isn't installed, show helpful message
                        if command_not_found:
                            help_message = (
                                "\r\n\x1b[33m"
                                "Claude Code is not installed or not in PATH.\r\n"
                                "To install: npm install -g @anthropics/claude-code\r\n"
                                "Or disable auto-start: export CADE_AUTO_START_CLAUDE=false\r\n"
                                "\x1b[0m"
                            )
                            await self._send({
                                "type": MessageType.OUTPUT,
                                "data": help_message,
                                "sessionKey": session_key,
                            })

                        # Fall through to send this chunk
                    else:
                        self._suppress_buffer.append(data)
                        continue  # Keep suppressing

                await self._send({
                    "type": MessageType.OUTPUT,
                    "data": data,
                    "sessionKey": session_key,
                })
        except Exception as e:
            if not self._closed:
                logger.exception("PTY output error for %s: %s", session_key, e)

        # PTY read loop ended — notify client if process died without producing output
        if not received_output and not self._closed:
            logger.error(
                "PTY for %s exited without producing any output", session_key,
            )
            error_msg = "Terminal process exited without producing output. The shell may have failed to start."
            # Write visible red error text to the terminal so the user sees it
            ansi_error = (
                "\r\n\x1b[1;31m"
                f"Error: {error_msg}"
                "\x1b[0m\r\n"
            )
            await self._send({
                "type": MessageType.OUTPUT,
                "data": ansi_error,
                "sessionKey": session_key,
            })
            await self._send({
                "type": MessageType.PTY_EXITED,
                "code": ErrorCode.PTY_EXITED,
                "message": error_msg,
                "sessionKey": session_key,
            })

    async def _deferred_claude_start(self) -> None:
        """Run WSL network check in background and start Claude when ready.

        Keeps the WebSocket responsive while waiting for WSL networking.
        """
        try:
            await self._send_status("Checking WSL network...")

            from backend.wsl.health import wait_for_wsl_network
            network_timeout = (
                self._user_config.behavior.session.network_timeout
                if self._user_config
                else 15.0
            )
            ready, msg = await asyncio.get_event_loop().run_in_executor(
                None,
                wait_for_wsl_network,
                network_timeout,
                1.0,
            )

            if ready:
                logger.info("WSL network ready, starting Claude Code")
            else:
                logger.warning(
                    "WSL network not ready after %.1fs, starting Claude Code anyway: %s",
                    network_timeout, msg,
                )

            if self._closed or self._session is None:
                return

            await self._session.pty.write("claude\n")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.exception("Deferred Claude start failed: %s", e)

    async def _watch_loop(self) -> None:
        """Watch for file changes and notify client.

        Retries up to 3 times with exponential backoff if the watcher fails,
        recreating it each time. The connection stays alive even if watching
        is permanently lost.
        """
        max_retries = 3
        for attempt in range(max_retries + 1):
            if self._closed or self._watcher is None:
                return

            try:
                async for event in self._watcher.watch():
                    if self._closed:
                        return
                    await self._send({
                        "type": MessageType.FILE_CHANGE,
                        "event": event.event,
                        "path": event.path,
                    })
                # Normal exit (stop event set) — don't retry
                return
            except asyncio.CancelledError:
                return
            except Exception as e:
                if self._closed:
                    return
                if attempt < max_retries:
                    backoff = 2 ** (attempt + 1)
                    logger.warning(
                        "Watch error (attempt %d/%d), retrying in %ds: %s",
                        attempt + 1, max_retries, backoff, e,
                    )
                    await asyncio.sleep(backoff)
                    self._watcher = FileWatcher(self._working_dir)
                else:
                    logger.warning(
                        "File watcher failed after %d retries, disabling: %s",
                        max_retries, e,
                    )


async def websocket_handler(websocket: WebSocket, config: "Config") -> None:
    """Handle a WebSocket connection."""
    handler = ConnectionHandler(websocket, config)
    await handler.handle()
