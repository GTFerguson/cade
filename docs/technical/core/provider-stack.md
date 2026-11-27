---
title: Provider Stack
created: 2026-11-26
updated: 2026-11-27
status: implemented
tags: [providers, litellm, tools, mcp, failover, context-budget]
---

# Provider Stack

How a chat message becomes a model call. Chat providers of `type = "api"` in `~/.cade/providers.toml` run through LiteLLM. `APIProvider` streams the completion, runs any tools the model asks for, and loops until the model stops asking. This doc covers that loop, the tool registry behind it, MCP adapters, failover, and the context budget gauge.

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
3. Call `litellm.acompletion` with `stream=True`. A transient error is retried up to `_MAX_ACOMPLETION_RETRIES` times with a doubling delay. `_is_retryable_acompletion_error()` decides what counts as transient. Any other error becomes a `ChatError` and the stream ends. Its code comes from `error_code()` (`core/backend/providers/errors.py`): the HTTP status LiteLLM attaches, or `context-window-exceeded`, `timeout`, `connection` or `unknown`. [[#Failover]] reads that code.
4. Collect text and tool-call fragments from the chunks.
5. If the model finished with `tool_calls`: append the assistant turn, announce every call with `ToolUseStart`, run all calls at once with `asyncio.gather`, yield a `ToolResult` for each, append the results as `tool` messages, and go back to step 3.
6. Otherwise yield `ChatDone` with usage, cost and the reply's context size (see [[#Context budget gauge]]), and stop.

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

nkrdn has no tool of its own. Chat agents run it through `bash`.

### Turning tools off

`[tools] disabled` in `providers.toml` names tools no agent is offered. It is read into `ProvidersConfig.disabled_tools`, and it holds in every place CADE hands out tools:

- `ToolRegistry` takes the set when it is built. It leaves those names out of `definitions()` and `definitions_async()`, including tools an MCP adapter reports on discovery, and refuses them in `execute()` and `execute_async()`. The refusal matters because a model can call a tool by a name it was not offered.
- The orchestrator server does not read `providers.toml`, because run from source it is a plain script that cannot import the backend. `server_env()` in `backend/orchestrator/mcp_config.py` passes the names in `DISABLED_TOOLS_ENV`, and `build_server()` in `mcp_server.py` leaves those tools out. Both launches go through `server_env()`: the chat registry's and the one written into a CLI agent's MCP config, so a Claude Code tab loses the tool too.

A change takes effect for agents started after it. A running Claude Code tab keeps the server it was started with.

Turning off `spawn_agent` also turns off the orchestrator overlay (`orchestrator_available()` in `mcp_config.py`). Its prompt module tells the agent to delegate with that tool, so `/orch` answers with an error instead of switching on, and a Claude Code tab does not get the overlay. The tab still gets the orchestrator server for `view_file` and `show_html`.

### Orchestrator tools

The orchestrator server (`backend/orchestrator/mcp_server.py`) reaches every chat agent. `_create_tool_registry()` registers it as a stdio adapter under the name `__orchestrator__`, so every API provider and every orchestrator worker (which builds its registry with the same function) gets it. `APIProvider` removes the tools in `_ORCHESTRATOR_ONLY_TOOLS` (`spawn_agent`, `list_agents`) from the definitions unless the provider's mode is `orchestrator` or the orchestrator overlay is on (`set_orchestrator()`, driven by `/orch`). `view_file` and `show_html` are always offered.

The adapter's command comes from `server_command("orchestrator")` in `backend/orchestrator/mcp_config.py`, the same function that writes the server into a CLI agent's MCP config. From source it runs the venv Python on `mcp_server.py`. In the packaged binary there is no `.py` file to run, so it runs `cade-backend mcp-server --type orchestrator`. Sharing the function keeps the chat path and the CLI path from drifting apart; an earlier copy of this wiring imported a name that no longer existed and the adapter was silently never registered.

If the adapter cannot be built, the registry is returned without it and the reason is logged at warning level. Nothing else shows that the orchestrator tools are missing, so the log line is the place to look when a chat agent says it has no `view_file`.

That filter hides definitions only; `ToolRegistry.execute_async()` does not check it. A tool listed in `[tools] disabled` is refused at execution as well.

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
- It moves to the next provider when the current one fails before producing content, and the error is one another provider could plausibly not have (below). The error may arrive as a `ChatError` or as a raised exception.
- Once content has been passed on, a later error is passed on too. Output already sent cannot be withdrawn.
- A failed provider gets a cooldown starting at `_INITIAL_COOLDOWN`, multiplied by `_BACKOFF_FACTOR` on each repeat, capped at `_MAX_COOLDOWN`. A successful stream clears it.
- If every candidate fails, it yields a `ChatError` with code `failover-exhausted`. Its message names the last provider tried and its error.

### Holding back `SystemInfo`

`APIProvider` yields `SystemInfo` before it calls the model, so a failed call arrives as `SystemInfo` followed by `ChatError`. If any event counted as output, that error could never trigger failover. `SystemInfo` carries only the model name and is safe to hold back, so `FailoverProvider` holds leading `SystemInfo` events and releases them with the first other event (`TextDelta`, `ThinkingDelta`, `ToolUseStart` or anything else). When an error comes first, they are dropped and the next provider's `SystemInfo` is the one sent. The chat header takes the model name from `SystemInfo`, so after a failover it names the model that actually answered.

### Which errors fail over

`is_failover_code()` (`core/backend/providers/errors.py`) decides from the `ChatError` code, or from `error_code()` of a raised exception:

| Error | Code | Fails over |
|---|---|---|
| Rate limit | `429` | Yes |
| Server error | any `5xx`; LiteLLM gives connection errors `500` | Yes |
| Timeout | `408`, `timeout` | Yes |
| Connection error | `connection` | Yes |
| Bad request, bad key, forbidden, unknown model | `400`, `401`, `403`, `404` | No |
| Prompt too long | `context-window-exceeded` | No |
| Anything else | e.g. `unknown` | No |

The errors that fail over belong to one provider: its quota, its servers, its network path. The ones that do not would fail the same way on every provider in the chain, so trying them all only delays the message the user needs. A provider with such an error keeps whatever cooldown state it had.

A rate limit or server error that arrives after content still sets a cooldown, so the next message goes to a provider that is not rate limited or down.

### Per-provider settings

The WebSocket handler calls `set_mode()` and `set_orchestrator()` on the default provider only when it has them. `FailoverProvider` has both and passes each call to every sub-provider that takes it, because any of them may answer the next message. Its `mode` and `model` are the primary's.

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

**Reply size.** One reply can take several model calls: the model asks for tools, the results are appended, and the model is called again. Each call resends the whole conversation. `APIProvider` therefore reports two figures on `ChatDone`:

- `usage` sums `prompt_tokens` and `completion_tokens` over every call. That is what was billed, and it feeds the cost and the token counter.
- `context_tokens` is the last call's prompt tokens plus its completion tokens. The completion is included because it is part of the context for the next message. This is the figure the gauge needs. Summed usage would count the conversation once per tool turn.

Usage is read from whichever chunk carries it, keeping the last non-zero prompt and completion counts of each call. OpenAI-format providers report both on the last chunk. On the `anthropic/` route LiteLLM reports prompt tokens on the first chunk (`message_start`) and completion tokens later. When LiteLLM converts Anthropic usage, `AnthropicConfig.calculate_usage()` adds `cache_creation_input_tokens` and `cache_read_input_tokens` to `prompt_tokens` (checked in LiteLLM 1.83.8), so cached tokens are counted in the context figure, as they should be: they occupy the window like any other.

> [!NOTE]
> LiteLLM's stream wrapper has code paths that strip `usage` from chunks when `stream_options.include_usage` is not set, and CADE does not set it. Which chunks still carry usage on each route has not been measured in the running app. A provider that reports none gets no `context_tokens` and an empty `usage`, and the gauge is not updated.

**Wire.** The budget is sent on the `system-info` chat event as `contextBudget: { warn, danger, window }`. The `done` event carries `usage` and, when known, `contextTokens` (see [[../reference/websocket-protocol#Chat]]).

**Frontend.** `ContextBudgetIndicator` (`frontend/src/components/context-budget-indicator.ts`) takes the budget on `system-info` and updates on `done` from `contextTokensOf()`, which reads `contextTokens` and falls back to `usage.prompt_tokens` for a backend that does not send it. It draws `NUM_SEGMENTS` blocks and a percentage. The colour is blue, then green from `HEALTHY_PCT`, orange from the warn level, red from the danger level. It is cleared on every `system-info`, so it is hidden while a reply streams and reappears on `done`. It is also cleared when the session is reset.

Nothing on the backend acts on the thresholds. They only colour the gauge.

### Compacting by hand

`/compact` is typed by the user. The handler (`backend/websocket.py`) replaces the message with the `/handoff` skill prompt and streams the reply as usual. `_do_compact()` then writes the reply to `docs/plans/handoff/` and sends `COMPACT_PREVIEW`. When the client answers `COMPACT_PREVIEW_RESOLVED` with approval, the chat session is replaced by a new one seeded with the handoff, and `CHAT_COMPACT` tells the client to clear the pane. A rejection leaves the session as it was. The handoff file is written before the preview, so it stays either way.

## Configuration

Top-level `[tools]` table:

| Key | Used by |
|---|---|
| `disabled` | Tool names no agent is offered (see [[#Turning tools off]]) |

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

## Key files

| File | Role |
|---|---|
| `core/backend/providers/api_provider.py` | `APIProvider`, the tool loop, usage and cost |
| `core/backend/providers/tool_executor.py` | `ToolRegistry`, async discovery and dispatch |
| `core/backend/providers/mcp_tools.py` | stdio MCP adapter |
| `core/backend/providers/http_mcp_tools.py` | HTTP MCP adapter, OAuth token, cancel isolation |
| `core/backend/providers/failover_provider.py` | `FailoverProvider` |
| `core/backend/providers/errors.py` | `error_code()`, `is_failover_code()` |
| `core/backend/providers/config.py` | `ProviderConfig`, `get_context_budget()` |
| `backend/providers/registry.py` | `_create_tool_registry()`, `ProviderRegistry.from_config()` |
| `backend/orchestrator/mcp_config.py` | `server_command()`, the orchestrator server's launch command |
| `backend/websocket.py` | Chat streaming, `system-info` and `done` payloads |
| `frontend/src/components/context-budget-indicator.ts` | Gauge |

Tests live in `backend/tests/`. `asyncio_mode = "auto"` is set in `pyproject.toml`, so async tests need no marker.

## See Also

- [[agent-tools]]: the file, discovery and bash tools, and permission gating
- [[agent-orchestration]]: worker agents and the two approval gates
- [[prompt-composition]]: how the system prompt is assembled
- [[../reference/websocket-protocol]]: chat stream events
