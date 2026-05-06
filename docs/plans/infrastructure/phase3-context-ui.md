---
title: Phase 3 implementation — start with context budget UI
created: 2026-04-22
status: partially-shipped
verified: 2026-05-05
---

# Phase 3 Implementation

## Completed Phases

### Phase 3a — Context Budget Indicator — Completed 2026-04-22

Token usage gauge in the chat pane input row. 8-block segmented display matching the splash screen loading bar aesthetic, color progression (blue → orange 75% → red 90%). Usage data flows through `ChatDone` events, not global state. Context window sizes are hard-coded by model name substring match — `context_budget_threshold` / `context_budget_hard_limit` config knobs are not yet wired (see quick-fix `config-thresholds-not-wired`).

Key code: `frontend/src/components/context-budget-indicator.ts`, `frontend/src/chat/chat-pane.ts`

## Remaining Work

### Phase 3b — Dynamic Permission Management

Read/write `.claude/settings.json` permissions from the UI. See `docs/plans/dynamic-permission-management.md` for design.

### Phase 3c — Agent Orchestration Framework

Multi-agent parallel execution. See `docs/plans/agent-orchestration-framework.md` for design.

## Gotchas (carry forward to remaining phases)

- `asyncio_mode = "auto"` in `pyproject.toml` — no `@pytest.mark.asyncio` needed on new tests
- MCPToolAdapter: `ClientSession` requires streams from `stdio_client` context manager, not direct params
- `APIProvider` tool loop: `content: None` (not `""`) required in assistant tool-call turns for OpenAI-compatible providers
- FailoverProvider: Only fails over pre-output; once any event is yielded, errors propagate as-is (can't un-yield a partial stream)
