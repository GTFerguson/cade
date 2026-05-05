# Agent Memory

You have three tools that write durable memory entries to `.cade/memory/`. Each entry attaches to code symbols via `applies_to`. Future agents (including you in later sessions) retrieve these via `nkrdn memory search` and the `/api/memory/search` endpoint.

Capture and retrieval are both explicit and agent-controlled — there is no auto-injection at session start and no auto-extraction at session end. Call the tools when the triggers below apply; otherwise stay silent.

## When to record

| Tool | Call after... | Don't call for |
|---|---|---|
| `record_decision` | Choosing between two or more concrete approaches with non-trivial trade-off — capture rationale AND rejected alternatives | Routine choices without real alternatives |
| `record_attempt` | Spending more than a few tool calls on an approach you abandoned — capture the specific failure mode so a future session doesn't re-explore the same dead end | Single-call backtracks; trivial reverts |
| `record_note` | Finding a non-obvious quirk that isn't visible from reading the code — hidden constraints, surprising behaviours, undocumented invariants | Anything obvious from the code; small edits |

## When to retrieve

Call `nkrdn memory search "<query>"` (or the equivalent `/api/memory/search` endpoint) when project-specific prior knowledge could change your answer — not on every turn. Retrieval is LLM-controlled and iterative: issue a focused query, read what comes back, narrow with a follow-up query if needed.

| Trigger | Why call | Don't call for |
|---|---|---|
| About to choose between approaches on a non-trivial topic | A prior `record_decision` may already settle it — or its rejected alternatives rule out what you're considering | Routine choices with no real alternatives |
| About to invest more than a few tool calls in an approach | A prior `record_attempt` may show this exact path already failed; saves the dead end | Short, cheaply-reversed exploration |
| Hit surprising behaviour or a constraint that isn't visible in the code | A prior `record_note` may already explain it | Behaviour that's obvious from reading the code |
| Starting work on an unfamiliar symbol or area | `nkrdn memory search "<topic>" --uri <symbol-uri>` returns entries attached to that symbol | Symbols you've already touched this session |

Prefer narrow, specific queries over broad ones. Retrieval degrades when k grows large (attentional dilution) — a focused query returning 3 strong matches is more useful than a vague one returning 15 weak ones. If the first query returns nothing useful, rephrase or narrow with `--uri` rather than widening.

Skip retrieval for general programming knowledge, well-known framework behaviour, or anything pretraining already covers — searching for those returns noise and dilutes the genuinely project-specific entries that are there.

## Goal: high-signal, low-volume

The memory store is for things future readers would otherwise rediscover from scratch. Conservative capture beats noisy floods — fewer high-quality entries are far more useful than many trivial ones. When in doubt, don't record.

## Importance score (1–10)

Score at write time using context only you have right now — re-scoring later is unreliable.

| Score | Meaning |
|---|---|
| 3 | Routine choice |
| 5 | Standard trade-off with rationale |
| 7 | Architectural decision with broad impact |
| 9 | Critical (security, correctness, contractual) |

## Idempotency

Identical re-writes are silent no-ops — the writer dedupes by content hash. Call freely; don't pre-check whether an entry exists.

## applies_to

Use bare symbol names (`AuthService`, `JWTMiddleware`, not `[[AuthService]]`). Wiki-link resolution to stable code URIs happens automatically on the next nkrdn rebuild.

## evidence (optional)

Cite the source that grounds the entry. Each item in the array can be:

- A wiki-link to a reference doc or symbol — `[[agent-memory-systems]]`, `[[AuthService]]`. Resolves to a graph URI on rebuild.
- A URL — `https://arxiv.org/abs/2304.03442`.
- A citation literal — `Park et al. 2023`.

Skip evidence for routine decisions where the rationale alone is self-grounding. Add it when the decision is downstream of research, a paper, an RFC, an internal reference doc, or a prior memory entry — anywhere a future reader benefits from being able to trace back to the source. Mixing forms in the same array is fine.
