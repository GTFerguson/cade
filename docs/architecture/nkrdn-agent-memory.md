---
title: nkrdn Agent Memory — Architecture
created: 2026-04-28
updated: 2026-05-05
status: active
tags: [nkrdn, memory, architecture]
---

# nkrdn Agent Memory

Persistent agent memory using nkrdn as the graph substrate. Agents accumulate observations during work sessions — decisions made, approaches tried and rejected, code quirks found. Without persistence, that knowledge dies at context end. This system attaches it to the code symbols it describes and retrieves the relevant slice when the agent returns to the same code.

Design rationale and evidence base: [[../reference/agent-memory-systems]].

## How It Works

### Storage

Memory files live in `.cade/memory/` (gitignored by default). Each file is a markdown document with YAML frontmatter:

```yaml
---
type: decision          # decision | attempt | session | note
applies_to: [[AuthService]]
supersedes: 2026-01-12-old-decision
authored_by: agent:claude
session: 2026-01-31
tags: [auth, error-handling]
created: 2026-01-31
---
Chose JWT over session cookies for stateless horizontal scaling.
```

The body is stored as `mem:content`. The filename stem becomes the memory entity's URI (`mem:{stem}`).

### Ingestion Pipeline

On every `nkrdn rebuild`, Phase 2.5 runs after the code graph is built:

```
Symbol extraction (SQLite) → Graph construction (RDF) → Memory ingestion → Save graph
```

Memory ingestion (`parsers/memory/`) does three things:

1. **Scan** — walks `.cade/memory/*.md`, reads each file.
2. **Parse** — calls the docs frontmatter parser to extract fields; converts each field to `mem:*` triples.
3. **Resolve** — `[[SymbolName]]` wiki-links are resolved to stable `code:` URIs via the symbol DB. If resolved, `mem:appliesTo <code:...uuid...>` is emitted. If ambiguous or missing, `mem:unresolvedLink "SymbolName"` is stored instead; re-resolution is attempted on every rebuild automatically.

The memory named graph (`http://nkrdn.knowledge/memory`) is cleared and rebuilt each run — the pass is idempotent.

### Triple Schema

Namespace: `http://nkrdn.knowledge/memory#` (prefix: `mem:`).

Named graph: `http://nkrdn.knowledge/memory`.

| Predicate | Source field | Notes |
|---|---|---|
| `rdf:type` | `type:` | `mem:Decision`, `mem:Attempt`, `mem:Session`, `mem:Note` |
| `mem:content` | body | Full markdown body |
| `mem:appliesTo` | `applies_to:` | `code:` URI of resolved symbol |
| `mem:unresolvedLink` | `applies_to:` | Raw name when resolution fails |
| `mem:supersedes` | `supersedes:` | `mem:` URI of prior entry by filename stem |
| `mem:evidence` | `evidence:` | Wiki-links resolve to `code:` URIs via the symbol resolver; URLs and citation literals stay as `Literal`. Mixed arrays supported. |
| `mem:rejectedAlternative` | `alternatives:` | One literal per rejected option for a Decision. Same content also appears as prose in the body's `## Considered Options` section for human readability. |
| `mem:authoredBy` | `authored_by:` | Literal string. Format: `agent:<provider-name>` (e.g. `agent:cerebras`, `agent:mistral`) — the writer reads the active LiteLLM provider's `name` from `~/.cade/providers.toml` at executor construction time. Falls back to `agent:cade` when no provider is wired. |
| `mem:duringSession` | `session:` | Session date or ID |
| `mem:tag` | `tags:` | One triple per tag |
| `mem:createdAt` | `created:` | ISO date string |
| `mem:sourceFile` | (auto) | Absolute path to the source `.md` file |

### Wiki-Link Resolution

`WikiLinkResolver` (`parsers/memory/resolver.py`) queries the symbol DB with two strategies in order:

1. **Exact FQN match** — `symbols.fqn == name`
2. **Suffix match** — `symbols.fqn LIKE '%.name'`

If exactly one symbol matches, the stable UUID-keyed URI is emitted (`code:repo/{repo}/{kind}/{uuid}`). This URI survives renames and moves (Phase 1 identity guarantee).

If multiple symbols match (ambiguous), the resolver logs once per name per rebuild and returns `None`. The caller stores `mem:unresolvedLink`. The next rebuild retries automatically — no manual intervention required unless the name is permanently ambiguous.

**Note on frontmatter bracket-list parsing:** The docs frontmatter parser treats `[[AuthService]]` as a one-item bracket list, yielding `[AuthService]` (single brackets). `_extract_wikilink_names` handles both `[[Name]]` and `[Name]` forms.

## Design Decisions

**Why `.cade/memory/` gitignored by default?**  
Memory is personal and session-specific by default. Team-shared memory is a deliberate opt-in (commit the directory). Keeping it gitignored prevents accidental leakage of agent observations into shared history.

**Why rebuild the memory named graph from scratch each run?**  
Memory files are small and parse instantly. Incremental patching would require tracking which files changed, adding complexity for no measurable benefit. Clearing and rebuilding the named graph takes < 10ms even at hundreds of entries.

**Why suffix-match resolution rather than RDF label lookup?**  
The symbol DB (SQLite) is available during ingestion and is faster than an RDF query. The `symbols.fqn` index on `(repository_name, fqn)` makes both exact and LIKE queries cheap. The graph's `rdfs:label` predicates would require a round-trip through rdflib.

**Why store `mem:unresolvedLink` rather than dropping the triple?**  
Unresolved links are re-attempted on every rebuild. Storing them preserves the author's intent and allows the human to see which links are pending resolution. Silently dropping them would make the memory entry harder to audit.

**Why a separate named graph for memory?**  
Isolating memory triples in `http://nkrdn.knowledge/memory` keeps them easy to enumerate, clear, and rebuild without touching the code graph. It also makes SPARQL queries unambiguous — `GRAPH <memory>` scopes cleanly.

## Configuration

| Setting | Default | Notes |
|---|---|---|
| Memory dir | `.cade/memory/` | Relative to project root. Gitignored. |
| Named graph | `http://nkrdn.knowledge/memory` | Fixed in `parsers/memory/__init__.py`. |
| Namespace | `http://nkrdn.knowledge/memory#` | Fixed. |

## Capture Layer

The agent writes memory entries via type-discriminated tools registered in
CADE's per-connection `ToolRegistry`:

| Tool | When to call | Required fields |
|---|---|---|
| `record_decision` | After choosing between concrete alternatives with non-trivial trade-off | `rationale`, `alternatives`, `applies_to`, `importance` |
| `record_attempt` | After abandoning an approach mid-task | `approach`, `outcome`, `applies_to`, `importance` |
| `record_note` | When finding a non-obvious quirk worth keeping | `observation`, `applies_to`, `importance` |
| `record_investigation` | After completing a transaction triage investigation | `applies_to` (counterparty name), `verdict`, `confidence`, `signals`, `specter_snapshot`, `rationale`, `transaction_id` |

`record_investigation` is triage-mode-only. Its `applies_to` is a single string (counterparty entity name, not a code symbol). Importance is hard-coded from the verdict: 7 for `escalate`/`block`, 4 for `legit`.

`backend/memory/writer.py` emits markdown files into `.cade/memory/` with
frontmatter that matches the parser schema above. The body uses MADR-style
sections (rationale → Considered Options → Consequences for decisions). A
content hash over `(type, primary_text, sorted(alternatives), sorted(applies_to))`
is embedded as an HTML comment; identical writes are silent no-ops returning
the existing URI.

**Rebuild trigger.** `backend/nkrdn_service.py` extends its FileWatcher
filter to include `.md` files under `.cade/memory/`. The existing 10-second
debounce schedules a single rebuild per burst of writes — the writer
doesn't need a direct `NkrdnService` handle. After a successful incremental
rebuild, `NkrdnService` calls its `on_rebuild` callback; the websocket
handler passes `_emit_nkrdn_graph` so the frontend immediately receives the
updated graph without waiting for the next session.

**Live write notification.** `MemoryToolExecutor.execute_async` fires a
`memory-write` WebSocket event immediately after a successful write (before
the rebuild). The event carries `action`, `memory_type`, and `uri_stem`.
`MemoryPresenceIndex` listens to it and notifies subscribers so the UI can
show a pending state while the rebuild is in flight.

**Why explicit tool calls (vs autonomous post-turn extraction):** cheaper,
more auditable, and avoids the self-reinforcing reflection error documented
in Du 2026 (arXiv:2603.07670). Cross-domain evidence and rationale:
[[../reference/agent-memory-capture]].

### Capture toast

When `record_decision`, `record_attempt`, or `record_note` flows through
the chat stream, `ChatPane` renders a `.memory-capture-toast` (yellow rule,
✦ glyph, type pill) inline with the tool sequence instead of the generic
tool-use block. The toast pulls a truncated title from the tool input
(`rationale` / `approach` / `observation`) and the target from
`applies_to[0]`. On `tool-result` it flips to `saved` — or `duplicate`
when the content-hash idempotency check returns the existing URI — then
auto-collapses to a muted single row after three seconds. Click any
collapsed row to re-expand.

There is no dismiss action. The markdown file is already written by the
time the result arrives, so a discard control would imply a backend
tombstone endpoint that doesn't exist. The toast is a notification, not a
prompt — keeping it information-only matches the autonomous-capture
posture the agent already runs in.

### Capture Activation (Phase 4.1)

The capture tools are wired into every CADE mode. Two decisions made together:

**Prompt module — separate `agent-memory.md`.** The trigger guidance lives in
`backend/prompts/modules/agent-memory.md`, distinct from `nkrdn.md` (which
covers retrieval). Both modules are loaded as `additional_modules` in every
entry of `backend/modes.toml`. Splitting capture from retrieval keeps each
module focused on one concern; merging them would have made the combined
file a sprawl across two distinct agent behaviours.

**Mode filtering — uniform across all modes.** `MemoryToolExecutor.tool_definitions()`
returns all three tools regardless of `write_access`. Plan and research modes
are *where* most of the high-signal Decisions and Notes get reasoned through;
gating capture by write permissions would lose the highest-quality entries.
Memory writes go to `.cade/memory/`, which is outside the "user code"
permission boundary that read-only modes are meant to protect.

## UI Layer (Phase 5)

The Phase 5 surfaces expose the memory graph in CADE through two screens:

| Surface | Hosts |
|---|---|
| **Memory graph tree** (`frontend/src/memory/graph-tree.ts`) | Browse symbols by `belongsToModule` containment with attached-memory counts; tombstoned symbols and orphan-memory entries surface as their own sections |
| **Symbol detail pane** (`frontend/src/memory/symbol-detail.ts`) | Inspect attached `mem:Decision` / `mem:Attempt` / `mem:Note`, supersession chain, evidence URIs, archive + retarget controls |

The capture toast described above is the third visible surface — it's
implemented inside `ChatPane` rather than the dedicated memory module,
since it's part of the chat-stream render path.

### Layout

The graph tree lives in the **left tree pane** as a sibling to the file
tree, gated by a `+mem` toggle. Two sub-divs (`.memory-pane-graph`,
`.memory-pane-files`) sit inside the same `.file-tree-pane` container —
`FileTree` clears only its own sub-div, so the two coexist without DOM
conflict. The detail pane opens in the **viewer slot** as a full-pane
replacement; CADE has no modals.

### Backend wiring

- `GET /api/memory/graph` returns the assembled graph payload.
  `build_graph_message()` (`backend/memory/api.py`) walks the symbol DB,
  joins `mem:appliesTo` triples from the rebuilt RDF graph, and tags
  tombstoned symbols + orphan memory entries.
- WebSocket `nkrdn-graph` event fires twice on a fresh session: once on
  connect (whatever's already built), once after `initial_build()`
  finishes. Frontend re-renders idempotently on each.
- `POST /api/memory/archive` and `POST /api/memory/retarget` rewrite the
  source markdown files. The existing FileWatcher debounce schedules the
  rebuild — there is no direct rebuild call from the API path.

### Why two surfaces, not four

The original phase plan called out four sub-features (detail pane, review
queue, retarget, promote-to-docs). They all compose into the graph tree
plus the detail pane:

- Files aren't the natural unit of memory — a file with twelve functions
  may carry memory on two of them. The natural unit is the symbol.
- The file tree stays clean (the design bible forbids row decorations),
  so memory presence is surfaced in a sibling tree, not on the file tree.
- The graph tree mirrors what nkrdn already gives: UUID-stable symbols,
  `belongsToModule` containment, and `mem:appliesTo` edges. A tree view
  of that graph is the most direct UI surface for what the back-end
  already models.
- The detail pane composes with the graph tree through a single
  navigation idiom (`l` / enter on a tree row opens the pane).

The review queue is the orphan-memory section inside the graph tree;
retargeting is a state of the detail pane. Promote-to-docs is mocked but
deferred — it needs an LLM-drafted markdown section and a destination-
picking flow that warrants its own scope.

## What's In Scope

- Stable identity for code symbols across rebuilds (Phase 1)
- Markdown ingestion and wiki-link resolution (Phase 2)
- Supersession chain storage via `mem:supersedes`
- LLM-controlled iterative retrieval (Phase 3) — `nkrdn memory search` CLI +
  CADE's `/api/memory/search` endpoint
- Type-discriminated capture tools (Phase 4) — `record_decision`,
  `record_attempt`, `record_note` with content-hash idempotency
- **Pluggable dedup judge at write time** (Phase 6) — `DedupJudge` interface
  in `backend/memory/dedup.py` with three built-in implementations:
  `ContentHashJudge` (Phase 4 baseline: skip on exact match),
  `TokenJaccardJudge` (adds Update detection — same-target rewrites with
  ≥0.7 token-set Jaccard overlap refine the existing entry in place,
  preserving its URI), and `LLMDedupJudge` (adds LLM-backed Supersede
  detection — wraps `TokenJaccardJudge` and calls `litellm.completion` for
  candidates in the ambiguous overlap zone 0.20–0.70, using the yes/no
  rubric from [[../reference/agent-memory-capture#3-2-dedup-judge-rubric]];
  returns `New` on any LLM failure). Verdict is one of Skip / Update /
  Supersede / New; `WriteResult.action` surfaces which path ran.
  `registry.py` wires `LLMDedupJudge` when the provider has `model` + `api_key`;
  falls back to `TokenJaccardJudge` otherwise. `execute_async` runs
  `_dispatch_sync` via `asyncio.to_thread` so the sync LLM call never
  blocks the event loop.
- Memory-health surfacing — `nkrdn memory affected` reports entries whose
  `applies_to` URIs point at tombstoned or missing symbols, plus entries
  carrying `mem:unresolvedLink` literals. Renames are deliberately excluded:
  the stable_id carries through, so the edge isn't broken; surfacing them
  would generate persistent noise with no terminating event.
- Doc-URI emission — indexed markdown docs become first-class graph nodes
  in a `doc:` named graph (`http://nkrdn.knowledge/doc`) with `rdf:type`,
  `rdfs:label`, `doc:path`, `doc:stem`, `doc:tag`, and `doc:docType`
  predicates. Memory wiki-links resolve to symbols first, then fall back
  to doc stems — so `mem:evidence [[agent-memory-systems]]` now lands as
  a `doc:` URIRef rather than a literal of the inner name.
- **CADE UI** (Phase 5) — memory graph tree, symbol detail pane with
  archive + retarget actions, capture toast. See "UI Layer" above.

## What's Not In Scope Yet

- **Reflector pass** — session-end consolidation per ACE Generator-Reflector-
  Curator. Deferred until capture is in real use; needs provenance tracing
  to avoid the self-reinforcing reflection error failure mode.
- **Proactive retrieval at session start** — the `nkrdn memory search` path
  exists; agents call it voluntarily. Auto-loading relevant memories when a
  symbol is opened is a Phase 6 concern.
- **Promote-to-docs gesture** — drafting an architecture-doc section from a
  Decision is mocked but unbuilt. Needs an LLM draft path and a destination
  picker; deferred to Phase 6.
- **Memory delete / tombstone endpoint** — the capture toast has no discard
  action because the markdown file is already written by the time the toast
  renders. A first-class delete flow needs a backend endpoint.

## Key Files

| File | Purpose |
|---|---|
| `nkrdn/src/nkrdn/parsers/memory/parser.py` | Frontmatter → triples |
| `nkrdn/src/nkrdn/parsers/memory/resolver.py` | Wiki-link → symbol URI |
| `nkrdn/src/nkrdn/parsers/memory/__init__.py` | `ingest_memory_triples()` entry point |
| `nkrdn/src/nkrdn/memory/store.py` | Park et al. triple-score retrieval |
| `nkrdn/src/nkrdn/memory/retriever.py` | LLM-controlled iterative loop with `seen_ids` dedup |
| `nkrdn/src/nkrdn/cli/commands/memory.py` | `nkrdn memory search/list/retire` |
| `cade/backend/memory/writer.py` | Markdown emitter; consults `DedupJudge` per write, supports Skip / Update-in-place / New / explicit-Supersede |
| `cade/backend/memory/dedup.py` | `DedupJudge` interface + `ContentHashJudge` / `TokenJaccardJudge` / `LLMDedupJudge` implementations |
| `cade/backend/memory/tool_executor.py` | `record_decision`/`attempt`/`note`/`investigation` tool surface; wires judge, fires `memory-write` WS event on write |
| `cade/backend/memory/api.py` | `build_graph_message`, archive + retarget endpoints |
| `cade/backend/providers/registry.py` | Wires memory tools + `LLMDedupJudge` (when provider has credentials) into per-connection registry |
| `cade/backend/nkrdn_service.py` | FileWatcher trigger for memory writes; `on_rebuild` callback re-emits `nkrdn-graph` after incremental rebuild |
| `cade/frontend/src/memory/graph-tree.ts` | Memory graph tree (left pane) |
| `cade/frontend/src/memory/symbol-detail.ts` | Symbol detail pane (viewer); `p` keybinding triggers promote-to-docs |
| `cade/frontend/src/memory/presence-index.ts` | File-level memory presence index; refreshes on `nkrdn-graph` and notifies subscribers on `memory-write` |
| `cade/frontend/src/memory/promote-prompt.ts` | Builds the structured CoT prompt for promote-to-docs |
| `cade/frontend/src/chat/chat-pane.ts` | Capture toast render + presence-cue decorator on file links |
| `cade/frontend/styles/workspace/memory.css` | Tree, detail pane, and capture-toast styles |

## See Also

- [[../reference/agent-memory-systems]] — retrieval evidence base, scoring formula, failure modes
- [[../reference/agent-memory-capture]] — capture-layer design synthesis
