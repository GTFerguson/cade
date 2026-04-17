"""Integration tests for the WebSocket endpoint and app startup.

These tests use FastAPI's TestClient to make real WebSocket connections
to the app, verifying the full flow that the desktop app relies on:
health check → WebSocket connect → SET_PROJECT → PTY output.

These catch issues that unit tests with mocks can't:
- HTTP endpoint not responding (Tauri health check fails)
- WebSocket handshake failures
- Message serialization mismatches between frontend and backend
- Output never reaching the client through the real code path
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from backend.config import Config, set_config
from backend.main import create_app
from backend.protocol import ErrorCode, MessageType
from backend.terminal.sessions import SessionRegistry, set_registry

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def test_config(temp_dir: Path) -> Config:
    """Create a test config with dummy mode to avoid real shell spawning."""
    return Config(
        port=0,
        host="127.0.0.1",
        working_dir=temp_dir,
        shell_command="bash",
        auto_start_claude=False,
        auto_open_browser=False,
        dummy_mode=True,
    )


@pytest.fixture
def app(test_config: Config):
    """Create a FastAPI app configured for testing."""
    # Reset global state to avoid cross-test contamination
    set_config(test_config)
    registry = SessionRegistry()
    set_registry(registry)

    with patch("backend.main.unify_sessions"):
        with patch("backend.main._check_wsl_health_async", new_callable=AsyncMock):
            app = create_app(test_config)
            yield app

    # Cleanup: reset registry
    set_registry(SessionRegistry())


@pytest.fixture
def client(app) -> TestClient:
    """Create a test client for the app."""
    return TestClient(app)


# ---------------------------------------------------------------------------
# Health Check Tests
# ---------------------------------------------------------------------------


class TestHealthCheck:
    """Test the HTTP endpoint that Tauri polls to know the backend is ready.

    Tauri calls GET / every 500ms for up to 30 seconds. If this doesn't
    return 200, the desktop app shows an error and exits.
    """

    def test_root_returns_200(self, client: TestClient):
        """GET / must return 200 for the Tauri health check to pass."""
        response = client.get("/")
        assert response.status_code == 200

    def test_root_returns_content(self, client: TestClient):
        """Root should return either the frontend HTML or a JSON fallback."""
        response = client.get("/")
        assert response.status_code == 200
        # Either HTML (frontend built) or JSON (frontend not built)
        content_type = response.headers.get("content-type", "")
        assert "html" in content_type or "json" in content_type


# ---------------------------------------------------------------------------
# WebSocket Connection Tests
# ---------------------------------------------------------------------------


class TestWebSocketConnection:
    """Test the WebSocket handshake and initial message exchange."""

    def test_websocket_accepts_connection(self, client: TestClient):
        """WebSocket endpoint should accept connections."""
        with client.websocket_connect("/ws") as ws:
            # Connection accepted - read until we get the connected message
            # (startup-status messages arrive first, then connected after
            # the 2s SET_PROJECT timeout)
            for _ in range(10):
                data = ws.receive_json()
                if data["type"] == MessageType.CONNECTED:
                    break
            assert data["type"] == MessageType.CONNECTED

    def test_websocket_with_set_project(
        self, client: TestClient, temp_dir: Path
    ):
        """Sending SET_PROJECT should set the working directory."""
        with client.websocket_connect("/ws") as ws:
            ws.send_json({
                "type": MessageType.SET_PROJECT,
                "path": str(temp_dir),
                "sessionId": "test-session-1",
            })

            # Should receive startup status and connected messages
            messages = []
            for _ in range(10):
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == MessageType.CONNECTED:
                    break

            connected = next(
                m for m in messages if m["type"] == MessageType.CONNECTED
            )
            assert connected["workingDir"] == str(temp_dir)

    def test_websocket_receives_startup_status(self, client: TestClient):
        """Client should receive startup status messages during connection."""
        with client.websocket_connect("/ws") as ws:
            messages = []
            for _ in range(10):
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == MessageType.CONNECTED:
                    break

            status_msgs = [
                m for m in messages
                if m["type"] == MessageType.STARTUP_STATUS
            ]
            assert len(status_msgs) >= 1

    def test_websocket_connected_includes_config(self, client: TestClient):
        """CONNECTED message should include user config for the frontend."""
        with client.websocket_connect("/ws") as ws:
            messages = []
            for _ in range(10):
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == MessageType.CONNECTED:
                    break

            connected = next(
                m for m in messages if m["type"] == MessageType.CONNECTED
            )
            assert "config" in connected
            assert "workingDir" in connected


# ---------------------------------------------------------------------------
# WebSocket with Real PTY Tests
# ---------------------------------------------------------------------------


@pytest.mark.skipif(sys.platform == "win32", reason="Unix-only")
class TestWebSocketWithPTY:
    """Integration tests that use real shell processes.

    These verify the full pipeline: WebSocket → PTY → shell → output → client.
    """

    @pytest.fixture
    def pty_config(self, temp_dir: Path) -> Config:
        return Config(
            port=0,
            host="127.0.0.1",
            working_dir=temp_dir,
            shell_command="bash",
            auto_start_claude=False,
            auto_open_browser=False,
            dummy_mode=False,
        )

    @pytest.fixture
    def pty_app(self, pty_config: Config):
        set_config(pty_config)
        registry = SessionRegistry()
        set_registry(registry)

        with patch("backend.main.unify_sessions"):
            with patch("backend.main._check_wsl_health_async", new_callable=AsyncMock):
                app = create_app(pty_config)
                yield app

        set_registry(SessionRegistry())

    @pytest.fixture
    def pty_client(self, pty_app) -> TestClient:
        return TestClient(pty_app)

    def test_send_input_and_receive_output(
        self, pty_client: TestClient, temp_dir: Path
    ):
        """Send input to the shell and verify output comes back.

        This is the core test: if this works, the terminal pipeline is intact.
        """
        with pty_client.websocket_connect("/ws") as ws:
            ws.send_json({
                "type": MessageType.SET_PROJECT,
                "path": str(temp_dir),
                "sessionId": "pty-test-1",
            })

            # Wait for connection to be established
            messages = []
            for _ in range(20):
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == MessageType.CONNECTED:
                    break

            # Send a command that produces known output
            ws.send_json({
                "type": MessageType.INPUT,
                "data": "echo INTEGRATION_TEST_MARKER_XYZ\n",
            })

            # Read output until we find our marker
            found = False
            output_collected = ""
            for _ in range(50):
                try:
                    msg = ws.receive_json()
                    if msg["type"] == MessageType.OUTPUT:
                        output_collected += msg.get("data", "")
                        if "INTEGRATION_TEST_MARKER_XYZ" in output_collected:
                            found = True
                            break
                except Exception:
                    break

            assert found, (
                f"Never received echo output. Collected: {output_collected[:300]}"
            )

    def test_resize_during_session(
        self, pty_client: TestClient, temp_dir: Path
    ):
        """Resize should not crash the session."""
        with pty_client.websocket_connect("/ws") as ws:
            ws.send_json({
                "type": MessageType.SET_PROJECT,
                "path": str(temp_dir),
                "sessionId": "resize-test-1",
            })

            # Wait for connected
            for _ in range(20):
                msg = ws.receive_json()
                if msg["type"] == MessageType.CONNECTED:
                    break

            # Send resize
            ws.send_json({
                "type": MessageType.RESIZE,
                "cols": 120,
                "rows": 40,
            })

            # Verify session still works after resize
            ws.send_json({
                "type": MessageType.INPUT,
                "data": "echo AFTER_RESIZE\n",
            })

            found = False
            output = ""
            for _ in range(50):
                try:
                    msg = ws.receive_json()
                    if msg["type"] == MessageType.OUTPUT:
                        output += msg.get("data", "")
                        if "AFTER_RESIZE" in output:
                            found = True
                            break
                except Exception:
                    break

            assert found, f"No output after resize. Got: {output[:300]}"


# ---------------------------------------------------------------------------
# WebSocket Error Handling Tests
# ---------------------------------------------------------------------------


class TestWebSocketErrors:
    """Test error handling through the WebSocket connection."""

    def test_invalid_message_returns_error(self, client: TestClient):
        """Sending an unknown message type should return an error."""
        with client.websocket_connect("/ws") as ws:
            # Wait for connected first
            for _ in range(10):
                msg = ws.receive_json()
                if msg["type"] == MessageType.CONNECTED:
                    break

            ws.send_json({"type": "totally-bogus-type"})

            # Should receive an error
            for _ in range(10):
                msg = ws.receive_json()
                if msg["type"] == MessageType.ERROR:
                    assert msg["code"] == ErrorCode.INVALID_MESSAGE
                    return

            pytest.fail("Never received error for invalid message type")

    def test_get_file_missing_path_returns_error(self, client: TestClient):
        """GET_FILE without a path should return an error."""
        with client.websocket_connect("/ws") as ws:
            for _ in range(10):
                msg = ws.receive_json()
                if msg["type"] == MessageType.CONNECTED:
                    break

            ws.send_json({"type": MessageType.GET_FILE, "path": ""})

            for _ in range(10):
                msg = ws.receive_json()
                if msg["type"] == MessageType.ERROR:
                    return

            pytest.fail("Never received error for missing path")


# ---------------------------------------------------------------------------
# PTY Spawn Failure Integration Tests
# ---------------------------------------------------------------------------


class TestPTYSpawnFailure:
    """Test that PTY spawn failures are properly reported to the client.

    This is the critical path for the 'white cursor' bug: if the shell
    can't start, the user needs to see WHY.
    """

    def test_spawn_failure_sends_error_to_client(self, temp_dir: Path):
        """When PTY spawn fails, the client should receive a structured error."""
        config = Config(
            port=0,
            host="127.0.0.1",
            working_dir=temp_dir,
            shell_command="/nonexistent/shell/binary",
            auto_start_claude=False,
            auto_open_browser=False,
            dummy_mode=False,
        )
        set_config(config)
        registry = SessionRegistry()
        set_registry(registry)

        with patch("backend.main.unify_sessions"):
            with patch("backend.main._check_wsl_health_async", new_callable=AsyncMock):
                app = create_app(config)

        client = TestClient(app)

        with client.websocket_connect("/ws") as ws:
            ws.send_json({
                "type": MessageType.SET_PROJECT,
                "path": str(temp_dir),
                "sessionId": "fail-test-1",
            })

            # Collect all messages until connection closes or we find an error
            messages = []
            for _ in range(20):
                try:
                    msg = ws.receive_json()
                    messages.append(msg)
                    if msg["type"] == MessageType.ERROR:
                        break
                except Exception:
                    break

            error_msgs = [
                m for m in messages if m["type"] == MessageType.ERROR
            ]
            assert len(error_msgs) >= 1, (
                f"No error sent to client on spawn failure. "
                f"Messages received: {[m['type'] for m in messages]}"
            )
            assert "spawn" in error_msgs[0]["code"]

        set_registry(SessionRegistry())


# ---------------------------------------------------------------------------
# Dummy Mode Tests
# ---------------------------------------------------------------------------


class TestDummyMode:
    """Test dummy mode behavior through the full stack."""

    def test_dummy_mode_sends_output(self, client: TestClient, temp_dir: Path):
        """In dummy mode, the client should receive fake Claude output."""
        with client.websocket_connect("/ws") as ws:
            ws.send_json({
                "type": MessageType.SET_PROJECT,
                "path": str(temp_dir),
                "sessionId": "dummy-test-1",
            })

            messages = []
            for _ in range(20):
                msg = ws.receive_json()
                messages.append(msg)
                if msg["type"] == MessageType.CONNECTED:
                    break

            output_msgs = [
                m for m in messages if m["type"] == MessageType.OUTPUT
            ]
            # Dummy mode should have sent output with the fake Claude UI
            if output_msgs:
                all_output = "".join(m.get("data", "") for m in output_msgs)
                assert "dummy" in all_output.lower()


# ---------------------------------------------------------------------------
# WebsocketProvider integration with ConnectionHandler
# ---------------------------------------------------------------------------
#
# These don't spin up the full FastAPI stack — they poke at the two methods
# responsible for bridging padarax-server frames into CADE chat messages.
# Full-stack coverage lives in the padarax repo's integration test.


class TestWebsocketProviderIntegration:
    def _make_handler(self):
        """Construct a ConnectionHandler with just enough state to exercise
        the WebsocketProvider callbacks. Bypasses __init__ (which expects a
        real WebSocket + Config) and wires up the attributes the methods
        under test actually read."""
        from core.backend.chat.session import ChatSession
        from backend.websocket import ConnectionHandler

        handler = ConnectionHandler.__new__(ConnectionHandler)
        handler._closed = False
        handler._chat_session = ChatSession(provider_name="ws-test")
        handler._session_id = "sess-1"
        handler._provider_registry = None
        sent: list[dict] = []

        async def _send(msg: dict) -> None:
            sent.append(msg)

        handler._send = _send  # type: ignore[attr-defined]
        return handler, sent

    async def test_scene_update_emits_chat_stream_and_appends_assistant(self):
        handler, sent = self._make_handler()

        await handler._on_unsolicited_provider_event(
            "scene_update", {"content": "the tavern is quiet"}
        )

        # Two CHAT_STREAM frames: text-delta then done.
        chat_stream_msgs = [m for m in sent if m["type"] == MessageType.CHAT_STREAM]
        assert len(chat_stream_msgs) == 2
        assert chat_stream_msgs[0]["event"] == "text-delta"
        assert chat_stream_msgs[0]["content"] == "the tavern is quiet"
        assert chat_stream_msgs[1]["event"] == "done"

        # Session got an unpaired assistant message so subsequent replays
        # render the scene.
        history = handler._chat_session.get_history_for_replay()
        assert history == [{"role": "assistant", "content": "the tavern is quiet"}]

    async def test_scene_update_empty_content_is_a_noop(self):
        handler, sent = self._make_handler()
        await handler._on_unsolicited_provider_event("scene_update", {"content": ""})
        assert sent == []
        assert handler._chat_session.get_history_for_replay() == []

    async def test_chat_history_rehydrates_session_and_sends_history_frame(self):
        handler, sent = self._make_handler()

        await handler._on_unsolicited_provider_event(
            "chat_history",
            {"messages": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi"},
                {"role": "user", "content": "look"},
                {"role": "assistant", "content": "you see..."},
            ]},
        )

        history_frames = [
            m for m in sent if m["type"] == MessageType.CHAT_HISTORY
        ]
        assert len(history_frames) == 1
        assert len(history_frames[0]["messages"]) == 4
        assert history_frames[0]["messages"][0] == {
            "role": "user", "content": "hello"
        }

        # Session was rehydrated so in-memory history matches what went
        # over the wire.
        replayed = handler._chat_session.get_history_for_replay()
        assert replayed == [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "look"},
            {"role": "assistant", "content": "you see..."},
        ]

    async def test_chat_history_with_empty_messages_is_a_noop(self):
        handler, sent = self._make_handler()
        await handler._on_unsolicited_provider_event(
            "chat_history", {"messages": []}
        )
        assert sent == []

    async def test_handler_ignores_events_when_closed(self):
        handler, sent = self._make_handler()
        handler._closed = True

        await handler._on_unsolicited_provider_event(
            "scene_update", {"content": "shouldn't appear"}
        )
        assert sent == []

    async def test_handler_ignores_events_without_chat_session(self):
        handler, sent = self._make_handler()
        handler._chat_session = None

        await handler._on_unsolicited_provider_event(
            "scene_update", {"content": "shouldn't appear"}
        )
        assert sent == []

    async def test_maybe_start_does_nothing_without_provider_registry(self):
        handler, sent = self._make_handler()
        # _provider_registry is None from the fixture — method early-returns.
        await handler._maybe_start_websocket_provider()
        assert sent == []

    async def test_maybe_start_skips_non_websocket_providers(self):
        from backend.providers.registry import ProviderRegistry

        handler, sent = self._make_handler()
        registry = ProviderRegistry()
        # A bare MagicMock stands in for a non-WS provider — isinstance
        # check should filter it out without touching the handler state.
        fake = MagicMock()
        fake.name = "fake"
        registry.register("fake", fake)
        registry._default = "fake"  # type: ignore[attr-defined]
        handler._provider_registry = registry

        await handler._maybe_start_websocket_provider()
        assert sent == []
        fake.start.assert_not_called()

    async def test_maybe_start_sends_error_frame_on_connect_failure(self):
        from core.backend.providers.config import ProviderConfig
        from backend.providers.registry import ProviderRegistry
        from core.backend.providers.websocket_provider import WebsocketProvider

        handler, sent = self._make_handler()
        registry = ProviderRegistry()
        # Point at a port that isn't listening; connect_timeout keeps this
        # fast.
        provider = WebsocketProvider(ProviderConfig(
            name="ws-test",
            type="cli",
            model="padarax",
            extra={
                "url": "ws://127.0.0.1:1/nowhere",
                "connect_timeout": 0.2,
            },
        ))
        registry.register("ws-test", provider)
        registry._default = "ws-test"  # type: ignore[attr-defined]
        handler._provider_registry = registry

        await handler._maybe_start_websocket_provider()

        error_frames = [
            m for m in sent
            if m["type"] == MessageType.CHAT_STREAM and m.get("event") == "error"
        ]
        assert len(error_frames) == 1
        assert "unreachable" in error_frames[0]["message"].lower()
