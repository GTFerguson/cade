---
title: Five dashboard components exist but are undocumented
created: 2026-05-05
status: active
priority: low
---

## Problem

Five frontend dashboard components exist in `frontend/src/dashboard/components/` that are not described in any plan, schema doc, or dashboard prompt module. Agents don't know they exist, and there are no stability guarantees.

## Evidence

- `frontend/src/dashboard/components/basket.ts` — undocumented
- `frontend/src/dashboard/components/claims.ts` — undocumented
- `frontend/src/dashboard/components/entity-detail.ts` — undocumented
- `frontend/src/dashboard/components/graph.ts` — undocumented
- `frontend/src/dashboard/components/model-stats.ts` — undocumented
- `backend/prompts/modules/dashboard.md` — only lists the 7 plan components; no mention of the above

## Why it matters

Agents using the dashboard system won't discover these components. If they fit general use cases (entity-detail, graph, model-stats especially seem broadly useful) they should be documented. If they're project-specific, they should be moved or clearly marked as internal.

## Suggested fix direction

Read each component, determine purpose and props. Add any general-purpose ones to `backend/prompts/modules/dashboard.md`'s component table and `core/backend/dashboard/config.py`'s `KNOWN_COMPONENTS`. Move genuinely project-specific ones out of the shared component directory or mark with a comment.
