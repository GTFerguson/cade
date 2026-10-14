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
from backend.terminal.pty import PTYManager
from backend.models import TerminalSize

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
    r"\x1b\][0-9]+;\?\x1b\\"
    r"|"
    # OSC 52 clipboard writes/queries (BEL or ST terminated). The frontend
    # forwards these to the system clipboard, so replaying them on reconnect
    # would silently overwrite the user's clipboard with stale content.
    r"\x1b\]52;[^\x07\x1b]*(?:\x07|\x1b\\)"
    r")"
)


# Bounded fan-out queue per attached client. A client that cannot drain this
# many chunks is detached rather than allowed to stall the PTY reader; it
# resyncs with a cold attach.
SUBSCRIBER_QUEUE_LIMIT = 4096

# Sentinel placed on a subscriber queue when no more chunks will follow:
# the PTY reached EOF, or the subscriber overflowed and was detached.
END_OF_OUTPUT = None


class OutputSubscriber:
    """One attached client's view of a terminal's output stream."""

    def __init__(self) -> None:
        self.queue: asyncio.Queue[tuple[int, str] | None] = asyncio.Queue(
            maxsize=SUBSCRIBER_QUEUE_LIMIT
        )
        self.dropped = False

    def _end(self) -> None:
        # Make room for the sentinel so a full queue never swallows it.
        while self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(END_OF_OUTPUT)

    def drain(self) -> list[tuple[int, str] | None]:
        """Pop everything queued so far (tests and diagnostics)."""
        items: list[tuple[int, str] | None] = []
        while not self.queue.empty():
            items.append(self.queue.get_nowait())
        return items

    async def __aiter__(self):
        while True:
            item = await self.queue.get()
            yield item
            if item is END_OF_OUTPUT:
                return


@dataclass
class TerminalState:
    """State for a single terminal (claude or manual).

    Output flows PTY -> reader task -> ``publish`` -> every subscriber, with
    each chunk stamped by a sequence number so a reconnecting client can ask
    for exactly what it missed. The scrollback deque doubles as the replay
    ring buffer.
    """

    pty: PTYManager
    scrollback: deque[tuple[int, str]] = field(default_factory=deque)
    scrollback_size: int = 0
    output_task: asyncio.Task | None = field(default=None, repr=False)
    subscribers: set[OutputSubscriber] = field(default_factory=set, repr=False)
    last_seq: int = 0
    exited: bool = False
    # Current PTY size, None until a client has sized it.
    size: TerminalSize | None = None
    # Connection id of the client whose size owns the PTY.
    controller: str | None = None

    @property
    def first_seq(self) -> int:
        """Sequence of the oldest chunk still in the buffer (0 when empty)."""
        return self.scrollback[0][0] if self.scrollback else 0

    def capture_output(self, data: str) -> None:
        """Alias kept for callers that only record output."""
        self.publish(data)

    def publish(self, data: str) -> None:
        """Stamp a chunk, keep it for replay, and fan it out to subscribers."""
        self.last_seq += 1
        item = (self.last_seq, data)
        self.scrollback.append(item)
        self.scrollback_size += len(data)

        while self.scrollback_size > MAX_SCROLLBACK_SIZE and len(self.scrollback) > 1:
            removed = self.scrollback.popleft()
            self.scrollback_size -= len(removed[1])

        for sub in list(self.subscribers):
            try:
                sub.queue.put_nowait(item)
            except asyncio.QueueFull:
                sub.dropped = True
                self.subscribers.discard(sub)
                sub._end()

    def subscribe(
        self, since_seq: int | None
    ) -> tuple[OutputSubscriber, list[tuple[int, str]] | None]:
        """Attach a client and work out what it needs to catch up.

        Returns the subscriber and a replay list of chunks after ``since_seq``.
        A ``None`` replay means the client's position cannot be served from
        the buffer and it must cold-attach from the full scrollback.
        """
        sub = OutputSubscriber()
        self.subscribers.add(sub)
        if self.exited:
            sub._end()

        if since_seq is None or since_seq > self.last_seq:
            return sub, None
        if since_seq == self.last_seq:
            return sub, []
        # since_seq < first_seq - 1 means chunks between were trimmed away.
        if self.scrollback and since_seq < self.first_seq - 1:
            return sub, None
        return sub, [item for item in self.scrollback if item[0] > since_seq]

    def unsubscribe(self, sub: OutputSubscriber) -> None:
        self.subscribers.discard(sub)

    def ensure_reader(self) -> None:
        """Start the single PTY reader for this terminal if it isn't running."""
        if self.output_task is not None and not self.output_task.done():
            return
        self.output_task = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            async for data in self.pty.read():
                self.publish(data)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.exception("PTY reader stopped: %s", e)
        finally:
            self.exited = True
            for sub in list(self.subscribers):
                sub._end()

    def get_scrollback(self) -> str:
        """Get concatenated scrollback content, sanitized for replay."""
        raw = "".join(chunk for _, chunk in self.scrollback)
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
    # CLI orchestrator MCP config written for this session, removed on teardown.
    mcp_config_path: str | None = None
    # Display name the owning tab gave this session, for session listings.
    label: str | None = None
    # Whether the agent needs the user: "input", "idle" or None (see attention.py).
    attention: str | None = None
    attention_message: str | None = None
    attention_at: float = 0.0

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
            terminal.publish(data)
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

    # -- size policy -------------------------------------------------------
    #
    # The PTY has one size. The client that last typed into a terminal owns
    # it; everyone else renders at that size. Without this, a phone and a
    # desktop attached to one session resize the PTY against each other and
    # the TUI repaints on every swap.

    def _controls(self, terminal: TerminalState, connection_id: str) -> bool:
        return terminal.controller is None or terminal.controller == connection_id

    async def request_size(
        self, session_key: str, connection_id: str, size: TerminalSize
    ) -> bool:
        """Apply ``size`` if ``connection_id`` may own the terminal.

        Returns True when the PTY now has that size, False when another
        client controls it and the request was ignored.
        """
        terminal = self.terminals.get(session_key)
        if terminal is None:
            return False
        self.remember_size(session_key, connection_id, size)
        if not self._controls(terminal, connection_id):
            return False
        await self._apply_size(terminal, size)
        return True

    async def claim_control(
        self,
        session_key: str,
        connection_id: str,
        size: TerminalSize | None = None,
    ) -> bool:
        """Make ``connection_id`` the controller of a terminal.

        ``size`` is the claimant's desired size, applied on a handover so the
        TUI repaints for the device now driving it. Returns True when control
        changed hands.
        """
        terminal = self.terminals.get(session_key)
        if terminal is None or terminal.controller == connection_id:
            return False
        terminal.controller = connection_id
        desired = size or self._desired_sizes.get((session_key, connection_id))
        if desired is not None:
            await self._apply_size(terminal, desired)
        return True

    def remember_size(
        self, session_key: str, connection_id: str, size: TerminalSize
    ) -> None:
        """Record a client's preferred size for use if it later takes control."""
        self._desired_sizes[(session_key, connection_id)] = size

    def release_client(self, connection_id: str) -> None:
        """Forget a departing client; terminals it controlled become unowned."""
        for terminal in self.terminals.values():
            if terminal.controller == connection_id:
                terminal.controller = None
        for key in [k for k in self._desired_sizes if k[1] == connection_id]:
            del self._desired_sizes[key]

    async def nudge_repaint(self, session_key: str) -> None:
        """Make a full-screen TUI redraw by changing the PTY height and back.

        Both Claude Code and Codex repaint their whole screen on SIGWINCH,
        which is cheaper and more faithful than replaying a raw byte stream
        that was drawn for a different size.
        """
        terminal = self.terminals.get(session_key)
        if terminal is None or terminal.size is None:
            return
        size = terminal.size
        if size.rows < 2:
            return
        await terminal.pty.resize(size.cols, size.rows - 1)
        await terminal.pty.resize(size.cols, size.rows)

    async def _apply_size(self, terminal: TerminalState, size: TerminalSize) -> None:
        if terminal.size == size:
            return
        terminal.size = size
        await terminal.pty.resize(size.cols, size.rows)

    def __post_init__(self) -> None:
        self._desired_sizes: dict[tuple[str, str], TerminalSize] = {}


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
        initial_prompt: str | None = None,
        pty_env: dict[str, str] | None = None,
        resume_on_exit: bool = True,
    ) -> tuple[PTYSession, bool]:
        """Get an existing session or create a new one.

        Args:
            session_id: Unique session identifier (tab UUID from frontend)
            project_path: Working directory for the PTY
            shell_command: Command to spawn in the PTY
            size: Terminal size
            auto_start_claude: Whether to auto-start claude command
            resume_on_exit: Relaunch the agent into a fresh handoff brief on exit
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
                initial_prompt,
                pty_env,
                resume_on_exit,
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
        initial_prompt: str | None = None,
        pty_env: dict[str, str] | None = None,
        resume_on_exit: bool = True,
    ) -> PTYSession:
        """Create a new PTY session with the primary (claude) terminal."""
        pty = PTYManager()
        await pty.spawn(
            shell_command,
            project_path,
            size or TerminalSize(cols=80, rows=24),
            env=pty_env,
        )

        session = PTYSession(
            id=session_id,
            project_path=project_path,
            mcp_config_path=(pty_env or {}).get("CADE_CLI_MCP_CONFIG"),
        )
        session.add_terminal(SessionKey.CLAUDE, pty).ensure_reader()

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

            # WSL sessions skip writing "claude\n" here — the WebSocket handler
            # runs the network check as a non-blocking background task and writes
            # the command after the connection is established
            if "wsl" not in shell_command.lower():
                # A Plans-pane "▶ CLI" launch seeds the CLI with an initial
                # prompt so the agent starts already working on the doc. The
                # command optionally wires up handoff resume-on-exit (see
                # agent_launch) and is built from the configured CLI agent.
                from backend.config import get_config
                from backend.terminal.agent_launch import build_launch_command

                mcp_path = (pty_env or {}).get("CADE_CLI_MCP_CONFIG")
                cmd = build_launch_command(
                    initial_prompt,
                    get_config().cli_agent,
                    mcp_path,
                    resume_on_exit=resume_on_exit,
                )
                await pty.write(cmd + "\n")

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
            terminal.ensure_reader()
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

    def sessions(self) -> list[PTYSession]:
        """Snapshot of every registered session."""
        return list(self._sessions.values())

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

        if session.mcp_config_path:
            from backend.orchestrator.mcp_config import (
                remove_adapter_mcp_config,
                remove_mcp_config,
            )
            remove_mcp_config(session.mcp_config_path)
            remove_adapter_mcp_config(session.project_path)

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
