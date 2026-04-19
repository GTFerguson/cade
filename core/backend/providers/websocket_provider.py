"""WebSocket provider: long-lived connection to a game server.

Counterpart to SubprocessProvider for servers that keep state across turns.
Unlike SubprocessProvider (spawn-per-turn, stateless transport), this provider
holds one WebSocket connection for the handler's lifetime. That's what lets
the server push unsolicited frames — ambient beats, NPC chatter, world
events — into chat between user turns.

See docs/plans/server-and-persistence.md in the Padarax repo for the server
side (padarax-server). Protocol shape:

  Client → server:
    {"type": "hello", "client": "cade/1.0"}
    {"type": "command", "text": "look"}

  Server → client:
    {"type": "connected", "scene": "...markdown..."}       (on open)
    {"type": "response", "kind": "...", "content": "..."}  (reply to command)
    {"type": "scene_update", "content": "..."}              (unsolicited)
    {"type": "error", "code": "...", "message": "..."}
"""

from __future__ import annotations

import asyncio


class ProviderAuthError(RuntimeError):
    """Raised when the game server rejects the hello frame due to auth failure."""
import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

from core.backend.providers.base import BaseProvider, UnsolicitedEventHandler
from core.backend.providers.config import ProviderConfig
from core.backend.providers.types import (
    ChatDone,
    ChatError,
    ChatEvent,
    ChatMessage,
    ProviderCapabilities,
    TextDelta,
)

logger = logging.getLogger(__name__)


class WebsocketProvider(BaseProvider):
    """A provider that relays chat through a long-lived WebSocket.

    Config (via extra):
        url: ws://host:port/path  — required
        timeout: float seconds for a single command round-trip (default 120)
        connect_timeout: float seconds to establish the connection (default 10)

    Stateful: one WS connection per provider instance, kept alive across
    stream_chat calls. Call start() early so the server's `connected` frame
    (initial scene) gets received and routed through the event handler.
    """

    def __init__(
        self,
        config: ProviderConfig,
        working_dir: Path | None = None,
    ) -> None:
        self._config = config
        self._name = config.name
        self._model = config.model or config.name
        self._working_dir = working_dir or Path.cwd()

        extra = config.extra or {}
        url = extra.get("url")
        if not url or not isinstance(url, str):
            raise ValueError(
                f"WebsocketProvider '{config.name}' requires extra.url "
                f"(e.g. ws://localhost:9001/game)"
            )
        self._url: str = url
        self._timeout: float = float(extra.get("timeout", 120))
        self._connect_timeout: float = float(extra.get("connect_timeout", 10))

        self._ws: ClientConnection | None = None
        self._listener_task: asyncio.Task | None = None
        # Responses that stream_chat is currently awaiting (one at a time —
        # CADE's chat pipeline is serial per session).
        self._response_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._event_handler: UnsolicitedEventHandler | None = None
        self._started = False
        self._start_lock = asyncio.Lock()
        # Session ID sent to the server in the `hello` frame so the server
        # can key chat_messages and replay them on reconnect. Set by the
        # connection handler via set_session_id() before start().
        self._session_id: str = ""
        # Google id_token forwarded from the browser; included in hello when set
        # so the game server can verify the player's identity.
        self._auth_token: str = ""

    # --- BaseProvider interface ---

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(streaming=True, tool_use=False, vision=False)

    def set_event_handler(self, handler: UnsolicitedEventHandler | None) -> None:
        self._event_handler = handler

    async def send_frame(self, frame: dict[str, Any]) -> None:
        """Dispatch an arbitrary frame to the server over the persistent WS.

        Connection is established lazily if not yet open. The server is
        expected to handle the frame type; unknown types should surface an
        error frame which the background listener routes through the event
        handler as a scene_update or error message the user sees in chat.

        Fire-and-forget from the caller's perspective — server-side effects
        (e.g. save-file updates after a trade commit) drive dashboard refresh
        via the existing file-watch loop; no response is awaited here.
        """
        await self._ensure_connected()
        assert self._ws is not None
        await self._ws.send(json.dumps(frame))

    def set_session_id(self, session_id: str) -> None:
        """Sent to the server in the `hello` frame. The server uses this as
        the primary key of `chat_sessions` — same value across reconnects
        replays the transcript. Must be called before start()."""
        self._session_id = session_id

    def set_auth_token(self, token: str) -> None:
        """Forward a Google id_token (or other bearer token) to the game server.

        Included in the `hello` frame so the server can verify the player's
        identity without a separate auth handshake. Safe to call after start();
        the token is picked up on the next reconnect."""
        self._auth_token = token

    async def start(self) -> None:
        """Open the WebSocket and spawn the background listener.

        Safe to call multiple times — connection is only opened once. If the
        connection is already closed, a subsequent stream_chat will reconnect
        lazily via _ensure_connected.
        """
        async with self._start_lock:
            if self._started and self._ws is not None and not self._is_closed():
                return
            await self._connect()
            self._started = True

    async def stop(self) -> None:
        if self._listener_task is not None:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._listener_task = None
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
            self._ws = None
        self._started = False

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str | None = None,  # ignored — server owns state
    ) -> AsyncIterator[ChatEvent]:
        user_message = ""
        for msg in reversed(messages):
            if msg.role == "user":
                user_message = msg.content
                break
        if not user_message:
            yield ChatError(message="No user message to send", code="empty-prompt")
            return

        try:
            await self._ensure_connected()
        except Exception as e:  # noqa: BLE001
            yield ChatError(
                message=f"WebsocketProvider failed to connect: {e}",
                code="connect-failed",
            )
            return

        # Drain any stale frames that snuck into the queue between turns
        # (shouldn't happen given serial commands, but defensive).
        while not self._response_queue.empty():
            try:
                self._response_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Send the command frame and await exactly one response/error frame.
        try:
            assert self._ws is not None
            await self._ws.send(json.dumps({"type": "command", "text": user_message}))
        except Exception as e:  # noqa: BLE001
            yield ChatError(message=f"send failed: {e}", code="send-failed")
            return

        try:
            frame = await asyncio.wait_for(
                self._response_queue.get(), timeout=self._timeout
            )
        except asyncio.TimeoutError:
            yield ChatError(
                message=f"No response within {self._timeout}s",
                code="timeout",
            )
            return

        ftype = frame.get("type")
        if ftype == "response":
            content = frame.get("content") or ""
            if content:
                yield TextDelta(content=content)
            yield ChatDone()
            return
        if ftype == "error":
            yield ChatError(
                message=frame.get("message", "unknown error"),
                code=frame.get("code", "server-error"),
            )
            return

        yield ChatError(
            message=f"Unexpected frame type: {ftype}",
            code="bad-frame",
        )

    # --- internals ---

    def _is_closed(self) -> bool:
        if self._ws is None:
            return True
        try:
            return bool(self._ws.close_code is not None)
        except Exception:  # noqa: BLE001
            return True

    async def _connect(self) -> None:
        if not self._session_id:
            raise RuntimeError(
                "WebsocketProvider.set_session_id() must be called before "
                "start(); the server requires session_id in the hello frame"
            )
        logger.info("WebsocketProvider '%s' connecting to %s", self._name, self._url)
        self._ws = await asyncio.wait_for(
            websockets.connect(self._url, max_size=None),
            timeout=self._connect_timeout,
        )
        hello: dict[str, Any] = {
            "type": "hello",
            "session_id": self._session_id,
            "client": "cade/1.0",
        }
        if self._auth_token:
            hello["auth_token"] = self._auth_token
        await self._ws.send(json.dumps(hello))
        # Block until the server acks with `connected`. The server's hello
        # handler posts a deferred state transition (Connecting → Playing) via
        # its loop thread; if we return before that lands, a command sent
        # immediately after reconnect arrives while the server still sees
        # Connecting state and rejects it with "send a `hello` frame first".
        # chat_history frames arriving before `connected` are routed normally.
        await asyncio.wait_for(
            self._drain_until_connected(), timeout=self._connect_timeout
        )
        self._listener_task = asyncio.create_task(self._listen())

    async def _drain_until_connected(self) -> None:
        """Route frames from the server until the `connected` ack arrives."""
        assert self._ws is not None
        last_error: str | None = None
        async for raw in self._ws:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(
                    "WS provider '%s' got non-JSON frame during handshake", self._name
                )
                continue
            if frame.get("type") == "error":
                last_error = frame.get("message") or frame.get("code") or "unknown error"
                logger.warning("WS provider '%s' handshake error: %s", self._name, last_error)
                await self._ws.close()
                raise ProviderAuthError(last_error)
            await self._route_frame(frame)
            if frame.get("type") == "connected":
                return
        raise RuntimeError(
            last_error
            or f"WebsocketProvider '{self._name}': connection closed before 'connected' frame"
        )

    async def _ensure_connected(self) -> None:
        if self._ws is None or self._is_closed():
            await self._connect()
            self._started = True

    async def _listen(self) -> None:
        """Drain frames from the WebSocket and route them.

        Response frames go to _response_queue for stream_chat to consume.
        Unsolicited frames (connected, scene_update) fire the event handler,
        which converts them into assistant-only chat messages upstream.
        """
        assert self._ws is not None
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")
                try:
                    frame = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("WS provider '%s' got non-JSON frame", self._name)
                    continue
                await self._route_frame(frame)
        except asyncio.CancelledError:
            raise
        except websockets.ConnectionClosed:
            logger.info("WebsocketProvider '%s' connection closed", self._name)
        except Exception as e:  # noqa: BLE001
            logger.exception("WebsocketProvider '%s' listener error: %s", self._name, e)

    async def _route_frame(self, frame: dict[str, Any]) -> None:
        ftype = frame.get("type")
        if ftype in ("response", "error"):
            await self._response_queue.put(frame)
            return
        # Unsolicited frames — connected, scene_update, chat_history.
        handler = self._event_handler
        if handler is None:
            return
        if ftype == "connected":
            # resumed=True → no new scene; the chat_history frame handled the
            # replay. resumed=False → scene is the opening description.
            if frame.get("resumed"):
                return
            scene = frame.get("scene") or ""
            if scene:
                await handler("scene_update", {"content": scene})
        elif ftype == "scene_update":
            content = frame.get("content") or ""
            if content:
                await handler("scene_update", {"content": content})
        elif ftype == "chat_history":
            await handler("chat_history", {"messages": frame.get("messages") or []})
        elif ftype == "dashboard_focus":
            view_id = frame.get("view_id") or ""
            if view_id:
                await handler("dashboard_focus", {"view_id": view_id})
        elif ftype == "dashboard_hide_view":
            view_id = frame.get("view_id") or ""
            if view_id:
                await handler("dashboard_hide_view", {"view_id": view_id})
        elif ftype == "dashboard_data":
            sources = frame.get("sources")
            if sources:
                await handler("dashboard_data", {"sources": sources})
        else:
            logger.debug("WS provider '%s' unhandled frame type: %s", self._name, ftype)
