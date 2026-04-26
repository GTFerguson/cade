---
description: PROVEN documentation — every claim traces to a source, evidence-tiered, one topic per doc
---

# PROVEN Documentation

Project documentation is institutional memory. Every design decision and domain assumption must trace back to evidence.

## Doc types

| Type | Directory | Purpose |
|------|-----------|---------|
| Reference | `docs/reference/` | Evidence base — domain knowledge with citations |
| Architecture | `docs/architecture/` | How shipped systems work and why |
| Plan | `docs/plans/` | Intent before code — deleted after shipping |

## Lifecycle

```
research → reference doc → plan → implement → architecture doc → delete plan
```

Plans are ephemeral. Once a feature ships, extract durable knowledge into architecture docs and delete the plan.

## The PROVEN principles

- **Provenance** — every claim names author, year, title, source
- **Research-first** — write `docs/reference/` before writing code
- **One topic per doc** — split when a doc exceeds ~200 lines
- **Verifiable** — include sample size, effect size, journal name
- **Evidence-tiered** — label sources (meta-analysis > RCT > observational > opinion)
- **Not duplicated** — update existing docs rather than creating overlapping ones

## Citation format

```
(Author et al., Year, *Journal* Volume(Issue):Pages, n=SampleSize)
```

## When to write a reference doc

- Before implementing any algorithm that depends on domain knowledge
- When research informs thresholds, constants, or heuristics in code
- When a topic is re-searched repeatedly
