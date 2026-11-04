"""In-place backend upgrade that keeps every terminal session alive.

The backend is the parent of every shell and holds every PTY master, so a
restart ends every session. An upgrade instead replaces this process's
program image with the new binary via ``os.execv``. The pid is unchanged,
so the shells stay our children and the desktop app's handle on the sidecar
stays valid; the PTY masters and the HTTP listening socket are plain file
descriptors and survive the exec once their close-on-exec flag is cleared.
Everything that is not a descriptor (session ids, labels, scrollback,
sequence numbers, chat history) is written to a handoff manifest and read
back by the new image on startup.

Windows has no exec and ConPTY handles do not travel this way; there an
upgrade is refused and the app restarts as before.

Sequence (``UpgradeCoordinator.request`` to ``perform_handoff``):

1. Verify the new binary answers ``--version``.
2. Wait until no chat response is streaming (a shell or CLI agent mid-task
   is fine: its process is untouched), capped so a never-idle backend still
   upgrades.
3. Tell every connected tab an upgrade is starting, pause the PTY readers
   so no chunk is lost mid-read, export the registry and chat sessions.
4. Mark the PTY and listener descriptors inheritable, write the manifest,
   exec. The new image imports the manifest in its lifespan and removes the
   old image's PyInstaller extraction directory, which exec would otherwise
   leave behind in /tmp.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.models import TerminalSize

if TYPE_CHECKING:
    from backend.terminal.sessions import SessionRegistry
    from core.backend.chat.session import ChatSessionRegistry

logger = logging.getLogger(__name__)

MANIFEST_VERSION = 1
HANDOFF_DIR = Path.home() / ".cade" / "upgrade"
HANDOFF_FILE = HANDOFF_DIR / "handoff.json"

# A never-idle backend (a chat stream that keeps going) still upgrades once
# the pending request is this old; the stream is cut and its partial reply kept.
DEFAULT_IDLE_CAP_SECONDS = 600.0
# How often a pending upgrade re-checks for idleness.
IDLE_POLL_SECONDS = 1.0
# How long the new binary gets to answer --version. A one-file PyInstaller
# build extracts itself on first run, which takes a few seconds cold.
VERIFY_TIMEOUT_SECONDS = 30.0
# Flag the new image is started with; its value is the manifest path.
RESUME_FLAG = "--resume-handoff"


class UpgradeError(Exception):
    """The upgrade could not be started; the running backend is unchanged."""


def supported() -> bool:
    """Whether this platform can exec in place with inherited PTYs."""
    return sys.platform != "win32"


def build_id() -> str:
    """Identity of the running build, for tabs to notice a change.

    A frozen build is identified by its executable's size and mtime, which
    every process of that binary agrees on and a new install changes. A
    source checkout has no single file to stat, so each process counts as
    its own build; a dev restart then reloads the tabs, which is harmless.
    """
    if getattr(sys, "frozen", False):
        try:
            st = os.stat(sys.executable)
            return f"{st.st_size:x}-{int(st.st_mtime):x}"
        except OSError:
            pass
    return f"dev-{os.getpid():x}-{int(_PROCESS_START):x}"


_PROCESS_START = time.time()


def current_executable() -> str:
    """The binary an upgrade re-execs by default: our own path.

    After a reinstall that path holds the new build. A source checkout has
    no binary; the Python interpreter re-runs ``backend.main``.
    """
    return sys.executable


def exec_argv(executable: str, serve_argv: list[str], manifest_path: Path) -> list[str]:
    """Build the argv for the new image.

    ``serve_argv`` is this process's argv after the program name, with any
    earlier resume flag dropped so a second upgrade does not inherit the
    first one's manifest path.
    """
    args = list(serve_argv)
    while RESUME_FLAG in args:
        i = args.index(RESUME_FLAG)
        del args[i : i + 2]
    if getattr(sys, "frozen", False):
        head = [executable]
    else:
        head = [executable, "-m", "backend.main"]
    if not args or args[0].startswith("-"):
        args = ["serve", *args]
    return [*head, *args, RESUME_FLAG, str(manifest_path)]


def verify_executable(executable: str, timeout: float = VERIFY_TIMEOUT_SECONDS) -> str:
    """Run ``<executable> --version`` and return its output, or raise UpgradeError."""
    if getattr(sys, "frozen", False):
        cmd = [executable, "--version"]
    else:
        cmd = [executable, "-m", "backend.main", "--version"]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            cwd=None if getattr(sys, "frozen", False) else str(Path(__file__).resolve().parent.parent),
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise UpgradeError(f"{executable} did not answer --version: {e}") from e
    if result.returncode != 0:
        raise UpgradeError(
            f"{executable} --version exited {result.returncode}: {result.stderr.strip()[:200]}"
        )
    return result.stdout.strip()


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


@dataclass
class TerminalHandoff:
    session_key: str
    master_fd: int
    pid: int
    last_seq: int
    scrollback: list[tuple[int, str]]
    size: dict[str, int] | None
    exited: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_key": self.session_key,
            "master_fd": self.master_fd,
            "pid": self.pid,
            "last_seq": self.last_seq,
            "scrollback": [[seq, chunk] for seq, chunk in self.scrollback],
            "size": self.size,
            "exited": self.exited,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TerminalHandoff:
        return cls(
            session_key=d["session_key"],
            master_fd=int(d["master_fd"]),
            pid=int(d["pid"]),
            last_seq=int(d.get("last_seq", 0)),
            scrollback=[(int(seq), chunk) for seq, chunk in d.get("scrollback", [])],
            size=d.get("size"),
            exited=bool(d.get("exited", False)),
        )


@dataclass
class SessionHandoff:
    id: str
    project_path: str
    label: str | None
    last_activity: float
    created_at: float
    mcp_config_path: str | None
    attention: str | None
    attention_message: str | None
    attention_at: float
    terminals: list[TerminalHandoff] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "project_path": self.project_path,
            "label": self.label,
            "last_activity": self.last_activity,
            "created_at": self.created_at,
            "mcp_config_path": self.mcp_config_path,
            "attention": self.attention,
            "attention_message": self.attention_message,
            "attention_at": self.attention_at,
            "terminals": [t.to_dict() for t in self.terminals],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SessionHandoff:
        return cls(
            id=d["id"],
            project_path=d["project_path"],
            label=d.get("label"),
            last_activity=float(d.get("last_activity", time.time())),
            created_at=float(d.get("created_at", time.time())),
            mcp_config_path=d.get("mcp_config_path"),
            attention=d.get("attention"),
            attention_message=d.get("attention_message"),
            attention_at=float(d.get("attention_at", 0.0)),
            terminals=[TerminalHandoff.from_dict(t) for t in d.get("terminals", [])],
        )


@dataclass
class Manifest:
    sessions: list[SessionHandoff]
    chat: dict[str, dict]
    listener_fd: int | None
    old_meipass: str | None
    created: float = field(default_factory=time.time)
    version: int = MANIFEST_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "created": self.created,
            "listener_fd": self.listener_fd,
            "old_meipass": self.old_meipass,
            "sessions": [s.to_dict() for s in self.sessions],
            "chat": self.chat,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Manifest:
        if d.get("version") != MANIFEST_VERSION:
            raise UpgradeError(f"unsupported handoff manifest version {d.get('version')!r}")
        return cls(
            sessions=[SessionHandoff.from_dict(s) for s in d.get("sessions", [])],
            chat=dict(d.get("chat", {})),
            listener_fd=d.get("listener_fd"),
            old_meipass=d.get("old_meipass"),
            created=float(d.get("created", 0.0)),
        )

    @property
    def inherited_fds(self) -> list[int]:
        fds = [t.master_fd for s in self.sessions for t in s.terminals]
        if self.listener_fd is not None:
            fds.append(self.listener_fd)
        return fds


def write_manifest(manifest: Manifest, path: Path = HANDOFF_FILE) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest.to_dict()), encoding="utf-8")
    os.replace(tmp, path)
    return path


def read_manifest(path: Path = HANDOFF_FILE) -> Manifest:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise UpgradeError(f"cannot read handoff manifest {path}: {e}") from e
    return Manifest.from_dict(data)


# ---------------------------------------------------------------------------
# Export (old image) and import (new image)
# ---------------------------------------------------------------------------


async def export_sessions(registry: SessionRegistry) -> list[SessionHandoff]:
    """Pause every reader and describe every session for the manifest.

    Sessions whose PTY cannot travel (none on Unix, all on Windows) are left
    out and die with the old image, as they would on a restart.
    """
    out: list[SessionHandoff] = []
    for session in registry.sessions():
        handoff = SessionHandoff(
            id=session.id,
            project_path=str(session.project_path),
            label=session.label,
            last_activity=session.last_activity,
            created_at=session.created_at,
            mcp_config_path=session.mcp_config_path,
            attention=session.attention,
            attention_message=session.attention_message,
            attention_at=session.attention_at,
        )
        for key, terminal in session.terminals.items():
            descriptor = terminal.pty.handoff_descriptor()
            if descriptor is None:
                logger.warning("Terminal %s of %s cannot be carried across the upgrade", key, session.id)
                continue
            await terminal.pause_reader()
            fd, pid = descriptor
            handoff.terminals.append(TerminalHandoff(
                session_key=key,
                master_fd=fd,
                pid=pid,
                last_seq=terminal.last_seq,
                scrollback=list(terminal.scrollback),
                size={"cols": terminal.size.cols, "rows": terminal.size.rows} if terminal.size else None,
                exited=terminal.exited,
            ))
        if handoff.terminals:
            out.append(handoff)
    return out


def import_sessions(manifest: Manifest, registry: SessionRegistry) -> int:
    """Rebuild the sessions in the manifest around their inherited PTYs.

    Returns how many sessions were adopted. A terminal whose fd is not open
    in this process (the manifest is stale, or the exec came from somewhere
    else) is skipped rather than trusted.
    """
    from collections import deque

    from backend.terminal.pty import PTYManager
    from backend.terminal.sessions import PTYSession

    adopted = 0
    for item in manifest.sessions:
        session = PTYSession(
            id=item.id,
            project_path=Path(item.project_path),
            last_activity=item.last_activity,
            created_at=item.created_at,
            mcp_config_path=item.mcp_config_path,
            label=item.label,
            attention=item.attention,
            attention_message=item.attention_message,
            attention_at=item.attention_at,
        )
        for term in item.terminals:
            if not _fd_is_open(term.master_fd):
                logger.warning(
                    "Handoff names fd %d for %s/%s but it is not open here; dropping",
                    term.master_fd, item.id, term.session_key,
                )
                continue
            os.set_inheritable(term.master_fd, False)
            pty = PTYManager.adopt(term.master_fd, term.pid)
            state = session.add_terminal(term.session_key, pty)
            state.scrollback = deque(term.scrollback)
            state.scrollback_size = sum(len(chunk) for _, chunk in term.scrollback)
            state.last_seq = term.last_seq
            state.exited = term.exited
            if term.size:
                state.size = TerminalSize(cols=term.size["cols"], rows=term.size["rows"])
            state.ensure_reader()
        if session.terminals:
            registry.adopt(session)
            adopted += 1
    return adopted


def _fd_is_open(fd: int) -> bool:
    try:
        os.fstat(fd)
    except OSError:
        return False
    return True


def adopt_listener(manifest: Manifest) -> socket.socket | None:
    """The listening socket the old image was serving on, or None."""
    if manifest.listener_fd is None or not _fd_is_open(manifest.listener_fd):
        return None
    sock = socket.socket(fileno=manifest.listener_fd)
    sock.set_inheritable(False)
    return sock


def remove_old_extraction(manifest: Manifest) -> None:
    """Delete the previous image's PyInstaller extraction directory.

    The bootloader removes it when the process exits normally, which exec
    is not. Only a sibling of our own extraction directory is removed, so
    a bad manifest cannot point this at anything else.
    """
    old = manifest.old_meipass
    ours = getattr(sys, "_MEIPASS", None)
    if not old or not ours or old == ours:
        return
    old_path, ours_path = Path(old), Path(ours)
    if old_path.parent != ours_path.parent or not old_path.name.startswith("_MEI"):
        logger.warning("Not removing %s: not a sibling extraction directory of %s", old, ours)
        return
    shutil.rmtree(old_path, ignore_errors=True)


# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------


@dataclass
class UpgradeStatus:
    state: str  # "idle" | "pending" | "upgrading" | "unsupported"
    executable: str | None = None
    requested_at: float | None = None
    version: str | None = None
    busy_reason: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "executable": self.executable,
            "requestedAt": self.requested_at,
            "version": self.version,
            "busyReason": self.busy_reason,
            "error": self.error,
            "buildVersion": build_id(),
        }


class UpgradeCoordinator:
    """Accepts upgrade requests and performs the handoff when the backend is idle.

    ``busy`` says why the backend should not exec right now (a chat stream in
    flight), or None when it may. ``perform`` does the exec; tests inject a
    stand-in.
    """

    def __init__(
        self,
        *,
        busy: Callable[[], str | None],
        perform: Callable[[str], Any],
        idle_cap: float = DEFAULT_IDLE_CAP_SECONDS,
        poll: float = IDLE_POLL_SECONDS,
        verify: Callable[[str], str] = verify_executable,
    ) -> None:
        self._busy = busy
        self._perform = perform
        self._idle_cap = idle_cap
        self._poll = poll
        self._verify = verify
        self._task: asyncio.Task | None = None
        self.status = UpgradeStatus(state="idle" if supported() else "unsupported")

    async def request(self, executable: str | None = None, *, now: bool = False) -> UpgradeStatus:
        """Queue an upgrade to ``executable`` (default: our own path).

        A request while one is pending retargets it. ``now`` skips the idle
        wait. Raises UpgradeError if the binary does not check out.
        """
        if not supported():
            raise UpgradeError("in-place upgrade is not supported on this platform")
        if self.status.state == "upgrading":
            raise UpgradeError("an upgrade is already in progress")
        exe = executable or current_executable()
        version = await asyncio.to_thread(self._verify, exe)
        self.status = UpgradeStatus(
            state="pending", executable=exe, requested_at=time.time(), version=version,
        )
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = asyncio.create_task(self._run(now))
        return self.status

    def cancel(self) -> UpgradeStatus:
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        if self.status.state == "pending":
            self.status = UpgradeStatus(state="idle")
        return self.status

    async def _run(self, now: bool) -> None:
        try:
            if not now:
                await self._wait_for_idle()
            self.status.state = "upgrading"
            self.status.busy_reason = None
            result = self._perform(self.status.executable or current_executable())
            if asyncio.iscoroutine(result):
                await result
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.exception("Upgrade failed; backend continues on the old build")
            self.status = UpgradeStatus(state="idle", error=str(e))

    async def _wait_for_idle(self) -> None:
        started = time.monotonic()
        while True:
            reason = self._busy()
            if reason is None:
                return
            if time.monotonic() - started >= self._idle_cap:
                logger.warning("Upgrade waited %.0fs for idle (%s); proceeding anyway", self._idle_cap, reason)
                return
            self.status.busy_reason = reason
            await asyncio.sleep(self._poll)


# ---------------------------------------------------------------------------
# The handoff itself
# ---------------------------------------------------------------------------

_listener: socket.socket | None = None
_serve_argv: list[str] = []
_pending_manifest: Manifest | None = None
_pending_manifest_path: Path | None = None


def set_pending_manifest(manifest: Manifest, path: Path = HANDOFF_FILE) -> None:
    """Hold the manifest this image was started with until the app adopts it."""
    global _pending_manifest, _pending_manifest_path
    _pending_manifest = manifest
    _pending_manifest_path = path


def take_pending_manifest() -> Manifest | None:
    global _pending_manifest
    manifest, _pending_manifest = _pending_manifest, None
    return manifest


def discard_manifest_file() -> None:
    """Remove the adopted manifest; it names descriptors that mean nothing later."""
    path = _pending_manifest_path or HANDOFF_FILE
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def bind_listener(host: str, port: int, backlog: int = 2048) -> socket.socket:
    """Bind the HTTP listening socket the way uvicorn would have."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.listen(backlog)
    sock.set_inheritable(False)
    return sock


def set_listener(sock: socket.socket) -> None:
    """Remember the HTTP listening socket so an upgrade can hand it on."""
    global _listener
    _listener = sock


def set_serve_argv(argv: list[str]) -> None:
    """Remember how this process was started so the new image is started alike."""
    global _serve_argv
    _serve_argv = list(argv)


def default_busy_reason() -> str | None:
    from core.backend.chat.session import get_chat_registry

    if get_chat_registry().any_streaming():
        return "a chat response is streaming"
    return None


async def perform_handoff(executable: str, *, manifest_path: Path = HANDOFF_FILE) -> None:
    """Export state, mark descriptors inheritable, and exec the new binary.

    Only returns by raising: on success the process image is replaced. On
    failure before the exec the readers are restarted and the backend keeps
    serving on the old build.
    """
    from backend.terminal.connections import get_connection_manager
    from backend.terminal.sessions import get_registry
    from core.backend.chat.session import get_chat_registry

    registry = get_registry()
    try:
        await get_connection_manager().broadcast({"type": "upgrading"})
    except Exception:  # noqa: BLE001
        pass

    sessions = await export_sessions(registry)
    try:
        listener_fd = _listener.fileno() if _listener is not None else None
        manifest = Manifest(
            sessions=sessions,
            chat=get_chat_registry().to_handoff(),
            listener_fd=listener_fd,
            old_meipass=getattr(sys, "_MEIPASS", None),
        )
        for fd in manifest.inherited_fds:
            os.set_inheritable(fd, True)
        path = write_manifest(manifest, manifest_path)
        argv = exec_argv(executable, _serve_argv or sys.argv[1:], path)
        logger.info("Upgrading in place: exec %s", " ".join(argv))
        for handler in logging.getLogger().handlers:
            try:
                handler.flush()
            except Exception:  # noqa: BLE001
                pass
        os.execv(argv[0], argv)
    except BaseException:
        # Still the old image: undo what can be undone and keep serving.
        for session in registry.sessions():
            for terminal in session.terminals.values():
                descriptor = terminal.pty.handoff_descriptor()
                if descriptor is not None:
                    try:
                        os.set_inheritable(descriptor[0], False)
                    except OSError:
                        pass
                terminal.ensure_reader()
        if _listener is not None:
            try:
                _listener.set_inheritable(False)
            except OSError:
                pass
        raise


_coordinator: UpgradeCoordinator | None = None


def get_coordinator() -> UpgradeCoordinator:
    global _coordinator
    if _coordinator is None:
        _coordinator = UpgradeCoordinator(busy=default_busy_reason, perform=perform_handoff)
    return _coordinator


def set_coordinator(coordinator: UpgradeCoordinator | None) -> None:
    global _coordinator
    _coordinator = coordinator
