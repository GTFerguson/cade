"""LiteLLM-based API provider for any supported LLM."""

from __future__ import annotations

import json
import logging
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

_MAX_TOOL_TURNS = 10


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

    def __init__(self, config: ProviderConfig, tool_registry: ToolRegistry | None = None) -> None:
        self._config = config
        self._name = config.name
        self._model = config.model
        self._tool_registry = tool_registry

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
            defs = await self._tool_registry.definitions_async()
            if defs:
                kwargs["tools"] = [_tool_def_to_litellm(d) for d in defs]
                kwargs["tool_choice"] = "auto"

        tool_turn_count = 0

        while True:
            try:
                response = await litellm.acompletion(**kwargs)
            except Exception as e:
                logger.exception("LiteLLM streaming error: %s", e)
                yield ChatError(
                    message=str(e),
                    code=str(getattr(e, "status_code", "unknown")),
                )
                return

            finish_reason = None
            pending_tool_calls: dict[int, dict] = {}
            last_chunk = None

            async for chunk in response:
                last_chunk = chunk
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
                tool_turn_count += 1
                if tool_turn_count > _MAX_TOOL_TURNS:
                    yield ChatError(
                        message=f"Tool loop exceeded maximum {_MAX_TOOL_TURNS} turns",
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
                                "arguments": tc["arguments"],
                            },
                        }
                        for tc in sorted_calls
                    ],
                }
                kwargs["messages"].append(assistant_turn)

                # Execute each tool
                for tc in sorted_calls:
                    try:
                        args_dict = json.loads(tc["arguments"]) if tc["arguments"] else {}
                    except json.JSONDecodeError:
                        args_dict = {}

                    yield ToolUseStart(
                        tool_id=tc["id"],
                        tool_name=tc["name"],
                        tool_input=args_dict,
                    )

                    result_content = await self._tool_registry.execute_async(tc["name"], args_dict)
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
                usage = _extract_usage(last_chunk)
                yield ChatDone(usage=usage)
                return

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            streaming=True,
            tool_use=self._tool_registry is not None,
            vision=False,
        )
