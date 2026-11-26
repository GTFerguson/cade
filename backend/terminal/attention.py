"""Per-session attention state: what is the agent doing, and does it need the user?

Fed by agent hooks (Claude Code's Notification/Stop/UserPromptSubmit/
PostToolUse, Codex's notify) that POST to the backend, and by the title the
agent sets on its terminal, which is the only place Codex reports that it is
waiting on an approval. The state is what the
desktop tabs and the phone's session strip show and what a push notification
is sent for. A keystroke into the session clears a waiting or finished state:
the user is evidently dealing with it. Looking at the session does not.
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from pathlib import Path

# States, in order of urgency.
NEEDS_INPUT = "input"   # permission prompt or question
IDLE = "idle"           # turn finished; ready for the next prompt
WORKING = "working"     # the agent is in the middle of a turn

# Claude Code's notification that its prompt has sat unanswered. It follows
# every finished turn, question or not, so it is not a sign the agent needs
# anything: treated as a prompt it turned each finished tab into a waiting
# one. Its one use is to end a turn whose Stop never arrived.
IDLE_REMINDER = "idle_prompt"
CLEAR = None            # nothing to report

# A working agent redraws its spinner continuously. No hook fires when the
# user interrupts a turn, so silence is the only sign that one ended early:
# after this long without terminal output a "working" state is dropped.
WORKING_SILENCE_SECONDS = 10.0
WORKING_POLL_SECONDS = 2.0

# Codex's notify command fires only when a turn completes. While it waits on
# an approval it retitles the terminal instead, blinking a glyph in front of
# this text.
CODEX_PROMPT_TITLE = "action required"
# The marker opens the title and is either all of it or set off from the
# other title items (thread name, project) by a separator. A thread that is
# merely named "Action required ..." runs straight on into more words.
_PROMPT_TITLE = re.compile(
    rf"^[\W_]*{re.escape(CODEX_PROMPT_TITLE)}\s*(?:$|[^\w\s])", re.IGNORECASE
)

# OSC 0 (icon + title) and OSC 2 (title), ended by BEL or ST.
_TITLE_SEQUENCE = re.compile(r"\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)")
# A title sequence cut off by the end of a chunk, down to a lone ESC.
_PARTIAL_TITLE = re.compile(r"\x1b(?:\](?:[02](?:;[^\x07\x1b]*\x1b?)?)?)?\Z")
# Longer than any real title; an unterminated sequence past this is dropped
# so a stream that never closes one cannot grow the carry buffer.
MAX_PARTIAL_TITLE = 512


class TitleScanner:
    """Pulls terminal titles out of PTY output, across chunk boundaries."""

    def __init__(self) -> None:
        self._carry = ""

    def feed(self, data: str) -> list[str]:
        text = self._carry + data
        titles = [m.group(1) for m in _TITLE_SEQUENCE.finditer(text)]
        partial = _PARTIAL_TITLE.search(text)
        tail = partial.group(0) if partial else ""
        self._carry = tail if len(tail) <= MAX_PARTIAL_TITLE else ""
        return titles


def title_transition(
    was_prompting: bool, title: str, current: str | None
) -> tuple[bool, str | None | bool]:
    """What a new terminal title means for a session's attention.

    Returns whether the title is an approval prompt, and the state to move
    to (False to leave it alone). Only a title that is a prompt, or the first
    title after one, says anything: every other title is a session name.
    """
    prompting = _PROMPT_TITLE.match(title) is not None
    if prompting:
        return True, NEEDS_INPUT
    # The prompt was answered and the turn carries on. A turn that ended
    # instead has already reported itself finished; leave that standing.
    if was_prompting and current in (NEEDS_INPUT, CLEAR):
        return False, WORKING
    return False, False


@dataclass(frozen=True)
class AttentionEvent:
    """Normalised hook payload from any agent."""

    session_id: str | None
    cwd: str | None
    event: str
    notification_type: str | None = None
    message: str | None = None


def attention_from_event(event: AttentionEvent) -> str | None | bool:
    """Map a hook event to a state. Returns False when the event means nothing."""
    name = event.event
    if name == "Notification":
        kind = (event.notification_type or "").lower()
        if kind in ("permission_prompt", "elicitation_dialog"):
            return NEEDS_INPUT
        if kind == IDLE_REMINDER:
            return IDLE
        return False
    if name == "Stop":
        return IDLE
    if name in ("UserPromptSubmit", "PostToolUse"):
        return WORKING
    if name == "agent-turn-complete":  # Codex notify
        return IDLE
    if name in ("working", "idle", "input", "clear"):  # explicit API callers
        return {"working": WORKING, "idle": IDLE, "input": NEEDS_INPUT, "clear": CLEAR}[name]
    return False


def next_attention(current: str | None, event: AttentionEvent) -> str | None | bool:
    """The state a session moves to on a hook event; False to leave it alone.

    A finished tool call means the turn is still going, but it must not hide
    a prompt: with tools running in parallel one can finish while another is
    still waiting on a permission answer.
    """
    state = attention_from_event(event)
    if event.event == "PostToolUse" and current == NEEDS_INPUT:
        return False
    if (event.notification_type or "").lower() == IDLE_REMINDER and current != WORKING:
        return False
    return state


# What a terminal emulator writes to a session on its own: focus changes,
# answers to the agent's queries (cursor position, device attributes, mode
# and keyboard-protocol state, window size, colours, version), and mouse
# reports. Both agents ask for focus events, so merely switching to a tab
# sends one.
_TERMINAL_REPORT = re.compile(
    r"\x1b\[[IO]"
    r"|\x1b\[\d+;\d+R"
    r"|\x1b\[[?>][\d;]*c"
    r"|\x1b\[\d*n"
    r"|\x1b\[\?[\d;]*\$y"
    r"|\x1b\[\?\d+u"
    r"|\x1b\[[\d;]*t"
    r"|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"
    r"|\x1bP[^\x1b]*\x1b\\"
    r"|\x1b\[<[\d;]+[Mm]"
    r"|\x1b\[M[\s\S]{3}"
)


def is_user_typing(data: str) -> bool:
    """Whether input to a session contains anything the user typed."""
    return bool(_TERMINAL_REPORT.sub("", data))


def attention_after_keystroke(current: str | None) -> str | None:
    """Typing answers a prompt or starts the next one; it does not stop a turn."""
    return WORKING if current == WORKING else CLEAR


def resolve_session(sessions: list, session_id: str | None, cwd: str | None):
    """Find the session a hook is talking about.

    Prefer the id CADE injected into the agent's environment. Fall back to
    the project directory when exactly one live session runs there, which
    covers agents launched without the env (a plain shell) and Codex notify.
    """
    if session_id:
        for s in sessions:
            if s.id == session_id:
                return s
    if cwd:
        try:
            target = Path(cwd).resolve()
        except OSError:
            return None
        matches = [s for s in sessions if s.project_path.resolve() == target]
        if len(matches) == 1:
            return matches[0]
    return None


def attention_message(session) -> dict:
    """The WebSocket frame describing a session's attention state."""
    return {
        "type": "session-attention",
        "sessionId": session.id,
        "attention": session.attention,
        "message": session.attention_message,
    }


async def broadcast_attention(session) -> None:
    """Tell every client attached to the session where the agent stands."""
    frame = attention_message(session)
    for ws in list(session.connected_clients):
        try:
            await ws.send_json(frame)
        except Exception:  # noqa: BLE001 — a dying peer is its own handler's problem
            pass


def apply_attention(session, state: str | None, message: str | None) -> bool:
    """Set a session's attention; returns True when it changed."""
    if session.attention == state and (state is None or session.attention_message == message):
        return False
    session.attention = state
    session.attention_message = message if state is not None else None
    session.attention_at = time.time()
    return True


async def announce_attention(
    session, state: str | None, message: str | None, *, push: bool = True
) -> bool:
    """Move a session to a state and tell everyone who should hear of it.

    Attached clients get the new state; subscribed phones get a notification
    when the agent is waiting or finished. Returns True when the state changed.
    """
    if not apply_attention(session, state, message):
        return False
    await broadcast_attention(session)
    ensure_working_watch(session)
    if push and state in (NEEDS_INPUT, IDLE):
        from backend.config import get_config
        from backend.push import get_push_service

        label = session.label or session.project_path.name
        await get_push_service().send({
            "title": f"{label}: needs you" if state == NEEDS_INPUT else f"{label}: done",
            "body": (message or "")[:200],
            "tag": f"cade-{session.id}",
            "sessionId": session.id,
            "url": f"{get_config().root_path}/",
        })
    return True


# Announcements started from the PTY reader, held so they are not collected
# before they finish.
_title_announcements: set[asyncio.Task] = set()


class AgentTitleWatch:
    """Follows the agent terminal's title for prompts no hook reports."""

    def __init__(self, session) -> None:
        self._session = session
        self._scanner = TitleScanner()
        self._prompting = False

    def feed(self, data: str) -> None:
        for title in self._scanner.feed(data):
            was_prompting = self._prompting
            self._prompting, state = title_transition(was_prompting, title, self._session.attention)
            if state is False:
                continue
            # The prompt title blinks, and a keystroke inside the prompt
            # clears the state until the next blink restores it. Only the
            # prompt first appearing is worth a notification.
            task = asyncio.create_task(
                announce_attention(
                    self._session,
                    state,
                    "Waiting for approval" if state == NEEDS_INPUT else None,
                    push=not was_prompting,
                )
            )
            _title_announcements.add(task)
            task.add_done_callback(_title_announcements.discard)


_working_watchers: dict[str, asyncio.Task] = {}


def _output_position(session) -> int:
    """Total output chunks the session's terminals have produced so far."""
    return sum(t.last_seq for t in session.terminals.values())


async def _watch_working(session) -> None:
    last = _output_position(session)
    quiet_since = time.monotonic()
    while session.attention == WORKING:
        await asyncio.sleep(WORKING_POLL_SECONDS)
        position = _output_position(session)
        if position != last:
            last = position
            quiet_since = time.monotonic()
        elif time.monotonic() - quiet_since >= WORKING_SILENCE_SECONDS:
            if session.attention == WORKING and apply_attention(session, CLEAR, None):
                await broadcast_attention(session)
            return


def ensure_working_watch(session) -> None:
    """Make sure a working session is watched for going quiet.

    Called wherever a session may be found in the working state: when a hook
    sets it, and when a client attaches (the state survives an in-place
    upgrade, the watcher task does not).
    """
    if session.attention != WORKING:
        return
    task = _working_watchers.get(session.id)
    if task is not None and not task.done():
        return
    task = asyncio.create_task(_watch_working(session))
    _working_watchers[session.id] = task
    task.add_done_callback(
        lambda t, sid=session.id: _working_watchers.pop(sid, None)
        if _working_watchers.get(sid) is t
        else None
    )
