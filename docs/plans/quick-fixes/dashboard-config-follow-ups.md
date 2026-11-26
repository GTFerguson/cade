---
title: Dashboard Config Follow-ups
created: 2026-11-26
status: active
priority: medium
---

# Dashboard Config Follow-ups

Loading every real project config through the stricter loader showed problems in the configs themselves, and two gaps in how problems reach the person who wrote the config. Measured by loading the 16 configs under `~/projects/*/.cade/` and their worktrees, read-only, on 26 November 2026.

## Problem

1. **The business-manager kanban cannot save a move.** Its source is a `vault` source, and `vault` has no write-back. A move used to be dropped without a word. It is now refused, the card goes back, and the dashboard shows why, so every move shows an error.
2. **The nkrdn project's dashboard does not load.** Its config names a source `manual` that it never declares. This was true before the loader changed.
3. **Panels whose inline source has no adapter show no rows.** dream-decks uses an inline `type: file` source, which should be a `markdown` source with `parse: raw`. A Padarax worktree uses ten inline sources of `type: inline`. Each now produces a warning naming the type.
4. **A config error does not reach the dashboard.** `dashboard-config-error` is logged in the browser console only. Warnings are shown in the pane; errors, which stop the config loading, are not.
5. **The agent that wrote a config cannot read its warnings.** They are in the payload sent to the browser and in the backend log. No tool or endpoint returns them, so an agent finds out only if the user tells it.

## Evidence

- Item 1: `core/backend/dashboard/handler.py`, the set of source types with write-back. The business-manager config's kanban panel reads a `vault` source.
- Item 2: loading `~/projects/nkrdn/.cade/dashboard.yml` raises `unknown source 'manual' (available: none)`.
- Item 3: `core/backend/dashboard/adapters.py` registers neither `file` nor `inline`.
- Item 4: `frontend/src/tabs/project-context.ts` passes `dashboard-config-error` to nothing but the console.
- Item 5: `config.warnings` is set in `core/backend/dashboard/config.py` and read only by `frontend/src/dashboard/dashboard-pane.ts` and the handler's log line.

## Why it matters

Items 1 to 3 are dashboards that do less than their configs ask for. Items 4 and 5 are why such configs go unnoticed: the person who sees the screen did not write it, and the agent that did cannot see the result.

## Suggested fix direction

- Item 1: write-back for `vault` sources, updating the note's frontmatter field the patch names, as the `directory` source does for its files.
- Items 2 and 3: fix the configs in their own repositories. They are not CADE's files.
- Item 4: show a config error in the pane with the same notice strip the warnings use.
- Item 5: return the warnings from the tool or endpoint an agent uses to see the dashboard, or answer a config write with them.
