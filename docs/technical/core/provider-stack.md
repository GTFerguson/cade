---
title: Provider Stack
created: 2026-11-26
updated: 2026-11-26
status: implemented
tags: [providers, litellm, tools, mcp, failover, context-budget]
---

# Provider Stack

How a chat message becomes a model call. Chat providers of `type = "api"` in `~/.cade/providers.toml` run through LiteLLM. `APIProvider` streams the completion, runs any tools the model asks for, and loops until the model stops asking. This doc covers that loop, the tool registry behind it, MCP adapters, failover, and the context budget gauge.

Three parts of this stack do not work as their names suggest. They are stated where they apply and collected under [[#Known gaps]].

## Building providers

`ProviderRegistry.from_config()` (`backend/providers/registry.py`) builds one registry per WebSocket connection. It makes two passes over the provider blocks:

1. Every `api` provider gets its own `ToolRegistry` and an `APIProvider`. If the block has no `system_prompt`, one is composed for the block's `mode` (see [[prompt-composition]]). `cli` blocks are skipped, because CLI agents run as terminal processes.
2. Every `failover` provider is assembled from the providers named in its `primary` and `fallbacks` keys.

Two passes are needed because a failover block can appear before the providers it names. A name that does not resolve is logged and left out. A failover block with no resolvable providers is not registered.

A project's `.cade/launch.yml` can also register a `subprocess` or `websocket` provider (`backend/websocket.py`). Those do not use anything described here.

Orchestrator workers do not come from this registry. `_make_worker_provider()` (`backend/orchestrator/manager.py`) builds a fresh `APIProvider` and tool registry for each worker. See [[agent-orchestration]].

## The tool loop

`APIProvider.stream_chat()` (`core/backend/providers/api_provider.py`) yields a stream of events: `SystemInfo`, `TextDelta`, `ToolUseStart`, `ToolResult`, `ChatDone`, `ChatError`.

1. Yield `SystemInfo`. This happens before any network call.
2. Resolve tool definitions with `ToolRegistry.definitions_async()` and apply the orchestrator filter (below).
3. Call `litellm.acompletion` with `stream=True`. A transient error is retried up to `_MAX_ACOMPLETION_RETRIES` times with a doubling delay. `_is_retryable_acompletion_error()` decides what counts as transient. Any other error becomes a `ChatError` and the stream ends.
4. Collect text and tool-call fragments from the chunks.
5. If the model finished with `tool_calls`: append the assistant turn, announce every call with `ToolUseStart`, run all calls at once with `asyncio.gather`, yield a `ToolResult` for each, append the results as `tool` messages, and go back to step 3.
6. Otherwise yield `ChatDone` with usage and cost, and stop.

The loop stops with a `ChatError` (code `tool-loop-max-turns`) once the number of tool turns passes the cap. The cap is `_DEFAULT_MAX_TOOL_TURNS`, or `max_tool_turns` in the provider block.

Tool calls in one turn run concurrently so that several `spawn_agent` calls start their workers in parallel.

Two details of the assistant turn matter to strict gateways:

- `content` is `None`, not an empty string. This was needed for OpenAI-compatible providers when the loop was written. It has not been re-tested since.
- A call with no arguments is sent as `"{}"`, because MiniMax rejects an empty string there.

The system prompt is recomposed on every chat message (`_stream_chat_response` in `backend/websocket.py`), so a mode switch takes effect on the next message.

## Tool registry

`ToolRegistry` (`core/backend/providers/tool_executor.py`) maps tool names to executors. An executor is any object with `execute(name, arguments)`. One with `execute_async` is awaited instead. A tool that raises returns a string starting `Error:`, which the loop reports as a failed `ToolResult`.

`_create_tool_registry()` (`backend/providers/registry.py`) fills a registry:

| Source | Tools | Condition |
|---|---|---|
| File, discovery and bash executors | See [[agent-tools]] | Only when a project folder is open |
| Memory and Specter executors | `record_*` tools, company lookup | Only when a project folder is open |
| MCP servers in the provider block (`mcp_servers`) | Whatever each server lists | Per provider |
| Orchestrator MCP server | `spawn_agent`, `list_agents`, `view_file`, `show_html` | Always |

### Orchestrator tools

The orchestrator server (`backend/orchestrator/mcp_server.py`) is wired into every API provider as a stdio adapter under the name `__orchestrator__`. `APIProvider` removes the tools in `_ORCHESTRATOR_ONLY_TOOLS` from the definitions unless the provider's mode is `orchestrator` or the orchestrator overlay is on (`set_orchestrator()`, driven by `/orch`). `view_file` and `show_html` are always offered.

The filter hides definitions only. `ToolRegistry.execute_async()` does not check it.

## MCP adapters

| Adapter | Transport | Config |
|---|---|---|
| `MCPToolAdapter` (`mcp_tools.py`) | stdio child process | `command`, `args`, `env` |
| `HTTPMCPToolAdapter` (`http_mcp_tools.py`) | streamable HTTP | `type = "http"`, `url`, and either `headers` or `auth = "claude-oauth"` |

With `auth = "claude-oauth"` the adapter sends the stored OAuth token for that server as a bearer header.

Both connect lazily. Nothing is started until the first chat message.

### Discovery at stream start

`definitions_async()` asks each adapter for its tools at the start of every stream. The adapter connects on the first request and caches the list, so the cost is paid once. Each discovered tool name is then mapped to its adapter so calls can be routed.

Each adapter's discovery is wrapped in `asyncio.wait_for` with `MCP_HANDSHAKE_TIMEOUT_S`. Without the bound, one stalled server blocks the whole chat before the model is called. An HTTP server that answers with an OAuth challenge the client tries to negotiate was the case that showed this. On timeout the adapter contributes no tools and the chat goes ahead.

The HTTP adapter also applies `MCP_HANDSHAKE_TIMEOUT_S` to the transport handshake and to `initialize`. The stdio adapter has no inner timeout and relies on the outer one.

An adapter whose connect fails marks itself failed and stops trying for the rest of the session. For HTTP adapters, a new OAuth token clears that state (`refresh_adapters_for_server()`).

The stdio adapter must take its streams from the `stdio_client` context manager. `ClientSession` cannot be given the process pipes directly.

### Cancel-scope isolation in the HTTP adapter

The HTTP client runs inside an anyio task group. When the server returns 401, anyio cancels its own scope, and that surfaces as `CancelledError` in whoever is awaiting the connect. Left alone, it would cancel the chat stream.

`HTTPMCPToolAdapter._list_tools()` therefore runs the connect in a child task. It re-raises `CancelledError` only when `_outer_cancel_pending()` reports that the calling task itself is being cancelled. Any other failure, including anyio's internal unwind, disables the adapter and the chat continues. A real cancel, such as the user stopping the response, still propagates.

## Failover

`FailoverProvider` (`core/backend/providers/failover_provider.py`) wraps an ordered list of providers.

- It tries each provider that is not in cooldown, in order. If all are in cooldown it tries the primary anyway.
- It moves to the next provider when the current one raises, or yields a `ChatError` before any other event.
- Once any event has been passed on, a later error is passed on too. Output already sent cannot be withdrawn.
- A failed provider gets a cooldown starting at `_INITIAL_COOLDOWN`, multiplied by `_BACKOFF_FACTOR` on each repeat, capped at `_MAX_COOLDOWN`. A successful stream clears it.
- If every candidate fails, it yields a `ChatError` with code `failover-exhausted`.

> [!WARNING]
> With `APIProvider` sub-providers, failover does not trigger. `APIProvider` always yields `SystemInfo` first, so its errors never arrive before any event. It also converts its own exceptions into `ChatError`, so the exception path does not help. The error is passed to the user, no fallback is tried, and the provider is recorded as healthy. This was checked with a stub provider that yields `SystemInfo` then `ChatError`, not against a real `APIProvider`. See [[../../plans/quick-fixes/failover-never-triggers]].

`FailoverProvider` has no `set_mode()` or `set_orchestrator()`. The WebSocket handler calls those only when the provider has them, so a mode or `/orch` change does not reach the sub-providers. This is read from the code and has not been run. Its `model` is the primary's model.

Background on failover strategies is in [[../../reference/multi-provider-failover]].

## Context budget gauge

The gauge in the chat input row shows how full the model's context window is.

**Backend.** `get_context_budget()` (`core/backend/providers/config.py`) reads three optional keys from the provider block:

| Key | Meaning | Default |
|---|---|---|
| `context_budget_threshold` | Warn level, as a fraction of the window | `DEFAULT_CONTEXT_BUDGET_THRESHOLD` |
| `context_budget_hard_limit` | Danger level, as a fraction | `DEFAULT_CONTEXT_BUDGET_HARD_LIMIT` |
| `context_window` | Window size in tokens | `resolve_context_window()` |

`resolve_context_window()` takes `max_input_tokens` from LiteLLM's model catalog and falls back to `DEFAULT_CONTEXT_WINDOW` when the model is not listed. Fractions are clamped to the range 0 to 1. A provider with no config of its own, such as `FailoverProvider`, gets the defaults and a catalog lookup (`_resolve_context_budget()` in `backend/websocket.py`).

**Wire.** The result is sent on the `system-info` chat event as `contextBudget: { warn, danger, window }`. Token usage arrives later on the `done` event, from `ChatDone.usage`.

**Frontend.** `ContextBudgetIndicator` (`frontend/src/components/context-budget-indicator.ts`) takes the budget on `system-info` and updates from `usage.prompt_tokens` on `done`. It draws `NUM_SEGMENTS` blocks and a percentage. The colour is blue, then green from `HEALTHY_PCT`, orange from the warn level, red from the danger level. It is cleared on every `system-info`, so it is hidden while a reply streams and reappears on `done`. It is also cleared when the session is reset.

> [!WARNING]
> The gauge over-reads on replies that use tools. `APIProvider` adds up `prompt_tokens` across every tool turn of a reply and reports the total in `ChatDone.usage`. The indicator treats that figure as the current context size. A reply with several tool turns counts the conversation several times. This is read from the code, not measured. See [[../../plans/quick-fixes/context-gauge-over-reads]].

Nothing on the backend acts on the thresholds. They only colour the gauge.

### Compacting by hand

`/compact` is typed by the user. The handler (`backend/websocket.py`) replaces the message with the `/handoff` skill prompt and streams the reply as usual. `_do_compact()` then writes the reply to `docs/plans/handoff/` and sends `COMPACT_PREVIEW`. When the client answers `COMPACT_PREVIEW_RESOLVED` with approval, the chat session is replaced by a new one seeded with the handoff, and `CHAT_COMPACT` tells the client to clear the pane. A rejection leaves the session as it was. The handoff file is written before the preview, so it stays either way.

## Configuration

Keys in a `[provider.<name>]` block that this stack reads:

| Key | Used by |
|---|---|
| `type`, `model`, `api_key`, `region`, `system_prompt` | `ProviderConfig` |
| `mode` | Default mode and prompt for the provider |
| `max_tool_turns` | Tool loop cap |
| `mcp_servers` (or `mcp-servers`) | MCP adapters |
| `context_budget_threshold`, `context_budget_hard_limit`, `context_window` | Gauge |
| `primary`, `fallbacks` | Failover blocks |

Every key that is not a `ProviderConfig` field lands in `extra`, and `_build_kwargs()` passes all of `extra` to `litellm.acompletion`. That is how `api_base` and `extra_headers` reach LiteLLM. It also means the CADE-only keys above are passed along. How LiteLLM treats them has not been checked.

## Known gaps

- Failover does not trigger with `APIProvider` sub-providers (see [[#Failover]]).
- The gauge over-reads on tool-using replies (see [[#Context budget gauge]]).
- Three classes exist but are not wired into chat. See [[../../plans/quick-fixes/dead-provider-code]].
  - `AgentSpawnerTool` (`core/backend/providers/agent_spawner.py`) is never registered. `spawn_agent` comes from the orchestrator MCP server.
  - `NkrdnExecutor` (`tool_executor.py`) is never registered. Chat agents reach nkrdn through `bash`.
  - `HandoffCompactor` (`backend/providers/handoff_compactor.py`) is used only by its tests. `/compact` does not call it.

## Key files

| File | Role |
|---|---|
| `core/backend/providers/api_provider.py` | `APIProvider`, the tool loop, usage and cost |
| `core/backend/providers/tool_executor.py` | `ToolRegistry`, async discovery and dispatch |
| `core/backend/providers/mcp_tools.py` | stdio MCP adapter |
| `core/backend/providers/http_mcp_tools.py` | HTTP MCP adapter, OAuth token, cancel isolation |
| `core/backend/providers/failover_provider.py` | `FailoverProvider` |
| `core/backend/providers/config.py` | `ProviderConfig`, `get_context_budget()` |
| `backend/providers/registry.py` | `_create_tool_registry()`, `ProviderRegistry.from_config()` |
| `backend/websocket.py` | Chat streaming, `system-info` payload |
| `frontend/src/components/context-budget-indicator.ts` | Gauge |

Tests live in `backend/tests/`. `asyncio_mode = "auto"` is set in `pyproject.toml`, so async tests need no marker.

## See Also

- [[agent-tools]]: the file, discovery and bash tools, and permission gating
- [[agent-orchestration]]: worker agents and the two approval gates
- [[prompt-composition]]: how the system prompt is assembled
- [[../reference/websocket-protocol]]: chat stream events
