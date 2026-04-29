---
title: nkrdn Agent Memory — Architecture
created: 2026-04-28
updated: 2026-04-28
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
| `mem:authoredBy` | `authored_by:` | Literal string (e.g. `agent:claude`) |
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

The agent writes memory entries via three type-discriminated tools registered
in CADE's per-connection `ToolRegistry`:

| Tool | When to call | Required fields |
|---|---|---|
| `record_decision` | After choosing between concrete alternatives with non-trivial trade-off | `rationale`, `alternatives`, `applies_to`, `importance` |
| `record_attempt` | After abandoning an approach mid-task | `approach`, `outcome`, `applies_to`, `importance` |
| `record_note` | When finding a non-obvious quirk worth keeping | `observation`, `applies_to`, `importance` |

`backend/memory/writer.py` emits markdown files into `.cade/memory/` with
frontmatter that matches the parser schema above. The body uses MADR-style
sections (rationale → Considered Options → Consequences for decisions). A
content hash over `(type, primary_text, sorted(alternatives), sorted(applies_to))`
is embedded as an HTML comment; identical writes are silent no-ops returning
the existing URI.

**Rebuild trigger.** `backend/nkrdn_service.py` extends its FileWatcher
filter to include `.md` files under `.cade/memory/`. The existing 10-second
debounce schedules a single rebuild per burst of writes — the writer
doesn't need a direct `NkrdnService` handle.

**Why explicit tool calls (vs autonomous post-turn extraction):** cheaper,
more auditable, and avoids the self-reinforcing reflection error documented
in Du 2026 (arXiv:2603.07670). Cross-domain evidence and rationale:
[[../reference/agent-memory-capture]].

## What's In Scope

- Stable identity for code symbols across rebuilds (Phase 1)
- Markdown ingestion and wiki-link resolution (Phase 2)
- Supersession chain storage via `mem:supersedes`
- LLM-controlled iterative retrieval (Phase 3) — `nkrdn memory search` CLI +
  CADE's `/api/memory/search` endpoint
- Type-discriminated capture tools (Phase 4) — `record_decision`,
  `record_attempt`, `record_note` with content-hash idempotency

## What's Not In Scope Yet

- **LLM-judge dedup** — refinement vs supersedes detection at write time;
  Phase 4 ships with content-hash exact-match only. The agent uses the
  explicit `supersedes` parameter when it knows.
- **Reflector pass** — session-end consolidation per ACE Generator-Reflector-
  Curator. Deferred until capture is in real use; needs provenance tracing
  to avoid the self-reinforcing reflection error failure mode.
- **UI** (Phase 5) — symbol detail pane showing attached memories, orphan
  review queue, promote-to-docs gesture.

## Key Files

| File | Purpose |
|---|---|
| `nkrdn/src/nkrdn/parsers/memory/parser.py` | Frontmatter → triples |
| `nkrdn/src/nkrdn/parsers/memory/resolver.py` | Wiki-link → symbol URI |
| `nkrdn/src/nkrdn/parsers/memory/__init__.py` | `ingest_memory_triples()` entry point |
| `nkrdn/src/nkrdn/memory/store.py` | Park et al. triple-score retrieval |
| `nkrdn/src/nkrdn/memory/retriever.py` | LLM-controlled iterative loop with `seen_ids` dedup |
| `nkrdn/src/nkrdn/cli/commands/memory.py` | `nkrdn memory search/list/retire` |
| `cade/backend/memory/writer.py` | Markdown emitter with content-hash idempotency |
| `cade/backend/memory/tool_executor.py` | `record_decision`/`attempt`/`note` tool surface |
| `cade/backend/providers/registry.py` | Wires the memory tools into the per-connection registry |
| `cade/backend/nkrdn_service.py` | FileWatcher trigger for memory writes |

## See Also

- [[../reference/agent-memory-systems]] — retrieval evidence base, scoring formula, failure modes
- [[../reference/agent-memory-capture]] — capture-layer design synthesis
- [[../plans/nkrdn-agent-memory]] — phase plan (Phase 5 UI still ahead)
