"""Per-session attention state: does the agent need the user right now?

Fed by agent hooks (Claude Code's Notification/Stop/UserPromptSubmit, Codex's
notify) that POST to the backend. The state is what the phone's session
strip pulses on and what a push notification is sent for. Any keystroke
into the session clears it: the user is evidently dealing with it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

# States, in order of urgency.
NEEDS_INPUT = "input"   # permission prompt, question, idle prompt
IDLE = "idle"           # turn finished; ready for the next prompt
WORKING = None          # nothing to report


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
    if name == "UserPromptSubmit":
        return WORKING
    if name == "agent-turn-complete":  # Codex notify
        return IDLE
    if name in ("working", "idle", "input", "clear"):  # explicit API callers
        return {"working": WORKING, "idle": IDLE, "input": NEEDS_INPUT, "clear": WORKING}[name]
    return False


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
