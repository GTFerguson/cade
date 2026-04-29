---
title: Agent Memory Capture — CADE Phase 4 Design Synthesis
created: 2026-04-29
updated: 2026-04-29
status: active
tags: [research, memory, capture, agents, nkrdn, phase-4]
---

# Agent Memory Capture

Evidence base for the **write side** of CADE's nkrdn agent-memory system —
Phase 4. The capture surface is what the agent calls (or what the system
extracts) to produce the markdown files that nkrdn ingests on rebuild. This
doc synthesises the cross-domain research into concrete recommendations for
the CADE writer module and tool registration.

For retrieval evidence see [[agent-memory-systems]]. For the architectural
context of how nkrdn ingests these files see [[../architecture/nkrdn-agent-memory]].
For the implementation handoff see
[[../plans/handoff/agent-memory-phase-4-capture]].

## 1. The Capture Decision Tree

Three concrete questions the writer module must answer:

1. **Who decides to write — the agent or the system?** (Write surface)
2. **When the agent decides to write, how does the system handle duplicates?** (Dedup)
3. **What does a capturable decision look like?** (Schema and content)

The literature has converged on defensible answers for each. CADE's plan
already favours conservative explicit triggers; the cross-domain evidence
backs that choice and adds detail on dedup and schema.

## 2. Write Surface — Explicit Tool Calls

The cross-domain recommendation is unambiguous for CADE's setting (short to
medium coding sessions, 30-turn order of magnitude): **default to explicit
tool calls**. See [[common-knowledge/ai-agents/agent-memory-write-tools]] for
the full evidence. The compressed version:

- MemGPT-style (Packer et al. 2023, ICLR 2024) explicit tools: cheaper, more
  auditable, no extra LLM call per turn.
- A-MEM autonomous post-write (Xu et al. 2025) is the right pattern for
  long-horizon agents accumulating context across sessions — overkill for a
  typical CADE coding session.
- Self-reinforcing reflection error (Du 2026, arXiv:2603.07670) is a
  documented failure mode of autonomous extraction.

### 2.1 Tool API for CADE

Type-discriminated tools, schema-first parameters, importance scored at write
time:

```python
record_decision(
    rationale: str,                # WHY this choice was made
    alternatives: list[str],       # Rejected approaches with one-line each
    applies_to: list[str],         # ["AuthService", "JWTMiddleware"] - wiki-link names
    importance: int,               # 0-5, scored against rubric
    supersedes: str | None = None, # Memory URI of prior decision, if any
)

record_attempt(
    approach: str,                 # What was tried
    outcome: str,                  # Why it didn't work
    applies_to: list[str],
    importance: int,
)

record_note(
    observation: str,              # Lightweight finding worth keeping
    applies_to: list[str],
    importance: int,
)
```

Reasoning for type discrimination
([[common-knowledge/ai-agents/agent-memory-write-tools#3-3-type-discrimination-at-the-tool-surface]]):
parameter shape signals what good content looks like. The agent's training
kicks in when it sees `alternatives: list[str]` — it provides genuine
alternatives instead of skipping that field under a generic `save_memory`.

### 2.2 Importance Score — 0–5 with Rubric

Use the Padarax-derived rubric from
[[self-improving-agent-systems#4-importance-scoring-five-question-rubric]]:

Event-type prior (Decision baseline = 3 for trade-off with rationale, 4 for
revelation/commitment, 1 for routine), plus five yes/no questions (each = +1):

1. Is this novel — something the agent hasn't seen before in this codebase?
2. Does this change the agent's relationship with another component or
   constraint?
3. Does this affect the agent's current goals or plans?
4. Does this contradict something previously assumed?
5. Does this carry significant impact in context (security, cost,
   correctness)?

Score = prior + yes_count, clamped to 0–5. The agent fills `importance` at
write time; recomputing later is expensive and loses context.

### 2.3 System-Prompt Triggers

The system prompt must nudge writes — agents under-call write tools without
explicit guidance:

```
After choosing between two or more concrete approaches with a non-trivial
trade-off, call record_decision with the rationale and the alternatives you
rejected.

After abandoning an approach that you've spent more than a few tool calls on,
call record_attempt to leave a breadcrumb for future sessions.

When you find a non-obvious quirk in the codebase that future agents would
benefit from knowing, call record_note.

Do NOT write memory for routine edits, small refactors, or successful tool
calls without trade-off reasoning.
```

The "Do NOT" line matters more than the "Do" lines. Conservative capture is
explicitly the goal — better to miss some entries than to flood the index
with noise. See
[[common-knowledge/ai-agents/agent-memory-write-tools#5-empirical-evidence-why-capture-quality-matters]]
for why.

## 3. Idempotency and Dedup at the Write Tool

The agent **must not** be responsible for checking duplicates. The write tool
itself dedupes. See
[[common-knowledge/ai-agents/memory-write-deduplication]] for the full design.

### 3.1 Pipeline

```
record_decision(...)
  ↓
embed(rationale + alternatives + applies_to)
  ↓
top_k_nearest(memory_index, embedding, k=5)
  ↓
dedup_judge(new, candidates) → identical | refinement | supersedes | new
  ↓
write markdown to .cade/memory/<YYYY-MM-DD-slug>.md (or update existing)
  ↓
trigger nkrdn rebuild (debounced via existing nkrdn_service.py machinery)
```

### 3.2 Dedup Judge Rubric

Yes/no checklist for the LLM judge — outperforms numeric thresholds for the
same reason yes/no importance rubrics outperform 1–10 scales:

1. Same `type` (decision, attempt, note)?
2. Same primary `applies_to` target (or transitively related)?
3. Does the new entry contradict the old, or refine/extend it?
4. Is the new content materially different (>30% novel tokens)?

Decision matrix:

| Pattern | Action |
|---|---|
| (1) AND (2) AND content hash matches modulo whitespace | Skip — silent no-op return existing URI |
| (1) AND (2) AND refines/extends, not contradicts | Update — overwrite body, keep URI |
| (1) AND (2) AND contradicts | Supersede — new entry with `mem:supersedes` link |
| Any other | Create new |

Conservative editing is the safe default
([[common-knowledge/ai-agents/memory-write-deduplication#3-3-conservative-editing-skillclaw-pattern]]).
When the judge has uncertainty, prefer create-new-with-link over destructive
merge.

### 3.3 Stable URIs

Mint the URI at first write (UUID4 hex or content-derived slug) and keep it
across updates. Updates and supersessions need stable referents — content-hash
URIs break the moment the content changes.

The nkrdn parser already keys memory entries by filename stem
([[../architecture/nkrdn-agent-memory#triple-schema]]). The writer must
ensure stems are stable — pick the slug at first write, not on subsequent
updates.

## 4. Markdown Schema — Match nkrdn Parser

The frontmatter schema is **already defined** by nkrdn at
`/home/gary/projects/nkrdn/src/nkrdn/parsers/memory/parser.py`. The writer
just produces files matching that schema:

```yaml
---
type: decision           # decision | attempt | note | session
applies_to: [[AuthService]]
supersedes: 2026-01-12-old-decision
authored_by: agent:claude
session: 2026-04-29
tags: [auth, security]
importance: 4
created: 2026-04-29
archived_at: null
---

Body text — the rationale, alternatives, consequences. Markdown.

## Considered Options

- JWT (chosen)
- Session cookies — rejected because horizontal scaling required
- OAuth-only — rejected because mobile clients

## Consequences

Positive: stateless, scalable, mobile-friendly.
Negative: token revocation requires a denylist; longer tokens than session IDs.
```

The body structure (Considered Options + Consequences sections) maps to the
MADR template — see
[[common-knowledge/ai-agents/architecture-decision-records#5-mapping-adrs-onto-agent-memory-schema]].

The writer module should produce this body shape as a default template,
populated from the tool parameters. Authors who hand-edit the file later get
a structured starting point.

## 5. Rebuild Trigger

After a write, nkrdn must rebuild for the new entry to be searchable. The
existing `backend/nkrdn_service.py` already has the `_run_nkrdn_rebuild` +
debounce machinery. The writer just calls into the service:

```python
# After successful markdown write:
await nkrdn_service.schedule_rebuild()  # debounced
```

The debounce avoids thrashing when the agent writes multiple entries in a
short window. Default debounce window of ~2-5 seconds is appropriate — fast
enough that the next retrieval call finds the new entry, slow enough that a
burst of writes only triggers one rebuild.

## 6. Quality Gate

Xiong et al. 2025 showed that "add-all" memory writing **performs worse than
fixed memory** — adding every entry without a quality check actively degrades
agent performance over time
([[common-knowledge/ai-agents/agent-memory-write-tools#5-empirical-evidence-why-capture-quality-matters]]).

For Phase 4 the conservative default is:

| Layer | Mechanism | Cost |
|---|---|---|
| **Tool-surface gate** | Required fields force structure; agent self-filters | Free |
| **Schema validation** | Pydantic / dataclass validates types and ranges | Free |
| **Dedup judge** | Catches duplicates and false-merge attempts | One LLM call per write |
| **Importance threshold** | Drop writes with `importance < 1` (the rubric floor) | Free |

This is conservative but defensible. More aggressive gates (LLM trajectory
evaluator, fine-tuned judge) can be added in Phase 4.5 once we have data on
what kinds of entries the agent actually produces.

The "free quality labels" insight from Xiong et al. — using future retrieval
outcomes to label memory utility — is a Phase 5+ concern. It requires
tracking which retrievals led to task success, which is not yet wired up.

## 7. Reflector Pass — Deferred

The CADE plan calls out a session-end ACE-style Reflector pass as a Phase 4
extension. Defer it. Two reasons:

1. **The plan itself flags this as deferred until capture is in real use.**
   Without entries to consolidate, the Reflector has nothing to do. Build
   capture first; consolidate when there's measurable noise.

2. **Self-reinforcing reflection error** (Du 2026, arXiv:2603.07670) is the
   most dangerous documented failure mode for the synthesis layer. Any
   Reflector implementation needs provenance tracing back to source memories
   ([[agent-memory-systems#documented-failure-modes]]). That's a meaningful
   design effort, not a quick add-on.

When Phase 4.5 picks up the Reflector pass, the design pattern is
[[common-knowledge/ai-agents/agentic-context-engineering]]'s
Generator-Reflector-Curator with the multi-condition trigger from
[[common-knowledge/ai-agents/self-improving-agent-systems#3-multi-condition-trigger-mechanisms]]:

```
reflect_now = (
    importance_sum >= 30          # accumulated entry importance this session
    OR turns_since_last >= 15     # turn counter
    OR session_end                # always reflect at session close
)
```

Recommended threshold values are calibrated for short sessions; tune from
real usage.

## 8. CADE-Specific Implementation Map

| Layer | Module | Purpose |
|---|---|---|
| Tool registration | `backend/tools/registry.py` | Register `record_decision`, `record_attempt`, `record_note` |
| Tool execution | `backend/memory/writer.py` (new) | Schema validation, dedup judge, markdown emission |
| Slug + URI | `backend/memory/writer.py` | Stable filename stem at first write, never changes |
| Dedup index | `backend/memory/dedup.py` (new, optional) | Embedding ANN over existing memory; can stub with sequential scan in Phase 4.0 |
| Rebuild trigger | `backend/nkrdn_service.py` | Existing debounce, just call into it |
| Frontmatter schema | nkrdn `parsers/memory/parser.py` | Source of truth — match exactly |
| Wiki-link resolution | nkrdn `parsers/memory/resolver.py` | Writer emits `[[Name]]` strings, resolver does the work |

The writer's responsibility ends at "valid markdown file in `.cade/memory/`."
nkrdn does graph ingestion, wiki-link resolution, and supersedes-chain
materialisation on rebuild — CADE doesn't duplicate that logic.

## 9. Test Plan

Unit tests for the writer
([[../plans/handoff/agent-memory-phase-4-capture#next-actions-ordered]] step 6):

| Test | Asserts |
|---|---|
| Frontmatter shape | Output matches nkrdn parser's expected fields |
| Slug generation | Same input → same slug; collision yields distinct slugs |
| Idempotency | Calling write tool twice with identical content → one file, second call returns existing URI |
| Dedup judge — refinement | Slightly modified content → updates existing file body, preserves URI |
| Dedup judge — supersedes | Contradicting decision → new file with `supersedes` link to old |
| Importance clamp | Out-of-range importance gets clamped to 0–5 |
| Required fields | Missing rationale / alternatives raises clear validation error |

Integration test:
- Write a decision via the tool
- Wait for nkrdn rebuild (or trigger explicitly)
- Call `/api/memory/search` and confirm the new entry surfaces

## 10. Recommendations Summary

Drawn from cross-domain research and tied to the CADE Phase 4 surface:

1. **Default to explicit tool calls** — `record_decision`, `record_attempt`,
   `record_note`, type-discriminated.
2. **Schema-first parameters** — required `alternatives` for decisions,
   required `applies_to` for everything; importance scored at write time on
   the 0–5 rubric.
3. **Idempotency at the write tool, not the agent.** Embedding ANN +
   yes/no LLM judge → identical / refinement / supersedes / new.
4. **Conservative editing.** Link, don't merge. Update only on clear
   refinement.
5. **MADR-shaped body.** Considered options + consequences sections in the
   markdown body, populated by default from tool parameters.
6. **Stable URIs from first write.** Don't derive from content.
7. **Trigger nkrdn rebuild via existing debounce.** Single integration point.
8. **Quality gate at the schema layer plus dedup judge.** Add fancier gates
   only after measuring real-world capture quality.
9. **Defer the Reflector pass.** Capture first, consolidate when there's
   noise to consolidate.
10. **System prompt nudges.** Without trigger phrases the agent under-calls;
    with them the rate of useful writes goes up. Include explicit "do NOT
    write for routine edits" guidance.

## 11. Open Questions

1. **Default importance threshold.** The rubric floor is 1. Should the
   writer drop entries below 2 by default? Tune from data.
2. **Authored-by stamping.** Hard-code `agent:claude` or pull from the
   current provider config? Latter is cleaner but adds a dependency on
   provider state at write time.
3. **Cross-session vs per-session writes.** `.cade/memory/` is project-local;
   should the writer surface a hint when a memory is broadly reusable
   (candidate for promotion to common-knowledge)?
4. **User override / approval.** Should the writer surface to the UI before
   committing? Phase 4 ships agent-only writes; Phase 5 UI is the natural
   place for human-in-the-loop.
5. **Test for self-reinforcing error.** Hard to write; defer until Reflector
   pass exists.

## 12. Key Sources

| Source | Tier | Contribution |
|---|---|---|
| Xiong et al. 2025 (arXiv:2505.16067) | Tier 2 | Add-all degrades; quality gate evidence |
| Xu et al. 2025 (arXiv:2502.12110) | Tier 2 | A-MEM link-on-write; LLM-judged linking |
| Du et al. 2025 (arXiv:2505.00675) | Tier 4 (survey) | Six-operation taxonomy |
| Packer et al. 2023 (arXiv:2310.08560) | Tier 2 | MemGPT explicit memory tools |
| Zhou et al. 2025 (arXiv:2504.20781) | Tier 2 | LLM ADR generation; multi-agent best |
| Su et al. 2026 (arXiv:2602.07609) | Tier 2 | LLM ADR violation detection; failure taxonomy |
| Nygard 2011 | Tier 5 | Original ADR template |
| MADR Project 2026 | Tier 5 | Markdown ADR formalisation |

## See Also

- [[agent-memory-systems]] — retrieval scoring evidence
- [[../architecture/nkrdn-agent-memory]] — nkrdn ingestion architecture
- [[../plans/handoff/agent-memory-phase-4-capture]] — current implementation
  handoff
- [[common-knowledge/ai-agents/agent-memory-write-tools]] — capture surface
  research foundation
- [[common-knowledge/ai-agents/memory-write-deduplication]] — dedup decision
  matrix
- [[common-knowledge/ai-agents/architecture-decision-records]] — ADR practice
  and schema mapping
- [[self-improving-agent-systems]] — Reflector pass design (deferred)
- [[agentic-context-engineering]] — ACE Generator-Reflector-Curator pattern
