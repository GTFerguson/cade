---
title: Agent Memory (built on nkrdn)
created: 2026-01-31
updated: 2026-04-28
status: exploratory
tags: [agents, memory, knowledge-base, nkrdn, suite]
---

# Agent Memory (built on nkrdn)

> [!NOTE]
> Exploratory. Memory is a **CADE + nkrdn suite feature**, not a standalone CADE
> subsystem. nkrdn provides the graph substrate and canonical schema; CADE owns
> capture, retrieval policy, lifecycle, and UI. nkrdn ships as a bundled package
> inside CADE so memory is always available.

## Concept

Persistent, structured memory that lives in the same knowledge graph as the
code it describes. A "decision" or "failed attempt" is not a loose note in a
folder — it's a node in nkrdn's graph with typed edges into the symbols it
applies to. Querying `nkrdn details <ClassURI>` surfaces structure *and* the
decision history for that class side-by-side.

## Motivation

**Today:** every Claude session starts cold. The user re-explains conventions,
past decisions, and rejected approaches. Knowledge accumulated during a session
evaporates when it ends.

**With graph-backed memory:** decisions, attempts, and session notes attach to
the code they touch. Future sessions (and future agents) can ask "what's the
history of this module?" and get an answer grounded in real edges, not in a
vector-search guess at relevance.

## Why nkrdn is the right substrate

nkrdn already provides the machinery agent memory needs:

| Need | nkrdn already does this |
|------|--------------------------|
| Typed entities + relationships | Class, Function, Module, Package, Namespace + `inheritsFrom`, `dependsOn`, `belongsToModule` |
| Markdown-with-frontmatter ingest | `src/nkrdn/parsers/docs/` — TF-IDF fusion search |
| Unified search across kinds | `nkrdn search` over code + docs |
| Cross-project scope | Workspace graph at `~/.nkrdn/workspace/graph.ttl` with per-repo named graphs |
| Provenance / staleness signals | Delta tracking between rebuilds |
| Programmable queries | SPARQL, `--json` output |

Building a parallel `.cade/memory/` system would duplicate all of the above.
Extending nkrdn's schema with memory entity types reuses every piece.

## Schema additions (nkrdn)

New entity types, sitting alongside the existing code-symbol types:

| Type | Purpose | Example |
|------|---------|---------|
| `mem:Decision` | A choice with rationale | "Use Result<T,E> over exceptions in auth module" |
| `mem:Attempt` | A tried-and-rejected approach | "Tried async pipeline 2026-01-15 — race conditions" |
| `mem:Session` | A conversation/work session | Date + participants + topics |
| `mem:Note` | Lightweight scratchpad observation | "This naming pattern recurs across handlers" |

New predicates linking memory ↔ code (and memory ↔ memory):

| Predicate | Direction | Meaning |
|-----------|-----------|---------|
| `mem:appliesTo` | memory → code entity | Which symbol(s) the memory is about |
| `mem:supersedes` | decision → decision | Explicit succession of prior decision |
| `mem:contradicts` | memory → memory | Flag for conflict resolution |
| `mem:duringSession` | memory → session | Provenance |
| `mem:authoredBy` | memory → "agent:..." / "user:..." | Who wrote it |
| `mem:rejectedAlternative` | decision → string/URI | What was considered and dropped |
| `mem:evidence` | memory → doc URI | Backing reference (e.g. a docs/ file or external link) |

Namespace: `http://nkrdn.knowledge/memory#` (prefix: `mem:`), parallel to
the existing `code:` namespace.

## Storage format (input layer)

Humans and agents write memory as markdown files with structured frontmatter.
nkrdn's doc indexer parses the frontmatter into triples on rebuild. Wiki-links
resolve to symbol URIs and become real graph edges.

```yaml
---
type: decision
id: 2026-01-31-result-types
applies_to: [[AuthService]]
supersedes: 2026-01-12-exceptions
authored_by: agent:claude
session: 2026-01-31
tags: [error-handling, auth]
---

# Use Result<T, AuthError> in the auth module

Explicit error types beat throwing for auth: callers can pattern-match,
errors don't unwind across async boundaries, and the type system documents
what can go wrong at each call site.

## Rejected alternatives

- `panic!` — too aggressive for recoverable errors like bad credentials
- `Box<dyn Error>` — loses the structured information we need for telemetry
```

Files live on disk (in `.cade/memory/` or a project-chosen location); the
graph is just an index. This keeps memory inspectable, version-controllable
(if the user wants), and easy to prune by hand.

## Lifecycle and rebuild semantics

Memory only works if it stays attached to the code it describes — through
renames, moves, and deletions. This requires meaningful changes to how nkrdn
identifies entities and what it does with them across rebuilds.

### The problem

nkrdn currently keys entities by structural identity (FQN + file path + AST
position). That breaks the moment code mutates:

- `AuthService` → `AuthenticationService` rename → URI changes → `mem:appliesTo` edge dangles
- Function moved between modules → URI changes → same problem
- File deleted → entity vanishes from next rebuild → memory orphaned silently

The rule: **the graph never silently loses a memory edge.** Every rebuild
preserves identity where it can, surfaces ambiguity where it can't, and
keeps history for things that no longer exist.

### Identity stability (UUID-keyed entities)

Entities get a stable UUID on first index. URIs become `code:entity/<uuid>`,
with FQN, file path, and line range stored as *properties* rather than
identity.

New predicates on code entities:

| Predicate | Meaning |
|-----------|---------|
| `code:firstSeen` | Timestamp of first index — entity's birth |
| `code:previousName` | Prior FQN(s), if renamed |
| `code:movedFrom` | Prior `belongsToModule`, if moved |
| `code:deletedAt` | Timestamp of disappearance — see Tombstoning below |

On rebuild, the matcher tries to map each new-source entity to an existing
graph entity using a layered heuristic:

1. Exact FQN + file path → preserve UUID (the fast path, most entities)
2. Same name + same parent module + similar signature → preserve UUID, record `code:previousName` or `code:movedFrom`
3. Same signature shape, different name, same file → preserve UUID, record rename
4. No match → mint a new UUID

Lookup (`nkrdn lookup <name>`) needs a separate name index that points at
UUIDs, since names no longer *are* the URI.

### Tombstoning instead of deletion

When a rebuild doesn't see a previously-indexed entity:

- It is **not** dropped from the graph
- `code:deletedAt <timestamp>` is added
- All `mem:*` edges remain intact and valid
- Default queries hide tombstones; `--include-deleted` exposes them

This makes the graph temporal — you can answer "what existed in this module
on 2026-02-15?" and "what did this deleted class do, and why was it
removed?" The Decision that *led to* the deletion stays attached to the
thing it deleted, which is exactly where it belongs.

### Memory-aware rebuild delta

nkrdn already emits version deltas (`nkrdn delta show`). The memory-aware
extension: after each rebuild, emit a "memory affected" report listing every
entity with `mem:*` edges that was renamed, moved, or tombstoned in this
run.

CADE subscribes to this report and surfaces it in the UI so the user can
review, retarget, or accept.

### Garbage collection

Tombstones can't grow without bound. Policy:

| Tombstone state | Action |
|-----------------|--------|
| No memory edges, age > GC threshold | Hard-delete the entity (and its tombstone) |
| Has memory edges | Keep indefinitely until memory is archived or retargeted |
| User explicitly archives | Hard-delete entity, archive the memory file alongside |

GC threshold is configurable; sensible default is something like 90 days
for hands-off cleanup of tombstones nobody attached anything to.

### Memory deletion (the other direction)

Memory has its own lifecycle separate from code:

- **User deletes a memory entry** — set `mem:archivedAt`, hide from default
  views, allow undo, hard-delete after a policy window.
- **Target code is deleted** — memory stays attached to the tombstone.
  CADE's notification surfaces the orphan so the user can:
  - Retarget to a successor symbol (set `mem:appliesTo` to a new URI, record `mem:retargetedFrom`)
  - Accept the tombstone (memory becomes purely historical, still queryable)
  - Archive the memory (`mem:archivedAt`)

The graph never silently loses a memory edge — every transition is
explicit.

### Summary of nkrdn changes required

To make memory durable, nkrdn needs:

1. UUID-keyed entity URIs (with a separate name index for lookup)
2. Rename/move detection on rebuild via signature heuristics
3. Tombstoning instead of deletion, with `code:deletedAt`
4. Memory-aware delta output after each rebuild
5. Configurable GC policy for tombstones with no memory

Most of these are wins for nkrdn beyond memory — semantic deltas, rename
tracking, and temporal queries are useful regardless. Memory is the forcing
function that makes them necessary.

## What CADE owns

| Layer | Responsibility |
|-------|----------------|
| **Capture** | When the agent decides to record a Decision vs let it stay ephemeral. Templates for the markdown frontmatter. |
| **Retrieval policy** | When to query memory for a given prompt; how much to surface; ranking/dedup. |
| **UI** | Decision-history pane on a symbol; supersession chain visualizer; memory editor; prune/correct flow. |
| **Lifecycle** | Promote `.cade/memory/` notes to formal `docs/` when they mature. Detect stale memory when target symbols change (using nkrdn delta tracking). |
| **Bootstrap** | Auto-index project on open; ensure nkrdn is initialised; run watch mode. |
| **Multi-agent coordination** | `mem:authoredBy` tags differentiate agents; CADE's orchestrator threads these into spawned subagent context. |

## Bundling

nkrdn ships inside CADE as a Python package — same PyInstaller bundle as the
backend. The desktop build copies it into `desktop/src-tauri/resources/`
alongside `cade-backend.exe`. Default backend is the rdflib file fallback
(`.nkrdn/graph.ttl`) so users don't need Docker; Neo4j becomes an optional
upgrade for large workspaces.

This is what makes them "a complete suite" rather than two tools that
optionally integrate.

## Use cases

**Session continuity**

```
Day 1: "Let's use JWT for auth"
  → agent writes mem:Decision linked to AuthService

Day 2: agent reads mem:Decision via nkrdn details
  → "We decided on JWT yesterday. Implement token refresh now?"
```

**Avoiding repeated explanations**

```
Agent (querying memory before suggesting): "I see a Decision (2026-01-31)
saying we use Result<T, AuthError> in this module. Following that pattern."
```

**Failed-attempt history**

```
Agent: "There's an Attempt node from 2026-01-15 — async pipeline tried here,
rejected for race conditions. Want a different approach?"
```

**Team knowledge sharing**

```
New collaborator opens the project. nkrdn workspace graph already has the
Decision/Attempt/Session history. Their first agent session has full context.
```

## Open questions

Most of the original proposal's open questions dissolve once nkrdn is the
substrate (scope, search, multi-agent, search/retrieval — all handled by
nkrdn primitives) and lifecycle is handled by tombstoning + identity
matching. What remains:

1. **Capture threshold.** What signals trigger an agent to write a Decision
   vs a Note vs nothing? Conservative defaults to start, then learn.

2. **Memory-affected delta UX.** Tombstoning + the memory-aware delta give
   us the mechanism. What's the right surface? Inline indicator on the
   memory file? Dedicated review queue? Toast on rebuild? Probably all
   three at different urgency levels.

3. **Identity-matcher ambiguity.** When the rebuild heuristic can't choose
   confidently (two simultaneous renames, function-pair swap, mass refactor),
   what's the fallback? Mint new UUIDs and let the user retarget after the
   fact, or pause the rebuild and surface the ambiguity for resolution?
   Leaning toward the former — never block a rebuild — but needs review.

4. **GC default threshold.** 90 days for tombstones with no memory feels
   right but is unprincipled. Could be tuned by repo activity rate.

5. **Promotion to `docs/`.** What's the explicit gesture (UI button? agent
   suggestion?) and what's the rule for when memory has matured into formal
   architecture documentation?

6. **Privacy / sharing.** Default memory location: per-user (`~/.cade/memory/`)
   or per-project (`.cade/memory/`, gitignored)? Per-project committed for
   team sharing? Probably configurable, but pick a sensible default.

7. **Cross-language identity.** nkrdn supports Python and C++. Identity
   heuristics need to work for both — Python's dynamic naming and C++'s
   templates/overloads have different signature shapes. Each language's
   parser needs its own matcher.

## See Also

- [[agent-orchestration|Agent Orchestration]] — uses the same workspace graph for cross-agent coordination
- [[../technical/README|Technical Documentation]] — formal documentation that mature memory graduates into
- nkrdn `CLAUDE.md` and `schema.md` (in `~/projects/nkrdn/`) — current entity types and predicates
- Project `CLAUDE.md` and `.claude/rules/` — current text-based context system, complementary not replaced
