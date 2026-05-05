---
title: Phase 5 — capture toast + automatic memory retrieval
created: 2026-04-29
updated: 2026-05-05
status: in-flight
---

# Resume: Phase 5 last piece — capture toast, then automatic retrieval

## Active plans

- **Phase plan:** `/home/gary/projects/cade/docs/plans/nkrdn-agent-memory.md` — Phase 5 section
- **Architecture (shipped phases 1–4):** `/home/gary/projects/cade/docs/architecture/nkrdn-agent-memory.md`
- **Design folder:** `/home/gary/projects/cade/docs/plans/design/phase-5-memory/README.md`

## Contract

1. **Orient, then confirm** — read this file, present a one-sentence status and proposed first action. Do not execute until the user approves.
2. **Update as you go** — tick off next-actions, add gotchas.
3. **Graduate on completion** — design decisions → `docs/architecture/nkrdn-agent-memory.md`, then delete this file.
4. **Delete this file** — existence = work in the air.

## Where we are

Phase 5 core is fully shipped on `phase5/memory-ui`: graph tree, symbol detail pane, backend endpoints, archive/retarget actions, WS emission, tests. One UI piece remains (capture toast). Additionally, the user asked whether memory capture is automatic — it isn't yet; agents call `record_decision` etc. voluntarily. Proactive retrieval at session start is also missing. Those are Phase 6 scope but flag them for discussion.

## Worktree / branch

> [!IMPORTANT]
> **Work is in a worktree, not main.**

- Path: `/home/gary/projects/cade-phase5-memory` (worktree)
- Branch: `phase5/memory-ui`
- Last commit: `8716b9e Phase 5: tests for build_graph_message, retarget_memory, and API endpoints`
- Main checkout: `/home/gary/projects/cade` on `main`

## Shipped this session (all on phase5/memory-ui)

- `1820a8b` — Phase 5 frontend base: `MemoryGraphTree`, `SymbolDetailPane`, `memory.css`, `+mem` toggle, demo scenario, help overlay bindings
- `4cf56e1` — Backend: `build_graph_message()`, `/api/memory/graph`, WS `nkrdn-graph` emission on connect + after build
- `b21c0dd` — Action handlers: `[a]` archive, `[r]`/`[1/2/3]` retarget; `/api/memory/archive` + `/api/memory/retarget` endpoints
- `8716b9e` — 10 backend tests for graph assembly, retarget rewrite, endpoint guards

## In flight (uncommitted work)

None. Working tree is clean on `phase5/memory-ui`.

## Next actions (ordered)

### 1. Capture toast — chat pane rendering `[safe]`

Mock reference: `/home/gary/projects/cade/docs/plans/design/phase-5-memory/03-secondary-surfaces.html` (Surface A)

When `record_decision`, `record_attempt`, or `record_note` tool results arrive in the chat stream, render a `.memory-capture-toast` block instead of the generic tool-result block. It auto-collapses after ~3s. Expanded view shows type pill, title, target symbol name, and an archive button.

- Find where tool results are rendered in `frontend/src/chat/chat-pane.ts`
- Add a branch matching `tool_name` in `["record_decision", "record_attempt", "record_note"]`
- Render `.memory-capture-toast` block (collapsed by default, expand on click)
- Add toast styles to `frontend/styles/workspace/memory.css`
- No backend changes needed

### 2. Merge phase5/memory-ui → main `[confirm]`

Once the toast ships (or explicitly deferred), merge and graduate.

### 3. Discuss Phase 6: automatic memory `[confirm]`

Current state: `record_*` tools exist and are in every mode's prompt, but agents call them voluntarily. Two missing pieces:
- **Proactive retrieval on session start** — agent doesn't auto-search for relevant memories when opening files
- **Automatic extraction** — no system-level hook to force capture at conversation end

Discuss with user before implementing anything — scope/priority TBD.

## Key design decisions (carry forward)

- **nkrdn not in cade venv** — `api.py` uses subprocess + stdlib `sqlite3` + PyYAML only. Never add `from nkrdn import ...` to backend.
- **DB at `.cade/staging/knowledge_base.db`** not `.cade/knowledge_base.db` — CADE passes `--staging-dir .cade/staging` to nkrdn.
- **FileTree clears its container** — MemoryGraphTree lives in `.memory-pane-graph`, FileTree in `.memory-pane-files` (sibling sub-divs inside `.file-tree-pane`). Don't merge them.
- **`nkrdn-graph` emitted twice on new sessions** — once on connect (existing graph), once after `initial_build()` completes. Frontend re-renders on each; that's intentional.

## Files of interest

In `/home/gary/projects/cade-phase5-memory/`:

- `frontend/src/chat/chat-pane.ts` — where to add capture toast branch
- `frontend/src/memory/` — all 4 memory UI files (done)
- `frontend/styles/workspace/memory.css` — add toast styles here
- `backend/memory/api.py` — graph assembly + retarget logic
- `backend/tests/test_memory_graph.py` — Phase 5 backend tests

## Build & verify

```bash
# Demo
cd /home/gary/projects/cade-phase5-memory/frontend && npm run dev -- --port 5175
xdg-open "http://localhost:5175/?demo=phase5-memory"

# Backend tests
cd /home/gary/projects/cade-phase5-memory
/home/gary/projects/cade/.venv/bin/python -m pytest backend/tests/test_memory_graph.py -v
/home/gary/projects/cade/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_websocket_integration.py
```
