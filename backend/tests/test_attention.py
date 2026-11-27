"""Tests for agent attention state: hook mapping, session resolution,
clearing on input, and the HTTP route that hooks post to."""

from __future__ import annotations

import asyncio
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
    PERMISSION,
    QUESTION,
    WORKING,
    AttentionEvent,
    TitleScanner,
    apply_attention,
    attention_after_keystroke,
    attention_from_event,
    attention_kind,
    attention_message,
    ensure_working_watch,
    is_user_typing,
    next_attention,
    resolve_session,
    title_transition,
)
from backend.terminal.sessions import PTYSession, SessionRegistry, set_registry
from backend.tests.test_multi_client_attach import attach_handler, make_pty, sent


class TestMapping:
    @pytest.mark.parametrize(
        "event,kind,expected",
        [
            ("Notification", "permission_prompt", NEEDS_INPUT),
            ("Notification", "elicitation_dialog", NEEDS_INPUT),
            ("Notification", "idle_prompt", IDLE),
            ("Notification", "auth_success", False),
            ("Stop", None, IDLE),
            ("UserPromptSubmit", None, WORKING),
            ("PostToolUse", None, WORKING),
            ("agent-turn-complete", None, IDLE),
            ("SomethingElse", None, False),
        ],
    )
    def test_hook_events_map_to_states(self, event, kind, expected):
        e = AttentionEvent(session_id="s", cwd=None, event=event, notification_type=kind)
        assert attention_from_event(e) == expected


class TestKind:
    @pytest.mark.parametrize(
        "event,kind,expected",
        [
            ("Notification", "permission_prompt", PERMISSION),
            ("Notification", "elicitation_dialog", QUESTION),
            ("Notification", "idle_prompt", None),
            ("Stop", None, None),
            ("input", None, None),
        ],
    )
    def test_hook_events_say_what_a_waiting_agent_wants(self, event, kind, expected):
        e = AttentionEvent(session_id="s", cwd=None, event=event, notification_type=kind)
        assert attention_kind(e) == expected


class TestTransitions:
    def _event(self, name: str) -> AttentionEvent:
        return AttentionEvent(session_id="s", cwd=None, event=name)

    def test_finished_tool_call_resumes_working(self):
        assert next_attention(None, self._event("PostToolUse")) == WORKING

    def test_finished_tool_call_does_not_hide_a_pending_prompt(self):
        assert next_attention(NEEDS_INPUT, self._event("PostToolUse")) is False

    def test_stop_ends_a_working_turn(self):
        assert next_attention(WORKING, self._event("Stop")) == IDLE

    def _idle_reminder(self) -> AttentionEvent:
        return AttentionEvent(
            session_id="s", cwd=None, event="Notification", notification_type="idle_prompt"
        )

    @pytest.mark.parametrize("current", [IDLE, NEEDS_INPUT, None])
    def test_idle_reminder_says_nothing_new(self, current):
        """Claude Code sends it a minute after every turn that ends unanswered.

        It is not a question: a finished tab stays finished, a real prompt
        stays a prompt, and a tab the user has already looked at stays clear.
        """
        assert next_attention(current, self._idle_reminder()) is False

    def test_idle_reminder_ends_a_turn_whose_stop_was_missed(self):
        assert next_attention(WORKING, self._idle_reminder()) == IDLE

    @pytest.mark.parametrize(
        "current,expected",
        [(NEEDS_INPUT, None), (IDLE, None), (None, None), (WORKING, WORKING)],
    )
    def test_keystroke_clears_waiting_states_but_not_a_running_turn(self, current, expected):
        assert attention_after_keystroke(current) == expected


class TestWorkingWatch:
    @pytest.mark.asyncio
    async def test_working_is_dropped_once_the_terminal_goes_quiet(self, temp_dir: Path):
        session = PTYSession(id="quiet", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        apply_attention(session, WORKING, None)
        with (
            patch("backend.terminal.attention.WORKING_POLL_SECONDS", 0.01),
            patch("backend.terminal.attention.WORKING_SILENCE_SECONDS", 0.03),
        ):
            ensure_working_watch(session)
            await asyncio.sleep(0.2)
        assert session.attention is None

    @pytest.mark.asyncio
    async def test_working_survives_while_output_keeps_coming(self, temp_dir: Path):
        session = PTYSession(id="busy", project_path=temp_dir)
        terminal = session.add_terminal(SessionKey.CLAUDE, make_pty())
        apply_attention(session, WORKING, None)
        with (
            patch("backend.terminal.attention.WORKING_POLL_SECONDS", 0.01),
            patch("backend.terminal.attention.WORKING_SILENCE_SECONDS", 0.05),
        ):
            ensure_working_watch(session)
            for _ in range(15):
                terminal.publish("spinner frame")
                await asyncio.sleep(0.01)
            assert session.attention == WORKING
            # Let the watcher finish so it does not outlive the test.
            await asyncio.sleep(0.2)
        assert session.attention is None


class TestTitleScanner:
    def test_reads_bel_and_st_terminated_titles(self):
        scanner = TitleScanner()
        assert scanner.feed("a\x1b]0;first\x07b\x1b]2;second\x1b\\c") == ["first", "second"]

    def test_title_split_across_chunks_is_reassembled(self):
        scanner = TitleScanner()
        assert scanner.feed("output\x1b]0;[ ! ] Action") == []
        assert scanner.feed(" Required\x07more") == ["[ ! ] Action Required"]

    def test_escape_split_from_its_introducer(self):
        scanner = TitleScanner()
        assert scanner.feed("output\x1b") == []
        assert scanner.feed("]0;late\x07") == ["late"]

    def test_other_osc_sequences_are_not_titles(self):
        scanner = TitleScanner()
        assert scanner.feed("\x1b]8;;http://x\x07link\x1b]8;;\x07") == []

    def test_an_unterminated_sequence_does_not_grow_without_bound(self):
        scanner = TitleScanner()
        scanner.feed("\x1b]0;" + "x" * 10_000)
        assert scanner.feed("\x1b]0;ok\x07") == ["ok"]


class TestTitleTransition:
    @pytest.mark.parametrize("title", ["[ ! ] Action Required", "[ . ] Action Required"])
    def test_codex_prompt_title_means_needs_input(self, title):
        assert title_transition(False, title, None) == (True, NEEDS_INPUT)
        assert title_transition(False, title, WORKING) == (True, NEEDS_INPUT)

    def test_prompt_title_followed_by_the_thread_name_means_needs_input(self):
        # Codex joins its title items, so the prompt marker is followed by
        # the thread name.
        title = "[ ! ] Action Required | Review maker checklist"
        assert title_transition(False, title, None) == (True, NEEDS_INPUT)

    def test_a_thread_merely_named_like_the_prompt_is_a_session_name(self):
        assert title_transition(False, "Action required fields in the form", None) == (False, False)

    def test_prompt_title_is_reasserted_after_a_keystroke_cleared_it(self):
        # Arrow keys inside the prompt clear the state; the blinking title
        # arrives again and must put it back.
        assert title_transition(True, "[ . ] Action Required", None) == (True, NEEDS_INPUT)

    def test_leaving_the_prompt_resumes_the_turn(self):
        assert title_transition(True, "⠋ fix the tabs", NEEDS_INPUT) == (False, WORKING)
        assert title_transition(True, "⠋ fix the tabs", None) == (False, WORKING)

    def test_leaving_the_prompt_does_not_undo_a_finished_turn(self):
        assert title_transition(True, "fix the tabs", IDLE) == (False, False)

    def test_ordinary_titles_leave_a_hook_set_prompt_alone(self):
        # Claude Code keeps retitling while its own permission prompt is open.
        assert title_transition(False, "✳ fix the tabs", NEEDS_INPUT) == (False, False)
        assert title_transition(False, "✳ fix the tabs", WORKING) == (False, False)


class TestTitleDrivenAttention:
    @staticmethod
    def pty_emitting(chunks: list[str]) -> AsyncMock:
        pty = make_pty()

        async def read():
            for chunk in chunks:
                yield chunk
                await asyncio.sleep(0)
            await asyncio.sleep(3600)

        pty.read = read
        return pty

    @pytest.mark.asyncio
    async def test_agent_terminal_title_sets_needs_input_and_pushes_once(self, temp_dir: Path):
        session = PTYSession(id="codex", project_path=temp_dir, label="cade")
        pty = self.pty_emitting([
            "\x1b]0;[ ! ] Action Required\x07",
            "\x1b]0;[ . ] Action Required\x07",
            "\x1b]0;[ ! ] Action Required\x07",
        ])
        with patch("backend.push.PushService.send", new_callable=AsyncMock) as send:
            terminal = session.add_terminal(SessionKey.CLAUDE, pty)
            terminal.ensure_reader()
            await asyncio.sleep(0.05)
            terminal.output_task.cancel()
        assert session.attention == NEEDS_INPUT
        assert session.attention_kind == PERMISSION
        assert send.await_count == 1
        assert send.await_args.args[0]["title"] == "cade: needs you"

    @pytest.mark.asyncio
    async def test_title_moving_on_marks_the_session_working(self, temp_dir: Path):
        session = PTYSession(id="codex", project_path=temp_dir)
        pty = self.pty_emitting([
            "\x1b]0;[ ! ] Action Required\x07",
            "\x1b]0;⠋ fix the tabs\x07",
        ])
        with patch("backend.push.PushService.send", new_callable=AsyncMock):
            terminal = session.add_terminal(SessionKey.CLAUDE, pty)
            terminal.ensure_reader()
            await asyncio.sleep(0.05)
            terminal.output_task.cancel()
        assert session.attention == WORKING
        apply_attention(session, None, None)  # stop the silence watcher

    @pytest.mark.asyncio
    async def test_manual_shell_titles_are_ignored(self, temp_dir: Path):
        session = PTYSession(id="shell", project_path=temp_dir)
        pty = self.pty_emitting(["\x1b]0;Action Required\x07"])
        terminal = session.add_terminal(SessionKey.MANUAL, pty)
        terminal.ensure_reader()
        await asyncio.sleep(0.05)
        terminal.output_task.cancel()
        assert session.attention is None


class TestUserTyping:
    """Input reaches a session from the terminal emulator as well as the user."""

    @pytest.mark.parametrize(
        "data",
        [
            "\x1b[I",                    # terminal gained focus
            "\x1b[O",                    # terminal lost focus
            "\x1b[12;40R",               # cursor position report
            "\x1b[?1;2c",                # device attributes
            "\x1b[>0;276;0c",            # secondary device attributes
            "\x1b[0n",                   # device status
            "\x1b[?2026;2$y",            # mode report
            "\x1b[?1u",                  # keyboard protocol report
            "\x1b[8;24;80t",             # window size report
            "\x1b]11;rgb:0a0a/0a0a/0909\x1b\\",  # background colour reply
            "\x1b]10;rgb:f8f8/f6f6/f2f2\x07",    # foreground colour reply
            "\x1bP>|xterm.js(5.5.0)\x1b\\",      # terminal version reply
            "\x1b[<0;10;5M",             # mouse press
            "\x1b[<0;10;5m",             # mouse release
            "\x1b[<64;10;5M",            # wheel
            "\x1b[I\x1b[12;40R",         # several in one write
            "",
        ],
    )
    def test_terminal_reports_are_not_typing(self, data):
        assert is_user_typing(data) is False

    @pytest.mark.parametrize(
        "data",
        ["y", "\r", "hello", "\x1b", "\x1b[A", "\x1b[B", "\x03", "\t", "1", "\x1b[I y", "\x1b[13;2u"],
    )
    def test_keys_are_typing(self, data):
        assert is_user_typing(data) is True


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


    def test_kind_is_kept_only_while_waiting(self, temp_dir: Path):
        s = PTYSession(id="a", project_path=temp_dir)
        apply_attention(s, NEEDS_INPUT, "Allow Bash?", PERMISSION)
        assert s.attention_kind == PERMISSION
        assert attention_message(s)["kind"] == PERMISSION
        apply_attention(s, IDLE, None, PERMISSION)
        assert s.attention_kind is None

    def test_a_new_kind_is_a_change(self, temp_dir: Path):
        s = PTYSession(id="a", project_path=temp_dir)
        apply_attention(s, NEEDS_INPUT, "Waiting", None)
        assert apply_attention(s, NEEDS_INPUT, "Waiting", QUESTION) is True

    def test_the_same_wait_keeps_its_place(self, temp_dir: Path):
        s = PTYSession(id="a", project_path=temp_dir)
        apply_attention(s, NEEDS_INPUT, "Allow Bash?", PERMISSION)
        since = s.attention_at
        apply_attention(s, NEEDS_INPUT, "Allow Edit?", PERMISSION)
        assert s.attention_at == since
        apply_attention(s, IDLE, None)
        assert s.attention_at >= since


class TestRename:
    def test_set_label_renames_the_session(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        handler = attach_handler(session, temp_dir)
        handler._handle_set_label({"label": "  api server  "})
        assert session.label == "api server"

    def test_blank_label_clears_it(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir, label="old")
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        handler = attach_handler(session, temp_dir)
        handler._handle_set_label({"label": "   "})
        assert session.label is None


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
    async def test_switching_to_a_tab_does_not_clear_its_status(self, temp_dir: Path):
        # The terminal reports gaining focus by writing to the session; that
        # is not the user answering anything.
        session = PTYSession(id="s", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        apply_attention(session, NEEDS_INPUT, "Allow?")
        h = attach_handler(session, temp_dir)
        await h._handle_input({"type": MessageType.INPUT, "data": "\x1b[I"})
        assert session.attention == NEEDS_INPUT
        apply_attention(session, IDLE, None)
        await h._handle_input({"type": MessageType.INPUT, "data": "\x1b[O\x1b[12;40R"})
        assert session.attention == IDLE

    async def test_input_does_not_end_a_running_turn(self, temp_dir: Path):
        session = PTYSession(id="s", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        apply_attention(session, WORKING, None)
        h = attach_handler(session, temp_dir)

        await h._handle_input({"type": MessageType.INPUT, "data": "queued follow-up"})

        assert session.attention == WORKING

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
        assert session.attention_kind == PERMISSION
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
        listed = res.json()["sessions"][0]
        assert listed["attention"] == IDLE
        assert listed["attentionKind"] is None
        assert listed["attentionAt"] == session.attention_at

    def test_ending_a_session_nothing_is_attached_to(self, api_client, temp_dir: Path):
        client, registry = api_client
        session = PTYSession(id="left", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        registry._sessions["left"] = session
        assert client.delete("/api/sessions/left").json() == {"status": "ended"}
        assert registry.get("left") is None

    def test_a_session_attached_to_a_tab_is_not_ended(self, api_client, temp_dir: Path):
        client, registry = api_client
        session = PTYSession(id="live", project_path=temp_dir)
        session.add_terminal(SessionKey.CLAUDE, make_pty())
        session.connected_clients.add(object())
        registry._sessions["live"] = session
        assert client.delete("/api/sessions/live").status_code == 409
        assert registry.get("live") is session

    def test_ending_an_unknown_session_is_404(self, api_client):
        client, _ = api_client
        assert client.delete("/api/sessions/nope").status_code == 404

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
