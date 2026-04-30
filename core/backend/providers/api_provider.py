"""LiteLLM-based API provider for any supported LLM."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator

import litellm

from core.backend.providers.base import BaseProvider
from core.backend.providers.config import ProviderConfig
from core.backend.providers.tool_executor import ToolRegistry
from core.backend.providers.types import (
    ChatDone,
    ChatError,
    ChatEvent,
    ChatMessage,
    ProviderCapabilities,
    SystemInfo,
    TextDelta,
    ToolDefinition,
    ToolResult,
    ToolUseStart,
)

logger = logging.getLogger(__name__)

# Suppress litellm's verbose logging
litellm.suppress_debug_info = True

_DEFAULT_MAX_TOOL_TURNS = 100


def _build_litellm_messages(messages: list[ChatMessage], system_prompt: str | None) -> list[dict]:
    """Build litellm message list from ChatMessage objects."""
    result = []
    if system_prompt:
        result.append({"role": "system", "content": system_prompt})
    for msg in messages:
        result.append({"role": msg.role, "content": msg.content})
    return result


def _tool_def_to_litellm(defn: ToolDefinition) -> dict:
    """Convert ToolDefinition to litellm's OpenAI-compatible format."""
    return {
        "type": "function",
        "function": {
            "name": defn.name,
            "description": defn.description,
            "parameters": defn.parameters_schema,
        },
    }


def _extract_usage(last_chunk) -> dict:
    """Extract token usage from the final chunk."""
    if last_chunk and hasattr(last_chunk, "usage") and last_chunk.usage:
        return {
            "prompt_tokens": getattr(last_chunk.usage, "prompt_tokens", 0),
            "completion_tokens": getattr(last_chunk.usage, "completion_tokens", 0),
        }
    return {}


class APIProvider(BaseProvider):
    """Provider that calls LLM APIs via LiteLLM."""

    # Tools that require the orchestrator overlay (or orchestrator mode) to be visible.
    _ORCHESTRATOR_ONLY_TOOLS = frozenset({"spawn_agent", "list_agents"})

    def __init__(self, config: ProviderConfig, tool_registry: ToolRegistry | None = None) -> None:
        self._config = config
        self._name = config.name
        self._model = config.model
        self._tool_registry = tool_registry
        self._mode: str = config.extra.get("mode", "code")
        self._orchestrator_overlay: bool = False
        self._max_tool_turns: int = int(config.extra.get("max_tool_turns", _DEFAULT_MAX_TOOL_TURNS))

    def set_mode(self, mode: str) -> None:
        self._mode = mode

    def set_orchestrator(self, enabled: bool) -> None:
        self._orchestrator_overlay = enabled

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    def _build_kwargs(self, messages: list[dict]) -> dict:
        """Build litellm kwargs from config and current messages.

        Tools are injected separately via definitions_async() in stream_chat.
        """
        kwargs: dict = {
            "model": self._model,
            "messages": messages,
            "stream": True,
        }

        if self._config.api_key:
            kwargs["api_key"] = self._config.api_key

        if self._config.region:
            kwargs["aws_region_name"] = self._config.region

        for key, value in self._config.extra.items():
            kwargs[key] = value

        return kwargs

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        system_prompt: str | None = None,
    ) -> AsyncIterator[ChatEvent]:
        """Stream a chat completion via LiteLLM.

        Supports tool calling: if the model requests a tool, executes it via
        the configured ToolRegistry, then continues the conversation.

        If system_prompt is None, uses the default from provider config.
        """
        t_start = time.monotonic()
        logger.info(
            "[%s] stream_chat start: model=%s, mode=%s, n_messages=%d, sysprompt_len=%d",
            self._config.name, self._model, self._mode, len(messages),
            len(system_prompt) if system_prompt else 0,
        )

        # Emit SystemInfo at the start so the frontend knows the model
        yield SystemInfo(
            model=self._model,
            session_id="",
            tools=[],
            slash_commands=[],
            version="1.0",
        )

        # Use config default if no system_prompt provided
        if system_prompt is None and self._config.system_prompt:
            system_prompt = self._config.system_prompt

        litellm_messages = _build_litellm_messages(messages, system_prompt)
        kwargs = self._build_kwargs(litellm_messages)

        if self._tool_registry:
            t_tools = time.monotonic()
            defs = await self._tool_registry.definitions_async()
            allow_orchestrator_tools = self._mode == "orchestrator" or self._orchestrator_overlay
            if not allow_orchestrator_tools:
                defs = [d for d in defs if d.name not in self._ORCHESTRATOR_ONLY_TOOLS]
            logger.info(
                "[%s] tool definitions resolved: n=%d (%.2fs)",
                self._config.name, len(defs), time.monotonic() - t_tools,
            )
            if defs:
                kwargs["tools"] = [_tool_def_to_litellm(d) for d in defs]
                kwargs["tool_choice"] = "auto"

        tool_turn_count = 0

        while True:
            t_request = time.monotonic()
            logger.info(
                "[%s] turn %d: calling acompletion (n_messages=%d, n_tools=%d)",
                self._config.name, tool_turn_count,
                len(kwargs["messages"]), len(kwargs.get("tools") or []),
            )
            _retries = 0
            _max_retries = 3
            while True:
                try:
                    response = await litellm.acompletion(**kwargs)
                    break
                except (litellm.APIConnectionError, litellm.ServiceUnavailableError) as e:
                    if _retries < _max_retries:
                        _retries += 1
                        delay = 2 ** (_retries - 1)
                        logger.warning(
                            "[%s] transient network error (attempt %d/%d), retrying in %.0fs: %s",
                            self._config.name, _retries, _max_retries, delay, e,
                        )
                        await asyncio.sleep(delay)
                    else:
                        logger.exception("[%s] LiteLLM acompletion error: %s", self._config.name, e)
                        yield ChatError(message=str(e), code=str(getattr(e, "status_code", "unknown")))
                        return
                except litellm.InternalServerError as e:
                    msg = str(e).lower()
                    if _retries < _max_retries and ("name resolution" in msg or "cannot connect" in msg or "connection" in msg):
                        _retries += 1
                        delay = 2 ** (_retries - 1)
                        logger.warning(
                            "[%s] transient connection error (attempt %d/%d), retrying in %.0fs: %s",
                            self._config.name, _retries, _max_retries, delay, e,
                        )
                        await asyncio.sleep(delay)
                    else:
                        logger.exception("[%s] LiteLLM acompletion error: %s", self._config.name, e)
                        yield ChatError(message=str(e), code=str(getattr(e, "status_code", "unknown")))
                        return
                except Exception as e:
                    logger.exception("[%s] LiteLLM acompletion error: %s", self._config.name, e)
                    yield ChatError(message=str(e), code=str(getattr(e, "status_code", "unknown")))
                    return
            logger.info(
                "[%s] turn %d: acompletion returned, awaiting first chunk (%.2fs since request, %.2fs since start)",
                self._config.name, tool_turn_count,
                time.monotonic() - t_request, time.monotonic() - t_start,
            )

            finish_reason = None
            pending_tool_calls: dict[int, dict] = {}
            last_chunk = None
            accumulated_prompt_tokens = 0
            accumulated_completion_tokens = 0
            first_chunk_logged = False

            async for chunk in response:
                if not first_chunk_logged:
                    logger.info(
                        "[%s] turn %d: first chunk received (%.2fs since request)",
                        self._config.name, tool_turn_count,
                        time.monotonic() - t_request,
                    )
                    first_chunk_logged = True
                last_chunk = chunk

                # Accumulate usage across all chunks — Anthropic-format providers
                # emit prompt_tokens in the first chunk (message_start), not the last.
                if hasattr(chunk, "usage") and chunk.usage:
                    pt = getattr(chunk.usage, "prompt_tokens", 0) or 0
                    ct = getattr(chunk.usage, "completion_tokens", 0) or 0
                    if pt:
                        accumulated_prompt_tokens = pt
                    if ct:
                        accumulated_completion_tokens = ct

                choice = chunk.choices[0] if chunk.choices else None
                if not choice:
                    continue

                delta = choice.delta
                finish_reason = choice.finish_reason or finish_reason

                # Text delta
                if delta.content:
                    yield TextDelta(content=delta.content)

                # Accumulate tool call fragments by index
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in pending_tool_calls:
                            pending_tool_calls[idx] = {
                                "id": tc.id or "",
                                "name": "",
                                "arguments": "",
                            }
                        if tc.id and not pending_tool_calls[idx]["id"]:
                            pending_tool_calls[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            pending_tool_calls[idx]["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            pending_tool_calls[idx]["arguments"] += tc.function.arguments

            # Handle tool calls or finish
            if finish_reason == "tool_calls" and self._tool_registry and pending_tool_calls:
                tool_names = [
                    pending_tool_calls[i].get("name", "?")
                    for i in sorted(pending_tool_calls)
                ]
                logger.info(
                    "[%s] turn %d: model requested %d tool call(s): %s",
                    self._config.name, tool_turn_count, len(tool_names), tool_names,
                )
                tool_turn_count += 1
                if tool_turn_count > self._max_tool_turns:
                    yield ChatError(
                        message=f"Tool loop exceeded maximum {self._max_tool_turns} turns",
                        code="tool-loop-max-turns",
                    )
                    return

                # Sort by index to preserve order
                sorted_calls = [pending_tool_calls[i] for i in sorted(pending_tool_calls)]

                # Append assistant turn with tool_calls
                assistant_turn = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {
                                "name": tc["name"],
                                # MiniMax (and other strict Anthropic-compatible
                                # gateways) reject "" here — a no-arg tool call
                                # must serialise as the JSON object "{}".
                                "arguments": tc["arguments"] or "{}",
                            },
                        }
                        for tc in sorted_calls
                    ],
                }
                kwargs["messages"].append(assistant_turn)

                # Parse args and announce all tool calls before executing
                parsed: list[tuple[dict, dict]] = []
                for tc in sorted_calls:
                    try:
                        args_dict = json.loads(tc["arguments"]) if tc["arguments"] else {}
                    except json.JSONDecodeError:
                        args_dict = {}
                    parsed.append((tc, args_dict))
                    yield ToolUseStart(
                        tool_id=tc["id"],
                        tool_name=tc["name"],
                        tool_input=args_dict,
                    )

                # Execute all tool calls concurrently so parallel spawns run in parallel
                import asyncio as _asyncio
                t_exec = time.monotonic()
                results = await _asyncio.gather(*[
                    self._tool_registry.execute_async(tc["name"], args)
                    for tc, args in parsed
                ])
                logger.info(
                    "[%s] tool batch executed in %.2fs",
                    self._config.name, time.monotonic() - t_exec,
                )

                for (tc, _args), result_content in zip(parsed, results):
                    status = "error" if result_content.startswith("Error:") else "success"
                    yield ToolResult(
                        tool_id=tc["id"],
                        tool_name=tc["name"],
                        status=status,
                        content=result_content,
                    )
                    kwargs["messages"].append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result_content,
                    })

                # Continue the loop — next iteration calls litellm again
                continue

            else:
                # Non-tool finish
                if accumulated_prompt_tokens or accumulated_completion_tokens:
                    usage = {
                        "prompt_tokens": accumulated_prompt_tokens,
                        "completion_tokens": accumulated_completion_tokens,
                    }
                else:
                    usage = _extract_usage(last_chunk)
                logger.info(
                    "[%s] stream_chat done: finish_reason=%s, total=%.2fs, usage=%s",
                    self._config.name, finish_reason,
                    time.monotonic() - t_start, usage,
                )
                yield ChatDone(usage=usage)
                return

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            streaming=True,
            tool_use=self._tool_registry is not None,
            vision=False,
        )
