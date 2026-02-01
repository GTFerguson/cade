"""PTY lifecycle management with cross-platform support."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, AsyncIterator

from backend.errors import PTYError
from backend.models import TerminalSize
from backend.wsl.commands import resolve_command, windows_to_wsl_path
from backend.wsl.health import is_wsl_error, restart_wsl

logger = logging.getLogger(__name__)

# Ensure winpty native binaries (winpty.dll, winpty-agent.exe) can be found
# when running as a frozen PyInstaller bundle
if sys.platform == "win32" and getattr(sys, "frozen", False):
    _meipass = getattr(sys, "_MEIPASS", "")
    _winpty_dir = os.path.join(_meipass, "winpty")
    if os.path.isdir(_winpty_dir):
        os.add_dll_directory(_winpty_dir)
        os.environ["PATH"] = _winpty_dir + os.pathsep + os.environ.get("PATH", "")
        logger.info("Added winpty binary path: %s", _winpty_dir)

if TYPE_CHECKING:
    from collections.abc import Callable


class BasePTY(ABC):
    """Abstract base class for PTY implementations."""

    @abstractmethod
    async def spawn(self, command: str, cwd: Path, size: TerminalSize) -> None:
        """Spawn a new PTY process."""
        ...

    @abstractmethod
    async def read(self) -> AsyncIterator[str]:
        """Read output from the PTY."""
        ...

    @abstractmethod
    async def write(self, data: str) -> None:
        """Write input to the PTY."""
        ...

    @abstractmethod
    async def resize(self, size: TerminalSize) -> None:
        """Resize the PTY."""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Close the PTY and clean up resources."""
        ...

    @abstractmethod
    def is_alive(self) -> bool:
        """Check if the PTY process is still running."""
        ...

    @property
    def pid(self) -> int:
        """Return the PID of the underlying process, or 0 if unavailable."""
        return 0


class UnixPTY(BasePTY):
    """Unix PTY implementation using pexpect."""

    def __init__(self) -> None:
        self._process: "pexpect.spawn | None" = None  # type: ignore[name-defined]
        self._read_task: asyncio.Task | None = None

    async def spawn(self, command: str, cwd: Path, size: TerminalSize) -> None:
        import pexpect

        try:
            env = os.environ.copy()
            env.setdefault("TERM", "xterm-256color")

            self._process = pexpect.spawn(
                command,
                cwd=str(cwd),
                dimensions=(size.rows, size.cols),
                encoding="utf-8",
                timeout=None,
                env=env,
            )
        except Exception as e:
            raise PTYError.spawn_failed(command, str(e)) from e

    async def read(self) -> AsyncIterator[str]:
        import pexpect

        if self._process is None:
            return

        loop = asyncio.get_event_loop()
        while self.is_alive():
            try:
                data = await loop.run_in_executor(None, self._read_chunk)
                if data:
                    yield data
            except pexpect.EOF:
                break
            except pexpect.TIMEOUT:
                continue
            except Exception as e:
                raise PTYError.read_failed(str(e)) from e

    def _read_chunk(self) -> str:
        """Blocking read, called in executor."""
        import pexpect

        if self._process is None:
            return ""
        try:
            # Use read_nonblocking to avoid duplicate data from pexpect.before
            # The expect(TIMEOUT) approach was returning the same data repeatedly
            # because pexpect.before is not cleared when no new data arrives
            return self._process.read_nonblocking(size=4096, timeout=0.1)
        except pexpect.TIMEOUT:
            return ""  # No new data available
        except pexpect.EOF:
            return ""

    async def write(self, data: str) -> None:
        if self._process is None:
            raise PTYError.write_failed("PTY not initialized")
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._process.send, data)
        except Exception as e:
            raise PTYError.write_failed(str(e)) from e

    async def resize(self, size: TerminalSize) -> None:
        if self._process is None:
            return
        try:
            self._process.setwinsize(size.rows, size.cols)
        except Exception:
            pass

    async def close(self) -> None:
        if self._process is not None:
            try:
                self._process.close(force=True)
            except Exception:
                pass
            self._process = None

    def is_alive(self) -> bool:
        return self._process is not None and self._process.isalive()

    @property
    def pid(self) -> int:
        if self._process is not None:
            return self._process.pid
        return 0


class WindowsPTY(BasePTY):
    """Windows PTY implementation using pywinpty."""

    def __init__(self) -> None:
        self._pty: "winpty.PTY | None" = None  # type: ignore[name-defined]
        self._closed = False

    def _do_spawn(
        self, pty: "winpty.PTY", exe: str, args: str, cwd: str,  # type: ignore[name-defined]
    ) -> None:
        """Synchronous spawn helper — called in executor for timeout support."""
        if args:
            pty.spawn(exe, cwd=cwd, cmdline=args)
        else:
            pty.spawn(exe, cwd=cwd)

    async def spawn(self, command: str, cwd: Path, size: TerminalSize) -> None:
        from winpty import PTY, Backend, WinptyError

        is_wsl = "wsl" in command.lower()

        # Resolve the executable to its full path so both backends find it
        exe = resolve_command(command) if is_wsl else command
        if is_wsl:
            logger.info("Resolved executable: %s", exe)

        # Build (backend, exe, args) attempts.
        # pywinpty's PTY.spawn() takes the executable as the first arg
        # and command-line arguments via the cmdline= keyword.
        # Passing the whole string as the first arg causes WinPTY to treat
        # it as a file path, resulting in ERROR_PATH_NOT_FOUND.
        if is_wsl:
            wsl_cwd = windows_to_wsl_path(str(cwd)) or "~"
            attempts: list[tuple[int, str, str]] = [
                (Backend.WinPTY, exe, f" --cd {wsl_cwd}"),
                (Backend.ConPTY, exe, f" --cd {wsl_cwd}"),
                (Backend.WinPTY, exe, f" --cd {wsl_cwd} -e bash --login"),
                (Backend.ConPTY, exe, f" --cd {wsl_cwd} -e bash --login"),
                (Backend.WinPTY, exe, " --cd ~"),
                (Backend.ConPTY, exe, " --cd ~"),
            ]
        else:
            attempts = [(Backend.ConPTY, exe, "")]

        loop = asyncio.get_event_loop()
        last_error: str = ""

        for attempt_idx, (backend, attempt_exe, attempt_args) in enumerate(attempts):
            backend_name = "WinPTY" if backend == Backend.WinPTY else "ConPTY"
            logger.info(
                "Attempt %d/%d: backend=%s, exe=%s, args=%s",
                attempt_idx + 1, len(attempts), backend_name,
                attempt_exe, attempt_args.strip(),
            )

            try:
                pty = PTY(size.cols, size.rows, backend)
                logger.debug("PTY created, calling spawn...")

                # Run spawn in executor with timeout — ConPTY can hang
                try:
                    await asyncio.wait_for(
                        loop.run_in_executor(
                            None, self._do_spawn, pty, attempt_exe,
                            attempt_args, str(cwd),
                        ),
                        timeout=5.0,
                    )
                except asyncio.TimeoutError:
                    last_error = f"{backend_name} spawn timed out after 5s"
                    logger.warning("%s", last_error)
                    try:
                        pty.close()
                    except Exception:
                        pass
                    continue

                self._pty = pty
                logger.debug("spawn() returned successfully")
            except (WinptyError, Exception) as e:
                last_error = f"{backend_name} spawn exception: {e}"
                logger.warning("%s", last_error)

                if is_wsl and is_wsl_error(str(e)):
                    success, restart_msg = restart_wsl()
                    if success:
                        logger.info("WSL recovered, retrying")
                        try:
                            pty2 = PTY(size.cols, size.rows, backend)
                            await asyncio.wait_for(
                                loop.run_in_executor(
                                    None, self._do_spawn, pty2, attempt_exe,
                                    attempt_args, str(cwd),
                                ),
                                timeout=5.0,
                            )
                            self._pty = pty2
                        except Exception as retry_e:
                            last_error = f"Retry after WSL recovery: {retry_e}"
                            logger.warning("%s", last_error)
                            continue
                    else:
                        last_error = f"WSL recovery failed: {restart_msg}"
                        logger.warning("%s", last_error)
                        continue
                else:
                    continue

            # Allow process time to start, then verify it's alive
            await asyncio.sleep(0.5)
            alive = self.is_alive()
            logger.info("After 500ms: is_alive=%s", alive)

            if alive:
                logger.info(
                    "PTY spawned successfully: backend=%s, exe=%s, args=%s",
                    backend_name, attempt_exe, attempt_args.strip(),
                )
                return

            # Process died — capture any output for diagnostics
            error_output = ""
            try:
                error_output = self._pty.read(blocking=False) if self._pty else ""
            except Exception:
                pass

            last_error = f"{backend_name} process died after spawn. Output: {error_output!r}"
            logger.warning("%s", last_error)

        # All attempts exhausted
        raise PTYError.spawn_failed(command, last_error or "All spawn attempts failed")

    async def read(self) -> AsyncIterator[str]:
        if self._pty is None:
            return

        loop = asyncio.get_event_loop()
        while self.is_alive():
            try:
                data = await loop.run_in_executor(None, self._read_chunk)
                if data:
                    yield data
                else:
                    await asyncio.sleep(0.01)
            except Exception as e:
                if not self._closed:
                    raise PTYError.read_failed(str(e)) from e
                break

    def _read_chunk(self) -> str:
        """Blocking read, called in executor."""
        if self._pty is None:
            return ""
        try:
            return self._pty.read(blocking=False)
        except Exception as e:
            logger.warning("PTY read error: %s", e)
            return ""

    async def write(self, data: str) -> None:
        if self._pty is None:
            raise PTYError.write_failed("PTY not initialized")
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._pty.write, data)
        except Exception as e:
            raise PTYError.write_failed(str(e)) from e

    async def resize(self, size: TerminalSize) -> None:
        if self._pty is None:
            return
        try:
            self._pty.set_size(size.cols, size.rows)
        except Exception:
            pass

    async def close(self) -> None:
        self._closed = True
        if self._pty is not None:
            try:
                self._pty.close()
            except Exception:
                pass
            self._pty = None

    def is_alive(self) -> bool:
        if self._pty is None or self._closed:
            return False
        try:
            return self._pty.isalive()
        except Exception:
            return False


class PTYManager:
    """Manages PTY lifecycle with context manager support."""

    def __init__(self) -> None:
        self._pty: BasePTY | None = None
        self._output_callback: Callable[[str], None] | None = None

    async def __aenter__(self) -> PTYManager:
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.close()

    def _create_pty(self) -> BasePTY:
        """Create platform-appropriate PTY implementation."""
        if sys.platform == "win32":
            return WindowsPTY()
        else:
            return UnixPTY()

    async def spawn(
        self,
        command: str,
        cwd: Path,
        size: TerminalSize | None = None,
    ) -> None:
        """Spawn a new PTY with the given command."""
        if self._pty is not None:
            await self.close()

        self._pty = self._create_pty()
        await self._pty.spawn(command, cwd, size or TerminalSize())

    async def read(self) -> AsyncIterator[str]:
        """Read output from PTY as an async iterator."""
        if self._pty is None:
            return
        async for data in self._pty.read():
            yield data

    async def write(self, data: str) -> None:
        """Write input to the PTY."""
        if self._pty is None:
            raise PTYError.write_failed("PTY not spawned")
        await self._pty.write(data)

    async def resize(self, cols: int, rows: int) -> None:
        """Resize the PTY."""
        if self._pty is not None:
            await self._pty.resize(TerminalSize(cols=cols, rows=rows))

    async def close(self) -> None:
        """Close the PTY and clean up resources."""
        if self._pty is not None:
            await self._pty.close()
            self._pty = None

    def is_alive(self) -> bool:
        """Check if the PTY process is still running."""
        return self._pty is not None and self._pty.is_alive()

    @property
    def pid(self) -> int:
        """Return the PID of the underlying process, or 0 if unavailable."""
        if self._pty is not None:
            return self._pty.pid
        return 0
