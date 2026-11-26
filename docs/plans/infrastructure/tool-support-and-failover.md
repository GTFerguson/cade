---
title: APIProvider Tool Support + FailoverProvider
created: 2026-04-22
updated: 2026-11-26
status: partially-shipped
verified: 2026-11-26
tags: [cade, providers, tools, litellm]
---

# Tool Support for APIProvider + FailoverProvider

## Shipped

How the shipped parts work is in [[../../technical/core/provider-stack]].

| Phase | What | Commit | Now documented in |
|---|---|---|---|
| 1 | Tool loop in `APIProvider`, `ToolRegistry`, `FailoverProvider`, two-pass registry build | `98d7828b` | [[../../technical/core/provider-stack#The tool loop]], [[../../technical/core/provider-stack#Failover]], [[../../technical/core/provider-stack#Building providers]] |
| 2a-d | stdio MCP adapter | `94fea505` | [[../../technical/core/provider-stack#MCP adapters]] |
| 2f | MCP servers read from the provider block in `providers.toml` | `b8eb45c9` | [[../../technical/core/provider-stack#Tool registry]] |
| 2g | Async tool discovery, orchestrator tools wired into every API provider | `6e5d7d0a` | [[../../technical/core/provider-stack#Tool registry]] |

Phases 1 and 2a-d also added `NkrdnExecutor`, `AgentSpawnerTool` and `HandoffCompactor`. None of the three was wired into chat, and all three have been removed.

Failover now triggers with `APIProvider` sub-providers and fails over only on errors another provider could plausibly not have. See [[../../technical/core/provider-stack#Failover]].

## Remaining Work

### Phase 2e: compact automatically when the context budget is crossed

Today the user has to notice the gauge and type `/compact`. This phase makes CADE offer that itself.

What exists to build on:

- `/compact` already runs the handoff skill, writes the brief, shows an approval preview and resets the session ([[../../technical/core/provider-stack#Compacting by hand]]). The auto-trigger should start that same flow. It needs no new compaction code and no new approval dialog.
- The thresholds are already resolved per provider by `get_context_budget()` (`context_budget_threshold`, `context_budget_hard_limit`). Nothing on the backend acts on them yet.

What has to be built:

- A check after each reply that compares the reply's context size to the thresholds and starts the compact flow. The figure exists: `ChatDone.context_tokens`, the last model call's prompt plus completion ([[../../technical/core/provider-stack#Context budget gauge]]).
- A decision for orchestrator workers. They stream through `OrchestratorManager`, not through the chat handler that owns the compact flow, so the check does not cover them for free.

Open questions:

- Which threshold triggers what. One option: at the warn level, suggest `/compact` in the chat; at the danger level, start it and show the preview.
- What a worker does at the danger level: stop and report, or hand off to a fresh worker.
- Whether a rejected preview should suppress the next automatic offer, and for how long.

Background on threshold choices is in [[../../reference/context-window-management]].
