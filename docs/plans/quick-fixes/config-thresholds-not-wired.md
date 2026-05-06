---
title: Context budget thresholds hardcoded, not config-driven
created: 2026-05-05
status: active
priority: medium
---

## Problem

The context budget indicator uses hardcoded thresholds (50% / 75% / 90%) and hardcoded context window sizes per model. The plan specified `context_budget_threshold` and `context_budget_hard_limit` config knobs in `~/.cade/providers.toml`, but these are never read.

## Evidence

- `frontend/src/components/context-budget-indicator.ts` lines 14–22 — `CONTEXT_WINDOWS` table hard-coded by model name substring
- `frontend/src/components/context-budget-indicator.ts` lines 32–37 — `getSegmentColor()` uses literal 50/75/90 thresholds
- No `context_budget_threshold` or `context_budget_hard_limit` keys in `~/.cade/providers.toml`

## Why it matters

Users cannot customise when the indicator turns warning/danger. Also blocks Phase 2e (auto-trigger handoff), which needs the same threshold values from config to know when to fire.

## Suggested fix direction

Add `context_budget_threshold` and `context_budget_hard_limit` to the per-provider section of `providers.toml`. Expose them through the `/api/config` or session init payload so the frontend component can read them at startup. Extend `CONTEXT_WINDOWS` or fetch from litellm's model info for unknown models.
