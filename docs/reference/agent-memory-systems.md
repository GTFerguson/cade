---
title: Agent Memory Systems
created: 2026-04-28
updated: 2026-04-28
status: active
tags: [research, memory, agents, retrieval, nkrdn]
---

# Agent Memory Systems

Evidence base for CADE's memory architecture, built on nkrdn. Covers the
taxonomy of memory types, the canonical retrieval-scoring formula, context
budget strategies, documented failure modes, and the Padarax suite reference
implementation.

## Memory Type Taxonomy

Four types appear consistently across the literature. Each has distinct
characteristics that determine how it should be stored and retrieved.

### Procedural Memory

Know-how — how to perform actions, execute tools, follow patterns.

- High stability; no decay; accessed through fixed mechanisms, not searched
- In CADE: tool registry, provider configs, orchestration logic, agent behaviours
- Not a retrieval problem: procedural memory is wired in, not queried

### Semantic Memory

Factual knowledge — domain facts, design decisions, project conventions.

- Explicitly recalled, not triggered by association
- Versioned — changes tracked and queryable
- In CADE: nkrdn's knowledge graph is semantic memory. `Decision`, `Note`,
  and `Attempt` nodes (defined in [[agent-memory]]) are the semantic memory
  layer for development context

### Episodic Memory

Experience records — what happened, in what order, with what outcome.

- Temporal; ordered by time; full fidelity initially, then compressed
- In CADE: session logs, conversation history, execution traces

### Working Memory

Active context — what's currently relevant to the task at hand.

- Volatile; cleared between sessions; size-limited by context window budget
- The most constrained resource; active eviction required

(Tier 4: taxonomy synthesised from Hu et al., 2025, *arXiv:2512.13564* — the
45-author survey classifies memory in agent systems along the same four-type
axis, tracing the typology back to cognitive science literature.)

## The Retrieval Scoring Formula

The canonical scoring model comes from Generative Agents (Park et al., 2023,
*ACM UIST '23*, arXiv:2304.03442). Every memory object has three independent
scores, each normalised to [0, 1] by min-max across the candidate set, then
combined linearly:

```
score = α·recency + β·importance + γ·relevance
```

Park et al. use equal weights (α = β = γ = 1/3). The normalisation ensures no
single component dominates by scale.

**Recency** — exponential decay on *last-access* time, not creation time.
Memories that have been recently recalled stay warm; memories not touched in a
long time decay:

```
recency = exp(−Δt / halflife)
```

where Δt is time since last access and halflife is a tunable parameter (in
Park et al., ~1.0 in normalised time units; in Padarax, `recency_halflife_game_days`).
Anchoring to last-access rather than creation time is deliberate: a memory
re-triggered last week is more salient than one written but never retrieved.

**Importance** — an LLM assigns a poignancy score (1–10) at write time:

> "On the scale of 1 to 10, where 1 is purely mundane and 10 is extremely
> poignant, rate the likely poignancy of the following piece of memory."

This score is stored as a permanent attribute of the memory object and
normalised by dividing by 10. Importance serves a second role in Park et al.:
when the cumulative importance of recent observations exceeds a threshold
(~150), a *reflection pass* fires, generating higher-order insights stored back
into the memory stream. These reflections can themselves be retrieved, creating
a recursive hierarchy of abstraction.

**Relevance** — cosine similarity between the memory's text embedding and the
current query's embedding. Falls back to Jaccard overlap when embeddings are
unavailable.

(Tier 2: Park et al., 2023. n=25 agents, n=100 human evaluators. ACM UIST '23.
arXiv:2304.03442.)

## Context Budget Strategies

Three dominant patterns in the literature for managing context limits:

### Score-gated retrieval (Park et al.)

Apply the triple-score formula, inject only top-k scoring memories. Simple but
brittle: relevant memories that score poorly on the query are silently dropped
(retrieval miss — see Failure Modes).

### Tiered memory with paged access (MemGPT)

Maintains working context (fixed-size editable text block in context), recall
storage (searchable message history), and archival storage (vector-indexed
documents). The LLM explicitly calls `recall_storage.search()` or
`archival_storage.search()` when it needs external context, and explicitly
edits the working context block via function calls.

When the FIFO message queue nears the context limit, the oldest N messages are
recursively summarised and evicted; raw messages remain in recall storage.

**Empirical results:** GPT-4 + MemGPT achieved 92.5% accuracy on Deep Memory
Retrieval tasks vs. 32.1% for baseline GPT-4. On 4-hop nested KV retrieval,
MemGPT was the only system to maintain non-zero accuracy at 3+ nesting levels.

(Tier 2: Packer et al., 2023. Evaluated on Multi-Session Chat + NaturalQuestions
+ synthetic KV tasks. ICLR 2024. arXiv:2310.08560.)

### Iterative masked retrieval (MemR³)

Rather than scoring once and injecting, maintains an explicit evidence-gap
state (E = what is known, G = what is still missing) and issues sequential
retrieval queries. Each call uses a *masked* retrieval that excludes snippets
already seen, so rephrased queries fetch genuinely new context rather than
re-retrieving the same top-k hits.

A router decides at each step whether to issue another retrieval query, reflect
on existing evidence, or generate the final answer.

**Empirical results:** +7.29 percentage points on LoCoMo benchmark overall
(79.46% → 86.75%). Multi-hop questions improved by +8.15 pp. Ablation showed
masked retrieval was the single most important component — removing it dropped
performance from 81.55% to 68.54%.

(Tier 2: Du, Li, Zhang, Song, 2025. LoCoMo benchmark. MBZUAI. arXiv:2512.20237.)

### Zettelkasten structural linking (A-MEM)

Each memory note stores content, timestamp, LLM-generated keywords, tags,
contextual description, and links to related memories. Retrieval is
embedding-based (top-k cosine over content + keywords + tags), but when a
memory is retrieved, its linked notes are also surfaced. Recency and importance
become implicit: encoded in the linked structure rather than as explicit scores.

**Key result:** 85–93% reduction in tokens per retrieval vs. MemGPT (1,200
vs. 16,900 tokens) while outperforming on multi-hop reasoning (+100% ROUGE-L
on LoCoMo multi-hop tasks).

(Tier 2: Xu et al., 2025. LoCoMo + DialSim benchmarks. Rutgers University.
arXiv:2502.12110.)

## Documented Failure Modes

These failure modes are empirically documented — not theoretical risks.

| Failure mode | Source | Mechanism |
|---|---|---|
| **Retrieval miss** | Park et al. 2023 (2304.03442) | Query embedding semantically diverges from memory's phrasing; correct memory scores below cutoff and is dropped |
| **Hallucinated embellishment** | Park et al. 2023 (2304.03442) | LLM fills gaps in retrieved memories with plausible confabulation from pre-training; especially when retrieved memory is partial or ambiguous |
| **World-knowledge bleed** | Park et al. 2023 (2304.03442) | Pre-training associations override memory-stream content for well-known concepts (e.g. "Adam Smith" triggers *Wealth of Nations* from training, not from memory) |
| **Summarisation drift** | Packer et al. 2023 (2310.08560); Du 2026 (2603.07670) | Each rolling-summary eviction cycle loses nuance; errors accumulate multiplicatively over long sessions |
| **Self-reinforcing reflection error** | Du 2026 (2603.07670) | Wrong memory → LLM generates confident reflection → reflection scores high on importance → retrieved preferentially → error amplified in future outputs |
| **Attentional dilution** | Du 2026 (2603.07670) | Retrieving too many memories (large k) degrades performance on *all* of them; there is an optimal k beyond which performance declines |
| **Cross-session coherence failure** | Du 2026 (2603.07670); Du et al. 2025 (2512.20237) | Different retrieval subsets across sessions cause the agent to contradict earlier beliefs |
| **Long context ≠ memory** | Du 2026 (2603.07670) | Models with very large context windows consistently underperform dedicated memory systems on selective retrieval benchmarks — raw context length does not substitute for retrieval ranking |

The most dangerous failure mode for CADE specifically is **self-reinforcing
reflection error**: the reflection/consolidation pass (park et al.'s trigger at
cumulative importance > 150) can synthesise incorrect memories into
high-importance, confidently-stated beliefs that propagate forward. Any
reflection mechanism needs a quality gate or provenance trace back to source
memories.

## Padarax: Reference Implementation in the Suite

Padarax's NPC memory system (`engine/src/agents/memory_store.cpp`) implements
the Park et al. triple-score formula directly and adds MemR³-style masked
iterative retrieval on top. It is the live reference implementation for
CADE's planned memory system.

**Scoring implementation:**

```cpp
const double recency = std::exp(-dt_game_days / recency_halflife_game_days);
const double importance_raw = static_cast<double>(ev.importance) / 10.0;
// relevance: nkrdn embedding cosine similarity, or Jaccard fallback

// min-max normalise all three across the candidate set, then combine:
m.score = alpha_recency * r[idx] + alpha_importance * i[idx] + alpha_relevance * rel[idx];
```

Decay anchors to `last_accessed_game_time` (not creation time), matching
Park et al.'s last-access recency design. On retrieval, a write-back function
updates `last_accessed_game_time` for returned memories, keeping warm memories
warm across subsequent queries.

**LLM-controlled iterative retrieval** (`engine/src/agents/memory_retriever.cpp`):
The retriever runs a multi-round loop — the LLM calls `nkrdn_search` as a tool
(0 to N times per prompt, configurable `max_tool_rounds`). A `seen_ids` set
ensures each retrieved memory is returned only once across rounds regardless
of how many queries are issued — this is the masked retrieval from MemR³ that
proved to be the most impactful ablation in that paper.

**Relevance:** Padarax uses nkrdn's embedding-based similarity as the primary
relevance signal, falling back to Jaccard tokenset overlap when nkrdn is
unreachable. This is the correct fallback hierarchy for the bundled suite.

## Retrieval Design Recommendations for CADE

Grounded in the above:

1. **Use the triple-score formula** (Park et al.) as the baseline. Equal weights
   are a reasonable default; Padarax already has configurable `alpha_*` weights
   for tuning.

2. **Anchor recency to last-access, not creation.** This keeps memories that
   have been recently retrieved salient without manually marking them.

3. **Store importance at write time** (LLM-scored poignancy 1–10). Expensive
   to recompute later; cheap to store. Critical for filtering noise.

4. **Use LLM-controlled iterative tool calling** (MemR³ pattern), not
   fixed top-k injection. Let the agent decide whether it needs retrieval at
   all, and issue multiple queries with masked deduplication. Padarax already
   does this.

5. **Superseded Decisions must not surface by default.** The Park et al. model
   has no concept of supersession — a superseded Decision scores identically to
   an active one. The `mem:supersedes` predicate in nkrdn's memory schema must
   filter these at retrieval time, not after injection.

6. **Gate the reflection/consolidation pass.** Before synthesising higher-order
   beliefs from retrieved memories, validate source provenance. Reflections
   derived from superseded or agent-authored-only memories should be marked
   provisional until confirmed by a user-authored source.

7. **Optimal k is not maximum k.** The attentional dilution failure mode is
   documented. Default to small k (3–5); surface more only when the
   LLM-controlled loop explicitly requests additional rounds.

## Key Sources

| Source | Evidence tier | Key contribution |
|---|---|---|
| Park et al. (2023). *Generative Agents*. ACM UIST '23. arXiv:2304.03442 | Tier 2 | Triple-score formula (recency + importance + relevance); reflection mechanism; documented failure modes |
| Packer et al. (2023). *MemGPT*. ICLR 2024. arXiv:2310.08560 | Tier 2 | Tiered memory with LLM-controlled paging; 92.5% vs 32.1% on deep retrieval |
| Du, Li, Zhang, Song (2025). *MemR³*. arXiv:2512.20237 | Tier 2 | Masked iterative retrieval; +7.29pp on LoCoMo; masked retrieval = most impactful ablation |
| Xu et al. (2025). *A-MEM*. arXiv:2502.12110 | Tier 2 | Zettelkasten structural linking; 85–93% token reduction; multi-hop gains |
| Du P. (2026). *Memory for Autonomous LLM Agents* (survey). arXiv:2603.07670 | Tier 4 | Self-reinforcing reflection error; attentional dilution; long-context-≠-memory finding |
| Hu et al. (2025). *Memory in the Age of AI Agents* (survey). arXiv:2512.13564 | Tier 4 | 45-author taxonomy; forgetting mechanisms; post-retrieval processing patterns |
| Zhang et al. (2024). *Survey on Memory Mechanism of LLM Agents*. arXiv:2404.13501 | Tier 4 | Formal retrieval operator taxonomy; classifies retrieval strategies |

## References

- Park JS, O'Brien JC, Cai CJ, Morris MR, Liang P, Bernstein MS (2023). Generative Agents: Interactive Simulacra of Human Behavior. *ACM UIST '23*. arXiv:2304.03442.
- Packer C, Wooders S, Lin K, Fang V, Patil SG, Stoica I, Gonzalez JE (2023). MemGPT: Towards LLMs as Operating Systems. *ICLR 2024*. arXiv:2310.08560.
- Du X, Li L, Zhang D, Song L (2025). MemR³: Memory Retrieval via Reflective Reasoning for LLM Agents. arXiv:2512.20237.
- Xu W et al. (2025). A-MEM: Agentic Memory for LLM Agents. Rutgers University. arXiv:2502.12110.
- Du P (2026). Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers. arXiv:2603.07670.
- Hu Y et al. (2025). Memory in the Age of AI Agents: A Survey. arXiv:2512.13564. (45-author collaboration: NUS, Renmin, Oxford et al.)
- Zhang C et al. (2024). A Survey on the Memory Mechanism of Large Language Model Based Agents. Renmin University + Huawei Noah's Ark. arXiv:2404.13501.

## See Also

- [[agent-memory]] — CADE+nkrdn memory architecture (schema, lifecycle, rebuild semantics)
- [[context-window-management]] — working memory size budgeting
- [[session-persistence]] — session state storage and resumption
