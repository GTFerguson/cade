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

### Phase 4 — Capture layer (CADE)

Trigger conditions for writing a Decision vs a Note vs nothing:

- **Decision**: agent makes an explicit trade-off (chose X over Y, with
  rationale). Trigger: agent output contains reasoning about alternatives
  or a choice between approaches.
- **Attempt**: agent tries something and reverts or pivots. Trigger: a
  significant edit is reversed within the session.
- **Note**: lightweight observation the agent flags as worth keeping.
  Trigger: explicit agent annotation.
- **Nothing**: small edits, routine tool calls, anything without reasoning
  content.

Capture flow: agent writes a markdown file to `.cade/memory/` using a
frontmatter template. File is created immediately; graph ingestion happens
on next `nkrdn rebuild` (or via a lightweight single-file ingest command:
`nkrdn memory add`).

At session end, optionally trigger a Reflector pass (ACE
Generator-Reflector-Curator): review session notes, consolidate overlapping
Decisions, promote high-value Notes to Decisions.

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

Start with Phase 1. The UUID-keying change is load-bearing for everything
else — nothing in Phase 2+ works without stable identity across rebuilds.

Key files in nkrdn to read first:
- `src/nkrdn/graph/builder/` — where entity URIs are generated
- `src/nkrdn/parsers/docs/` — doc indexer to extend in Phase 2
- `src/nkrdn/cli/` — where new `nkrdn memory *` commands live

Key files in Padarax to read before Phase 3:
- `engine/src/agents/memory_store.cpp` — scoring formula, nkrdn relevance query
- `engine/src/agents/memory_retriever.cpp` — iterative LLM-controlled loop
- `engine/include/padarax/agents/memory_retriever.hpp` — struct definitions

## Evidence Base

- [[../reference/agent-memory-systems]] — scoring formula, failure modes,
  Padarax implementation details
- [[../future/agent-memory]] — full design rationale, schema, lifecycle
- Park et al. 2023 (arXiv:2304.03442) — triple-score retrieval formula
- Du, Li, Zhang, Song 2025 (arXiv:2512.20237) — masked iterative retrieval
  (MemR³); implemented in Padarax's `seen_ids` dedup
