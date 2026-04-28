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

## What's In Scope (Phases 1–2)

- Stable identity for code symbols across rebuilds (Phase 1)
- Markdown ingestion and wiki-link resolution (Phase 2, shipped)
- Supersession chain storage via `mem:supersedes`

## What's Not In Scope Yet

- **Retrieval** (Phase 3) — `nkrdn memory search` CLI, scored retrieval using the Park et al. triple-score formula (recency × importance × relevance)
- **Capture layer** (Phase 4) — CADE writing memory files automatically at session end
- **UI** (Phase 5) — symbol detail pane showing attached memories, orphan review queue

## Key Files

| File | Purpose |
|---|---|
| `nkrdn/src/nkrdn/parsers/memory/parser.py` | Frontmatter → triples |
| `nkrdn/src/nkrdn/parsers/memory/resolver.py` | Wiki-link → symbol URI |
| `nkrdn/src/nkrdn/parsers/memory/__init__.py` | `ingest_memory_triples()` entry point |
| `nkrdn/src/nkrdn/cli/rebuild.py` | Phase 2.5 wiring (after line ~588) |
| `nkrdn/tests/parsers/memory/` | 24 unit tests |

## See Also

- [[../reference/agent-memory-systems]] — evidence base, scoring formula, failure modes
- [[../plans/nkrdn-agent-memory]] — phase plan (Phases 3–5 still in flight)
