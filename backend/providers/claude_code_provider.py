"""Claude Code subprocess provider using --output-format stream-json."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import pty
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
    SystemInfo,
    TextDelta,
    ThinkingDelta,
    ToolResult,
    ToolUseStart,
)

logger = logging.getLogger(__name__)

ARCHITECT_PROMPT = """You are in ARCHITECT mode (read-only).
Explore, analyze, and create implementation plans.
You can read files, search code, and browse the web.
You cannot edit, write, or delete files.
When your plan is ready, suggest switching to Code mode with /code."""

CODE_PROMPT = """You are in CODE mode with full tool access.
Implement changes as needed. If you need to step back and plan, suggest /plan."""

REVIEW_PROMPT = """You are in REVIEW mode (read-only).
Review code for bugs, security issues, and improvements.
You can read files and search code but cannot make changes.
Provide clear, actionable feedback."""

ORCHESTRATOR_PROMPT = """You are in ORCHESTRATOR mode.
You can spawn and manage worker agents to parallelize tasks.
Use the orchestrator MCP tools to create agents, monitor their progress,
and collect their results. Coordinate multi-agent workflows."""

MODE_PROMPTS = {
    "architect": ARCHITECT_PROMPT,
    "code": CODE_PROMPT,
    "review": REVIEW_PROMPT,
    "orchestrator": ORCHESTRATOR_PROMPT,
}


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
        self._streaming_partial = False
        self._pty_fd: int | None = None
        self._mode = "code"
        self._mcp_config_path: Path | None = None

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def mode(self) -> str:
        return self._mode

    def set_mode(self, mode: str) -> None:
        self._mode = mode

    def set_working_dir(self, path: Path) -> None:
        self._working_dir = path

    def set_mcp_config(self, path: Path) -> None:
        self._mcp_config_path = path

    async def cancel(self) -> None:
        """Terminate the running subprocess and close the PTY."""
        # Close the PTY first so the reader loop exits
        if self._pty_fd is not None:
            try:
                os.close(self._pty_fd)
            except OSError:
                pass
            self._pty_fd = None

        if self._process is not None and self._process.returncode is None:
            try:
                self._process.terminate()
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
        """Stream a chat response by spawning a Claude Code subprocess.

        Uses a PTY for stdout so Node.js flushes each NDJSON line immediately
        instead of block-buffering to a pipe.
        """
        claude_path = shutil.which("claude")
        if claude_path is None:
            yield ChatError(
                message="Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
                code="not-found",
            )
            return

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
            "--include-partial-messages",
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

        if self._mode in ("architect", "review"):
            cmd.extend(["--permission-mode", "plan"])

        # Orchestrator mode: inject prompt and pre-approve MCP tools
        if self._mode == "orchestrator" and self._mcp_config_path:
            from backend.orchestrator.prompts import ORCHESTRATOR_ARCHITECT_PROMPT
            cmd.extend(["--append-system-prompt", ORCHESTRATOR_ARCHITECT_PROMPT])
            cmd.extend(["--allowedTools", "mcp__cade-orchestrator__spawn_agent,mcp__cade-orchestrator__list_agents"])
        else:
            system_prompt = MODE_PROMPTS.get(self._mode)
            if system_prompt:
                cmd.extend(["--append-system-prompt", system_prompt])

        if self._mcp_config_path and self._mcp_config_path.exists():
            cmd.extend(["--mcp-config", str(self._mcp_config_path)])

        cwd = str(self._working_dir) if self._working_dir else None

        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        env["TERM"] = "dumb"
        env["NO_COLOR"] = "1"

        master_fd = None
        try:
            # PTY so Node.js line-buffers stdout instead of block-buffering
            master_fd, slave_fd = pty.openpty()
            self._pty_fd = master_fd

            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=slave_fd,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=env,
            )
            os.close(slave_fd)

            async for event in self._parse_pty_stream(master_fd, self._process):
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
            if master_fd is not None:
                try:
                    os.close(master_fd)
                except OSError:
                    pass
            self._pty_fd = None
            self._process = None

    async def _parse_pty_stream(
        self,
        master_fd: int,
        process: asyncio.subprocess.Process,
    ) -> AsyncIterator[ChatEvent]:
        """Read NDJSON lines from a PTY master fd and yield ChatEvents.

        PTY forces Node.js to line-buffer stdout, giving us real-time streaming
        instead of block-buffered output that only arrives at process exit.
        Uses asyncio add_reader for non-blocking I/O on the fd.
        """
        loop = asyncio.get_running_loop()
        buf = b""
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        def _on_readable() -> None:
            """Called by the event loop when the PTY master fd has data."""
            try:
                chunk = os.read(master_fd, 16384)
                if chunk:
                    queue.put_nowait(chunk)
                else:
                    queue.put_nowait(None)
                    loop.remove_reader(master_fd)
            except OSError:
                queue.put_nowait(None)
                try:
                    loop.remove_reader(master_fd)
                except Exception:
                    pass

        loop.add_reader(master_fd, _on_readable)
        self._streaming_partial = False

        try:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break

                buf += chunk

                while b"\n" in buf:
                    raw_line, buf = buf.split(b"\n", 1)
                    line = raw_line.replace(b"\r", b"").strip()
                    if not line:
                        continue

                    line_str = line.decode("utf-8", errors="replace")

                    try:
                        data = json.loads(line_str)
                    except json.JSONDecodeError:
                        logger.debug("Non-JSON line from claude: %s", line_str[:200])
                        continue

                    async for event in self._process_json_event(data):
                        yield event
        finally:
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass

        await process.wait()

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

    async def _process_json_event(self, data: dict) -> AsyncIterator[ChatEvent]:
        """Process a single parsed JSON event from Claude Code stream-json output."""
        event_type = data.get("type", "")

        # Capture session_id for --resume on subsequent calls
        if not self._has_session:
            sid = data.get("session_id")
            if sid:
                self._session_id = sid
                self._has_session = True

        # --- Partial streaming events (from --include-partial-messages) ---
        if event_type == "stream_event":
            self._streaming_partial = True
            stream_event = data.get("event", {})
            se_type = stream_event.get("type", "")

            if se_type == "content_block_delta":
                delta = stream_event.get("delta", {})
                delta_type = delta.get("type", "")
                if delta_type == "text_delta":
                    text = delta.get("text", "")
                    if text:
                        yield TextDelta(content=text)
                elif delta_type == "thinking_delta":
                    text = delta.get("thinking", "")
                    if text:
                        yield ThinkingDelta(content=text)

            elif se_type == "content_block_start":
                block = stream_event.get("content_block", {})
                if block.get("type") == "tool_use":
                    yield ToolUseStart(
                        tool_id=block.get("id", ""),
                        tool_name=block.get("name", ""),
                    )

            return

        # --- System init event ---
        if event_type == "system":
            yield SystemInfo(
                model=data.get("model", self._model),
                session_id=self._session_id,
                tools=[t.get("name", "") if isinstance(t, dict) else str(t) for t in data.get("tools", [])],
                slash_commands=[c.get("name", c) if isinstance(c, dict) else str(c) for c in data.get("slash_commands", [])],
                version=data.get("claude_code_version", ""),
            )
            return

        # --- Full assistant message (skip content if we streamed partials) ---
        if event_type == "assistant":
            if not self._streaming_partial:
                message = data.get("message", {})
                for block in message.get("content", []):
                    block_type = block.get("type", "")
                    if block_type == "text":
                        text = block.get("text", "")
                        if text:
                            yield TextDelta(content=text)
                    elif block_type == "tool_use":
                        yield ToolUseStart(
                            tool_id=block.get("id", ""),
                            tool_name=block.get("name", ""),
                        )
                    elif block_type == "thinking":
                        text = block.get("thinking", "")
                        if text:
                            yield ThinkingDelta(content=text)

        elif event_type == "user":
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
            cost = data.get("total_cost_usd", 0)
            is_error = data.get("is_error", False)
            if is_error:
                yield ChatError(
                    message=data.get("result", "Unknown error"),
                    code="claude-code-error",
                )
            else:
                yield ChatDone(usage=usage, cost=cost)
            self._streaming_partial = False

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            streaming=True,
            tool_use=True,
            vision=False,
        )
