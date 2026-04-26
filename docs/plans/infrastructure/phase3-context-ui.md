---
title: Phase 3 implementation — start with context budget UI
created: 2026-04-22
status: in-progress
verified: 2026-04-24
---

# Phase 3 Implementation

## Completed Phases

### Phase 3a — Context Budget Indicator — Completed 2026-04-22

Token usage gauge in the statusline. 8-block display matching the splash screen loading bar aesthetic, color progression (normal → warn → danger). Usage data flows through `ChatDone` events, not global state. Thresholds are config-driven (`context_budget_threshold`, `context_budget_hard_limit`) per provider.

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
