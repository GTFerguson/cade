"""PTY lifecycle management with cross-platform support."""

from __future__ import annotations

import asyncio
import logging
import sys
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, AsyncIterator

from backend.errors import PTYError
from backend.types import TerminalSize
from backend.wsl_health import is_wsl_error, restart_wsl

logger = logging.getLogger(__name__)

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


class UnixPTY(BasePTY):
    """Unix PTY implementation using pexpect."""

    def __init__(self) -> None:
        self._process: "pexpect.spawn | None" = None  # type: ignore[name-defined]
        self._read_task: asyncio.Task | None = None

    async def spawn(self, command: str, cwd: Path, size: TerminalSize) -> None:
        import pexpect

        try:
            self._process = pexpect.spawn(
                command,
                cwd=str(cwd),
                dimensions=(size.rows, size.cols),
                encoding="utf-8",
                timeout=None,
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
            self._process.expect(pexpect.TIMEOUT, timeout=0.1)
        except pexpect.TIMEOUT:
            pass
        except pexpect.EOF:
            return ""
        return self._process.before or ""

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


class WindowsPTY(BasePTY):
    """Windows PTY implementation using pywinpty."""

    def __init__(self) -> None:
        self._pty: "winpty.PTY | None" = None  # type: ignore[name-defined]
        self._closed = False

    async def spawn(self, command: str, cwd: Path, size: TerminalSize) -> None:
        from winpty import PTY, WinptyError

        try:
            self._pty = PTY(size.cols, size.rows)
            self._pty.spawn(command, cwd=str(cwd))
        except (WinptyError, Exception) as e:
            error_msg = str(e)

            # Check if this is a WSL error that might be recoverable
            if "wsl" in command.lower() and is_wsl_error(error_msg):
                logger.warning("WSL spawn failed, attempting recovery: %s", error_msg)

                # Attempt WSL restart
                success, restart_msg = restart_wsl()
                if success:
                    logger.info("WSL recovered, retrying spawn")
                    try:
                        self._pty = PTY(size.cols, size.rows)
                        self._pty.spawn(command, cwd=str(cwd))
                        return
                    except Exception as retry_e:
                        raise PTYError.spawn_failed(
                            command, f"Retry after WSL recovery failed: {retry_e}"
                        ) from retry_e
                else:
                    raise PTYError.spawn_failed(
                        command, f"WSL recovery failed: {restart_msg}"
                    ) from e

            raise PTYError.spawn_failed(command, error_msg) from e

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
            logger.debug("PTY read error: %s", e)
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

        # Verify PTY is alive after spawn
        if not self.is_alive():
            raise PTYError.spawn_failed(command, "PTY process exited immediately")

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
