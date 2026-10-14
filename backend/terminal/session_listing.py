"""Describe the live PTY sessions on this backend.

Tabs are owned by whichever browser created them, so a second device has no
way to find the sessions already running here. This listing is what a phone
(or a desktop after clearing its storage) uses to adopt them.
"""

from __future__ import annotations

from backend.terminal.sessions import PTYSession, SessionRegistry


def describe_session(session: PTYSession, agent_id: str) -> dict:
    terminals = {}
    for key, terminal in session.terminals.items():
        terminals[key] = {
            "alive": terminal.pty.is_alive(),
            "exited": terminal.exited,
            "cols": terminal.size.cols if terminal.size else None,
            "rows": terminal.size.rows if terminal.size else None,
            "lastSeq": terminal.last_seq,
            "controller": terminal.controller,
        }
    return {
        "id": session.id,
        "label": session.label,
        "projectPath": str(session.project_path),
        "agent": agent_id,
        "createdAt": session.created_at,
        "lastActivity": session.last_activity,
        "alive": session.is_alive(),
        "clients": len(session.connected_clients),
        "attention": session.attention,
        "attentionMessage": session.attention_message,
        "terminals": terminals,
    }


def describe_sessions(registry: SessionRegistry, agent_id: str) -> list[dict]:
    sessions = [describe_session(s, agent_id) for s in registry.sessions()]
    sessions.sort(key=lambda s: s["lastActivity"], reverse=True)
    return sessions
