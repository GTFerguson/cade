"""Neovim instance manager.

Manages one Neovim instance per session (project tab), following the same
lifecycle pattern as SessionRegistry for PTY sessions.
"""

from __future__ import annotations

import asyncio
import logging
import shlex
import shutil
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
import tempfile
from typing import Any

from backend.models import TerminalSize
from backend.subprocess_utils import run_silent
from backend.terminal.pty import PTYManager

logger = logging.getLogger(__name__)


@dataclass
class NeovimInstance:
    """A running Neovim process with PTY for TUI rendering."""

    session_id: str
    pty: PTYManager
    project_path: Path
    socket_path: str
    pid: int | None = None
    output_task: asyncio.Task | None = field(default=None, repr=False)
    # async callable set by the websocket handler to push messages to the client
    send_callback: Any | None = field(default=None, repr=False)
    # maps absolute file path string → temp snapshot path (pre-edit content)
    snapshots: dict[str, str] = field(default_factory=dict, repr=False)

    def is_alive(self) -> bool:
        return self.pty.is_alive()


class NeovimManager:
    """Manages Neovim instances, one per session."""

    def __init__(self) -> None:
        self._instances: dict[str, NeovimInstance] = {}
        self._lock = asyncio.Lock()

    async def spawn(
        self,
        session_id: str,
        project_path: Path,
        size: TerminalSize,
        clean_mode: bool = False,
        file_path: str | None = None,
    ) -> NeovimInstance:
        """Spawn a new Neovim instance for a session.

        Uses --embed flag with --listen for dual-channel communication:
        the PTY carries TUI output while the socket carries RPC.
        """
        async with self._lock:
            existing = self._instances.get(session_id)
            if existing is not None and existing.is_alive():
                logger.info("Reusing existing Neovim for session: %s", session_id)
                return existing

            # Clean up dead instance if present
            if existing is not None:
                await self._close_instance(existing)
                del self._instances[session_id]

        nvim_path = self._resolve_nvim_path()

        # Build unique socket path for RPC
        socket_name = f"cade-nvim-{uuid.uuid4().hex[:12]}"
        if sys.platform == "win32":
            # Neovim on Windows uses named pipes, not Unix sockets
            socket_path = f"\\\\.\\pipe\\{socket_name}"
        else:
            import tempfile
            socket_dir = Path(tempfile.gettempdir())
            socket_path = str(socket_dir / socket_name)

        cmd_parts = [nvim_path, "--listen", socket_path]
        if clean_mode:
            cmd_parts.append("--clean")
        if file_path:
            cmd_parts.append(file_path)

        if sys.platform == "win32":
            cmd = subprocess.list2cmdline(cmd_parts)
        else:
            cmd = shlex.join(cmd_parts)

        pty = PTYManager()
        await pty.spawn(
            cmd,
            project_path,
            size,
        )

        instance = NeovimInstance(
            session_id=session_id,
            pty=pty,
            project_path=project_path,
            socket_path=socket_path,
        )

        async with self._lock:
            self._instances[session_id] = instance

        logger.info(
            "Spawned Neovim for session %s (socket: %s)",
            session_id,
            socket_path,
        )

        return instance

    def _resolve_nvim_path(self) -> str:
        """Find a working nvim binary, preferring the bundled copy."""
        bundled = self._find_bundled_nvim()
        if bundled is not None:
            logger.info("Using bundled nvim: %s", bundled)
            return bundled

        system_nvim = shutil.which("nvim")
        if system_nvim is None:
            raise FileNotFoundError("nvim not found on PATH")

        if not self._validate_nvim(system_nvim):
            raise FileNotFoundError(
                f"Found nvim at {system_nvim} but it failed to run. "
                "The binary may be a broken shim — reinstall Neovim or "
                "remove the broken entry from PATH."
            )

        logger.info("Using system nvim: %s", system_nvim)
        return system_nvim

    @staticmethod
    def _find_bundled_nvim() -> str | None:
        """Check for nvim bundled inside a PyInstaller package."""
        nvim_name = "nvim.exe" if sys.platform == "win32" else "nvim"
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            path = Path(meipass) / "nvim" / "bin" / nvim_name
            if path.is_file():
                return str(path)
        return None

    @staticmethod
    def _validate_nvim(nvim_path: str) -> bool:
        """Run 'nvim --version' to verify the binary actually works."""
        try:
            result = run_silent(
                [nvim_path, "--version"],
                capture_output=True,
                timeout=5,
            )
            return result.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            return False

    async def kill(self, session_id: str) -> None:
        """Kill the Neovim instance for a session."""
        async with self._lock:
            instance = self._instances.pop(session_id, None)

        if instance is not None:
            await self._close_instance(instance)
            logger.info("Killed Neovim for session: %s", session_id)

    def get(self, session_id: str) -> NeovimInstance | None:
        """Get a Neovim instance by session ID."""
        return self._instances.get(session_id)

    async def open_file_for_project(self, project_path: Path, file_path: Path) -> None:
        """Open or reload a file in the Neovim instance for the given project.

        No-op if no live instance exists for the project or RPC fails.
        """
        instance = self._find_for_project(project_path)
        if instance is None:
            return
        await self._rpc_edit(instance.socket_path, file_path)

    async def record_edit(
        self,
        project_path: Path,
        file_path: Path,
        old_content: str,
        new_content: str,
    ) -> None:
        """Snapshot old content, apply diff highlights, and notify the frontend.

        Called by file tools after every write/edit so the user sees which lines
        changed and can open a diff view on demand.
        """
        from backend.neovim.diff import compute_hunks
        from backend.protocol import MessageType

        instance = self._find_for_project(project_path)
        if instance is None:
            return

        hunks = compute_hunks(old_content, new_content)

        # Save snapshot so open_diff can compare against it later
        await self._save_snapshot(instance, file_path, old_content)

        # Apply highlights in Neovim (opens/reloads file as side-effect)
        await self._rpc_highlight(instance.socket_path, file_path, hunks)

        # Notify the frontend so it can show the diff button
        if instance.send_callback and hunks:
            added = sum(
                h.new_end - h.new_start for h in hunks if h.tag in ("insert", "replace")
            )
            removed = sum(
                h.old_end - h.old_start for h in hunks if h.tag in ("delete", "replace")
            )
            await instance.send_callback({
                "type": MessageType.NEOVIM_DIFF_AVAILABLE,
                "filePath": str(file_path),
                "hunkCount": len(hunks),
                "added": added,
                "removed": removed,
            })

    async def open_diff(self, project_path: Path, file_path: Path) -> None:
        """Open a vertical diff split comparing current file to its pre-edit snapshot."""
        instance = self._find_for_project(project_path)
        if instance is None:
            return
        snapshot = instance.snapshots.get(str(file_path))
        if not snapshot:
            return
        await self._rpc_open_diff(instance.socket_path, file_path, snapshot)

    async def _save_snapshot(
        self, instance: NeovimInstance, file_path: Path, content: str
    ) -> None:
        loop = asyncio.get_running_loop()
        path_str = str(file_path)
        old_snap = instance.snapshots.get(path_str)

        def _write() -> str:
            if old_snap:
                try:
                    Path(old_snap).unlink(missing_ok=True)
                except OSError:
                    pass
            fd, tmp = tempfile.mkstemp(suffix=".orig", prefix="cade-diff-")
            import os
            os.close(fd)
            Path(tmp).write_text(content, encoding="utf-8")
            return tmp

        tmp_path = await loop.run_in_executor(None, _write)
        instance.snapshots[path_str] = tmp_path

    async def _rpc_highlight(
        self, socket_path: str, file_path: Path, hunks: list
    ) -> None:
        loop = asyncio.get_running_loop()
        path_str = str(file_path)

        def _run() -> None:
            try:
                import pynvim
                nvim = pynvim.attach("socket", path=socket_path)
                try:
                    escaped = nvim.funcs.fnameescape(path_str)
                    nvim.command(f"e {escaped}")
                    buf = nvim.current.buffer
                    ns = nvim.api.create_namespace("cade_diff")
                    nvim.api.buf_clear_namespace(buf, ns, 0, -1)
                    for hunk in hunks:
                        if hunk.tag == "insert":
                            hl = "DiffAdd"
                            for line in range(hunk.new_start, hunk.new_end):
                                nvim.api.buf_add_highlight(buf, ns, hl, line, 0, -1)
                        elif hunk.tag == "replace":
                            hl = "DiffChange"
                            for line in range(hunk.new_start, hunk.new_end):
                                nvim.api.buf_add_highlight(buf, ns, hl, line, 0, -1)
                        # "delete" hunks have no new lines — nothing to highlight
                finally:
                    nvim.close()
            except Exception as exc:
                logger.debug("Neovim highlight skipped: %s", exc)

        await loop.run_in_executor(None, _run)

    async def _rpc_open_diff(
        self, socket_path: str, file_path: Path, snapshot_path: str
    ) -> None:
        loop = asyncio.get_running_loop()
        path_str = str(file_path)

        def _run() -> None:
            try:
                import pynvim
                nvim = pynvim.attach("socket", path=socket_path)
                try:
                    escaped_file = nvim.funcs.fnameescape(path_str)
                    escaped_snap = nvim.funcs.fnameescape(snapshot_path)
                    # Navigate to the edited file, clear any existing diff
                    nvim.command(f"e {escaped_file}")
                    nvim.command("diffoff!")
                    # Open snapshot in a vertical split — activates diff mode on both
                    nvim.command(f"vert diffsplit {escaped_snap}")
                finally:
                    nvim.close()
            except Exception as exc:
                logger.debug("Neovim diff open skipped: %s", exc)

        await loop.run_in_executor(None, _run)

    def _find_for_project(self, project_path: Path) -> NeovimInstance | None:
        for instance in self._instances.values():
            if instance.project_path == project_path and instance.is_alive():
                return instance
        return None

    async def _rpc_edit(self, socket_path: str, file_path: Path) -> None:
        """Run :e <file_path> in Neovim via the RPC socket."""
        loop = asyncio.get_running_loop()
        path_str = str(file_path)

        def _run() -> None:
            try:
                import pynvim
                nvim = pynvim.attach("socket", path=socket_path)
                try:
                    escaped = nvim.funcs.fnameescape(path_str)
                    nvim.command(f"e {escaped}")
                finally:
                    nvim.close()
            except Exception as exc:
                logger.debug("Neovim RPC open_file skipped: %s", exc)

        await loop.run_in_executor(None, _run)

    async def stop(self) -> None:
        """Stop all Neovim instances (cleanup on shutdown)."""
        async with self._lock:
            for instance in self._instances.values():
                await self._close_instance(instance)
            self._instances.clear()
        logger.info("NeovimManager stopped, all instances closed")

    async def _close_instance(self, instance: NeovimInstance) -> None:
        """Close a single Neovim instance."""
        if instance.output_task is not None:
            instance.output_task.cancel()
            try:
                await instance.output_task
            except asyncio.CancelledError:
                pass
        await instance.pty.close()

        # Clean up socket file (named pipes on Windows are cleaned up by the OS)
        if not instance.socket_path.startswith("\\\\.\\pipe\\"):
            try:
                socket = Path(instance.socket_path)
                if socket.exists():
                    socket.unlink()
            except OSError:
                pass

        # Clean up diff snapshot temp files
        for snap_path in instance.snapshots.values():
            try:
                Path(snap_path).unlink(missing_ok=True)
            except OSError:
                pass


# Global manager instance
_manager: NeovimManager | None = None


def get_neovim_manager() -> NeovimManager:
    """Get the global Neovim manager instance."""
    global _manager
    if _manager is None:
        _manager = NeovimManager()
    return _manager
