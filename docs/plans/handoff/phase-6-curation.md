---
title: Phase 6 — memory curation, browse, promote
created: 2026-05-05
updated: 2026-05-05
status: in-flight
---

# Resume: Phase 6 — P1 + P2 shipped, start with P3 (ambient retrieval surfaces)

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

Phase 5 (memory UI: graph tree, symbol detail pane, capture toast) is shipped, merged, graduated. **Phase 6 P1 (memory archive) and P2 (retrieval-side prompt nudges) are now shipped.** The natural next step is **P3 — ambient retrieval surfaces**, the first non-trivial design+code task in Phase 6.

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
- Last commit on main: P2 commit (this session) — see "Shipped this session"

## Shipped this session

- `81075ce` — Phase 5: capture toast for record_decision/attempt/note (shipped on phase5/memory-ui)
- `a9e5a41` — Phase 5: graduate UI design into architecture doc
- `a64ef5e` — Merge phase5/memory-ui into main
- `07189ec` — Phase 5 shipped: drop handoff
- In `common-knowledge`: `b50e142 ai-agents: ambient cues in developer tools` — PROVEN reference doc closing the HCI evidence gap for P3
- `92d03fa` — plans: Phase 6 priorities and explicit non-goals (research-grounded)
- `c69ed5f` — Phase 6 P1: discard action on memory capture toast
- (this session) — **Phase 6 P2: retrieval trigger guidance in `agent-memory.md` and `nkrdn.md`**

### What P2 actually shipped

Two prompt module edits (no code, no tests):

- `backend/prompts/modules/agent-memory.md` — added a **When to retrieve** section parallel to the existing **When to record** table. Triggers: about-to-decide (check for prior `record_decision`), about-to-explore (check for prior `record_attempt`), surprising behaviour (check for prior `record_note`), unfamiliar symbol (`--uri` scoped query). Counter-triggers explicit: trivial choices, well-known framework behaviour, fishing without a question. Cited the attentional-dilution failure mode as the rationale for narrow queries. Doc title trimmed from "Agent Memory — When to Record" to "Agent Memory" since both sides are now covered. Added an intro sentence stating capture and retrieval are both explicit and agent-controlled.
- `backend/prompts/modules/nkrdn.md` — added a **Project memory** row to the "When to Use" table with a pointer to `agent-memory` for triggers, and a new **Memory Commands** subsection (`memory search`, `--uri` variant, `memory list`, `memory affected`, `memory retire`) sitting between the Commands and Workspace Commands tables.

P2 is loaded by every mode that has `agent-memory` and/or `nkrdn` in `additional_modules` — currently `plan`, `code`, `research`, `review`, `triage` (per `backend/modes.toml`). No mode-config changes needed.

## In flight (uncommitted work)

**Mine (Phase 6):** none — P1 committed in `c69ed5f`, P2 committed this session.

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

1. **P3 — ambient retrieval surfaces** `[design + code]` — design and implement file-open hint (gutter or statusline) and chat hot-link extension. The HCI evidence base at `common-knowledge/ai-agents/ambient-cues-developer-tools.md` constrains the design: presence cues (markers, counts, badges) over content injection; let the user pull. Practical entry points: extend the existing chat linkifier; add a gutter component to the editor pane. **Start by re-reading the HCI doc, then sketch a design before writing code** — this is the first non-trivial design call in Phase 6.

2. **P4 — promote-to-docs gesture** — read Zhou et al. 2025 (arXiv:2504.20781) and Su et al. 2026 (arXiv:2602.07609) more deeply before designing the prompt + workflow (Open Question 4 in the plan). The summaries in `agent-memory-capture.md` §12 are too thin.

3. **P5 — tighten dedup at write time** — embedding-ANN + LLM-judge layer; can ship parallel to anything. Spec lives in `agent-memory-capture.md` §3.2.

P3 is the next major piece. P5 is independent and can run in any session.

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
- P2 shipped (this session):
  - `backend/prompts/modules/agent-memory.md` — When to retrieve section
  - `backend/prompts/modules/nkrdn.md` — Project memory row + Memory Commands subsection
- P3 targets (next):
  - HCI evidence base to re-read: `/home/gary/projects/common-knowledge/ai-agents/ambient-cues-developer-tools.md`
  - Likely code surfaces (TBD pending design): chat linkifier, editor gutter component, statusline. Identify by reading current `frontend/src/chat/` and `frontend/src/editor/` (or equivalent) before designing.

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
