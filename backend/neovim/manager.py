"""Neovim instance manager.

Manages one Neovim instance per session (project tab), following the same
lifecycle pattern as SessionRegistry for PTY sessions.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import uuid
from dataclasses import dataclass, field
from pathlib import Path
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

        pty = PTYManager()
        await pty.spawn(
            " ".join(cmd_parts),
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


# Global manager instance
_manager: NeovimManager | None = None


def get_neovim_manager() -> NeovimManager:
    """Get the global Neovim manager instance."""
    global _manager
    if _manager is None:
        _manager = NeovimManager()
    return _manager
