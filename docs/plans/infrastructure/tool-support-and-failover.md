---
title: APIProvider Tool Support + FailoverProvider
created: 2026-04-22
status: in-progress
verified: 2026-04-24
tags: [cade, providers, tools, litellm]
---

# Tool Support for APIProvider + FailoverProvider

## Completed Phases

### Phase 1 — APIProvider Tool Support + FailoverProvider — Completed 2026-04-22

Async tool loop in `APIProvider.stream_chat()`, `ToolExecutor` protocol, `ToolRegistry` dispatcher, `NkrdnExecutor` (subprocess, 15s timeout), `FailoverProvider` with cooldown/backoff (60s initial, 10m cap, 2× factor). `_MAX_TOOL_TURNS = 10` guard prevents infinite loops. 31 tests passing.

Key code: `core/backend/providers/api_provider.py`, `core/backend/providers/tool_executor.py`, `core/backend/providers/failover_provider.py`

Gotcha: `content: None` (not `""`) required in assistant tool-call turns for OpenAI-compatible providers.

### Phase 2a-d — MCP Adapter, Agent Spawner, Handoff Compactor — Completed 2026-04-22

`MCPToolAdapter` bridges MCP JSON-RPC to `ToolDefinition`. `AgentSpawnerTool` spawns agents via orchestrator MCP. `HandoffCompactor` integrates `/handoff` skill as a compression mechanism. 27 additional tests.

Key code: `core/backend/providers/mcp_tools.py`, `core/backend/providers/agent_spawner.py`, `backend/providers/handoff_compactor.py`

Gotcha: `ClientSession` requires streams from `stdio_client` context manager — cannot pass streams directly.

### Phase 2f — Registry Integration — Completed 2026-04-22

MCP adapters and agent spawner auto-registered from `providers.toml` in `ProviderRegistry.from_config()`. Two-pass config: non-failover providers first, then failover providers assembled from registered sub-providers.

Key code: `backend/providers/registry.py`

### Phase 2g — Async Tool Definitions + Orchestrator Auto-wiring — Completed 2026-04-22

`definitions_async()` + `execute_async()` on `ToolRegistry` — MCP adapters work from async context. `APIProvider` fetches tool defs async at stream start. Orchestrator MCP server auto-wired into all API provider tool registries (lazy-connect, tools discovered on first call). Mode system prompt passed to API providers. Adaptive failover chain: Mistral → Cerebras → Groq → Google Gemma via `~/.cade/providers.toml`.

Key code: `backend/providers/registry.py`, `core/backend/providers/api_provider.py`

Gotcha: MCP tool discovery runs at stream start with no timeout. An HTTP MCP server that stalls (e.g. returning a 401 OAuth challenge that the MCP library tries to negotiate) blocks the entire chat indefinitely. `definitions_async()` now wraps each `_list_tools()` call in `asyncio.wait_for(..., timeout=10.0)`. `_ensure_connected()` in both `MCPToolAdapter` and `HTTPMCPToolAdapter` similarly has 8s timeouts on the transport handshake.

Gotcha: `except (Exception, BaseException)` in `_list_tools()` and `execute_async()` was swallowing `asyncio.CancelledError`, making task cancellation silently ineffective while a connection was in flight. Both adapters now re-raise `CancelledError` explicitly before the generic except clause.

## Remaining Work

### Phase 2e — Auto-trigger Handoff on Context Budget Threshold

Auto-trigger the `/handoff` skill when token usage crosses `context_budget_threshold`. Check context size before each turn in `APIProvider`; spawn a fresh agent with the handoff brief injected when approaching the limit.

- Config knobs: `context_budget_threshold` (warn) and `context_budget_hard_limit` (danger) per provider in `~/.cade/providers.toml`
- The context budget indicator (Phase 3a, shipped) already tracks usage via `ChatDone` events — hook auto-trigger into that same signal
- Tie into `docs/plans/context-budget-indicator.md` for the threshold values
