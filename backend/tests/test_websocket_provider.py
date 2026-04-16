"""Tests for WebsocketProvider.

Stands up a throwaway local `websockets.serve()` instance per test so we
can drive the provider against a real socket without depending on
padarax-server. The fixture server records received frames and emits
scripted frames back under test control.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Any

import pytest
import websockets

from backend.providers.config import ProviderConfig
from backend.providers.types import ChatDone, ChatError, ChatMessage, TextDelta
from backend.providers.websocket_provider import WebsocketProvider


# --- Test-server fixture ----------------------------------------------------

class ScriptedServer:
    """A minimal in-process WebSocket server controlled by tests.

    The test arranges which frames are sent back in response to a given
    incoming frame type via `on_frame`. Received frames are exposed on
    `.received` for assertions.
    """

    def __init__(self) -> None:
        self.received: list[dict[str, Any]] = []
        self.on_frame: Callable[
            [dict[str, Any], Any],
            Awaitable[None],
        ] = self._default_on_frame
        self._server: websockets.Server | None = None
        self.port: int = 0
        self._connections: list[Any] = []

    async def _default_on_frame(self, frame: dict[str, Any], ws: Any) -> None:
        # Default: echo the frame type back as a response so provider
        # stream_chat calls terminate. Tests override as needed.
        if frame.get("type") == "hello":
            await ws.send(json.dumps({
                "type": "connected",
                "session_id": frame.get("session_id", ""),
                "resumed": False,
                "scene": "the scene",
            }))
        elif frame.get("type") == "command":
            await ws.send(json.dumps({
                "type": "response",
                "kind": "narration",
                "content": "ok",
            }))

    async def _handler(self, ws: Any) -> None:
        self._connections.append(ws)
        try:
            async for raw in ws:
                frame = json.loads(raw)
                self.received.append(frame)
                await self.on_frame(frame, ws)
        except websockets.ConnectionClosed:
            pass

    async def start(self) -> None:
        self._server = await websockets.serve(self._handler, "127.0.0.1", 0)
        # websockets v16 returns a Server with sockets attribute.
        self.port = self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def push(self, connection_index: int, frame: dict[str, Any]) -> None:
        """Send a frame to a connected client out-of-band (unsolicited)."""
        await self._connections[connection_index].send(json.dumps(frame))

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/game"


@pytest.fixture
async def scripted_server() -> AsyncGenerator[ScriptedServer, None]:
    server = ScriptedServer()
    await server.start()
    try:
        yield server
    finally:
        await server.stop()


def _make_provider(url: str, **extra: Any) -> WebsocketProvider:
    config = ProviderConfig(
        name="test-ws",
        type="cli",
        model="padarax",
        extra={"url": url, **extra},
    )
    return WebsocketProvider(config)


# --- Tests ------------------------------------------------------------------

class TestConstruction:
    def test_requires_url_in_extra(self):
        with pytest.raises(ValueError, match="requires extra.url"):
            WebsocketProvider(ProviderConfig(name="bad", type="cli", extra={}))

    def test_reads_timeouts_from_extra(self):
        provider = _make_provider(
            "ws://127.0.0.1:9999/game",
            timeout=5,
            connect_timeout=2,
        )
        assert provider._timeout == 5
        assert provider._connect_timeout == 2

    def test_exposes_name_model_and_capabilities(self):
        config = ProviderConfig(
            name="ws-1",
            type="cli",
            model="padarax",
            extra={"url": "ws://127.0.0.1:9999/game"},
        )
        provider = WebsocketProvider(config)
        assert provider.name == "ws-1"
        assert provider.model == "padarax"
        caps = provider.get_capabilities()
        assert caps.streaming is True
        assert caps.tool_use is False
        assert caps.vision is False


class TestSessionId:
    async def test_start_without_session_id_raises(self, scripted_server: ScriptedServer):
        provider = _make_provider(scripted_server.url)
        with pytest.raises(RuntimeError, match="set_session_id"):
            await provider.start()


class TestHelloFrame:
    async def test_hello_includes_session_id_and_client(
        self, scripted_server: ScriptedServer
    ):
        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-abc")
        await provider.start()
        # Give the listener a moment to handle the connected reply.
        await asyncio.sleep(0.05)
        await provider.stop()

        hello = next(f for f in scripted_server.received if f["type"] == "hello")
        assert hello["session_id"] == "sess-abc"
        assert hello["client"] == "cade/1.0"


class TestUnsolicitedRouting:
    async def test_connected_with_scene_fires_scene_update(
        self, scripted_server: ScriptedServer
    ):
        events: list[tuple[str, dict[str, Any]]] = []

        async def handler(event_type: str, payload: dict[str, Any]) -> None:
            events.append((event_type, payload))

        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        provider.set_event_handler(handler)
        await provider.start()
        await asyncio.sleep(0.05)
        await provider.stop()

        scene_events = [e for e in events if e[0] == "scene_update"]
        assert len(scene_events) == 1
        assert scene_events[0][1] == {"content": "the scene"}

    async def test_connected_resumed_skips_scene_update(
        self, scripted_server: ScriptedServer
    ):
        async def on_frame(frame: dict[str, Any], ws: Any) -> None:
            if frame["type"] == "hello":
                await ws.send(json.dumps({
                    "type": "chat_history",
                    "messages": [
                        {"role": "user", "content": "hi"},
                        {"role": "assistant", "content": "hello"},
                    ],
                }))
                await ws.send(json.dumps({
                    "type": "connected",
                    "resumed": True,
                    "session_id": frame["session_id"],
                }))

        scripted_server.on_frame = on_frame

        events: list[tuple[str, dict[str, Any]]] = []

        async def handler(event_type: str, payload: dict[str, Any]) -> None:
            events.append((event_type, payload))

        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        provider.set_event_handler(handler)
        await provider.start()
        await asyncio.sleep(0.05)
        await provider.stop()

        # chat_history routed, but connected(resumed=True) did NOT fire a
        # scene_update — the replay is the history.
        assert ("chat_history", {"messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]}) in events
        assert not any(e[0] == "scene_update" for e in events)

    async def test_unsolicited_scene_update_routed(
        self, scripted_server: ScriptedServer
    ):
        events: list[tuple[str, dict[str, Any]]] = []

        async def handler(event_type: str, payload: dict[str, Any]) -> None:
            events.append((event_type, payload))

        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        provider.set_event_handler(handler)
        await provider.start()
        await asyncio.sleep(0.05)

        # Push an out-of-band scene_update mid-session.
        await scripted_server.push(0, {
            "type": "scene_update",
            "content": "a moment passes",
        })
        await asyncio.sleep(0.05)
        await provider.stop()

        assert any(
            e == ("scene_update", {"content": "a moment passes"})
            for e in events
        )


class TestStreamChat:
    async def test_command_round_trip_yields_text_delta_then_done(
        self, scripted_server: ScriptedServer
    ):
        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        await provider.start()

        events = []
        async for event in provider.stream_chat([ChatMessage(role="user", content="look")]):
            events.append(event)
        await provider.stop()

        assert len(events) == 2
        assert isinstance(events[0], TextDelta)
        assert events[0].content == "ok"
        assert isinstance(events[1], ChatDone)

        # Verify the command frame shape the server received.
        command = next(f for f in scripted_server.received if f["type"] == "command")
        assert command["text"] == "look"

    async def test_error_frame_yields_chat_error(
        self, scripted_server: ScriptedServer
    ):
        async def on_frame(frame: dict[str, Any], ws: Any) -> None:
            if frame["type"] == "hello":
                await ws.send(json.dumps({
                    "type": "connected",
                    "resumed": False,
                    "scene": "",
                }))
            elif frame["type"] == "command":
                await ws.send(json.dumps({
                    "type": "error",
                    "code": "command_failed",
                    "message": "something broke",
                }))

        scripted_server.on_frame = on_frame

        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        await provider.start()

        events = []
        async for event in provider.stream_chat([ChatMessage(role="user", content="look")]):
            events.append(event)
        await provider.stop()

        assert len(events) == 1
        assert isinstance(events[0], ChatError)
        assert events[0].code == "command_failed"
        assert "something broke" in events[0].message

    async def test_empty_user_message_yields_error(
        self, scripted_server: ScriptedServer
    ):
        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        await provider.start()

        events = []
        async for event in provider.stream_chat([ChatMessage(role="assistant", content="hi")]):
            events.append(event)
        await provider.stop()

        assert len(events) == 1
        assert isinstance(events[0], ChatError)
        assert events[0].code == "empty-prompt"

    async def test_timeout_yields_chat_error(
        self, scripted_server: ScriptedServer
    ):
        async def on_frame(frame: dict[str, Any], ws: Any) -> None:
            if frame["type"] == "hello":
                await ws.send(json.dumps({
                    "type": "connected",
                    "resumed": False,
                    "scene": "",
                }))
            # Never respond to command frames.

        scripted_server.on_frame = on_frame

        provider = _make_provider(scripted_server.url, timeout=0.1)
        provider.set_session_id("sess-1")
        await provider.start()

        events = []
        async for event in provider.stream_chat([ChatMessage(role="user", content="look")]):
            events.append(event)
        await provider.stop()

        assert len(events) == 1
        assert isinstance(events[0], ChatError)
        assert events[0].code == "timeout"


class TestConnectFailure:
    async def test_stream_chat_yields_error_when_connect_fails(self):
        # Point at a port that isn't listening. connect_timeout keeps the
        # failure fast so the test doesn't stall.
        provider = _make_provider(
            "ws://127.0.0.1:1/nowhere", connect_timeout=0.2
        )
        provider.set_session_id("sess-1")

        events = []
        async for event in provider.stream_chat(
            [ChatMessage(role="user", content="look")]
        ):
            events.append(event)

        assert len(events) == 1
        assert isinstance(events[0], ChatError)
        assert events[0].code == "connect-failed"


class TestFrameRouting:
    async def test_unexpected_frame_type_after_command_yields_error(
        self, scripted_server: ScriptedServer
    ):
        # Server only handles hello — command gets no response frame, so
        # the injected surprise frame is what stream_chat reads.
        async def on_frame(frame: dict[str, Any], ws: Any) -> None:
            if frame["type"] == "hello":
                await ws.send(json.dumps({
                    "type": "connected", "resumed": False, "scene": "",
                }))

        scripted_server.on_frame = on_frame

        provider = _make_provider(scripted_server.url, timeout=1)
        provider.set_session_id("sess-1")
        await provider.start()
        await asyncio.sleep(0.05)  # let hello handshake settle

        async def inject_after_command() -> None:
            await asyncio.sleep(0.05)
            await provider._response_queue.put({"type": "surprise"})

        events = []
        inject_task = asyncio.create_task(inject_after_command())
        async for event in provider.stream_chat(
            [ChatMessage(role="user", content="look")]
        ):
            events.append(event)
        await inject_task
        await provider.stop()

        assert any(
            isinstance(e, ChatError) and e.code == "bad-frame"
            for e in events
        )

    async def test_unhandled_frame_type_is_logged_and_ignored(
        self, scripted_server: ScriptedServer
    ):
        # Push a never-heard-of frame type; the provider's router logs
        # and moves on rather than blowing up.
        events: list[tuple[str, dict[str, Any]]] = []

        async def handler(event_type: str, payload: dict[str, Any]) -> None:
            events.append((event_type, payload))

        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        provider.set_event_handler(handler)
        await provider.start()
        await asyncio.sleep(0.05)

        await scripted_server.push(0, {"type": "never_seen_before", "x": 1})
        await asyncio.sleep(0.05)
        await provider.stop()

        # No unhandled event surfaced via the handler.
        assert not any(e[0] == "never_seen_before" for e in events)

    async def test_listener_survives_non_json_frame(
        self, scripted_server: ScriptedServer
    ):
        async def on_frame(frame: dict[str, Any], ws: Any) -> None:
            if frame["type"] == "hello":
                # Send an invalid JSON frame, then a valid one after.
                await ws.send("{not json")
                await ws.send(json.dumps({
                    "type": "connected", "resumed": False, "scene": "hi",
                }))

        scripted_server.on_frame = on_frame

        events: list[tuple[str, dict[str, Any]]] = []

        async def handler(event_type: str, payload: dict[str, Any]) -> None:
            events.append((event_type, payload))

        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        provider.set_event_handler(handler)
        await provider.start()
        await asyncio.sleep(0.1)
        await provider.stop()

        # The valid connected frame still made it through.
        assert any(e[0] == "scene_update" for e in events)


class TestStop:
    async def test_stop_cancels_listener_task_and_closes_ws(
        self, scripted_server: ScriptedServer
    ):
        provider = _make_provider(scripted_server.url)
        provider.set_session_id("sess-1")
        await provider.start()
        assert provider._listener_task is not None
        await asyncio.sleep(0.05)  # let hello handshake complete

        await provider.stop()

        assert provider._listener_task is None
        assert provider._ws is None
        assert provider._started is False
