---
title: Agent memory — Phase 4.1 activate capture in LiteLLM mode
created: 2026-04-29
status: in-flight
---

# Resume: activate agent-memory capture in CADE's live LiteLLM agent loop

## Active plans

- **Phase plan:** `/home/gary/projects/cade/docs/plans/nkrdn-agent-memory.md`
  — Phases 1, 2, 3, 4 shipped. Phase 4.1 (this doc) is next, with 4.2
  (refinement detection) and 4.3 (Reflector pass) following. Phase 5 (UI)
  is separate scope.
- **Architecture (shipped):** `/home/gary/projects/cade/docs/architecture/nkrdn-agent-memory.md`
- **Reference (capture design synthesis):** `/home/gary/projects/cade/docs/reference/agent-memory-capture.md`
- **Common-knowledge research:**
  `/home/gary/projects/common-knowledge/ai-agents/agent-memory-write-tools.md`,
  `memory-write-deduplication.md`, `architecture-decision-records.md`

## Contract — how to use this file

Same as previous handoffs:

1. **Execute** — read this file first, then resume Next Actions below.
2. **Use as persistent reference while building** — tick off actions, add
   gotchas, revise file lists. Single source of truth for "where is this
   work right now."
3. **Graduate on completion** — design decisions → architecture doc,
   research findings → reference doc.
4. **Delete this file** when 4.1 ships. (4.2 and 4.3 are separate handoffs
   when their time comes.)

## Where we are

Phase 4 capture machinery shipped at cade `aa1d11c` (graduated at
`a207eba`). The agent has three working tools:

| Tool | What it captures | Required fields |
|---|---|---|
| `record_decision` | Trade-off with rationale | `rationale`, `alternatives`, `applies_to`, `importance` |
| `record_attempt` | Abandoned approach + failure mode | `approach`, `outcome`, `applies_to`, `importance` |
| `record_note` | Non-obvious finding | `observation`, `applies_to`, `importance` |

All three emit MADR-flavoured markdown into `.cade/memory/`, dedupe by
content hash, and trigger nkrdn rebuilds via the existing FileWatcher
debounce. End-to-end round-trip verified (cade writes → nkrdn parser
ingests as `mem:Decision` / `mem:Attempt` / `mem:Note` triples).

**The gap:** the agent doesn't know it should call these tools, because
nothing in the system prompt tells it to. So today, the machinery works
but capture rate in real sessions is effectively zero.

## Worktree / branch

- cade: `/home/gary/projects/cade`, branch `main`, last commit `a207eba`
- nkrdn: `/home/gary/projects/nkrdn`, branch `main`, last commit `aa715ca`
- common-knowledge: `/home/gary/projects/common-knowledge`, branch `master`,
  last commit `69a72c6`

Working tree contains pre-existing unrelated edits in cade
(`tauri.conf.json`, `chat-pane.ts`, `pyinstaller.spec`, `desktop/src-tauri/resources/`)
that are NOT part of this work — do not bundle.

## Shipped this session

The Phase 4 + 4.0 prerequisites — see `git log a207eba...d8069f9` in cade
and `aa715ca` in nkrdn. Nothing left to commit before starting 4.1.

## In flight (uncommitted work)

Nothing related to memory capture. Pre-existing unrelated edits only.

## Next actions (ordered)

### 1. System-prompt nudges (highest priority — unblocks user benefit)

Decide between two options:

- **Option A — extend `backend/prompts/modules/nkrdn.md`** with a new
  "When to record memory" section. Cheaper change, but the file is
  already focused on the `nkrdn` CLI for *retrieval*; adding capture
  guidance there blurs the doc's purpose.
- **Option B — new `backend/prompts/modules/agent-memory.md` module**,
  loaded as `additional_modules` for every mode in `backend/modes.toml`.
  Cleaner separation; same loading mechanism as `nkrdn.md`. **Recommended.**

Content to encode (drawn from
[[../../common-knowledge/ai-agents/agent-memory-write-tools#4-triggering-writes-system-prompt-patterns]]):

```markdown
# Agent Memory — When to Record

You have three tools that write durable memory entries to .cade/memory/
attached to code symbols. Future agents (including you in later sessions)
can retrieve these entries via nkrdn memory search.

## When to call

- record_decision — after choosing between two or more concrete
  approaches with a non-trivial trade-off. Include the rationale AND the
  alternatives you rejected. Do NOT call for routine choices without real
  alternatives.
- record_attempt — after spending more than a few tool calls on an
  approach you ended up abandoning. Capture the specific failure mode so
  a future agent doesn't re-explore the same dead end.
- record_note — when you find a non-obvious quirk in the codebase that
  isn't visible from reading the code itself. Hidden constraints,
  surprising behaviours, undocumented invariants.

## When to skip

Routine edits, successful tool calls without trade-off reasoning, small
refactors, anything visible in the code itself. The memory store is for
things future readers would otherwise rediscover from scratch.

## Importance score (1-10)

3 = routine choice; 5 = standard trade-off with rationale; 7 =
architectural decision with broad impact; 9 = critical (security,
correctness, contractual). Score at write time using context only you
have right now — re-scoring later is unreliable.
```

After writing the module, add it to `additional_modules` in every mode's
section of `backend/modes.toml`. Test: start CADE, switch modes, verify
the new content appears in the composed prompt (use a print-debug line or
the existing prompt-inspection tooling).

### 2. Mode-aware filtering decision

Currently `MemoryToolExecutor.tool_definitions()` returns all three tools
regardless of mode. Decide:

- **Plan mode** (`write_access = "none"`): expose record_*? Plan mode is
  where the most decisions get made *about future work*. Probably yes.
- **Research mode** (`write_access = "none"`): yes — capture during
  research is high-value (the research synthesis recommends this).
- **Review mode** (`write_access = "docs_plans"`): yes.
- **Code mode** (`write_access = "all"`): yes (current behaviour).
- **Orchestrator mode**: yes for the orchestrator session itself; spawned
  subagents go through ClaudeCodeProvider and are out of scope.

If the answer ends up being "yes for all", no filtering change is needed
— current behaviour is correct. Document the decision in
`docs/architecture/nkrdn-agent-memory.md` either way so future readers
don't re-litigate.

If filtering becomes per-mode, gate via:

```python
from backend.permissions.manager import get_permission_manager
mode = get_permission_manager().get_mode(self._connection_id)
# filter _ALL_DEFINITIONS based on mode
```

Pattern is already used in `backend/tools/file_tools.py:205-211`.

### 3. End-to-end smoke test in a live session

The Phase 4 unit + integration tests cover the wiring (56 passing, 1
skipped). Phase 4.1 needs a *behaviour* test: in a real CADE session,
does the agent actually call the tools when prompted to make a decision?

Manual test script:

```
1. Start CADE with a real LiteLLM provider configured (Mistral / Cerebras /
   Groq — check ~/.cade/providers.toml).
2. Open a project (any project; the test directory in /tmp works fine).
3. Switch to code mode.
4. Ask the agent: "We need to choose between using JWT or session cookies
   for our new auth service. Walk me through the trade-offs and pick one.
   Record the decision."
5. Confirm the agent calls record_decision (visible in the tool-call
   stream).
6. Confirm `.cade/memory/<today>-*-md` exists with valid frontmatter.
7. Wait ~10s for the FileWatcher debounce, then run
   `nkrdn memory search "auth"` from a shell. The new entry should
   surface.
8. Hit POST /api/memory/search (e.g. via curl with the auth token from
   ~/.cade/.token) — same entry should come back scored.
```

Add a regression test if this surfaces issues. The current test gap is
that we don't have a recorded LiteLLM tool-call trace in the test suite;
it's hard to fake the agent's decision to call a tool. Document this as
a known gap rather than mocking the LLM-call path more deeply.

### 4. Update architecture doc + ship

Once 4.1 is verified working in a live session:

- Update `docs/architecture/nkrdn-agent-memory.md` with the prompt module
  decision (A vs B above) and the mode-filtering decision.
- Mark Phase 4.1 with a Status line in
  `docs/plans/nkrdn-agent-memory.md` citing the commit, same pattern as
  Phases 1–4.
- Delete this handoff.

### 5. (Then move to Phase 4.2 if scoped together)

LLM-judge dedup for refinement vs supersedes detection. See plan doc
Phase 4.2 section for the design. New module: `backend/memory/dedup.py`,
wired from `MemoryWriter._write_file()` before the current
`_scan_for_duplicate` call. Evidence base:
[[../../common-knowledge/ai-agents/memory-write-deduplication]].

This is its own non-trivial implementation chunk. Either fold it into
this handoff or graduate 4.1 first and start a fresh handoff for 4.2 —
your call based on session length and complexity tolerance.

### 6. (Phase 4.3 — explicitly defer)

Session-end Reflector pass. Don't build until 4.1 is live and you have
real session data on what entries the agent produces. Premature
reflection on noise is worse than no reflection. The plan doc Phase 4.3
section spells out the prerequisite: provenance tracing to mitigate the
self-reinforcing reflection error from Du 2026 (arXiv:2603.07670).

## Key design decisions (settled in Phase 4)

- **Type-discriminated tools, not generic save_memory.** Schema-first
  parameter design forces the agent to commit to specific content shape.
  Don't collapse to a single tool.
- **Importance is 1–10, not 0–5.** The research doc recommended 0–5
  (Li et al. 2025) but the existing nkrdn parser at
  `nkrdn/src/nkrdn/parsers/memory/parser.py:122-127` clamps to 1–10. Phase 4
  matches the parser. Switching to 0–5 is a Phase 4.5 cleanup that requires
  a parser change.
- **System owns idempotency, not the agent.** The agent never pre-checks
  whether memory exists; the write tool absorbs duplicates silently.
- **`.cade/memory/` gitignored by default.** Memory is personal/per-developer
  unless the project explicitly opts into committing it.
- **`authored_by: agent:cade` hard-coded.** Tying it to the active provider
  config is a Phase 4.5 cleanup; Phase 4 ships with the simple default.

## Files touched / to touch

For Phase 4.1:

- `backend/prompts/modules/agent-memory.md` (new — Option B above)
- `backend/modes.toml` — add `"agent-memory"` to `additional_modules` for
  each mode
- `backend/memory/tool_executor.py` — only if mode-filtering change needed
- `docs/architecture/nkrdn-agent-memory.md` — update with 4.1 decisions
- `docs/plans/nkrdn-agent-memory.md` — Status line for 4.1 when shipped

For Phase 4.2 (if folded in):

- `backend/memory/dedup.py` (new) — embedding ANN + LLM judge
- `backend/memory/writer.py:200-260` — `_write_file()` integration point
  before the current `_scan_for_duplicate`
- Possibly `backend/memory/embeddings.py` (new) for the embedding wrapper,
  unless we reuse nkrdn's
- `backend/tests/test_memory_dedup.py` (new) — judge cases for identical /
  refinement / supersedes / new

For Phase 4.3:

- TBD — start a fresh handoff when this phase is greenlit.

## Build & verify

```bash
# cade — full backend
cd ~/projects/cade && .venv/bin/python -m pytest backend/tests/ -q --ignore=backend/tests/test_websocket_integration.py

# cade — memory subset
cd ~/projects/cade && .venv/bin/python -m pytest backend/tests/test_memory_writer.py backend/tests/test_memory_integration.py backend/tests/test_memory_api.py -q

# Live smoke (manual; see Next Action 3)
# 1. Start CADE
# 2. Open project, code mode, ask for a decision with rationale
# 3. Verify .cade/memory/ + nkrdn memory search
```

## Gotchas encountered (Phase 4)

Carried forward — these still apply:

- **`from __future__ import annotations` + closure-scoped Pydantic model
  = silent FastAPI body→query downgrade.** Module-scope any new request
  models in `backend/main.py`. Cost ~30 minutes during Phase 3.
- **`backend/tests/test_websocket_integration.py` has flaky pty/forkpty
  tests** unrelated to memory work. Run in isolation if anything fails
  there.
- **`nkrdn` is editable-installed via `/home/gary/.local/share/nkrdn-venv`,
  not the project's `.venv`.** Use that interpreter for nkrdn-side tests
  and round-trip verification.
- **The cade conftest's `temp_dir` fixture** is the right one for memory
  tests. Pattern is in `backend/tests/test_memory_writer.py`.
- **Pre-existing unrelated uncommitted edits** sit alongside this work —
  `tauri.conf.json`, `chat-pane.ts`, `pyinstaller.spec`,
  `desktop/src-tauri/resources/`. Stage selectively, don't `git add -A`.

New gotchas to watch for in 4.1:

- **Prompt modules are loaded by name from `backend/prompts/modules/`.**
  The composer (`backend/prompts/compose.py`) reads `MODULES_DIR / f"{name}.md"`.
  If you add `agent-memory.md`, reference it as `"agent-memory"` (without
  the `.md`) in `modes.toml`.
- **System prompt changes don't hot-reload.** Restart CADE between prompt
  edits to see them take effect, or use the dev-server reload flow.
- **Tool definitions go through LiteLLM's function-calling format.**
  The shared `ToolDefinition` → JSON-Schema mapping happens in
  `core/backend/providers/api_provider.py` around `definitions_async()`.
  If a tool's schema doesn't match what LiteLLM expects, the call will
  return a 400 from the upstream provider — debug by inspecting the
  composed kwargs.
- **Mode change races.** `permissions.manager.set_mode()` is called from
  the websocket handler; a tool definition request that arrives mid-mode-
  switch could see either the old or new mode. Phase 4 doesn't worry
  about this; if 4.1 adds mode-filtering, ensure the resolved mode is
  read once per `tool_definitions()` call.

## Open questions for 4.1

1. **Module A vs B above** — `nkrdn.md` extension or new `agent-memory.md`?
   Recommendation is B; confirm before writing.
2. **Mode-aware filtering** — uniform across modes, or per-mode? Current
   default is uniform.
3. **Should `authored_by` reflect the active provider?** Currently
   hard-coded `agent:cade`. Phase 4.5 cleanup; flag if you change it.
4. **Subagents (ClaudeCodeProvider)** — out of scope per CADE
   CLAUDE.md guidance. Confirm and document.
