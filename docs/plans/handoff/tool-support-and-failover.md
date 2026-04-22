---
title: APIProvider tool support, FailoverProvider, Phase 2 skills + handoff compaction
created: 2026-04-22
status: in-flight
---

# Resume: Wire non-CC providers with tools, failover routing, and agent handoff compaction

## Active plans
- **Feature plan**: `docs/plans/tool-support-and-failover.md` — Phase 1 (shipped) + Phase 2 (in progress)

## Contract — how to use this file

1. **Execute** — read this file first, then resume the Next actions below.
2. **Update as you go** — tick off next-actions, add gotchas, revise file lists.
3. **Graduate on completion** — design decisions → `docs/architecture/`, then delete this file.
4. **Delete this file** — its existence means work is still in the air.

## Where we are

Phase 1 (tool support + failover) shipped. Phase 2a-f (config, MCP, spawner, compactor, registry) mostly done. Phase 2e (auto-trigger) remains.

## Worktree / branch
- Path: `/home/gary/projects/cade`
- Branch: `main`
- Last commit: `b8eb45c Phase 2f: Register MCP adapters, agent spawner, and system prompt in registry`

## Shipped this session

**Phase 1 (committed: 98d7828)**
- APIProvider tool support with async tool loop (_build_kwargs, _MAX_TOOL_TURNS=10)
- FailoverProvider with exponential-backoff cooldown
- ToolExecutor protocol + ToolRegistry + NkrdnExecutor
- 31 tests, all passing

**Phase 2a-d (committed: 94fea50)**
- ProviderConfig.system_prompt field + config loader support
- MCPToolAdapter connects to MCP servers via stdio_client, lists/executes tools
- AgentSpawnerTool for agent spawning with context_handoff parameter
- HandoffCompactor generates briefs for session continuity
- 27 new tests, all passing

**Phase 2f (committed: b8eb45c)**
- Registry wired to create ToolRegistry per APIProvider
- MCP server config via mcp_servers dict in extra fields
- Agent spawner registration with enable_agent_spawner flag
- APIProvider reads system_prompt from config as default

## In flight (remaining work)

**Phase 2e — Auto-trigger in APIProvider (not yet started)**
- Add context budget tracking (token count vs model limit) to `stream_chat`
- Call handoff compactor when threshold crossed
- Spawn replacement agent via `AgentSpawnerTool`
- Monitor token usage from litellm responses and trigger handoff when crossing threshold

## Next actions (ordered)

1. **Phase 2e — Auto-trigger in APIProvider** (optional, complex)
   - Track cumulative token usage from litellm responses
   - Get model token limit from config or litellm model info
   - When usage > (limit × threshold), call handoff compactor + spawn agent
   - This requires UI interaction (approval dialog) which may need refactoring

2. **Graduate to architecture** — move design decisions from this doc to `docs/architecture/provider-tools-and-failover.md`:
   - Overview of tool executor pattern
   - Why ToolRegistry + separate executors vs single monolithic tool handler
   - How MCP servers integrate (stdio_client, tool discovery)
   - Failover strategy and backoff design
   - Agent spawning + context handoff flow

3. **Delete this file** — once knowledge is graduated, delete the plan doc.

## Key design decisions

- **Tool loop inside `stream_chat`** — consumers see a clean `AsyncIterator[ChatEvent]`; no protocol changes needed upstream. Consistent with `ClaudeCodeProvider` pattern.
- **`content: None` (not `""`) in assistant tool-call turns** — required by OpenAI-compatible providers; empty string causes validation errors.
- **`ToolRegistry.execute` never raises** — always returns error string. Keeps tool loop clean; LLM can decide how to handle errors.
- **FailoverProvider only fails over pre-output** — once any event is yielded, errors propagate as-is. Can't un-yield partial streams.
- **Two-pass `from_config()`** — failover providers depend on sub-providers being registered first; ordering in TOML should not matter.
- **Single `nkrdn` tool with operation enum** — fewer tokens, simpler LLM decision vs 5 separate tools.
- **Handoff + subagent completion reports unified** — both use the same format (context summary + decisions + artifacts). Handoff brief becomes the completion report returned to parent agent.
- **`_build_kwargs` stores message list by reference** — the tool loop appends to `kwargs["messages"]` directly across iterations. This is intentional; `litellm_messages` is always a fresh local list.
- **MCPToolAdapter is async-first** — can execute tools via `execute_async()` or blocking `execute()`. Tool loop uses async; ToolRegistry.execute() uses blocking (which internally creates event loop).
- **AgentSpawnerTool returns JSON** — executor pattern requires string output. Caller (UI layer/orchestrator) parses JSON and calls MCP spawn_agent.
- **ToolRegistry per APIProvider** — each API provider gets its own registry (nkrdn + MCP servers + agent spawner) via config. Simpler than shared global registry.

## Files touched / to touch

- **Done:**
  - `core/backend/providers/types.py` (Phase 1)
  - `core/backend/providers/tool_executor.py` (Phase 1)
  - `core/backend/providers/api_provider.py` (Phase 1 + Phase 2f)
  - `core/backend/providers/failover_provider.py` (Phase 1)
  - `core/backend/providers/config.py` (Phase 2a)
  - `core/backend/providers/mcp_tools.py` (Phase 2b)
  - `core/backend/providers/agent_spawner.py` (Phase 2c)
  - `backend/providers/handoff_compactor.py` (Phase 2d)
  - `backend/providers/registry.py` (Phase 1 + Phase 2f)
  - `backend/tests/test_*` (Phase 1, 2b, 2c, 2d)
  - `frontend/src/chat/chat-pane.ts` (Phase 1 cleanup)
  - `frontend/src/platform/websocket.ts` (Phase 1 cleanup)
  - `docs/plans/README.md` (Phase 1)
  - `docs/plans/tool-support-and-failover.md` (this file)

- **Phase 2e — pending:**
  - `core/backend/providers/api_provider.py` — extend `stream_chat` with token budget tracking

## Build & verify

```bash
cd /home/gary/projects/cade
.venv/bin/python -m pytest backend/tests/test_api_provider.py backend/tests/test_tool_executor.py backend/tests/test_failover_provider.py backend/tests/test_mcp_tools.py backend/tests/test_agent_spawner.py backend/tests/test_handoff_compactor.py -q
```

All 61 tests should pass.

## Gotchas encountered

- `asyncio_mode = "auto"` in pyproject.toml — no `@pytest.mark.asyncio` needed on new tests, but existing tests have it harmlessly
- `MockChunk` used `MagicMock()` for delta fields — `delta.tool_calls` returned a truthy mock, breaking tool accumulation check. Fixed by explicitly setting `delta.tool_calls = None` in `MockChunk.__init__`
- `bridgedHandlerSet` in `websocket.ts` was dead code referencing nonexistent `accessNotApprovedHandlers` — deleted, not refactored
- `ClientSession.__init__` requires read/write streams from `stdio_client` context manager, not direct parameters. Updated MCPToolAdapter to use `await stdio_client(...).__aenter__()`.
- `asyncio.get_event_loop()` is deprecated. MCPToolAdapter handles both async (execute_async) and blocking (execute) contexts gracefully.
