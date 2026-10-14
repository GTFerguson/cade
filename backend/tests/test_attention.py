"""Tests for agent attention state: hook mapping, session resolution,
clearing on input, and the HTTP route that hooks post to."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.config import Config, set_config
from backend.main import create_app
from backend.protocol import MessageType, SessionKey
from backend.push import PushService, set_push_service
from backend.terminal.attention import (
    IDLE,
    NEEDS_INPUT,
    AttentionEvent,
    apply_attention,
    attention_from_event,
    resolve_session,
)
from backend.terminal.sessions import PTYSession, SessionRegistry, set_registry
from backend.tests.test_multi_client_attach import attach_handler, make_pty, sent


class TestMapping:
    @pytest.mark.parametrize(
        "event,kind,expected",
        [
            ("Notification", "permission_prompt", NEEDS_INPUT),
            ("Notification", "idle_prompt", NEEDS_INPUT),
            ("Notification", "auth_success", False),
            ("Stop", None, IDLE),
            ("UserPromptSubmit", None, None),
            ("agent-turn-complete", None, IDLE),
            ("SomethingElse", None, False),
        ],
    )
    def test_hook_events_map_to_states(self, event, kind, expected):
        e = AttentionEvent(session_id="s", cwd=None, event=event, notification_type=kind)
        assert attention_from_event(e) == expected


class TestResolve:
    def test_prefers_session_id(self, temp_dir: Path):
        a = PTYSession(id="a", project_path=temp_dir)
        b = PTYSession(id="b", project_path=temp_dir)
        assert resolve_session([a, b], "b", str(temp_dir)) is b

    def test_falls_back_to_unique_cwd(self, temp_dir: Path):
        other = temp_dir / "other"
        other.mkdir()
        a = PTYSession(id="a", project_path=temp_dir)
        b = PTYSession(id="b", project_path=other)
        assert resolve_session([a, b], None, str(other)) is b

    def test_ambiguous_cwd_resolves_nothing(self, temp_dir: Path):
        a = PTYSession(id="a", project_path=temp_dir)
        b = PTYSession(id="b", project_path=temp_dir)
        assert resolve_session([a, b], None, str(temp_dir)) is None


class TestApply:
    def test_reports_change_only_when_state_moves(self, temp_dir: Path):
        s = PTYSession(id="a", project_path=temp_dir)
        assert apply_attention(s, NEEDS_INPUT, "Allow Bash?") is True
        assert apply_attention(s, NEEDS_INPUT, "Allow Bash?") is False
        assert apply_attention(s, None, None) is True
        assert s.attention_message is None


class TestHandler:
    @pytest.mark.asyncio
    async def test_input_clears_attention_and_tells_everyone(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        apply_attention(session, NEEDS_INPUT, "Allow?")
        desktop = attach_handler(session, temp_dir)
        phone = attach_handler(session, temp_dir)

        await phone._handle_input({"type": MessageType.INPUT, "data": "y"})

        assert session.attention is None
        for h in (desktop, phone):
            frames = sent(h._ws, MessageType.SESSION_ATTENTION)
            assert frames[-1]["attention"] is None

    @pytest.mark.asyncio
    async def test_joining_client_learns_current_attention(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        apply_attention(session, IDLE, "done")
        h = attach_handler(session, temp_dir)
        await h._attach_terminal(SessionKey.CLAUDE)
        frame = sent(h._ws, MessageType.SESSION_ATTENTION)[0]
        assert frame["attention"] == IDLE
        assert frame["message"] == "done"
        await h._cleanup()


@pytest.fixture
def api_client(temp_dir: Path):
    config = Config(
        port=0, host="127.0.0.1", working_dir=temp_dir, shell_command="bash",
        auto_start_claude=False, auto_open_browser=False, dummy_mode=True,
    )
    set_config(config)
    registry = SessionRegistry()
    set_registry(registry)
    set_push_service(PushService(temp_dir / "push"))
    with patch("backend.main.unify_sessions"), patch(
        "backend.main._check_wsl_health_async", new_callable=AsyncMock
    ):
        app = create_app(config)
        yield TestClient(app), registry
    set_registry(SessionRegistry())
    set_push_service(None)


class TestRoute:
    def test_unknown_session_is_404(self, api_client):
        client, _ = api_client
        res = client.post("/api/sessions/attention", json={"session_id": "nope", "event": "Stop"})
        assert res.status_code == 404

    def test_sets_state_and_pushes_for_needs_input(self, api_client, temp_dir: Path):
        client, registry = api_client
        session = PTYSession(id="live", project_path=temp_dir, label="cade")
        registry._sessions["live"] = session

        with patch("backend.push.PushService.send", new_callable=AsyncMock) as send:
            res = client.post("/api/sessions/attention", json={
                "session_id": "live", "event": "Notification",
                "notification_type": "permission_prompt", "message": "Allow Bash?",
            })
        assert res.json() == {"status": "ok", "attention": NEEDS_INPUT}
        assert session.attention == NEEDS_INPUT
        payload = send.await_args.args[0]
        assert payload["title"] == "cade: needs you"
        assert payload["sessionId"] == "live"

    def test_irrelevant_event_is_ignored(self, api_client):
        client, _ = api_client
        res = client.post("/api/sessions/attention", json={"event": "PreToolUse"})
        assert res.json() == {"status": "ignored"}

    def test_listing_includes_attention(self, api_client, temp_dir: Path):
        client, registry = api_client
        session = PTYSession(id="live", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        apply_attention(session, IDLE, None)
        registry._sessions["live"] = session
        res = client.get("/api/sessions")
        assert res.json()["sessions"][0]["attention"] == IDLE

    def test_push_subscribe_roundtrip(self, api_client):
        client, _ = api_client
        res = client.post("/api/push/subscribe", json={
            "subscription": {"endpoint": "https://push/x", "keys": {"p256dh": "a", "auth": "b"}},
            "device": "phone",
        })
        assert res.json()["subscriptions"] == 1
        assert client.get("/api/push/status").json()["subscriptions"] == 1
        res = client.post("/api/push/unsubscribe", json={"endpoint": "https://push/x"})
        assert res.json()["subscriptions"] == 0
