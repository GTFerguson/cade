"""Interactive CLI for testing the chat pipeline.

Bypasses the websocket and exercises the same provider + tool registry path
the live UI uses, so a stuck stream is reproducible (and observable) outside
the desktop app.

Usage:
    python -m backend.cli_chat                          # default provider, code mode
    python -m backend.cli_chat --provider minimax --mode research --orch
    python -m backend.cli_chat --cwd /path/to/project   # set working directory

Each input line is a message. Type a single dot (.) on its own line to send
a multi-line message. Ctrl+D exits. Ctrl+C cancels the current stream.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

from backend.prompts import compose_prompt
from backend.providers.registry import ProviderRegistry
from core.backend.providers.config import get_providers_config
from core.backend.providers.types import (
    ChatDone,
    ChatError,
    ChatMessage,
    SystemInfo,
    TextDelta,
    ThinkingDelta,
    ToolResult,
    ToolUseStart,
)


def _stamp(t0: float) -> str:
    return f"{time.monotonic() - t0:6.2f}s"


async def _read_input() -> str | None:
    """Read a message from stdin. Returns None on EOF."""
    print("\n\033[36m❯\033[0m ", end="", flush=True)
    first = await asyncio.to_thread(sys.stdin.readline)
    if not first:
        return None
    first = first.rstrip("\n")
    if first.strip() == ".":
        # Multi-line: read until "." on its own line
        lines: list[str] = []
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            line = line.rstrip("\n")
            if line.strip() == ".":
                break
            lines.append(line)
        return "\n".join(lines)
    return first


async def _chat_once(provider, mode: str, working_dir: Path, orchestrator: bool, history: list[ChatMessage]) -> None:
    system_prompt = compose_prompt(mode, working_dir, orchestrator=orchestrator)
    t0 = time.monotonic()
    print(f"\033[2m--- streaming (mode={mode}, orch={orchestrator}, sysprompt={len(system_prompt)} chars) ---\033[0m", flush=True)

    assistant_text = ""
    thinking_open = False

    try:
        async for event in provider.stream_chat(history, system_prompt):
            if isinstance(event, SystemInfo):
                print(f"\033[2m[{_stamp(t0)}] SYSTEM model={event.model}\033[0m", flush=True)
            elif isinstance(event, TextDelta):
                if thinking_open:
                    print("\033[0m", end="", flush=True)
                    thinking_open = False
                print(event.content, end="", flush=True)
                assistant_text += event.content
            elif isinstance(event, ThinkingDelta):
                if not thinking_open:
                    print("\n\033[35m[thinking] ", end="", flush=True)
                    thinking_open = True
                print(event.content, end="", flush=True)
            elif isinstance(event, ToolUseStart):
                if thinking_open:
                    print("\033[0m", end="", flush=True)
                    thinking_open = False
                preview = str(event.tool_input)[:200]
                print(f"\n\033[33m[{_stamp(t0)}] TOOL_START {event.tool_name}({preview})\033[0m", flush=True)
            elif isinstance(event, ToolResult):
                preview = (event.content or "")[:200].replace("\n", " ")
                color = "32" if event.status == "success" else "31"
                print(f"\033[{color}m[{_stamp(t0)}] TOOL_RESULT {event.tool_name} status={event.status} {preview}\033[0m", flush=True)
            elif isinstance(event, ChatDone):
                if thinking_open:
                    print("\033[0m", end="", flush=True)
                    thinking_open = False
                print(f"\n\033[2m[{_stamp(t0)}] DONE usage={event.usage}\033[0m", flush=True)
                if assistant_text:
                    history.append(ChatMessage(role="assistant", content=assistant_text))
            elif isinstance(event, ChatError):
                if thinking_open:
                    print("\033[0m", end="", flush=True)
                    thinking_open = False
                print(f"\n\033[31m[{_stamp(t0)}] ERROR {event.message} (code={event.code})\033[0m", flush=True)
    except asyncio.CancelledError:
        if thinking_open:
            print("\033[0m", end="", flush=True)
        print(f"\n\033[31m[{_stamp(t0)}] CANCELLED\033[0m", flush=True)
        raise


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", help="Provider name from ~/.cade/providers.toml (default: configured default)")
    parser.add_argument("--mode", default="code", help="Mode: code | plan | research | review (default: code)")
    parser.add_argument("--orch", action="store_true", help="Enable orchestrator overlay")
    parser.add_argument("--cwd", default=".", help="Working directory (default: cwd)")
    parser.add_argument("--log-level", default="INFO", help="Backend log level (default: INFO)")
    parser.add_argument("--prompt", help="Send this single prompt and exit (non-interactive)")
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        stream=sys.stderr,
    )

    working_dir = Path(args.cwd).resolve()
    if not working_dir.exists():
        print(f"--cwd does not exist: {working_dir}", file=sys.stderr)
        return 1

    config = get_providers_config()
    registry = ProviderRegistry.from_config(config, working_dir=working_dir, connection_id="cli")

    provider_name = args.provider or config.default_provider
    provider = registry.get(provider_name)
    if provider is None:
        available = ", ".join(p["name"] for p in registry.list_providers())
        print(f"Unknown provider {provider_name!r}. Available: {available}", file=sys.stderr)
        return 1

    if hasattr(provider, "set_mode"):
        provider.set_mode(args.mode)

    print(f"\033[1mCADE chat CLI\033[0m  provider={provider_name}  mode={args.mode}  orch={args.orch}  cwd={working_dir}")
    print("\033[2mType a message and press Enter. Single '.' on a line starts/ends a multi-line block. Ctrl+C cancels stream, Ctrl+D exits.\033[0m")

    history: list[ChatMessage] = []

    if args.prompt:
        history.append(ChatMessage(role="user", content=args.prompt))
        await _chat_once(provider, args.mode, working_dir, args.orch, history)
        return 0

    while True:
        try:
            content = await _read_input()
        except KeyboardInterrupt:
            print("\n\033[2m^C — exiting\033[0m", flush=True)
            return 0
        if content is None:
            print("\n\033[2m^D — exiting\033[0m", flush=True)
            return 0
        content = content.strip()
        if not content:
            continue

        history.append(ChatMessage(role="user", content=content))
        chat_task = asyncio.create_task(
            _chat_once(provider, args.mode, working_dir, args.orch, history)
        )
        try:
            await chat_task
        except KeyboardInterrupt:
            chat_task.cancel()
            try:
                await chat_task
            except (asyncio.CancelledError, KeyboardInterrupt):
                pass
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()) or 0)
    except KeyboardInterrupt:
        sys.exit(130)
