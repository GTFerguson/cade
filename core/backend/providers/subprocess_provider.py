"""Generic subprocess provider — wraps any CLI tool as a chat provider.

A SubprocessProvider spawns a configured subprocess per chat turn,
substitutes the user's message into a command template, reads stdout,
and streams it back as TextDelta events. Optionally persists state
between turns via `--load`/`--save`-style flags in the command template
using a `{state}` placeholder.

Designed to work with any turn-based CLI tool that accepts a command
argument and emits markdown output. First user of this provider is
Padarax's padarax-cli, but anything from interactive tutorials to
pitch-deck viewers to other LLM agent CLIs can slot in via config
without writing a new Python class.

Configuration (``ProviderConfig.extra``):

- ``command``: ``list[str]``
    argv template with ``{message}`` and ``{state}`` placeholders.
    ``{message}`` is replaced with the last user message (the player's
    typed input). ``{state}`` is replaced with the absolute state file
    path (only meaningful if ``state_file`` is set).
- ``state_file``: ``str``
    Path to the subprocess's state file. Relative paths resolve against
    the project working directory. Enables the ``{state}`` placeholder.
    Omit for stateless subprocesses.
- ``cwd``: ``str``
    Working directory for the subprocess. Relative paths resolve against
    the project working directory. Defaults to the project working dir.
- ``timeout``: ``int``
    Subprocess wall-clock timeout in seconds. Default: 120.
- ``env``: ``dict[str, str]``
    Extra environment variables to set on top of the inherited environ.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
from collections.abc import AsyncIterator
from pathlib import Path

from core.backend.providers.base import BaseProvider
from core.backend.providers.config import ProviderConfig
from core.backend.providers.types import (
    ChatDone,
    ChatError,
    ChatEvent,
    ChatMessage,
    ProviderCapabilities,
    TextDelta,
)

logger = logging.getLogger(__name__)

# Read stdout in chunks this big. Small enough that each chunk reaches
# the frontend quickly (streaming feel), large enough that we're not
# syscall-bound on fast subprocess output.
_READ_CHUNK_BYTES = 1024


class SubprocessProvider(BaseProvider):
    """Wraps a CLI tool as a streaming chat provider.

    See the module docstring for the config schema. This class is
    deliberately generic — no project-specific logic lives here. Make
    it work for Padarax and it'll work for any similar subprocess
    whose output is markdown and whose state persistence uses CLI
    load/save flags.
    """

    def __init__(
        self,
        config: ProviderConfig,
        working_dir: Path | None = None,
    ) -> None:
        self._config = config
        self._name = config.name
        self._model = config.model or config.name
        self._working_dir = working_dir or Path.cwd()

        extra = config.extra
        command = extra.get("command")
        if not command or not isinstance(command, list):
            raise ValueError(
                f"SubprocessProvider '{config.name}' requires "
                f"extra.command to be a list of strings"
            )
        self._command_template: list[str] = [str(tok) for tok in command]
        self._state_file: str | None = extra.get("state_file") or None
        self._cwd: str | None = extra.get("cwd") or None
        self._timeout: float = float(extra.get("timeout", 120))
        # Command to run on fresh-session bootstrap so the UI isn't blank
        # before the player types anything. Mirrors the padarax-cli REPL
        # behaviour of printing the scene on startup.
        self._initial_command: str | None = extra.get("initial_command") or None
        extra_env_raw = extra.get("env") or {}
        self._extra_env: dict[str, str] = {
            str(k): str(v) for k, v in extra_env_raw.items()
        }

    # --- BaseProvider interface ---

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    @property
    def initial_command(self) -> str | None:
        return self._initial_command

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            streaming=True,
            tool_use=False,
            vision=False,
        )

    # --- Internal helpers ---

    def _resolve_cwd(self) -> Path:
        """Absolute cwd for the spawned subprocess."""
        if self._cwd is None:
            return self._working_dir
        cwd_path = Path(self._cwd)
        if cwd_path.is_absolute():
            return cwd_path
        return self._working_dir / cwd_path

    def _resolve_state_path(self) -> str:
        """Absolute path for the `{state}` placeholder. Empty if unset."""
        if not self._state_file:
            return ""
        state_path = Path(self._state_file)
        if state_path.is_absolute():
            return str(state_path)
        return str(self._working_dir / state_path)

    def _build_argv(self, user_message: str) -> list[str]:
        """Substitute `{message}` and `{state}` placeholders in the template."""
        state_path = self._resolve_state_path()
        argv: list[str] = []
        for token in self._command_template:
            # Literal string substitution — no shell involved. Users should
            # NOT embed shell metacharacters; argv goes straight to exec().
            argv.append(
                token.replace("{message}", user_message)
                     .replace("{state}", state_path)
            )
        return argv

    # --- Streaming implementation ---

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str | None = None,  # ignored — state lives in {state} file
    ) -> AsyncIterator[ChatEvent]:
        user_message = ""
        for msg in reversed(messages):
            if msg.role == "user":
                user_message = msg.content
                break

        if not user_message:
            yield ChatError(message="No user message to send", code="empty-prompt")
            return

        argv = self._build_argv(user_message)
        cwd = self._resolve_cwd()

        env = os.environ.copy()
        env.update(self._extra_env)

        logger.info(
            "SubprocessProvider '%s' spawning: %s (cwd=%s)",
            self._name, shlex.join(argv), cwd,
        )

        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(cwd),
                env=env,
            )
        except FileNotFoundError:
            yield ChatError(
                message=f"SubprocessProvider: command not found: {argv[0]}",
                code="not-found",
            )
            return
        except Exception as e:  # noqa: BLE001
            yield ChatError(
                message=f"SubprocessProvider spawn failed: {e}",
                code="spawn-failed",
            )
            return

        assert process.stdout is not None
        assert process.stderr is not None

        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        process.stdout.read(_READ_CHUNK_BYTES),
                        timeout=self._timeout,
                    )
                except asyncio.TimeoutError:
                    try:
                        process.kill()
                        await process.wait()
                    except ProcessLookupError:
                        pass
                    yield ChatError(
                        message=f"SubprocessProvider timed out after {self._timeout}s",
                        code="timeout",
                    )
                    return

                if not chunk:
                    break

                text = chunk.decode("utf-8", errors="replace")
                yield TextDelta(content=text)

            # Drain remaining stderr after stdout closes so we can surface
            # errors in logs; don't block gameplay on it.
            try:
                stderr_bytes = await asyncio.wait_for(
                    process.stderr.read(), timeout=5.0
                )
            except asyncio.TimeoutError:
                stderr_bytes = b""

            await process.wait()
            if process.returncode != 0:
                stderr_text = stderr_bytes.decode("utf-8", errors="replace").strip()
                logger.warning(
                    "SubprocessProvider '%s' exit code %d: %s",
                    self._name, process.returncode, stderr_text,
                )

        except Exception as e:  # noqa: BLE001
            logger.exception("SubprocessProvider streaming failed")
            yield ChatError(
                message=f"Streaming error: {e}",
                code="stream-error",
            )
            return

        yield ChatDone()
