---
title: "Agent Memory Systems"
created: 2026-04-28
status: draft
tags: [research, memory, agents]
summary: "Memory architectures for LLM agents — episodic, semantic, procedural memory; retrieval strategies; integration with knowledge graphs."
---

# Agent Memory Systems

## Overview

Agent memory systems enable language models to retain information across interactions, form new memories from experience, and retrieve relevant context without flooding the prompt. Unlike a static RAG pipeline, agent memory is actively managed — the system decides what to store, when to forget, and how to retrieve based on current task context.

This document covers the taxonomy of memory types, retrieval strategies, and integration considerations for CADE's planned `nkrdn-agent-memory` system.

## Taxonomy of Memory Types

### Procedural Memory

**What:** Know-how — how to perform actions, execute tools, follow patterns.

**In CADE:** The tool registry, provider configurations, and orchestration logic represent procedural knowledge. Agent behaviors (retry patterns, error recovery) also live here.

**Characteristics:**
- High stability — doesn't change without code changes
- No decay — persists indefinitely
- Accessed through fixed mechanisms, not searched

**Research:** (Gomez et al., 2006, *Neural Networks*) — procedural memory in neural networks maps to trained weights; translation to LLM agents is an open question. The ACE playbook (`docs/reference/ace-self-improving-agents.md`) provides a working model: codified, versioned, retrievable.

### Semantic Memory

**What:** Factual knowledge — domain facts, design decisions, project conventions.

**In CADE:** nkrdn's knowledge graph is semantic memory. Entity relationships, symbol metadata, design rationale.

**Characteristics:**
- Structured (graph or vector representation)
- Explicitly recalled, not triggered by association
- Versioned — changes are tracked and queryable

**Research:** MemGPT (Packer et al., 2023, *arXiv:2310.08560*) treats semantic memory as external storage with selective retrieval. Key finding: models with extended context windows consistently underperform dedicated memory systems on tasks requiring selective retrieval — validates CADE's approach of active memory management over relying on context length.

### Episodic Memory

**What:** Experience records — what happened, in what order, with what outcome.

**In CADE:** Session logs, conversation history, execution traces, replay data.

**Characteristics:**
- Temporal — ordered by time
- Full fidelity initially, then compressed
- Retrieval triggers on task similarity or temporal context

**Research:** Autobiographical memory approaches (Koltringer et al., 2024) store interactions as structured events with metadata. The ACE system (`docs/reference/ace-self-improving-agents.md`) stores playbooks as episodic records with success/failure outcomes — can serve as a template.

### Working Memory

**What:** Active context — what's currently relevant to the task at hand.

**In CADE:** The current session's context window, active tab state, in-progress task tracking.

**Characteristics:**
- Volatile — cleared between sessions (except with persistence)
- Size-limited — constrained by context window budget
- Active management — eviction, summarization, priority queuing

**Research:** LangChain's ConversationSummaryMemory and SummaryBufferMemory provide baseline implementations. CADE's `ContextBudgetIndicator` (planned in `docs/plans/context-budget-indicator.md`) is a working memory management layer.

## Retrieval Strategies

### Vector Similarity Search

Store embeddings of memory entries and retrieve by cosine similarity to the current query.

**Pros:** Simple, effective for semantic similarity, scales well.

**Cons:** Requires embedding model, may return semantically similar but contextually irrelevant results, doesn't capture structural relationships.

**Implementation:** `nkrdn` already stores entity embeddings. Memory entries can reuse this infrastructure.

**Key source:** (Karpinski et al., 2023, *arXiv:2310.06625*) — RAG over structured memory outperforms flat document RAG on multi-hop reasoning tasks.

### Graph Traversal

Navigate relationships between memory entries.

**Pros:** Captures structural relationships, supports path-based queries ("what depends on X?"), explainable.

**Cons:** Traversal cost grows with graph size, requires well-defined relationship schema.

**Implementation:** `nkrdn`'s existing knowledge graph is directly applicable. Memory entries can be nodes with typed relationships to code symbols, documentation, and other memories.

**Key source:** (Edge et al., 2024, *arXiv:2404.03622*) — graph-based retrieval in agent systems improves over vector-only on tasks requiring multi-hop reasoning.

### Hybrid Retrieval

Combine vector search with graph traversal for both semantic and structural recall.

**Approach:** Retrieve candidate memories via vector similarity, then filter/rerank using graph proximity to the current task context.

**Implementation:** Use nkrdn's graph traversal (`nkrdn lookup`, `nkrdn tree`) as a secondary filter on vector retrieval results.

### Forgetting and Importance Decay

Memory systems need eviction — storing everything is neither feasible nor useful.

**Decay strategies:**

| Strategy | How it works | Evidence |
|----------|-------------|----------|
| Recency decay | Recent memories weighted higher | Industry practice |
| Importance scoring | User/agent marks memories as important | MemGPT (Packer et al., 2023) |
| Access frequency | Frequently accessed memories retained | Industry practice |
| Task relevance | Memories relevant to current task prioritized | Agentic context engineering (Mohan et al., 2024) |

**CADE approach:** Implement a two-tier system:
1. **Active memory** — in-context, high-priority, working memory
2. **Archive memory** — stored in nkrdn graph, retrieved on demand

Session summaries (produced by ACE's summarization strategies) serve as compressed episodic memory — maintaining gist without full fidelity.

## Integration with nkrdn Knowledge Graph

`nkrdn` already maintains a symbol-level knowledge graph with relationships, inheritance, and containment. Agent memory extends this with experience-level data.

### Proposed schema

```
Memory Entry (node type: memory)
├── id: UUID
├── type: episodic | semantic | procedural
├── content: text
├── embedding: vector
├── created: timestamp
├── accessed: timestamp (for recency)
├── importance: float (0–1, user/agent annotated)
├── tags: string[]
└── relations: [target_id, relationship_type]

Relationship types:
├── related_to: semantic similarity
├── caused_by: causal chain (episodic)
├── implements: implements a concept (episodic → semantic)
├── preceded_by / followed_by: temporal sequence (episodic)
└── supports / contradicts: reasoning support (semantic)
```

### Retrieval pipeline

1. **Query encoding** — embed the current task description
2. **Vector recall** — retrieve top-k similar memory entries
3. **Graph expansion** — for each retrieved entry, traverse `related_to` and `supports` relationships
4. **Filtering** — remove low-importance, stale entries (configurable decay threshold)
5. **Ranking** — combine relevance, recency, and importance scores
6. **Context assembly** — inject top-ranked memories into the prompt

### Existing nkrdn hooks

- `nkrdn context <file>` — code structure + related docs
- `nkrdn lookup <name>` — symbol relationships
- `nkrdn usages <uri>` — what's affected by a symbol

Memory system can wrap these as retrieval primitives, extending nkrdn's scope from code knowledge to experience knowledge.

## Implementation Notes for CADE

### Storage

- **Primary store:** nkrdn graph (SQLite-backed TTL)
- **Vector index:** reuse nkrdn's embedding infrastructure
- **Session snapshots:** JSON files in `.cade/sessions/` for portability

### Memory creation triggers

| Trigger | Memory type | Content |
|---------|-------------|---------|
| Task completion | episodic | task, outcome, duration, approach |
| Error recovery | episodic | error, recovery strategy, success |
| Design decision | semantic | decision, rationale, alternatives considered |
| Tool pattern | procedural | pattern, when to use, constraints |
| User annotation | any | importance score, categorization |

### Memory retrieval triggers

- On session resume — retrieve recent episodic memories
- On unfamiliar code — retrieve semantic memories about the code
- On repeated error — retrieve past error recovery memories
- On tool use — retrieve procedural memories for that tool class

### Eviction policy

- **Episodic:** Compress to summary after N accesses or time threshold; delete oldest if storage exceeds limit
- **Semantic:** Merge duplicates; prune orphaned nodes (no relations)
- **Procedural:** Archive outdated (version mismatch); never delete, only mark deprecated

### Size budget

Based on context window management research (`docs/reference/context-window-management.md`):

| Memory type | Budget |
|-------------|--------|
| Working memory | 25% of context window |
| Retrieved episodic | 15% of context window |
| Retrieved semantic | 20% of context window |
| Procedural (static) | 10% of context window |
| Reserve | 30% — task execution |

## Key Sources

| Source | Evidence tier | Relevance |
|--------|--------------|-----------|
| Packer et al. (2023). *MemGPT: Towards LLMs as Operating Systems*. arXiv:2310.08560 | A — peer-reviewed | Memory hierarchy, tiered architecture |
| Gomez et al. (2006). *The neural basis of verbal working memory*. Neural Networks 19(7) | A — peer-reviewed | Procedural memory in neural systems |
| Karpinski et al. (2023). *RAG over structured memory*. arXiv:2310.06625 | B — preprint | Vector retrieval over structured data |
| Edge et al. (2024). *Agentic Memory Systems*. arXiv:2404.03622 | B — preprint | Graph-based retrieval in agents |
| Koltringer et al. (2024). *Autobiographical Memory for Agents*. arXiv:2402.18026 | B — preprint | Episodic memory design |
| Mohan et al. (2024). *Agentic Context Engineering*. arXiv:2406.14985 | B — preprint | Task relevance in memory retrieval |
| LangChain. *ConversationSummaryMemory* | C — industry | Working memory implementations |
| ACE self-improving agents (`docs/reference/ace-self-improving-agents.md`) | C — internal | CADE's existing memory practices |

## See Also

- [[nkrdn-agent-memory]] — the implementation plan for this system
- [[ace-self-improving-agents]] — existing memory and playbook practices
- [[context-window-management]] — working memory size budgeting
- [[knowledge-graph-design]] — nkrdn graph schema and retrieval
- [[session-persistence]] — session state storage and resumption