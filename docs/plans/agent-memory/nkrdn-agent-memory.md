---
title: Agent Memory
created: 2026-04-23
status: planning
tags: [nkrdn, memory, agent]
---

# Agent Memory

nkrdn is CADE's memory and knowledge system. This plan extends it to store and retrieve agent experience — what agents learn as they work — alongside the structural code knowledge it already holds.

## Overview

Agents accumulate experience during work sessions: they discover quirks, make mistakes, develop heuristics, find the right patterns for a codebase. Today that knowledge dies at context end. This feature persists it in nkrdn and loads it back when the agent returns to the same code.

The result is ACE's itemized playbook pattern (structured bullets, Generator-Reflector-Curator update cycle) but spatially indexed — memories live on graph nodes rather than floating globally in the system prompt.

## Core Concepts

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

When the agent opens a file or edits a symbol, nkrdn loads the relevant memory annotations alongside the existing structural context.

The retrieval query should be **task intent + structural location**, not structural location alone. Two semantically identical memories rank differently based on where they're anchored relative to where the agent has been working.

### Update Cycle (ACE Generator-Reflector-Curator)

After each task, the Reflector pass reviews the session and proposes memory updates:
- **New bullet** — something learned that wasn't known before
- **Update** — existing bullet revised based on new evidence
- **Retire** — bullet no longer accurate

## Tailored Advantages

Most of the research this plan draws on was conducted on legacy codebases where structure must be inferred. Here it's explicit:

- **Wiki-links are graph edges**: `[[agentic-context-engineering]]` is a typed relationship already in the files. nkrdn should parse these as first-class edges.
- **Doc type is a trust signal**: Reference docs are evidence, architecture docs are ground truth, plan docs are intent — weighted accordingly.
- **PROVEN tiers are quality weights**: Tier 1 (meta-analysis) vs Tier 5 (practitioner opinion) — already structured metadata.
- **Frontmatter status is freshness**: `status: active` vs `status: draft` — lifecycle is declared.

## Integration Points

- **`nkrdn context <filepath>`** — extend to include memory annotations in output
- **`nkrdn memory add <uri> <text>`** — new command to attach a memory bullet
- **`nkrdn memory list <uri>`** — list memories on a node and its ancestors
- **CADE agent hooks** — after-task Curator pass triggers memory update cycle

## Open Questions

- Does nkrdn store memories as RDF properties on symbol nodes, or as separate linked nodes with `about` edges?
- What's the right depth for ancestor memory inheritance at load time?
- Should memories be committed to git or stay in the local `.nkrdn/` store only?
- How does CADE surface memories in the UI — inline in chat, separate panel, or invisible (agent-only)?
