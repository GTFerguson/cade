---
title: nkrdn Agent Memory — Implementation Plan
created: 2026-04-23
updated: 2026-04-28
status: active
tags: [nkrdn, memory, agent, suite]
---

# nkrdn Agent Memory

CADE and nkrdn ship as a complete suite. This plan implements persistent agent
memory using nkrdn as the graph substrate and adapting Padarax's retrieval
plugin, which already implements the canonical scoring approach.

Design rationale and evidence base: [[../future/agent-memory]] and
[[../reference/agent-memory-systems]].

## What This Adds

Agents accumulate experience during work sessions — decisions made, approaches
tried and rejected, code quirks found. Today that knowledge dies at context
end. This feature persists it in nkrdn's graph, attached to the symbols it
describes, and retrieves the relevant slice when the agent returns to the same
code.

## Scope Reduction from Padarax Reuse

Padarax (`engine/src/agents/memory_store.cpp` + `memory_retriever.cpp`) already
implements the full retrieval stack:

- Park et al. 2023 triple-score formula (recency × last-access decay +
  importance stored at write time + nkrdn embedding relevance, all min-max
  normalised)
- LLM-controlled multi-round iterative retrieval with `seen_ids` dedup (the
  MemR³ masked-retrieval pattern)
- Graceful fallback to Jaccard when nkrdn embeddings are unavailable

**The diff to CADE is small:**
- `ChronicleEvent` → `MemoryEntry` (same fields, rename)
- `game_time_days` → wall-clock time throughout (formula unchanged)
- Add a supersession pre-filter before scoring (one predicate check)
- Swap the system prompt from NPC dialogue to dev-context retrieval

Phases 1–2 (nkrdn schema + ingestion) are the real work. Phase 3
(retrieval plugin) is largely a port.

## Phases

### Phase 1 — nkrdn schema changes

**Status:** Phase 1a (UUID-keyed identity, end-to-end) and Phase 1b (soft tombstoning) shipped in nkrdn `0d52287`, `36da615`, `1b30581`. Migration note in `nkrdn/CHANGELOG.md`. Cross-file move detection (tier 2) and `nkrdn delta show memory_affected` deferred until a concrete user need surfaces.

**UUID-keyed entity identity**

nkrdn currently keys entities by FQN + file path. Memory edges break on
rename/move. Fix: assign a stable UUID on first index; store FQN, path, and
line range as properties on the URI, not as the URI itself.

On rebuild, match new-source entities to existing graph entities via a layered
heuristic:
1. Exact FQN + file path → preserve UUID (fast path)
2. Same name + same parent module + similar signature → preserve UUID, record `code:previousName` or `code:movedFrom`
3. Same signature shape, different name, same file → preserve UUID, record rename
4. No match → mint new UUID

`nkrdn lookup <name>` needs a separate name index (name → UUID) since names
are no longer the URI.

#### Design decisions

**UUID format.** Random `uuid4` hex strings. Content-hash IDs would change every
time a function's body changed — defeats the purpose. Random IDs stay stable
across edits.

**URI shape.** `<namespace>repo/{repo}/{type}/{uuid}>`. Keeping the type
segment costs nothing and makes raw turtle output and SPARQL queries
human-readable.

**Name index.** The existing `symbols` table already serves as the name index
(unique on `(repository_name, fqn)`). Add a `stable_id` column (UUID4 hex)
to both `symbols` and `files`. Lookup becomes a SQL query on the existing
`idx_symbols_repo_fqn` index — no new infrastructure.

**UUID preservation across rebuilds.** Today `file_processor.py:237` runs
`delete_symbols_not_in(file_id, current_fqns)` then `upsert_symbols_bulk()`.
Inject the matcher between these two calls:

1. Snapshot the old rows for `file_id` (FQN + stable_id + signature_json).
2. Run the matcher: for each new symbol, find its prior `stable_id` via
   tier 1 → 4. Carry it forward into the upsert payload.
3. `INSERT ... ON CONFLICT DO UPDATE` on `(repo_name, fqn)` keeps the
   existing `stable_id` when FQN is unchanged (don't UPDATE the column).
4. After upsert, the unmatched old rows are tombstoned (soft delete via a
   `tombstoned_at` column) instead of being hard-deleted.

**Cross-file moves (tier 2 with module change) — deferred.** Cross-file
matching needs a higher-level coordinator that sees all files in one rebuild
pass. Phase 1a ships tier 1, tier 3 (within-file rename), and tier 4. Tier 2
cross-file moves land in Phase 1b once the in-file path is proven.

**"Similar signature" definition.** Same parameter count, same return type
name (raw string from `signature_json`). Loose enough to absorb parameter
renames and minor type tweaks; strict enough that two unrelated functions
in the same file don't collide.

**Symbol-table → graph projection.** `URIFactory.create_uri(entity_type, fqn)`
becomes `URIFactory.create_uri_for_symbol(symbol_row)` — looks up
`stable_id` from the row and returns
`<namespace>repo/{repo}/{type}/{stable_id}>`. Callers in
`graph_constructor.py`, `entity_processing_service.py`,
`summary_generation_service.py` switch to passing the symbol row instead of
the FQN. The fallback in `cross_reference_builder.py:624` that
reconstructs URIs from FQN dies — replaced with a SQL lookup that returns
the URI directly.

**Tombstoning**

When rebuild doesn't see a previously-indexed entity: add `code:deletedAt
<timestamp>`, do not drop it. All `mem:*` edges stay valid. Default queries
hide tombstones; `--include-deleted` exposes them.

GC policy: tombstones with no `mem:*` edges and age > 90 days are
hard-deleted. Tombstones with memory edges are kept until memory is archived
or retargeted.

**New code: predicates**

| Predicate | Meaning |
|---|---|
| `code:firstSeen` | Timestamp of first index |
| `code:previousName` | Prior FQN(s), if renamed |
| `code:movedFrom` | Prior `belongsToModule`, if moved |
| `code:deletedAt` | Timestamp of tombstoning |

**New mem: entity types**

| Type | Purpose |
|---|---|
| `mem:Decision` | A choice with rationale |
| `mem:Attempt` | A tried-and-rejected approach |
| `mem:Session` | A work session (date, topics) |
| `mem:Note` | Lightweight observation |

Namespace: `http://nkrdn.knowledge/memory#` (prefix: `mem:`)

**New mem: predicates**

`mem:appliesTo`, `mem:supersedes`, `mem:contradicts`, `mem:authoredBy`,
`mem:duringSession`, `mem:retargetedFrom`, `mem:archivedAt`

**Memory-aware rebuild delta**

Extend `nkrdn delta show` to include a `memory_affected` section: entities
with `mem:*` edges that were renamed, moved, or tombstoned in this run. CADE
subscribes to this to surface the "memory orphaned" review flow.

### Phase 2 — Markdown ingestion

**Status:** Shipped in nkrdn `bbb6712`. Architecture doc: [[../architecture/nkrdn-agent-memory]].

Storage format: markdown files with YAML frontmatter in `.cade/memory/`
(gitignored by default). nkrdn's existing doc parser is extended to handle
`mem:` frontmatter.

**Frontmatter → triples**

```yaml
---
type: decision
applies_to: [[AuthService]]
supersedes: 2026-01-12-exceptions
authored_by: agent:claude
session: 2026-01-31
tags: [error-handling, auth]
---
```

- `type` → entity class (`mem:Decision` etc.)
- `applies_to` wiki-links → `mem:appliesTo` edges, resolved to symbol UUIDs
- `supersedes` → `mem:supersedes` edge to prior Decision
- `authored_by` → `mem:authoredBy` literal

**Wiki-link resolution**

`[[AuthService]]` must resolve to a symbol UUID at ingest time. Resolution:
look up by name index (Phase 1). Ambiguous names (multiple symbols with the
same name) → log the ambiguity, store the raw name as a `mem:unresolvedLink`
literal for manual resolution. On rebuild, attempt re-resolution.

Store the resolved UUID as `mem:resolvedTarget` alongside the wiki-link text
so the markdown stays human-readable but the graph edge is stable.

**Supersession chain building**

When parsing, any Decision with a `supersedes` frontmatter field gets a
`mem:supersedes` edge to the referenced Decision. The retrieval pre-filter
uses this to exclude superseded Decisions from default queries.

### Phase 3 — Retrieval plugin (port from Padarax)

Port `memory_store.cpp` and `memory_retriever.cpp` from Padarax into nkrdn
(Python, mirroring the C++ logic). Key changes from the original:

- `ChronicleEvent` → `MemoryEntry` dataclass (id, type, content, importance,
  created\_at, last\_accessed, metadata)
- All time in wall-clock `datetime`, not `game_time_days`
- Relevance: nkrdn embedding cosine similarity (existing infrastructure),
  Jaccard fallback
- Pre-filter: exclude entries where `mem:supersedes` points at them (active
  supersession chain check before scoring)
- System prompt: dev-context retrieval rather than NPC dialogue — "you are the
  memory layer for a development agent; recall past decisions and observations
  relevant to the current task"

New CLI commands:

```bash
nkrdn memory search "<query>"          # LLM-controlled iterative retrieval
nkrdn memory search "<query>" --uri <code-entity-uri>  # scoped to symbol
nkrdn memory list <uri>                # all memories attached to a node
nkrdn memory add <uri> <markdown-file> # attach a memory file
nkrdn memory retire <memory-uri>       # set mem:archivedAt
```

Wire into CADE backend: a `/api/memory/search` endpoint that proxies
`nkrdn memory search` with the agent's current task context as the query.

### Phase 4 — Capture machinery (CADE)

**Status:** Shipped at `aa1d11c`. The `record_decision` / `record_attempt` /
`record_note` tools are registered in `backend/providers/registry.py`;
emission lives in `backend/memory/writer.py` with content-hash idempotency;
markdown writes trigger nkrdn rebuilds via the existing FileWatcher debounce
in `backend/nkrdn_service.py` (now also accepting `.md` writes under
`.cade/memory/`). Round-trip verified: cade writes → nkrdn parser ingests as
expected `mem:*` triples. Design synthesis: [[../reference/agent-memory-capture]].

What Phase 4 *doesn't* do: it doesn't make the agent actually call the tools.
The system prompt has no nudges, the dedup judge for refinement-vs-supersedes
isn't built, and there's no session-end consolidation. The next chunks
address each.

### Phase 4.1 — Capture activation in LiteLLM mode

The tools exist but aren't reached for. This phase wires capture into the
live agent loop so writes happen organically during real sessions.

- **System-prompt nudges** — extend `backend/prompts/modules/nkrdn.md` (or a
  new `agent-memory.md` module loaded from every mode's `additional_modules`
  in `backend/modes.toml`) with: when to call each tool, type-discrimination
  examples, and explicit "do NOT" guidance for routine edits. Conservative
  capture is the goal — fewer high-quality entries beats noisy floods.
- **Mode-aware filtering decision** — `MemoryToolExecutor.tool_definitions()`
  currently returns all three tools regardless of mode. Decide whether
  read-only modes (plan, research, review) should expose write-tools. The
  research synthesis recommends "yes" — capture during a research session
  is itself valuable — but confirm and gate via
  `permissions.manager.get_mode(connection_id)` if the answer turns out to
  be "no for plan, yes for research/review".
- **Verification** — open a real CADE session, ask the agent to make a
  decision, confirm the tool is called, the file lands in `.cade/memory/`,
  the rebuild fires, and `nkrdn memory search` finds it. The current
  Phase 4 tests cover the wiring; this phase needs end-to-end smoke
  testing in a live session.
- **Out of scope here:** spawned subagents (ClaudeCodeProvider) — CC has
  its own tool ecosystem; per CADE CLAUDE.md guidance, don't re-implement
  what CC already does. Defer to a separate question.

Trigger conditions to encode in the prompt nudge:

- **record_decision** — agent makes an explicit trade-off between concrete
  alternatives, with rationale. NOT for routine choices without real
  alternatives.
- **record_attempt** — agent abandons an approach mid-task after a
  meaningful effort (more than a few tool calls). NOT for routine
  backtracking.
- **record_note** — agent finds a non-obvious quirk worth keeping. NOT
  for things visible in the code itself.
- **Nothing** — small edits, routine tool calls, successful operations
  without trade-off reasoning.

### Phase 4.2 — Refinement vs supersedes detection

Phase 4 ships with content-hash exact-match idempotency only. If the agent
re-records a decision with slightly different wording, that's currently a
new entry, not an update. This phase adds an LLM-judge dedup pass at write
time:

1. **Candidate retrieval** — embedding ANN over existing entries
   (sequential scan is fine until index size warrants ANN; A-MEM does this
   too). Top-k nearest by `(content + alternatives + applies_to)` embedding.
2. **LLM yes/no rubric** — for each candidate, judge: same type? same
   primary `applies_to` target? refines/extends or contradicts? content
   materially different (>30% novel tokens)?
3. **Decision matrix** —
   - identical → silent no-op (current Phase 4.0 behaviour)
   - refinement → update body, preserve URI
   - contradicts → new entry with `mem:supersedes` link
   - distinct → new entry
4. **Conservative editing default** — when the judge has uncertainty,
   prefer link over merge, supersede over delete. Reversible operations
   only.

Module: `backend/memory/dedup.py` (new). Wire from
`MemoryWriter._write_file()` before the current `_scan_for_duplicate` step.

Reference: [[../../common-knowledge/ai-agents/memory-write-deduplication]].

### Phase 4.3 — Session-end Reflector pass

ACE Generator-Reflector-Curator (Zhang et al. 2025) review of the session's
captured entries: consolidate overlapping Decisions, promote high-value
Notes to Decisions, identify gaps the agent should have captured but
didn't.

Hard prerequisite: **provenance tracing** to mitigate the self-reinforcing
reflection error documented in Du 2026 (arXiv:2603.07670). Reflections
derived only from agent-authored sources must be marked provisional;
reflections derived from a mix of agent and user-authored sources can
write to canonical memory. Without this, the Reflector compounds errors
into high-importance beliefs that propagate forward.

Trigger (informed by [[../../common-knowledge/ai-agents/self-improving-agent-systems#3-multi-condition-trigger-mechanisms]]):

```
reflect_now = (
    importance_sum >= 30           # accumulated session importance
    OR turns_since_last_reflect >= 15
    OR session_end                 # always reflect at session close
)
```

Defer this phase until capture is in real use and we have data on what
entries the agent actually produces — premature reflection on noise is
worse than no reflection at all.

### Phase 5 — CADE UI

- **Symbol detail pane**: show attached `mem:Decision` and `mem:Attempt`
  nodes alongside structural info. Superseded entries collapsed by default.
- **Memory review queue**: notifications from memory-aware rebuild delta —
  "3 memories attached to renamed/deleted code, review needed."
- **Retarget flow**: for orphaned memories (target tombstoned), offer
  drag-onto-symbol or auto-suggested match from rename detection.
- **Promote to docs/ gesture**: button on a Decision → drafts a formal
  architecture doc section, user approves.

Phase 5 is lower priority than Phases 1–4. The agent benefit (retrieval
working) doesn't require UI.

## Key Challenges

**Identity matcher false positives** — two simultaneously renamed functions,
swapped function pairs, mass refactor. When the heuristic can't choose
confidently, mint new UUIDs and surface the ambiguity in the memory-affected
delta rather than blocking the rebuild.

**Reflection / consolidation quality gate** — the ACE Reflector pass can
synthesise incorrect memories into high-importance beliefs (self-reinforcing
reflection error, documented in Du 2026, arXiv:2603.07670). Any consolidation
pass must trace provenance back to source memories; reflections derived only
from agent-authored sources should be marked provisional.

**Capture threshold calibration** — too aggressive generates noise; too
conservative never accumulates value. Start conservative: only Decisions with
explicit alternative-comparison reasoning, and only Attempts that involved a
non-trivial revert. Tune from there.

## Open Questions

1. **Identity-matcher ambiguity**: when heuristic can't choose, mint new UUID
   and surface in delta — agreed in principle, exact UX not decided.
2. **Memory location default**: `.cade/memory/` gitignored (personal) vs
   committed (team-shared). Probably configurable; default TBD.
3. **Promotion gesture**: UI button vs agent suggestion vs manual. TBD in
   Phase 5.
4. **Cross-language identity**: Python vs C++ matchers need separate
   heuristics. Phase 1 can start Python-only.

## Implementation Notes for Fresh Session

Phases 1, 2, 3, and 4 are shipped. The next chunk is Phase 4.1 — see the
active handoff at [[handoff/agent-memory-phase-4-1-litellm-activation]] for
the full briefing, file map, and gotchas.

Key files for Phase 4.1+:
- `backend/prompts/modules/nkrdn.md` — where to add capture-tool guidance
  (or beside it as a new `agent-memory.md` module)
- `backend/modes.toml` — wire the new module into every mode's
  `additional_modules` list
- `backend/memory/tool_executor.py` — `MemoryToolExecutor.tool_definitions()`
  is where mode filtering would land if the next agent decides to gate
  tools by mode
- `backend/memory/writer.py` — `_scan_for_duplicate` is the integration
  point for Phase 4.2's LLM-judge dedup
- `core/backend/providers/api_provider.py:146` — `definitions_async()` is
  where LiteLLM gathers all registered tools

## Evidence Base

- [[../reference/agent-memory-systems]] — scoring formula, failure modes,
  Padarax implementation details
- [[../reference/agent-memory-capture]] — Phase 4 capture-surface design
  synthesis, deferred-work rationale
- [[../future/agent-memory]] — full design rationale, schema, lifecycle
- Park et al. 2023 (arXiv:2304.03442) — triple-score retrieval formula
- Du, Li, Zhang, Song 2025 (arXiv:2512.20237) — masked iterative retrieval
  (MemR³); implemented in Padarax's `seen_ids` dedup
