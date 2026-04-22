---
title: Phase 3 implementation — start with context budget UI
created: 2026-04-22
status: in-flight
---

# Resume: Implement Phase 3 features starting with context budget indicator

## Active plans

- **Phase 1-2f shipping**: `docs/plans/tool-support-and-failover.md` — completed, 61 tests passing
- **Phase 3 planning**: All documented in `/docs/plans/`:
  - `context-budget-indicator.md` — UI design + implementation strategy
  - `dynamic-permission-management.md` — read/write .claude permissions
  - `agent-orchestration-framework.md` — multi-agent parallel execution

## Contract — how to use this file

1. **Execute** — read this file, then the Phase 3 planning docs, then start implementation
2. **Update as you go** — tick off next-actions, add gotchas, note file changes
3. **Graduate on completion** — move design decisions to `docs/architecture/`, delete this file
4. **Delete this file** — when Phase 3 ships

## Where we are

Phase 1-2f (tool support, failover, MCP adapter, agent spawner, handoff compactor) is complete and shipped. Phase 3 planning docs are written and committed. Ready to start implementation starting with the context budget indicator (most visible/impactful feature).

## Worktree / branch
- Path: `/home/gary/projects/cade`
- Branch: `main`
- Last commit: `df5d4ac Document Phase 3+ requirements: context UI, permissions, orchestration`

## Shipped this session

- `98d7828` Phase 1: APIProvider tool support + FailoverProvider (31 tests)
- `94fea50` Phase 2a-d: Config, MCP adapter, agent spawner, handoff compactor (27 tests)
- `b8eb45c` Phase 2f: Register MCP adapters, agent spawner in registry
- `314d2e0` Update handoff doc: Phase 1-2f shipped, Phase 2e remaining
- `df5d4ac` Document Phase 3+ requirements: context UI, permissions, orchestration
- **Phase 3a**: Context budget indicator — `frontend/src/components/context-budget-indicator.ts` + wired into `chat-pane.ts`

Total: 61 backend tests passing, frontend builds clean, context budget gauge visible in statusline.

## In flight (uncommitted work)

None. All work committed. Working tree clean.

## Next actions (ordered)

1. ~~**Implement context budget indicator**~~ — **DONE** (see Shipped this session below)

2. **Then: Dynamic permission management** — read/write .claude/settings.json
   - See `docs/plans/dynamic-permission-management.md` for design

3. **Then: Agent orchestration** — multi-agent parallel execution
   - See `docs/plans/agent-orchestration-framework.md` for design

## Key design decisions

- **Manual handoff trigger**: `/handoff` command user-triggered (no automation). Progress bar warns but doesn't force action.
- **Config-driven thresholds**: `context_budget_threshold` (warn) and `context_budget_hard_limit` (danger) both configurable per provider
- **Token tracking at event level**: Usage data flows through ChatDone events, not global state
- **UI aesthetic consistency**: Matches splash screen loading bar (8 blocks, color progression)
- **Phase ordering**: UI first (most visible), then permissions (reduces friction), then orchestration (most complex)

## Files to touch

- **New:**
  - `frontend/src/components/context-budget-indicator.ts` (component, ~150 lines)

- **Modify:**
  - `frontend/src/chat/chat-pane.ts` (import + render component)
  - `core/backend/providers/api_provider.py` (verify usage in ChatDone, may need no changes)
  - Check ChatDone event schema if usage isn't already included

## Build & verify

```bash
cd /home/gary/projects/cade
npm run build  # frontend build
npm run test   # verify existing tests still pass
# Manual test: open chat, watch progress bar appear and update
```

All 61 backend tests should still pass. No new tests required yet (testing gauge would be E2E, can add later).

## Gotchas encountered

- `asyncio_mode = "auto"` in pyproject.toml — no @pytest.mark.asyncio needed on new tests
- MCPToolAdapter: `ClientSession` requires streams from `stdio_client` context manager, not direct params
- APIProvider tool loop: `content: None` (not `""`) required in assistant tool-call turns for OpenAI-compatible providers
- FailoverProvider: Only fails over pre-output; once any event yielded, errors propagate as-is (can't un-yield partial streams)

## Notes for next session

- Phase 3 planning docs are comprehensive; use them as reference while implementing
- Infrastructure below the UI is ready (tool registry, agent spawner, handoff compactor all wired)
- Focus on getting the gauge visible first, then polish colors/thresholds based on real usage patterns
- Session memory at `/home/gary/.claude/projects/-home-gary-projects-cade/memory/phase3_planning.md` has key decisions
