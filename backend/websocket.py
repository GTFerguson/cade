"""WebSocket connection handling and message routing."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import WebSocket, WebSocketDisconnect

from backend.errors import CCPlusError, ProtocolError
from backend.file_tree import build_file_tree, get_file_type, read_file_content
from backend.file_watcher import FileWatcher
from backend.protocol import ErrorCode, MessageType
from backend.pty_manager import PTYManager
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
        self._pty: PTYManager | None = None
        self._watcher: FileWatcher | None = None
        self._closed = False
        self._suppress_output = False
        self._suppress_start_time: float | None = None

    async def handle(self) -> None:
        """Main connection handler loop."""
        await self._ws.accept()

        try:
            await self._setup()
            await self._send_connected()

            pty_output_task = asyncio.create_task(self._pty_output_loop())
            watch_task = asyncio.create_task(self._watch_loop())

            # Receive loop controls connection lifetime
            # PTY output and watch loops run as long-lived background tasks
            try:
                await self._receive_loop()
            finally:
                # Cancel background tasks when receive ends
                pty_output_task.cancel()
                watch_task.cancel()
                await asyncio.gather(
                    pty_output_task, watch_task, return_exceptions=True
                )

        except WebSocketDisconnect:
            logger.debug("WebSocket disconnected")
        except Exception as e:
            logger.exception("Connection handler error: %s", e)
        finally:
            await self._cleanup()

    async def _setup(self) -> None:
        """Initialize PTY and file watcher."""
        self._pty = PTYManager()

        if self._config.auto_start_claude and not self._config.dummy_mode:
            self._suppress_output = True
            self._suppress_start_time = time.monotonic()

        await self._pty.spawn(
            self._config.shell_command,
            self._config.working_dir,
            TerminalSize(cols=80, rows=24),
        )

        if self._config.dummy_mode:
            await asyncio.sleep(0.5)
            dummy_output = (
                "\x1b[?1049h\x1b[H\x1b[2J"  # Switch to alternate screen and clear
                "\x1b[38;5;75m ▐▛███▜▌\x1b[0m   Claude Code (dummy mode)\r\n"
                "\x1b[38;5;75m▝▜█████▛▘\x1b[0m  Development UI Preview\r\n"
                "\x1b[38;5;75m  ▘▘ ▝▝\x1b[0m\r\n"
                "\r\n"
                "─────────────────────────────────────────────────────────────────\r\n"
                "\x1b[38;5;245m❯\x1b[0m Dummy mode - no actual Claude running\r\n"
                "─────────────────────────────────────────────────────────────────\r\n"
            )
            # Send directly to the output stream, not as a shell command
            await self._send({
                "type": MessageType.OUTPUT,
                "data": dummy_output,
            })
        elif self._config.auto_start_claude:
            await asyncio.sleep(0.5)
            await self._pty.write("claude\n")

        self._watcher = FileWatcher(self._config.working_dir)

    async def _cleanup(self) -> None:
        """Clean up resources."""
        self._closed = True

        if self._watcher is not None:
            self._watcher.stop()
            self._watcher = None

        if self._pty is not None:
            await self._pty.close()
            self._pty = None

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

    async def _send_connected(self) -> None:
        """Send connected message with working directory."""
        await self._send({
            "type": MessageType.CONNECTED,
            "workingDir": str(self._config.working_dir),
        })

    async def _receive_loop(self) -> None:
        """Receive and handle messages from the client."""
        while not self._closed:
            try:
                data = await self._ws.receive_json()
                await self._handle_message(data)
            except WebSocketDisconnect:
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
            else:
                raise ProtocolError.invalid_message(f"Unknown message type: {msg_type}")

        except CCPlusError as e:
            await self._send(e.to_message())
        except Exception as e:
            logger.exception("Error handling message type %s: %s", msg_type, e)
            await self._send_error(ErrorCode.INTERNAL_ERROR, str(e))

    async def _handle_input(self, data: dict) -> None:
        """Handle terminal input."""
        if self._pty is None:
            return

        input_data = data.get("data", "")
        if input_data:
            await self._pty.write(input_data)

    async def _handle_resize(self, data: dict) -> None:
        """Handle terminal resize."""
        if self._pty is None:
            return

        cols = data.get("cols", 80)
        rows = data.get("rows", 24)
        await self._pty.resize(cols, rows)

    async def _handle_get_tree(self) -> None:
        """Handle file tree request."""
        tree = build_file_tree(self._config.working_dir)
        await self._send({
            "type": MessageType.FILE_TREE,
            "data": [node.to_dict() for node in tree],
        })

    async def _handle_get_file(self, data: dict) -> None:
        """Handle file content request."""
        path = data.get("path", "")
        if not path:
            raise ProtocolError.invalid_message("Missing path")

        content = read_file_content(self._config.working_dir, path)
        file_type = get_file_type(path)

        await self._send({
            "type": MessageType.FILE_CONTENT,
            "path": path,
            "content": content,
            "fileType": file_type,
        })

    async def _pty_output_loop(self) -> None:
        """Read and send PTY output to client."""
        if self._pty is None:
            return

        try:
            async for data in self._pty.read():
                if self._closed:
                    break

                if self._suppress_output:
                    # Detect Claude startup via alternate screen escape sequence
                    if "\x1b[?1049h" in data or "\x1b[?47h" in data:
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
                })
        except Exception as e:
            if not self._closed:
                logger.exception("PTY output error: %s", e)

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
