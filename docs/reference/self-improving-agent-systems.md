---
title: Self-Improving Agent Systems — Memory, Skills, and Experience Evolution
created: 2026-04-22
updated: 2026-04-22
status: active
tags: [agent-architecture, self-improvement, memory, skill-library, reflection, llm-agents]
---

# Self-Improving Agent Systems

Survey of architectures that allow agents to improve from their own experience — without retraining the base LLM. Covers the four strongest recent systems and the foundational memory architecture they build on. Includes a cross-system comparison and CADE design recommendations.

See also:
- [[agentic-context-engineering]] — ACE: itemized context + Generator-Reflector-Curator
- [[coding-agent-prompts]] — Prompt Alchemy and execution-driven prompt refinement

---

## 1. The Cream of the Crop: Which Approaches Win and Why

Five approaches are clearly dominant across the literature. They converge on the same insight: **agents improve by externalising experience as a structured, queryable artefact**.

### Ranking

| Rank | System | Why It Wins | CADE Relevance |
|------|--------|-------------|----------------|
| 1 | **ACE** (Zhang et al., 2025) | Universal: works on any task, any model. +10.6% on agent tasks, 82–91% cost reduction. Fully model-agnostic. Best validated. | Backbone for CADE agent context management |
| 2 | **SICA** (Robeyns et al., 2025) | Most directly applicable to coding agents. Claude-based, 17%→53% SWE-Bench, agent edits its own codebase. | Direct template for CADE self-improvement loop |
| 3 | **Prompt Alchemy** (Ye et al., 2025) | Universal for code generation tasks. Zero regressions. Execution-driven, so gains are always real. | Prompt tuning backbone for CADE system prompts |
| 4 | **Memento-Skills** (Zhou et al., 2026) | Best for procedural knowledge gaps. +20.8pp on HLE. Behaviour-aligned retrieval beats semantic retrieval. | Skill library pattern if CADE adds mode-specific tools |
| 5 | **EvolveR** (Wu et al., 2025) | Best for strategic/reasoning gaps. Self-distillation beats teacher distillation at 3B+. RL + experience retrieval is synergistic. | Experience base design — especially quality scoring + deduplication |

**Why ACE ranks first**: It addresses the universal problem (any prompt can be an itemized playbook) and has the strongest empirical validation. The Generator-Reflector-Curator is independently validated by Padarax's NPC reflection architecture — two production systems converging on the same pattern is strong signal.

**Why memory/reflection approaches are task-dependent**: The Park-style memory stream and reflection cycle add significant overhead. For short-horizon tasks they add noise; for long-horizon tasks with accumulating context they are load-bearing. Apply them selectively based on session length and task continuity.

---

## 2. Foundational Architecture: Park et al. (2023) Generative Agents

The baseline memory architecture that all later systems build on or route around.

**Three-component architecture** (Tier 2: Park et al., 2023, *CHI* 2023; n=25 agents, 2 simulated days):

1. **Memory stream** — append-only log of observations with importance scores (1–10 originally, 0–5 recommended per Kouba et al., 2026)
2. **Reflection** — self-triggered summarization: when cumulative importance sum crosses a threshold, the agent synthesizes higher-level insights from recent memories
3. **Planning** — long-range goal decomposition stored back into memory; re-planned when world changes invalidate it

**Retrieval function** (all three components are load-bearing per ablation):

```
retrieval_score = w_recency * recency(m) + w_importance * importance(m) + w_relevance * relevance(m)
```

Where recency uses exponential decay on last access time, and relevance is cosine similarity to the query.

**Threshold calibration**: The original threshold of 150 is calibrated for Smallville's observation density (~75 observations/day). In lower-density sessions (5–30 turns), 150 is ~10× too high — agents almost never reflect. Recommended: `T_importance=30`, `T_turns=15`, with scene-boundary floor of 5.

**Scale compression problem**: LLMs under-utilize 1–10 scales; effective range clusters to 3–7. The 0–5 scale has significantly better human-LLM alignment (ICC=0.853 vs. 0.805 for 1–10) (Tier 2: Li et al., 2025).

**Recursive self-scoring**: Park lets the LLM score its own reflection insights, inflating the accumulator. Set `insight_importance = 0` to sever this loop.

---

## 3. Multi-Condition Trigger Mechanisms

No production system uses Park's pure importance accumulator as the primary reflection trigger. The field moved to disjunctive multi-condition triggers.

**Shipped-system consensus** (Tier 3: synthesis from Nemori, AgentCore, A-Mem, Humanoid Agents, Memento-Skills, EvolveR; Kouba et al., 2026 survey):

| System | Primary trigger | Secondary |
|--------|----------------|-----------|
| Nemori | Event boundary (σ=0.7 embedding drift) | — |
| AgentCore | Messages OR tokens OR idle time | — |
| A-Mem | Every write (link-on-write) | — |
| EvolveR | Post-trajectory (offline cycle) | RL reward gate |
| SkillClaw | Nightly (scheduled) | Validation A/B |

**Recommended trigger for CADE** (informed by Kouba et al., 2026):

```
reflect_now = (
    importance_sum >= 30          # importance accumulator
    OR turns_since_last >= 15     # turn counter
    OR scene_boundary             # context switch
    OR session_end                # always reflect at end
)
```

---

## 4. Importance Scoring: Five-Question Rubric

Replace Park's single-axis "poignancy" (1–10) with a yes/no checklist on five sub-items. Evidence: yes/no sub-items have lower rubric bias and better calibration than numeric scales (Tier 2: Li et al., 2025).

**Event-type prior** (apply before rubric to anchor scoring):

| Event type | Prior score |
|------------|-------------|
| First meeting, revelation, commitment | 4 |
| Confrontation, task completion | 3 |
| Routine exchange | 1 |
| Weather/ambient | 0 |

**Five-question rubric** (each yes = +1):
1. Is this novel — something the agent hasn't seen before?
2. Does this change the agent's relationship with another entity?
3. Does this affect the agent's current goals or plans?
4. Does this contradict something the agent previously believed?
5. Does this carry significant emotional weight in context?

Score = event_prior + yes_count. Store as a 0–9 integer; threshold-sum math works without rescaling.

---

## 5. SICA: Self-Improving Coding Agent

The most directly applicable architecture for CADE's self-improvement loop.

**System**: Bristol/Bath group. Agent edits its own Python codebase — no distinction between meta-agent and target agent (Tier 2: Robeyns, Szummer, Aitchison, 2025, arXiv 2504.15228).

**Benchmark results**:

- SWE-Bench Verified: **17% → 53%** over 15 iterations (~$7K API cost total)
- LiveCodeBench: 65% → 71%
- File editing: 82% → 91–96%
- Codebase navigation: 35% → 43% (agent built its own AST symbol locator)

**Architecture**:

- **Archive + meta-agent loop**: Best-performing archived agent becomes the meta-agent. It examines the archive, reflects on the success/failure pattern, then edits its own codebase to produce a new version.
- **Utility function**: `U = 0.5 * score_normalized + 0.25 * cost_score + 0.25 * time_score`, with a 0.5× timeout penalty. This prevents the agent from "winning" by spending unlimited tokens.
- **Asynchronous overseer**: A second LLM runs concurrently during task execution, detecting loops or deviation and sending intervention signals. This is the same pattern as ACE's Reflector.
- **Context structure**: System prompt → core prompt (problem + open files + directory tree) → assistant messages (CoT, tool calls, sub-agent calls, overseer signals). File edits use diffs consolidated periodically to preserve KV cache.

**Key self-improvements the agent made** (in order):
1. Smart diff-based editor + quick overwrite (reduces token usage)
2. Code context summarization + file edit verification
3. AST symbol locator → hybrid ripgrep+AST locator
4. Context-sensitive diff minimization

**Takeaway for CADE**: Most gains come on longer-horizon agentic tasks where scaffolding adds value over raw LLM capability. The agent's self-improvements are consistently tooling and context-management improvements — exactly what CADE's infrastructure provides. The utility function design and async overseer are directly adoptable.

---

## 6. Memento-Skills: Behaviour-Aligned Skill Libraries

External skill libraries that evolve without retraining the base model (Tier 2: Zhou et al., 2026, arXiv 2603.18743).

**Benchmark results**:
- GAIA test set: 52.3% → **66.0%** (+13.7pp)
- HLE test set: 17.9% → **38.7%** (+20.8pp, >2×)

**Architecture**:

- **Skills as markdown+code files**: Structured units containing both executable behaviour and declarative specification. Persistent external library.
- **SRDP loop**:
  1. *Read*: Behaviour-aligned skill router retrieves most relevant skill
  2. *Execute*: Frozen LLM executes skill's workflow
  3. *Write*: Post-execution feedback triggers failure attribution → skill rewrite or skill discovery
  4. *Validate*: Unit-test gate prevents regression

- **Behaviour-aligned retrieval**: Trained with single-step offline RL (multi-positive InfoNCE loss) to optimise for execution success, not semantic similarity. Recall@1: 0.60 vs. 0.54 for semantic embedding.

**Critical finding**: Domain structure matters enormously for cross-task transfer. Taxonomically organised tasks (HLE academic subjects) yield strong transfer. Diverse benchmarks (GAIA) yield weak transfer. Design skill libraries with explicit domain clustering.

---

## 7. SkillClaw: Collective Skill Evolution

Shares a skill library across multiple users; cross-user interaction data is far richer than any single session (Tier 2: Ma et al., 2026, arXiv 2604.08377).

**Key results** (WildClawBench, 6-day evolution):
- Controlled targeted evaluation: average **+42.1%** gain per round
- "Save report" task: 28.3% → 100.0%
- Gains plateau after 1–2 days on procedural errors; higher-level reasoning gaps improve more slowly

**Architecture**:

- **Session collection**: Raw interactions → causal chain (user prompt → agent actions → tool results/errors → response) + skill usage metadata + quality score
- **Session grouping**: `G(s)` = all sessions using skill `s` (natural cross-user ablation); `G(∅)` = sessions using no skill (identifies coverage gaps)
- **Agentic evolver**: LLM agent chooses Refine / Create / Skip per skill based on grouped evidence. Conservative editing: targeted edits preferred over rewrites.
- **Nightly validation gate**: Candidate skill runs A/B alongside original on relevant tasks. LLM judges outcome and stability. Only accepted updates ship.

**Takeaway for CADE**: The nightly validation gate is essential for monotonic improvement. Conservative editing principles (targeted edits, preserve working structure) prevent regression cascades. Collective evolution across multiple CADE users would be substantially more powerful than per-session learning.

---

## 8. EvolveR: Experience Distillation + RL

Closes the loop fully: the agent distills its own trajectories into principles and refines its policy with RL (Tier 2: Wu et al., 2025, arXiv 2510.16079).

**Benchmark results** (7 QA benchmarks, Qwen2.5-3B):
- Best average EM: **0.382** (vs. CoT 0.28, RAG 0.31, Search-R1 0.36)
- Self-distillation beats teacher distillation (GPT-4o-mini) at 3B+ — "cognitive alignment" advantage

**Architecture**:

1. **Offline distillation** (policy frozen): Agent analyses its own trajectories, distils natural-language principles (success → guiding principle; failure → cautionary principle). Deduplication via embedding similarity + LLM judge. Dynamic quality scoring: `s(p) = (c_succ + 1) / (c_use + 2)`. Pruning below threshold.
2. **Online interaction**: Think-Act-Observe loop with explicit `<search_experience>` action type that retrieves relevant principles before acting.
3. **Policy evolution (GRPO)**: Reward = outcome score + format score (balanced think steps, diverse search actions). Group Relative Policy Optimization — no learned value function needed.

**Takeaway for CADE**: Dynamic quality scoring and deduplication are load-bearing — without them, the experience base degrades. Direct principle absorption into weights (unmasked loss) is counterproductive; relevance-weighted retrieval is the right pattern. Self-distillation quality is bounded by the base LLM capability; for CADE's Claude Sonnet backbone this is unlikely to be a bottleneck.

---

## 9. Implications for CADE Agent Design

Four concrete design commitments drawn from the cross-system evidence:

### 9.1 ACE as Context Backbone

The itemized playbook (ACE's core contribution) is the universal upgrade. Apply it to every CADE agent system prompt:
- Structure agent context as bullet-point heuristics, not prose
- Use Generator-Reflector-Curator to update bullets post-task
- Preserve comprehensive bullets (long-context LLMs extract relevance; brevity bias is the enemy)

See [[agentic-context-engineering]] for the full ACE implementation pattern.

### 9.2 SICA-Style Self-Improvement Loop

For CADE's self-improvement capability:
- Archive previous agent configurations + performance metrics
- Use utility function balancing score / cost / time (prevents "winning by spending")
- Implement async overseer as a concurrent validation thread
- Target tooling and context-management improvements first — highest ROI per SICA's iteration log

### 9.3 Memory Architecture (When Needed)

Apply Park-style memory only for long-horizon sessions (>30 turns) where context accumulation is load-bearing:
- Use 0–5 importance scale (Li et al., 2025) with event-type priors
- Multi-condition disjunctive reflection trigger (`T_importance=30 OR T_turns=15 OR scene_boundary`)
- Set `insight_importance = 0` to prevent recursive scoring inflation
- Separate memory (what happened) from skills (what to do) — these are independent axes

### 9.4 Skill Library (When Useful)

For mode-specific procedural knowledge (research mode, code mode, plan mode):
- Structure skills as markdown+code units with explicit domain taxonomy
- Use behaviour-aligned retrieval (optimise for execution success, not semantic similarity)
- Validate every skill mutation before deploying (nightly gate or per-session gate)
- Conservative editing by default: targeted patches, not rewrites

---

## References

- Park JS, O'Brien J, Cai CJ, et al. (2023). Generative agents: Interactive simulacra of human behavior. *CHI 2023* Extended Abstracts. doi:10.1145/3586183.3606763
- Zhang Y, et al. (2025). Agentic Context Engineering (ACE): Self-evolving LLM agent contexts for improved task performance. arXiv:2503.02834
- Ye F, et al. (2025). Prompt Alchemy: Evolving prompts for code generation. *IEEE Transactions on Software Engineering*. arXiv:2407.19453
- Robeyns M, Szummer M, Aitchison L (2025). A Self-Improving Coding Agent. University of Bristol / iGent.ai. arXiv:2504.15228
- Zhou H, Chen Y, Guo S, et al. (2026). Memento-Skills: Let Agents Design Agents. UCL / HKUST Guangzhou. arXiv:2603.18743
- Ma Z, Yang S, Ji Y, et al. (2026). SkillClaw: Let Skills Evolve Collectively with Agentic Evolver. DreamX Team. arXiv:2604.08377
- Wu R, Wang X, Shi B, et al. (2025). EvolveR: Self-Evolving LLM Agents Through an Experience-Driven Lifecycle. Zhejiang University / Shanghai AI Lab. arXiv:2510.16079
- Li J, et al. (2025). Calibrating LLM importance scorers: Scale and rubric effects on human-LLM alignment. [Internal citation from padarax/docs/reference/memory/memory-importance-scoring.md]
- Kouba D, et al. (2026). Reflection trigger mechanisms in production LLM agents. [Internal citation from padarax/docs/reference/memory/reflection-trigger-tuning.md]
