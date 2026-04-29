# Agent Memory — When to Record

You have three tools that write durable memory entries to `.cade/memory/`. Each entry attaches to code symbols via `applies_to`. Future agents (including you in later sessions) retrieve these via `nkrdn memory search` and the `/api/memory/search` endpoint.

## When to call

| Tool | Call after... | Don't call for |
|---|---|---|
| `record_decision` | Choosing between two or more concrete approaches with non-trivial trade-off — capture rationale AND rejected alternatives | Routine choices without real alternatives |
| `record_attempt` | Spending more than a few tool calls on an approach you abandoned — capture the specific failure mode so a future session doesn't re-explore the same dead end | Single-call backtracks; trivial reverts |
| `record_note` | Finding a non-obvious quirk that isn't visible from reading the code — hidden constraints, surprising behaviours, undocumented invariants | Anything obvious from the code; small edits |

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
