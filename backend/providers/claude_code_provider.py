"""Claude Code subprocess provider using --output-format stream-json."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from backend.providers.base import BaseProvider
from backend.providers.config import ProviderConfig
from backend.providers.types import (
    ChatDone,
    ChatError,
    ChatEvent,
    ChatMessage,
    ProviderCapabilities,
    TextDelta,
    ThinkingDelta,
    ToolResult,
    ToolUseStart,
)

logger = logging.getLogger(__name__)


class ClaudeCodeProvider(BaseProvider):
    """Provider that runs Claude Code as a subprocess with stream-json output.

    Each user message spawns a new `claude` process with --continue to maintain
    conversation history on Claude Code's side. CADE stores messages for UI
    replay only.
    """

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        self._name = config.name
        self._model = config.model or "sonnet"
        self._session_id = str(uuid.uuid4())
        self._has_session = False
        self._working_dir: Path | None = None
        self._process: asyncio.subprocess.Process | None = None

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    @property
    def session_id(self) -> str:
        return self._session_id

    def set_working_dir(self, path: Path) -> None:
        self._working_dir = path

    async def cancel(self) -> None:
        """Terminate the running subprocess."""
        if self._process is not None and self._process.returncode is None:
            try:
                self._process.terminate()
                # Give it a moment to exit gracefully
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    self._process.kill()
            except ProcessLookupError:
                pass
            self._process = None

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str | None = None,
    ) -> AsyncIterator[ChatEvent]:
        """Stream a chat response by spawning a Claude Code subprocess."""
        claude_path = shutil.which("claude")
        if claude_path is None:
            yield ChatError(
                message="Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
                code="not-found",
            )
            return

        # The last user message is what we send; prior history is managed
        # by Claude Code via --session-id --continue
        prompt = ""
        for msg in reversed(messages):
            if msg.role == "user":
                prompt = msg.content
                break

        if not prompt:
            yield ChatError(message="No user message to send", code="empty-prompt")
            return

        cmd = [
            claude_path,
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose",
        ]

        if self._has_session:
            cmd.extend(["--resume", self._session_id])

        if self._model:
            cmd.extend(["--model", self._model])

        allowed_tools = self._config.extra.get("allowed_tools", "")
        if allowed_tools:
            cmd.extend(["--allowedTools", allowed_tools])

        max_turns = self._config.extra.get("max_turns", "")
        if max_turns:
            cmd.extend(["--max-turns", str(max_turns)])

        cwd = str(self._working_dir) if self._working_dir else None

        # Clear CLAUDECODE env var so the subprocess doesn't think it's nested
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        try:
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )

            async for event in self._parse_stream(self._process):
                yield event

        except FileNotFoundError:
            yield ChatError(
                message="Claude Code CLI not found",
                code="not-found",
            )
        except Exception as e:
            logger.exception("ClaudeCodeProvider error: %s", e)
            yield ChatError(message=str(e), code="subprocess-error")
        finally:
            self._process = None

    async def _parse_stream(
        self,
        process: asyncio.subprocess.Process,
    ) -> AsyncIterator[ChatEvent]:
        """Parse NDJSON stream from Claude Code subprocess stdout.

        Claude Code stream-json emits these top-level event types:
        - system: init info (session_id, tools, model)
        - assistant: complete message with content blocks (text, tool_use, thinking)
        - user: tool results returned to the model
        - result: final summary (stop_reason, usage, cost)
        - rate_limit_event: rate limit status
        """
        assert process.stdout is not None

        usage: dict = {}

        async for raw_line in process.stdout:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                logger.debug("Non-JSON line from claude: %s", line[:200])
                continue

            event_type = data.get("type", "")

            # Capture session_id for --continue on subsequent calls
            if not self._has_session:
                sid = data.get("session_id")
                if sid:
                    self._session_id = sid
                    self._has_session = True

            if event_type == "assistant":
                message = data.get("message", {})
                content_blocks = message.get("content", [])

                for block in content_blocks:
                    block_type = block.get("type", "")

                    if block_type == "text":
                        text = block.get("text", "")
                        if text:
                            yield TextDelta(content=text)

                    elif block_type == "tool_use":
                        tool_id = block.get("id", "")
                        tool_name = block.get("name", "")
                        yield ToolUseStart(tool_id=tool_id, tool_name=tool_name)

                    elif block_type == "thinking":
                        text = block.get("thinking", "")
                        if text:
                            yield ThinkingDelta(content=text)

            elif event_type == "user":
                # Tool results — the model executed a tool and got results.
                # Emit ToolResult for each tool_result content block.
                content_blocks = data.get("message", {}).get("content", [])
                if not content_blocks:
                    content_blocks = data.get("content", [])
                for block in content_blocks:
                    if block.get("type") == "tool_result":
                        tool_use_id = block.get("tool_use_id", "")
                        is_error = block.get("is_error", False)
                        yield ToolResult(
                            tool_id=tool_use_id,
                            tool_name="",
                            status="error" if is_error else "success",
                        )

            elif event_type == "result":
                result_usage = data.get("usage", {})
                usage = {
                    "prompt_tokens": result_usage.get("input_tokens", 0),
                    "completion_tokens": result_usage.get("output_tokens", 0),
                }
                stop_reason = data.get("stop_reason", "")
                is_error = data.get("is_error", False)
                if is_error:
                    yield ChatError(
                        message=data.get("result", "Unknown error"),
                        code="claude-code-error",
                    )
                else:
                    yield ChatDone(usage=usage)

        # Wait for process to exit
        await process.wait()

        # If process exited with error and we never got a done event,
        # check stderr
        if process.returncode and process.returncode != 0:
            stderr_data = b""
            if process.stderr:
                stderr_data = await process.stderr.read()
            stderr_text = stderr_data.decode("utf-8", errors="replace").strip()
            if stderr_text:
                yield ChatError(
                    message=f"Claude Code exited with code {process.returncode}: {stderr_text[:500]}",
                    code="process-exit",
                )

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            streaming=True,
            tool_use=True,
            vision=False,
        )
