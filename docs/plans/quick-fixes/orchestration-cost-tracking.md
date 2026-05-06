---
title: AgentRecord.cost always 0.0 — cost tracking not wired
created: 2026-05-05
status: active
priority: medium
---

## Problem

`AgentRecord` has a `cost` field but it is never populated. Every completed agent reports `cost: 0.0` regardless of actual token usage.

## Evidence

- `backend/orchestrator/models.py` — `AgentRecord.cost: float = 0.0`
- `backend/orchestrator/manager.py` — no code path sets `record.cost` after agent completion
- `backend/tests/test_orchestrator_manager.py` — no assertions on cost field

## Why it matters

Multi-agent sessions have no cost visibility. A session that spawns 10 agents accumulates unknown expense. The "Cost tracking" future enhancement in the orchestration plan depends on this being wired first.

## Suggested fix direction

Litellm responses include usage tokens in `stream_chat()` response chunks. Sum them in `_run_agent()` and write to `record.cost` using litellm's `completion_cost()` or a token × price-per-token calculation when the agent's `ChatDone` event fires. Broadcast the updated cost in the completion event payload.
