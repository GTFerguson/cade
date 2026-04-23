---
title: Base Prompt + Tooling Audit
created: 2026-04-23
status: in-flight
tags: [prompts, tooling, agent, cade]
---

# Base Prompt + Tooling Audit

## What was done

### 1. Base prompt created

**File**: `backend/prompts/modules/base.md`

Added as the first module in `ALWAYS` (loads before mode-specific prompts). Content:

- **CADE identity** — agent knows it's running in CADE, not a generic terminal
- **Output channel decision tree** — chat vs dashboard vs `docs/plans/` vs `docs/reference/` with clear routing rules
- **Dashboard as interactive surface** — hot-reloading config, component vocabulary, when to use it vs chat
- **Neovim integration** — writes auto-reload in the user's editor
- **nkrdn reference** — condensed from existing module with key commands and budget guidance

### 2. Compose order updated

**File**: `backend/prompts/compose.py`

```python
ALWAYS = ["base", "dashboard", "nkrdn", "neovim"]
MODE_MODULES = {"code": ["code"], "architect": ["architect"], ...}
```

All modes now get: `base → dashboard → nkrdn → neovim → mode-specific`

## Current Prompt Structure

Modules in `backend/prompts/modules/`:

| Module | Purpose | Always loaded? |
|--------|---------|----------------|
| `base.md` | CADE identity, output channels, dashboard overview, nkrdn summary | Yes (first) |
| `dashboard.md` | Dashboard schema, components, data sources | Yes |
| `nkrdn.md` | Full nkrdn command reference | Yes |
| `neovim.md` | Editor integration note | Yes |
| `code.md` | Code mode: full access | No |
| `architect.md` | Architect mode: read-only | No |
| `review.md` | Review mode: read-only with review focus | No |
| `orchestrator.md` | Orchestrator mode: spawn/delegate agents | No |

## Tooling State

From `docs/plans/tool-support-and-failover.md` and code audit (2026-04-23):

| Component | Status | Notes |
|-----------|--------|-------|
| `ToolDefinition` + `ToolRegistry` + `NkrdnExecutor` | **Shipped** | Full implementation in `core/backend/providers/types.py`, `tool_executor.py`. NkrdnExecutor runs nkrdn CLI as subprocess with proper timeout/error handling. |
| `APIProvider` tool loop with `_MAX_TOOL_TURNS=10` | **Shipped** | Full implementation in `core/backend/providers/api_provider.py:31`. Tool loop accumulates tool_calls by index, executes via registry, continues until non-tool finish or max turns. |
| `FailoverProvider` with exponential backoff | **Shipped** | Full implementation in `core/backend/providers/failover_provider.py`. `_INITIAL_COOLDOWN=60s`, `_BACKOFF_FACTOR=2.0`, `_MAX_COOLDOWN=600s`. Marks failed providers with exponential-backoff cooldown and skips to next healthy candidate. |
| `MCPToolAdapter` (lazy-connect, async) | **Shipped** | Full implementation in `core/backend/providers/mcp_tools.py`. Lazy-connect via `_ensure_connected()`. `_list_tools()` and `execute_async()` are async; sync wrappers `tool_definitions()` and `execute()` exist for compatibility. |
| `AgentSpawnerTool` | **Shipped (partial stub)** | In `core/backend/providers/agent_spawner.py`. `execute()` returns structured JSON describing the spawn request rather than performing the spawn directly. Actual spawn happens in UI layer via orchestrator MCP. Design is intentional — see comment on line 63-65. |
| `HandoffCompactor` | **Shipped** | Full implementation in `backend/providers/handoff_compactor.py`. `generate_brief()` extracts work summary from chat context; `format_for_injection()` wraps for system prompt. |
| Registry wired — per-provider `ToolRegistry` | **Shipped** | `_create_tool_registry()` in `backend/providers/registry.py` creates per-provider registries. Registers file tools (if `working_dir`), MCP servers (from config), and orchestrator MCP adapter (`__orchestrator__`). |
| Orchestrator MCP server auto-wired | **Shipped** | Full implementation in `backend/orchestrator/mcp_server.py`. Provides `spawn_agent`, `list_agents`, `view_file`, `push_to_dashboard`, `notify`. Wired in `_create_tool_registry()` as `__orchestrator__` adapter. |
| Context budget auto-trigger | **Pending** | Not implemented. `APIProvider` does not track cumulative token usage or auto-trigger handoff. Plan correctly lists as "Phase 2e". |

## Remaining Work

### Phase 2e — Auto-trigger handoff in APIProvider

From `docs/plans/handoff/tool-support-and-failover.md`:

- Track cumulative token usage from litellm responses
- Get model token limit from config or litellm model info
- When usage > (limit × threshold), call handoff compactor + spawn agent
- Requires UI interaction (approval dialog)

### Verification needed

Run the tooling tests to confirm no regressions:

```bash
cd /home/gary/projects/cade
.venv/bin/python -m pytest \
  backend/tests/test_api_provider.py \
  backend/tests/test_tool_executor.py \
  backend/tests/test_failover_provider.py \
  backend/tests/test_mcp_tools.py \
  backend/tests/test_agent_spawner.py \
  backend/tests/test_handoff_compactor.py \
  -q
```

Expected: 61 tests passing

## Key Files

| File | Relevance |
|------|-----------|
| `backend/prompts/modules/base.md` | New base prompt |
| `backend/prompts/compose.py` | Prompt assembly |
| `core/backend/providers/api_provider.py` | Tool loop + context tracking |
| `core/backend/providers/tool_executor.py` | ToolRegistry + NkrdnExecutor |
| `core/backend/providers/mcp_tools.py` | MCPToolAdapter |
| `core/backend/providers/agent_spawner.py` | AgentSpawnerTool |
| `backend/providers/handoff_compactor.py` | HandoffCompactor |
| `backend/providers/registry.py` | Provider registry + tool wiring |
| `docs/plans/tool-support-and-failover.md` | Tooling plan |
| `docs/plans/handoff/tool-support-and-failover.md` | In-flight handoff notes |
| `docs/plans/cade-agent-context.md` | Output channel design reference |
