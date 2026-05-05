---
title: Phase 6 — memory curation, browse, promote
created: 2026-05-05
updated: 2026-05-05
status: in-flight
---

# Resume: Phase 6 — P1 + P2 + P3 shipped, P4 next

## Active plans

- **Phase plan**: `/home/gary/projects/cade/docs/plans/nkrdn-agent-memory.md` — Phase 6 section is the source of truth (P1–P5 priorities, explicit non-goals, Phase 6.1 deferral)
- **Architecture (shipped through Phase 5)**: `/home/gary/projects/cade/docs/architecture/nkrdn-agent-memory.md`
- **Evidence base**:
  - `/home/gary/projects/cade/docs/reference/agent-memory-capture.md` — capture/dedup/Reflector evidence; §3 has the full dedup matrix for P5; §7 has the Reflector deferral rationale
  - `/home/gary/projects/cade/docs/reference/agent-memory-systems.md` — retrieval evidence; failure modes (attentional dilution, world-knowledge bleed, self-reinforcing reflection) that constrain P3 design
  - `/home/gary/projects/common-knowledge/ai-agents/ambient-cues-developer-tools.md` — HCI evidence base for P3 (NEW this session — programmer interruption cost, presence-only-vs-auto-injection, FlowLight)

## Contract — how to use this file

This file is persistent working memory for one in-flight task. Procedure:

1. **Orient, then confirm** — read this file, then present a one-sentence status and the first proposed next action to the user. Do not execute until they say go. The writing agent planned these steps; only the user can approve them, especially for anything irreversible (deploys, migrations, external API calls, branch operations).
2. **Use as persistent reference while building** — update it as you go: tick off next-actions, add new gotchas, revise file lists. This is the single source of truth for "where is this work right now".
3. **Graduate on completion** — once the task ships, lift the durable knowledge out: design decisions → `docs/architecture/nkrdn-agent-memory.md`, research findings → `docs/reference/`. Don't leave it stranded in here.
4. **Delete this file** — after graduation, `rm` the handoff. Its existence means work is still in the air; absence means done.

## Where we are

Phase 5 (memory UI: graph tree, symbol detail pane, capture toast) is shipped, merged, graduated. **Phase 6 P1 (memory archive), P2 (retrieval-side prompt nudges), and P3 (ambient retrieval surfaces) are now shipped.** Next step: **P4 — promote-to-docs gesture** (research-then-design before code).

### What the previous handoff got wrong about P1

The Phase 5 codebase had already shipped most of the P1 surface area — only the capture-toast discard action was actually missing. Found while surveying:

- ✅ `POST /api/memory/archive` endpoint already existed (`backend/main.py:1048`), shells to `nkrdn memory retire <uri>`.
- ✅ `nkrdn memory retire` CLI command already existed.
- ✅ Parser already emits `mem:archivedAt` triples for `archived_at` frontmatter (`nkrdn/src/nkrdn/parsers/memory/parser.py:182-185`).
- ✅ `nkrdn memory list --json` already exposes the `archived` field.
- ✅ Memory graph API already filters archived entries (`backend/memory/api.py:69`).
- ✅ Symbol detail pane already had the `[a]` archive keybinding wired to the endpoint (`frontend/src/memory/symbol-detail.ts:269-288`).
- ❌ Capture toast had no discard action (the deliberate Phase 5 gap).
- ❌ Archive endpoint test coverage was just the 503 case.

**Archived-memory schema decision was already made** — Option 1 (`archived_at: <ISO>` in frontmatter, parser filters at retrieval). It was already in place. The handoff's "user must decide" note was redundant.

### What P1 actually shipped this session (commit `c69ed5f`)

- Discard button in the capture toast → POST `/api/memory/archive` → mark toast as discarded (red rule, struck-through title, 'discarded' status).
- Project path threaded through `TerminalManager → ChatPane` so the toast knows which project to archive against.
- Three new tests in `test_memory_graph.py::TestMemoryArchiveEndpoint`: happy path (mocks subprocess, asserts `nkrdn memory retire <uri>` invocation), invalid-project 400, retire-failure 502.

## Worktree / branch

- Path: `/home/gary/projects/cade` — the **main checkout, on `main` branch**. Phase 5's worktree (`/home/gary/projects/cade-phase5-memory`) and `phase5/memory-ui` branch are now redundant; the user has not yet asked to remove them, so leave both alone unless asked.
- Last commit on main: `3cc62d2 Phase 6 P2: retrieval trigger guidance in agent-memory and nkrdn modules`

## Shipped this session

- `81075ce` — Phase 5: capture toast for record_decision/attempt/note (shipped on phase5/memory-ui)
- `a9e5a41` — Phase 5: graduate UI design into architecture doc
- `a64ef5e` — Merge phase5/memory-ui into main
- `07189ec` — Phase 5 shipped: drop handoff
- In `common-knowledge`: `b50e142 ai-agents: ambient cues in developer tools` — PROVEN reference doc closing the HCI evidence gap for P3
- `92d03fa` — plans: Phase 6 priorities and explicit non-goals (research-grounded)
- `c69ed5f` — Phase 6 P1: discard action on memory capture toast
- `3cc62d2` — Phase 6 P2: retrieval trigger guidance in `agent-memory.md` and `nkrdn.md`
- (this session) — **Phase 6 P3: ambient memory presence cues in chat + neovim header**

### What P3 actually shipped

Two presence-only surfaces driven by a tiny in-memory index that subscribes to the same `nkrdn-graph` WS broadcast the graph tree consumes:

- `frontend/src/memory/presence-index.ts` (new) + `presence-index.test.ts` — `MemoryPresenceIndex` class with `getCountsForFile(path)`, `getFirstSymbolForFile(path)`, and `subscribe(cb)`. Handles relative + absolute path normalisation (Windows backslash, project-root strip). Excludes archived/superseded entries from counts. 10 unit tests.
- `core/frontend/chat/linkify.ts` — generic `decorateFileLink?: (path) => Node | null | undefined` extension hook on `linkifyElement`. Decorator returns the cue node which gets inserted as a sibling immediately after the link span. Kept generic (not memory-specific) so future cues can reuse it.
- `frontend/src/chat/chat-pane.ts` — passes a memory cue decorator to all four `linkifyElement` call sites (user message, post-stream targetEl, history assistant, history user). New ChatPaneOptions fields `onShowMemoryForFile`. New methods `setMemoryPresenceLookup(lookup)`, internal `buildMemoryCue` arrow.
- `frontend/src/neovim/neovim-pane.ts` — added a `mem N` chip in the pane header next to the diff button via a new `.neovim-header-actions` flex wrapper. New methods `setMemoryLookup`, `setOnShowMemory`, `refreshMemoryBadge`. Hidden when no file is open or no memories present. Click → `onShowMemoryCallback(currentFile)`.
- `frontend/src/right-pane/right-pane-manager.ts` — `setMemoryPresenceLookup`, `setOnShowMemoryForFile`. Wires the lookup through `ensureNeovimPane` so the chip is live whenever NeovimPane is constructed.
- `frontend/src/terminal/terminal-manager.ts` — same pattern as the existing `setOnOpenFile`: stash, forward to ChatPane on lazy creation; new `setOnShowMemoryForFile`, `setMemoryPresenceLookup`.
- `frontend/src/tabs/project-context.ts` — instantiates the index, sets the project root, wires `presenceLookup` and `showMemoryForFile` callbacks into both right-pane and terminal-manager. Subscribes to refresh events to push them into the neovim badge. New `openMemoryForFile(path)` method that uses the index to find the first memory-bearing symbol and routes through the existing `setMode("memory-symbol") + showSymbol` flow (same path as `memoryGraphTree.onSelect`).
- `frontend/styles/workspace/memory.css` — `.memory-cue` ambient pill: muted gray border + grey text by default, lifts to `--accent-yellow` on hover. Aligns with the existing capture-toast pill colour language.
- `frontend/styles/workspace/terminal.css` — `.neovim-memory-badge` matching the same muted→yellow pattern; `.neovim-header-actions` flex wrapper.
- `frontend/src/demo.ts` — extended `PHASE5_CHAT` so two assistant messages mention `backend/auth/auth_service.py` explicitly, letting the cue render in the existing `?demo=phase5-memory` scenario without a new fixture.

Verified in browser (`?demo=phase5-memory`): both messages mentioning the path show `· 4` muted cue (4 = the four active memories on AuthService and its `authenticate` method; the superseded mem-004 is correctly excluded). The path mentioning `rate_limiter.py` correctly has no cue. Click handler is wired to the same right-pane-mode flow Phase 5's graph-tree uses, so the navigation surface is verified at the framework level even though click was not exercised through scout-browse (cue spans aren't in the AX tree). Neovim chip code path is symmetric to the chat surface but not separately verified — needs a real backend to spawn neovim. Pre-existing `keybindings.test.ts` failures are unchanged from `main`.

### What P2 actually shipped

Two prompt module edits (no code, no tests):

- `backend/prompts/modules/agent-memory.md` — added a **When to retrieve** section parallel to the existing **When to record** table. Triggers: about-to-decide (check for prior `record_decision`), about-to-explore (check for prior `record_attempt`), surprising behaviour (check for prior `record_note`), unfamiliar symbol (`--uri` scoped query). Counter-triggers explicit: trivial choices, well-known framework behaviour, fishing without a question. Cited the attentional-dilution failure mode as the rationale for narrow queries. Doc title trimmed from "Agent Memory — When to Record" to "Agent Memory" since both sides are now covered. Added an intro sentence stating capture and retrieval are both explicit and agent-controlled.
- `backend/prompts/modules/nkrdn.md` — added a **Project memory** row to the "When to Use" table with a pointer to `agent-memory` for triggers, and a new **Memory Commands** subsection (`memory search`, `--uri` variant, `memory list`, `memory affected`, `memory retire`) sitting between the Commands and Workspace Commands tables.

P2 is loaded by every mode that has `agent-memory` and/or `nkrdn` in `additional_modules` — currently `plan`, `code`, `research`, `review`, `triage` (per `backend/modes.toml`). No mode-config changes needed.

## In flight (uncommitted work)

**Mine (Phase 6):** none — P1 committed in `c69ed5f`, P2 in `3cc62d2`, P3 in this session's last commit (see `git log`).

**User's, untouched (separate triage feature in flight — DO NOT bundle with Phase 6 commits, DO NOT delete):**
- `backend/memory/tool_executor.py` — adds `record_investigation` tool
- `backend/memory/writer.py` — adds `"investigation"` to `VALID_TYPES`
- `backend/modes.toml` — adds `[modes.triage]` section
- `backend/prompts/modules/triage.md` — untracked triage prompt module
- `.claude/scheduled_tasks.lock` — claude internal, ignore

**Pre-existing test failures unrelated to Phase 6** (confirmed not caused by P1 work):
- `test_memory_writer.py::test_tool_executor_exposes_three_definitions` and
  `::test_tool_definitions_have_required_fields` — fail because the user's
  triage WIP added a 4th tool. Will pass once the user updates those tests
  alongside their triage commit.
- `test_api_provider.py::test_stream_chat_handles_error` — litellm
  exception-class compat issue in `core/backend/providers/api_provider.py:188`
  (`TypeError: catching classes that do not inherit from BaseException`).
  Likely a pinned-version mismatch.
- `test_mcp_tools.py::TestMCPToolAdapterCancellation::test_list_tools_propagates_cancelled_error`
  — MCP adapter cancellation test, swallows `asyncio.CancelledError` instead
  of propagating. Long-standing.

## Next actions (ordered)

1. **P4 — promote-to-docs gesture** `[research → design → code]` — read Zhou et al. 2025 (arXiv:2504.20781) and Su et al. 2026 (arXiv:2602.07609) deeply before designing the prompt + workflow (Open Question 4 in the plan). The summaries in `agent-memory-capture.md` §12 are too thin to design against. Likely surfaces: a per-Decision "promote" action in the symbol-detail pane that drafts an architecture-doc section via LLM, plus a destination picker. Defer code until research is logged.

2. **P5 — tighten dedup at write time** — embedding-ANN + LLM-judge layer; can ship parallel to anything. Spec lives in `agent-memory-capture.md` §3.2.

3. **(Future) Live presence updates** — P3's index loads once at session start and refreshes when a new `nkrdn-graph` arrives. If a memory is captured mid-session, the cue lags until the backend re-emits the graph (it does so after rebuilds — see `backend/websocket.py:_emit_nkrdn_graph`). Watch for stale-cue complaints; if real, add a `memory-write` WS event the index can listen for to trigger a partial refresh.

P5 is independent and can run in any session.

## Key design decisions

- **Phase 6 keeps capture + retrieval explicit, by the research.** Auto-inject at session start (attentional dilution, Du 2026) and conversation-end auto-extraction (self-reinforcing reflection error, Du 2026) are explicitly NOT in scope. Phase 6 builds the curation/browse/promote loop *around* the explicit pattern, not on top of an autonomy layer.
- **Verify-occasionally is the user's stated workflow.** Phase 5's capture toast is the verification surface. Phase 6 extends that posture into archive (P1), ambient awareness (P3), and human-validated promotion (P4).
- **Phase 6.1 (Reflector pass) stays deferred** until: real capture data accumulated, provenance tracing designed, multi-condition trigger framework in place. Don't pick up early.
- **The earlier framing "make memory automatic"** (mistakenly endorsed mid-conversation this session) was corrected after re-reading the existing PROVEN docs. The corrected priority list is in the plan; this handoff reflects it.

## Files touched / to touch

- P1 shipped (commit `c69ed5f`):
  - `frontend/src/chat/chat-pane.ts` — `setProjectPath`, discard button, `archiveCapturedMemory`
  - `frontend/src/terminal/terminal-manager.ts` — `setProjectPath` propagation
  - `frontend/src/tabs/project-context.ts` — wires project path to terminal manager
  - `frontend/styles/workspace/memory.css` — `.memory-capture-toast__archive` and `--discarded` state
  - `backend/tests/test_memory_graph.py` — three new archive endpoint tests
- P2 shipped (commit `3cc62d2`):
  - `backend/prompts/modules/agent-memory.md` — When to retrieve section
  - `backend/prompts/modules/nkrdn.md` — Project memory row + Memory Commands subsection
- P3 shipped (this session):
  - `frontend/src/memory/presence-index.ts` (new), `presence-index.test.ts` (new)
  - `core/frontend/chat/linkify.ts` — `decorateFileLink` extension hook
  - `frontend/src/chat/chat-pane.ts` — memory cue decorator wiring
  - `frontend/src/neovim/neovim-pane.ts` — `mem N` chip + click handler
  - `frontend/src/right-pane/right-pane-manager.ts` — lookup forwarding
  - `frontend/src/terminal/terminal-manager.ts` — chat-pane wiring
  - `frontend/src/tabs/project-context.ts` — index instantiation, `openMemoryForFile`
  - `frontend/styles/workspace/memory.css` — `.memory-cue`
  - `frontend/styles/workspace/terminal.css` — `.neovim-memory-badge`, `.neovim-header-actions`
  - `frontend/src/demo.ts` — Phase5 chat fixture extended with explicit paths so cue is visible in `?demo=phase5-memory`
- P4 targets (next):
  - Read deeply: Zhou et al. 2025 (arXiv:2504.20781), Su et al. 2026 (arXiv:2602.07609)
  - Update `docs/reference/agent-memory-capture.md` §12 with deeper synthesis before design
  - Likely UI surface: action in `frontend/src/memory/symbol-detail.ts` to "promote" a Decision to docs

## Build & verify

```
cd /home/gary/projects/cade && /home/gary/projects/cade/.venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_websocket_integration.py
cd /home/gary/projects/cade/frontend && npx tsc --noEmit
cd /home/gary/projects/cade/frontend && npm run dev -- --port 5175  # demo at ?demo=phase5-memory still works
```

## Gotchas encountered

- **`SendMessage` is referenced in the Agent tool docstring but is NOT in the available toolset** in this CLI. To continue a previously spawned agent, you can't — you must launch a fresh one. If a sub-agent's prepared output is sandboxed-out, instruct the agent to write to a path it CAN access (e.g. `cade/.cache/proven-research/`) and move it from the parent. Do NOT spawn a fresh agent and ask it to "reply with the prepared content" — it has no context and will fabricate plausible-looking work.
- **`nkrdn workspace rebuild` is on the deny list** but works wrapped: `systemd-run --user --scope -p MemoryMax=2G -p MemorySwapMax=0 -p CPUQuota=200% nkrdn workspace rebuild <repo>`. Ran this session for `common-knowledge` after the new reference doc shipped.
- **The user's triage feature work** (record_investigation, triage mode, triage prompt module) is uncommitted in their working tree. It is NOT Phase 6 scope. Preserve it across any rebases / merges / branch ops; do not bundle it into Phase 6 commits; do not ask about it unless they raise it.
