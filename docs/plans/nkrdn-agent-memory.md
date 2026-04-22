---
title: nkrdn Agent Memory
created: 2026-04-23
status: planning
tags: [nkrdn, memory, agent, ace, knowledge-graph]
---

# nkrdn Agent Memory

nkrdn is CADE's memory and knowledge system. This plan extends it to store and retrieve agent experience — what agents learn as they work — alongside the structural code knowledge it already holds.

## What This Adds

Agents accumulate experience during work sessions: they discover quirks, make mistakes, develop heuristics, find the right patterns for a codebase. Today that knowledge dies at context end. This feature persists it in nkrdn and loads it back when the agent returns to the same code.

The result is ACE's itemized playbook pattern (structured bullets, Generator-Reflector-Curator update cycle) but spatially indexed — memories live on graph nodes rather than floating globally in the system prompt. Only the relevant slice loads, keeping context clean.

## How It Works

### Storage

Memories are annotations on existing nkrdn nodes. Every node (symbol, file, module, workspace) can carry a `memories` property: a list of structured bullets written by the agent.

```
node: backend/providers/failover.py
memories:
  - text: "FailoverProvider silently swallows the first provider's error — log before fallback or it's invisible"
    importance: 4
    created: 2026-04-22
    commit: 43ea106
    uses: 3
    successes: 3
```

Granularity is contextual — the agent attaches at whatever level is appropriate:
- **Symbol-level** for specific function quirks, edge cases, gotchas
- **File-level** for module-level patterns, conventions, design decisions
- **Package-level** for architectural patterns, cross-file invariants
- **Workspace-level** for cross-repo patterns and shared conventions

### Retrieval

When the agent opens a file or edits a symbol, nkrdn loads the relevant memory annotations alongside the existing structural context (`nkrdn context <filepath>` already does this for code structure — memories extend it).

The agent gets both:
- Structural knowledge: what this file contains, what depends on it, what it inherits
- Experiential knowledge: what previous agent sessions learned about it

**Retrieval mechanisms**: nkrdn already has graph traversal, embedding index, and TF-IDF index (`.cade/doc-index-embeddings.json`, `.cade/doc-index-tfidf.json`). Hybrid retrieval across all three is an option. The better question is what to use as the query.

**The retrieval query matters more than the mechanism**: File path / graph proximity is coarse — it loads everything attached to the current file regardless of relevance. The stronger signal is the agent's current task intent ("fix the pagination cursor off-by-one" vs "refactor the pagination module" — same file, very different memories needed). This is the Memento-Skills finding: behaviour-aligned retrieval (optimised for execution success) outperforms semantic similarity retrieval. The query should be task intent + structural location, not structural location alone.

**Proximity-weighted fusion**: Graph structure provides the behaviour-alignment signal without a separate routing model. The fusion score combines semantic relevance with spatial proximity to where the agent is currently focused:

```
score = semantic_similarity(memory, task_intent)
      × proximity_decay(graph_distance(memory_node, focus_nodes))
```

`focus_nodes` is a session-weighted set, not a single file — nodes touched more during the session accumulate higher focus weight, creating a heat map across the graph. Two semantically identical memories rank differently based on where they're anchored relative to where the agent has been working. Decay function: exponential over edge hops, flattening at package boundaries so workspace-level memories aren't suppressed by distance alone.

### Update Cycle (ACE Generator-Reflector-Curator)

After each task, the Reflector pass reviews the session and proposes memory updates:
- **New bullet** — something learned that wasn't known before
- **Update** — existing bullet revised based on new evidence
- **Retire** — bullet no longer accurate

Curator applies the delta. Memories are bullets, not prose — concise, actionable, independent.

### Staleness Handling

nkrdn already tracks when symbols and files change. When a node's code changes significantly:
1. Attached memories are soft-flagged stale (not deleted)
2. On next load, agent sees the flag: "attached node changed at commit X"
3. Curator pass validates/updates/retires during that session

Quality scoring prunes memories that consistently don't help:
`quality = (successes + 1) / (uses + 2)`

Memories below threshold are auto-archived on the next Curator pass.

## Memory Hierarchy

Mirrors nkrdn's existing two-level structure:

```
workspace graph (cross-repo)
  └─ cross-cutting patterns, shared conventions, inter-project knowledge

project graph (per-repo named graph)
  ├─ package-level  (architectural patterns)
  ├─ file-level     (module conventions, design decisions)
  └─ symbol-level   (function quirks, edge cases)
```

Cross-cutting memories (e.g. "auth always needs X regardless of which service") live at workspace scope. Project-specific memories live in the project graph at the appropriate granularity.

## Tailored Advantages

Most of the research this plan draws on was conducted on legacy codebases where structure must be inferred. Here it's explicit — which changes what the retrieval system gets for free:

**Wiki-links are graph edges**: `[[agentic-context-engineering]]` is a typed relationship already in the files. nkrdn should parse these as first-class edges rather than treating them as plain text. Cross-document links become traversable connections in the graph, not just text similarity candidates.

**Doc type is a trust signal**: Reference docs are evidence, architecture docs are ground truth about shipped systems, plan docs are intent. When the agent retrieves knowledge, these carry different confidence levels and should be weighted accordingly — not treated as a flat document pool.

**PROVEN tiers are quality weights**: A Tier 1 citation (meta-analysis) is epistemically different from a Tier 5 practitioner opinion. That distinction is already in the files as structured metadata — it's a retrieval weight waiting to be used.

**Frontmatter status is freshness**: `status: active` vs `status: draft` vs a plan that should be deleted. The lifecycle is declared, not inferred. Stale docs can be down-weighted without heuristics.

**Section boundaries enable semantic chunking**: Every `## Section` is a natural chunk with known context from the document's frontmatter. Character-based chunking (embedding first N chars) throws this away. Section-level chunks with inherited metadata are strictly better.

## Integration Points

- **`nkrdn context <filepath>`** — already the load-on-open command. Extend to include memory annotations in output.
- **`nkrdn memory add <uri> <text>`** — new command to attach a memory bullet to a node
- **`nkrdn memory list <uri>`** — list memories on a node and its ancestors
- **`nkrdn memory retire <id>`** — mark a memory as no longer valid
- **CADE agent hooks** — after-task Curator pass triggers memory update cycle
- **nkrdn RAG suite** (dependency) — Phase 2 Neo4j vector index and Phase 3 VectorStore abstraction are the retrieval infrastructure this plan runs on. Memory nodes plug into the existing RRF fusion pipeline as a new node type.

## Key Challenges

**Schema extension**: nkrdn is currently a structural graph. Memory annotations need to be a first-class property type, not a workaround. Decision: whether memories live as RDF annotations on existing nodes or as linked memory nodes in the graph.

**Retrieval scope**: When loading memories for a file, which ancestor memories also load? Probably file + package, not workspace (too broad). Need a depth limit or relevance filter.

**Curator cost**: Running a full Reflector-Curator pass after every task is expensive. Options: always-on for explicit agent sessions, opt-in for quick edits, async background pass.

**Memory vs documentation**: nkrdn already indexes `docs/`. Memories are distinct — they're agent-learned heuristics, not human-written documentation. They should be queryable separately but can coexist in the graph.

## Open Questions

- Does nkrdn store memories as RDF properties on symbol nodes, or as separate linked nodes with `about` edges?
- What's the right depth for ancestor memory inheritance at load time?
- Should memories be committed to git (reproducible, reviewable) or stay in the local `.nkrdn/` store only?
- How does CADE surface memories in the UI — inline in the chat context, separate panel, or invisible (agent-only)?

## Double Duty: Retrieval and Many-Shot Learning

Memory bullets stored in nkrdn serve two roles simultaneously:

1. **Retrieval targets** — loaded into context when the agent works near the relevant node
2. **Few-shot examples** — loaded as in-context demonstrations that implicitly calibrate the agent to project conventions

Many-shot in-context learning (Agarwal et al., 2024) shows performance keeps improving well beyond the traditional 2-5 examples, particularly on tasks where the model has weak priors — niche domains, unusual patterns, project-specific conventions. This is exactly the case for accumulated project memory. Describing conventions explicitly in a system prompt is weaker than showing 20-50 examples of them in action.

ACE's itemized bullet format is well-suited to this: short, structured bullets are efficient few-shot material. Prose memories would consume window budget too fast. The format constraint that makes bullets good for retrieval (concise, self-contained) also makes them good as few-shot examples.

**Implication for context assembly**: when loading memories for a task, ordering matters. The most relevant memories should be at the start or end of the loaded set, not the middle — lost-in-the-middle attention bias applies within the memory block too.

## Evidence Base

- [[agentic-context-engineering]] — ACE framework, itemized bullets, Generator-Reflector-Curator
- [[self-improving-agent-systems]] — importance scoring, staleness handling, quality decay formula
- [[coding-agent-prompts]] — Prompt Alchemy, execution-driven refinement
