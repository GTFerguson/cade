"""PTY session registry for persistent terminal sessions.

Keeps PTY processes alive when WebSocket disconnects, allowing reconnection
to the same session with scrollback history preserved.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from backend.protocol import SessionKey
from backend.pty_manager import PTYManager
from backend.types import TerminalSize
from backend.wsl_health import wait_for_wsl_network

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger(__name__)

# Maximum scrollback buffer size (~512KB)
MAX_SCROLLBACK_SIZE = 512 * 1024

# Regex to match terminal query sequences that cause xterm.js to send responses
# These sequences should be stripped from scrollback before replay
TERMINAL_QUERY_PATTERN = re.compile(
    r"(?:"
    # RIS: Reset to Initial State (ESC c) - triggers DA1 response
    r"\x1bc"
    r"|"
    # CSI sequences
    r"\x1b\[(?:"
    r"\??[0-9]*c|"        # DA1: Primary Device Attributes (CSI c, CSI 0 c, CSI ? 1 c)
    r">[0-9]*c|"          # DA2: Secondary Device Attributes (CSI > c)
    r"=[0-9]*c|"          # DA3: Tertiary Device Attributes (CSI = c)
    r"[0-9]*n|"           # DSR: Device Status Report (CSI 5 n, CSI 6 n)
    r"\?[0-9;]*n|"        # Extended DSR (CSI ? 6 n for DECXCPR, etc.)
    r"[0-9]*;[0-9]*R|"    # CPR: Cursor Position Report response
    r">[0-9]*q|"          # XTVERSION: xterm version query (CSI > q)
    r"\?[0-9]+\$p"        # DECRQM: Request Mode (CSI ? Ps $ p)
    r")"
    r"|"
    # OSC sequences with queries (e.g., OSC 10 ; ? ST for foreground color)
    r"\x1b\][0-9]+;\?\x07"
    r"|"
    r"\x1b\][0-9]+;\?\x1b\\\\"
    r")"
)


@dataclass
class TerminalState:
    """State for a single terminal (claude or manual)."""

    pty: PTYManager
    scrollback: deque[str] = field(default_factory=deque)
    scrollback_size: int = 0
    output_task: asyncio.Task | None = field(default=None, repr=False)

    def capture_output(self, data: str) -> None:
        """Add output to scrollback buffer, trimming if necessary."""
        self.scrollback.append(data)
        self.scrollback_size += len(data)

        while self.scrollback_size > MAX_SCROLLBACK_SIZE and len(self.scrollback) > 1:
            removed = self.scrollback.popleft()
            self.scrollback_size -= len(removed)

    def get_scrollback(self) -> str:
        """Get concatenated scrollback content, sanitized for replay."""
        raw = "".join(self.scrollback)
        return TERMINAL_QUERY_PATTERN.sub("", raw)

    def clear_scrollback(self) -> None:
        """Clear the scrollback buffer."""
        self.scrollback.clear()
        self.scrollback_size = 0


@dataclass
class PTYSession:
    """Represents a persistent PTY session with dual terminal support."""

    id: str
    project_path: Path
    terminals: dict[str, TerminalState] = field(default_factory=dict)
    last_activity: float = field(default_factory=time.time)
    connected_clients: set[WebSocket] = field(default_factory=set)
    created_at: float = field(default_factory=time.time)

    @property
    def pty(self) -> PTYManager:
        """Get the primary (claude) PTY for backwards compatibility."""
        return self.terminals[SessionKey.CLAUDE].pty

    def get_terminal(self, session_key: str) -> TerminalState | None:
        """Get terminal state by session key."""
        return self.terminals.get(session_key)

    def has_terminal(self, session_key: str) -> bool:
        """Check if a terminal exists for the given session key."""
        return session_key in self.terminals

    def add_terminal(self, session_key: str, pty: PTYManager) -> TerminalState:
        """Add a new terminal with the given session key."""
        terminal = TerminalState(pty=pty)
        self.terminals[session_key] = terminal
        return terminal

    def capture_output(self, data: str, session_key: str = SessionKey.CLAUDE) -> None:
        """Add output to the appropriate terminal's scrollback buffer."""
        terminal = self.terminals.get(session_key)
        if terminal:
            terminal.capture_output(data)
        self.last_activity = time.time()

    def get_scrollback(self, session_key: str = SessionKey.CLAUDE) -> str:
        """Get scrollback for a specific terminal."""
        terminal = self.terminals.get(session_key)
        if terminal:
            return terminal.get_scrollback()
        return ""

    def clear_scrollback(self, session_key: str = SessionKey.CLAUDE) -> None:
        """Clear scrollback for a specific terminal."""
        terminal = self.terminals.get(session_key)
        if terminal:
            terminal.clear_scrollback()

    def is_alive(self) -> bool:
        """Check if at least one PTY is alive."""
        return any(t.pty.is_alive() for t in self.terminals.values())


class SessionRegistry:
    """Manages persistent PTY sessions across WebSocket reconnections."""

    def __init__(self, session_max_age: float = 24 * 60 * 60) -> None:
        """Initialize the session registry.

        Args:
            session_max_age: Maximum session age in seconds (default 24 hours)
        """
        self._sessions: dict[str, PTYSession] = {}
        self._session_max_age = session_max_age
        self._cleanup_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        """Start the registry background tasks."""
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("Session registry started (max_age=%ds)", self._session_max_age)

    async def stop(self) -> None:
        """Stop the registry and close all sessions."""
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

        async with self._lock:
            for session in list(self._sessions.values()):
                await self._close_session(session)
            self._sessions.clear()

        logger.info("Session registry stopped")

    async def get_or_create(
        self,
        session_id: str,
        project_path: Path,
        shell_command: str,
        size: TerminalSize | None = None,
        auto_start_claude: bool = False,
        dummy_mode: bool = False,
        network_timeout: float = 15.0,
    ) -> tuple[PTYSession, bool]:
        """Get an existing session or create a new one.

        Args:
            session_id: Unique session identifier (tab UUID from frontend)
            project_path: Working directory for the PTY
            shell_command: Command to spawn in the PTY
            size: Terminal size
            auto_start_claude: Whether to auto-start claude command
            dummy_mode: Whether to run in dummy mode
            network_timeout: Max time to wait for network readiness (seconds)

        Returns:
            Tuple of (session, is_new) where is_new indicates if session was created
        """
        async with self._lock:
            if session_id in self._sessions:
                session = self._sessions[session_id]
                if session.is_alive():
                    logger.info("Reattaching to existing session: %s", session_id)
                    return session, False
                else:
                    logger.info("Session PTY died, recreating: %s", session_id)
                    await self._close_session(session)
                    del self._sessions[session_id]

            session = await self._create_session(
                session_id,
                project_path,
                shell_command,
                size,
                auto_start_claude,
                dummy_mode,
                network_timeout,
            )
            self._sessions[session_id] = session
            logger.info("Created new session: %s at %s", session_id, project_path)
            return session, True

    async def _create_session(
        self,
        session_id: str,
        project_path: Path,
        shell_command: str,
        size: TerminalSize | None,
        auto_start_claude: bool,
        dummy_mode: bool,
        network_timeout: float,
    ) -> PTYSession:
        """Create a new PTY session with the primary (claude) terminal."""
        pty = PTYManager()
        await pty.spawn(
            shell_command,
            project_path,
            size or TerminalSize(cols=80, rows=24),
        )

        session = PTYSession(
            id=session_id,
            project_path=project_path,
        )
        session.add_terminal(SessionKey.CLAUDE, pty)

        if dummy_mode:
            dummy_output = (
                "\x1b[H\x1b[2J"
                "\x1b[38;5;75m ▐▛███▜▌\x1b[0m   Claude Code (dummy mode)\r\n"
                "\x1b[38;5;75m▝▜█████▛▘\x1b[0m  Development UI Preview\r\n"
                "\x1b[38;5;75m  ▘▘ ▝▝\x1b[0m\r\n"
                "\r\n"
                "─────────────────────────────────────────────────────────────────\r\n"
                "\x1b[38;5;245m❯\x1b[0m Dummy mode - no actual Claude running\r\n"
                "─────────────────────────────────────────────────────────────────\r\n"
            )
            session.capture_output(dummy_output, SessionKey.CLAUDE)
        elif auto_start_claude:
            # Wait for shell to be ready
            await asyncio.sleep(0.5)

            # Verify the PTY survived the startup delay
            if not pty.is_alive():
                logger.error(
                    "PTY died during shell startup: command=%s, cwd=%s",
                    shell_command, project_path,
                )
                return session

            # For WSL, ensure network is ready before starting Claude Code
            # This prevents API timeout issues when WSL networking isn't initialized yet
            if "wsl" in shell_command.lower():
                logger.debug("Checking WSL network readiness before starting Claude Code...")
                # Run blocking network check in thread pool to avoid blocking event loop
                loop = asyncio.get_event_loop()
                ready, msg = await loop.run_in_executor(
                    None,
                    wait_for_wsl_network,
                    network_timeout,  # Use configured timeout
                    1.0,   # check_interval
                )
                if ready:
                    logger.info("WSL network ready, starting Claude Code")
                else:
                    logger.warning(
                        "WSL network not ready after %.1fs timeout, starting Claude Code anyway: %s",
                        network_timeout,
                        msg
                    )

            await pty.write("claude\n")

        return session

    async def create_manual_terminal(
        self,
        session_id: str,
        shell_command: str,
        size: TerminalSize | None = None,
    ) -> TerminalState | None:
        """Create the manual terminal for an existing session.

        Args:
            session_id: Session identifier
            shell_command: Command to spawn in the PTY
            size: Terminal size

        Returns:
            The created terminal state, or None if session not found
        """
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None

            if session.has_terminal(SessionKey.MANUAL):
                return session.get_terminal(SessionKey.MANUAL)

            pty = PTYManager()
            await pty.spawn(
                shell_command,
                session.project_path,
                size or TerminalSize(cols=80, rows=24),
            )

            terminal = session.add_terminal(SessionKey.MANUAL, pty)
            logger.info("Created manual terminal for session: %s", session_id)
            return terminal

    async def attach(self, session_id: str, websocket: WebSocket) -> PTYSession | None:
        """Attach a WebSocket to an existing session.

        Args:
            session_id: Session identifier
            websocket: WebSocket to attach

        Returns:
            The session if found, None otherwise
        """
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                session.connected_clients.add(websocket)
                session.last_activity = time.time()
            return session

    async def detach(self, session_id: str, websocket: WebSocket) -> None:
        """Detach a WebSocket from a session.

        Args:
            session_id: Session identifier
            websocket: WebSocket to detach
        """
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                session.connected_clients.discard(websocket)
                session.last_activity = time.time()

    async def remove(self, session_id: str) -> None:
        """Remove and close a session.

        Args:
            session_id: Session identifier to remove
        """
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session is not None:
                await self._close_session(session)
                logger.info("Removed session: %s", session_id)

    def get(self, session_id: str) -> PTYSession | None:
        """Get a session by ID without modifying it."""
        return self._sessions.get(session_id)

    async def _close_session(self, session: PTYSession) -> None:
        """Close a session and all its terminals."""
        for terminal in session.terminals.values():
            if terminal.output_task is not None:
                terminal.output_task.cancel()
                try:
                    await terminal.output_task
                except asyncio.CancelledError:
                    pass
            await terminal.pty.close()

    async def _cleanup_loop(self) -> None:
        """Periodically clean up orphaned sessions."""
        while True:
            try:
                await asyncio.sleep(60)
                await self._cleanup_orphaned()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Error in cleanup loop: %s", e)

    async def _cleanup_orphaned(self) -> None:
        """Remove sessions older than max_age."""
        now = time.time()
        sessions_to_close: list[tuple[str, "Session"]] = []

        # Collect sessions to close while holding lock
        async with self._lock:
            to_remove = []
            for session_id, session in self._sessions.items():
                age = now - session.created_at
                if age > self._session_max_age:
                    to_remove.append(session_id)
                elif not session.is_alive():
                    to_remove.append(session_id)

            # Remove from registry and collect for closure
            for session_id in to_remove:
                session = self._sessions.pop(session_id, None)
                if session is not None:
                    sessions_to_close.append((session_id, session))

        # Close sessions outside the lock to avoid blocking
        for session_id, session in sessions_to_close:
            try:
                age_seconds = now - session.created_at
                await self._close_session(session)
                logger.info(
                    "Cleaned up orphaned session: %s (age=%.0fs, project=%s, alive=%s)",
                    session_id, age_seconds, session.project_path, session.is_alive(),
                )
            except Exception as e:
                logger.error("Error closing orphaned session %s: %s", session_id, e)


# Global registry instance
_registry: SessionRegistry | None = None


def get_registry() -> SessionRegistry:
    """Get the global session registry instance."""
    global _registry
    if _registry is None:
        _registry = SessionRegistry()
    return _registry


def set_registry(registry: SessionRegistry) -> None:
    """Set the global session registry instance."""
    global _registry
    _registry = registry
