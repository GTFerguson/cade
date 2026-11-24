"""Per-session attention state: what is the agent doing, and does it need the user?

Fed by agent hooks (Claude Code's Notification/Stop/UserPromptSubmit/
PostToolUse, Codex's notify) that POST to the backend. The state is what the
desktop tabs and the phone's session strip show and what a push notification
is sent for. A keystroke into the session clears a waiting or finished state:
the user is evidently dealing with it.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from pathlib import Path

# States, in order of urgency.
NEEDS_INPUT = "input"   # permission prompt, question, idle prompt
IDLE = "idle"           # turn finished; ready for the next prompt
WORKING = "working"     # the agent is in the middle of a turn
CLEAR = None            # nothing to report

# A working agent redraws its spinner continuously. No hook fires when the
# user interrupts a turn, so silence is the only sign that one ended early:
# after this long without terminal output a "working" state is dropped.
WORKING_SILENCE_SECONDS = 10.0
WORKING_POLL_SECONDS = 2.0


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
        # Claude Code: permission_prompt / idle_prompt (plus auth, etc.)
        kind = (event.notification_type or "").lower()
        if kind in ("permission_prompt", "idle_prompt", "elicitation_dialog"):
            return NEEDS_INPUT
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
    return state


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
