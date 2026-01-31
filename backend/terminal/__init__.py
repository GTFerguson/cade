"""Terminal management: PTY lifecycle, sessions, and connection broadcasting."""

from backend.terminal.connections import ConnectionManager, get_connection_manager
from backend.terminal.pty import BasePTY, PTYManager, UnixPTY
from backend.terminal.sessions import (
    PTYSession,
    SessionRegistry,
    TerminalState,
    get_registry,
    set_registry,
)

__all__ = [
    "BasePTY",
    "ConnectionManager",
    "PTYManager",
    "PTYSession",
    "SessionRegistry",
    "TerminalState",
    "UnixPTY",
    "get_connection_manager",
    "get_registry",
    "set_registry",
]
