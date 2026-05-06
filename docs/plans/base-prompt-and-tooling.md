---
title: Base Prompt + Tooling Audit
created: 2026-04-23
status: partially-shipped
verified: 2026-05-05
tags: [prompts, tooling, agent, cade]
---

# Base Prompt + Tooling Audit

## Completed Phases

### Base Prompt + Compose System — Completed 2026-04-23

Modular prompt composition: `backend/prompts/compose.py` assembles ordered markdown modules. Compose order: base → rules (`~/.claude/rules/`) → always (dashboard, neovim) → mode-specific. `base.md` carries CADE identity, output channel decision tree, dashboard overview, nkrdn budget guidance.

Key code: `backend/prompts/compose.py`, `backend/prompts/modules/base.md` (63 lines), `backend/prompts/modules/` (dashboard.md, nkrdn.md, neovim.md, code.md, architect.md, review.md, orchestrator.md, research.md, triage.md)

### Tooling Stack — Completed 2026-04-23

Full tool loop in `APIProvider.stream_chat()` with `_DEFAULT_MAX_TOOL_TURNS = 100`. `ToolDefinition` + `ToolRegistry` + `NkrdnExecutor` (subprocess, 15s timeout). `FailoverProvider` with exponential backoff (60s initial, 10m cap, 2× factor). `MCPToolAdapter` lazy-connect + async (stdio). `HTTPMCPToolAdapter` with Claude OAuth support (8s handshake timeout). `AgentSpawnerTool` returns structured JSON — actual spawn happens in orchestrator MCP, intentional by design. `HandoffCompactor` generates/formats handoff briefs. Per-provider `ToolRegistry` wired via `_create_tool_registry()`. Orchestrator MCP server auto-wired as `__orchestrator__` adapter (lazy-connect, tools discovered on first call). Adaptive failover chain: Mistral → Cerebras → Groq → Google Gemma via `~/.cade/providers.toml`.

Key code: `core/backend/providers/api_provider.py`, `core/backend/providers/tool_executor.py`, `core/backend/providers/failover_provider.py`, `core/backend/providers/mcp_tools.py`, `core/backend/providers/http_mcp_tools.py`, `core/backend/providers/agent_spawner.py`, `backend/providers/handoff_compactor.py`, `backend/providers/registry.py`

Gotcha: `content: None` (not `""`) required in assistant tool-call turns for OpenAI-compatible providers. `CancelledError` must be re-raised explicitly before the generic except clause in both MCP adapters — swallowing it made task cancellation silently ineffective.

## Remaining Work

### Phase 2e — Auto-trigger Handoff on Context Budget Threshold

Track cumulative token usage from litellm responses in `APIProvider`. When usage exceeds `context_budget_threshold`, call `HandoffCompactor` and spawn a fresh agent with the handoff brief injected.

- Config knobs: `context_budget_threshold` (warn) and `context_budget_hard_limit` (danger) per provider in `~/.cade/providers.toml`
- The context budget indicator (`frontend/src/components/context-budget-indicator.ts`) already tracks usage via `ChatDone` events — hook auto-trigger into that same signal
- Requires UI approval dialog before spawning continuation agent
