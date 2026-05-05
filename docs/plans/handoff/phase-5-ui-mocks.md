---
title: Phase 5 — agent memory UI · backend wired, actions done
created: 2026-04-29
updated: 2026-05-05
status: in-flight
---

# Resume: Phase 5 backend wired — capture toast remaining

## Active plans

- **Design folder:** `/home/gary/projects/cade/docs/plans/design/phase-5-memory/README.md`
- **Phase plan:** `/home/gary/projects/cade/docs/plans/nkrdn-agent-memory.md` — Phase 5 section
- **Architecture (shipped phases 1-4):** `/home/gary/projects/cade/docs/architecture/nkrdn-agent-memory.md`
- **Design bible:** `/home/gary/projects/cade/docs/technical/design/visual-design-philosophy.md`

## Contract

1. **Execute** — read this file, resume Next actions.
2. **Update as you go** — tick off actions, add gotchas.
3. **Graduate on completion** — design decisions → architecture doc, then delete.

## Where we are

All Phase 5 core work is committed and working on `phase5/memory-ui`. The
backend is fully wired: `nkrdn-graph` WS events are emitted on connect and
after nkrdn rebuild. Archive and retarget actions are live. The demo scenario
still works (`?demo=phase5-memory`). One deferred item remains: the capture
toast (surface A from mock 03).

## Worktree / branch

> [!IMPORTANT]
> Work is in a worktree, not main.

- Path: `/home/gary/projects/cade-phase5-memory` (worktree)
- Branch: `phase5/memory-ui`
- Last commit: `8716b9e Phase 5: tests for build_graph_message, retarget_memory, and API endpoints`
- Main checkout: `/home/gary/projects/cade` on `main`

## What shipped this session (all committed)

1. **Phase 5 frontend base** (`1820a8b`) — `MemoryGraphTree`, `SymbolDetailPane`,
   `memory.css`, all wiring (websocket events, right-pane mode, demo scenario,
   help overlay). `+mem` filter token now a real toggle (off by default).

2. **Backend `/api/memory/graph` + WS emission** (`4cf56e1`) — `backend/memory/api.py`
   builds `NkrdnGraphMessage` via `nkrdn memory list --json` (subprocess) +
   SQLite3 for symbol data + PyYAML for frontmatter. `_emit_nkrdn_graph()` fires
   on WS connect and after nkrdn initial_build.

3. **Archive + retarget action handlers** (`b21c0dd`) — `[a]` archives in both
   graph-tree (orphan rows) and symbol-detail (memory entries). `[r]` and `[1/2/3]`
   retarget orphans to candidates. Both fire `/api/memory/archive` and
   `/api/memory/retarget`. FileWatcher triggers rebuild → re-emit automatically.

4. **Tests** (`8716b9e`) — 10 tests covering empty-graph cases, module tree,
   orphan detection, retarget rewrite, endpoint guards.

## What remains

### Capture toast (deferred — do last)

Mock: `docs/plans/design/phase-5-memory/03-secondary-surfaces.html` (Surface A)

When `record_decision`, `record_attempt`, or `record_note` tool results land in
the chat stream, render a special collapsed block — same DOM parent as existing
tool blocks. Auto-collapses after ~3s. On expand: shows type pill, title, target
symbol name, and an "archive" button.

Implementation hints:
- The tool result arrives as a `tool-result` chat message with `tool_name` matching
  one of the three record_* names
- Add a branch in `frontend/src/chat/chat-pane.ts` (wherever tool results are
  rendered) that matches these tool names and renders a `.memory-capture-toast`
  block instead of the generic tool-result block
- The toast block style goes in `frontend/styles/workspace/memory.css`
- No backend changes needed — tool results already flow through the WS stream

### Graduate to architecture doc

Once capture toast ships (or if deferred indefinitely), graduate design decisions
from the phase plan to `docs/architecture/nkrdn-agent-memory.md` and delete
`docs/plans/design/phase-5-memory/` + this file.

## Key gotchas (carry forward)

- **nkrdn not in cade venv** — `api.py` uses `nkrdn memory list --json` subprocess
  + stdlib `sqlite3` + PyYAML. Do NOT add `from nkrdn import ...` to backend code.
  nkrdn lives in `/home/gary/.local/share/nkrdn-venv/`.
- **DB path is `.cade/staging/knowledge_base.db`** (not `.cade/knowledge_base.db`).
  The staging_dir in nkrdn defaults to `graph_file.parent` which is `.cade/`.
  CADE's `_run_nkrdn_rebuild` passes `--staging-dir .cade/staging` explicitly.
- **FileTree clears its container** — `FileTree.render()` does `container.innerHTML = ""`
  which stomps sibling components. MemoryGraphTree lives in `.memory-pane-graph`,
  FileTree in `.memory-pane-files`. These are sibling sub-divs — don't merge them.
- **`nkrdn-graph` WS event** — emitted twice on new sessions: once immediately
  on connect (catches existing graph), once after `initial_build()` completes
  (catches freshly built graph). Frontend just re-renders on each.
- **Retarget source file lookup** — uses `uri.split("#")[-1]` as the file stem.
  Standard CADE memories have stems like `2026-05-01-use-jwt`. Custom IDs (like
  afdex's `inv-tx-003`) also work as long as the stem matches the filename.

## Files of interest

In `/home/gary/projects/cade-phase5-memory/`:

- `frontend/src/memory/` — all 4 memory UI files
- `frontend/styles/workspace/memory.css` — all memory styles
- `backend/memory/api.py` — graph assembly + retarget logic
- `backend/tests/test_memory_graph.py` — Phase 5 backend tests
- `backend/websocket.py:768` — `_emit_nkrdn_graph()` helper
- `backend/main.py` — `/api/memory/graph`, `/api/memory/archive`, `/api/memory/retarget`

## Build & verify

```bash
# Demo (frontend only)
cd /home/gary/projects/cade-phase5-memory/frontend && npm run dev -- --port 5175
xdg-open "http://localhost:5175/?demo=phase5-memory"

# Backend tests
cd /home/gary/projects/cade-phase5-memory
/home/gary/projects/cade/.venv/bin/python -m pytest backend/tests/test_memory_graph.py -v
/home/gary/projects/cade/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_websocket_integration.py
```
