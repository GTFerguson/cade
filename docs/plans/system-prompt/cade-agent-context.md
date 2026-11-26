---
title: CADE Agent Context: System Prompt Affordances
created: 2026-04-23
updated: 2026-11-26
status: planning
verified: 2026-11-26
tags: [agent, system-prompt, ux, dashboard, context]
---

# CADE Agent Context

The system prompt tells a chat agent which output surface to use: chat, the dashboard, or a document. That part is built. How it is assembled and why is in [[../../technical/core/prompt-composition]]. How an agent drives the dashboard, including pushing panels and streaming rows into a running dashboard, is in [[../../technical/reference/dashboard-interactive-primitives]].

This plan holds the two things that are not built.

## Remaining Work

### 1. Dashboard components an agent can add at run time

An agent can use the component types compiled into the frontend (`frontend/src/dashboard/registry.ts`). It cannot add a new type. A new type needs frontend code and a rebuild.

The need: when no existing component fits (a custom visualisation, a project-specific panel), the agent should be able to supply one without a CADE release.

What exists nearby:

- `show_html` draws a self-contained page in the viewer. It covers one-off visuals but the page is not a dashboard panel: it has no data source and does not sit in a view.
- `POST /api/ui/push-panel` adds a panel to a running dashboard, but only of an existing component type.

Open questions:

- Whether this is a real component API (the agent registers a renderer) or a panel type that hosts an HTML page with a data source bound to it. The second is much smaller and reuses the isolated frame `show_html` already uses.
- How a hosted page receives rows and reports clicks back.
- Where agent-supplied components live in the project, and whether they are trusted on reload.

### 2. Plan docs written by a chat agent do not open by themselves

The prompt tells every agent that a file written to `docs/plans/` opens for the user. That holds only for Claude Code in a terminal tab, where a hook posts each edited plan file to the viewer. A chat agent's `write_file` does not open the viewer. The agent has to call `view_file`, and no prompt module mentions that tool.

Either the write tools open plan docs for chat agents too, or the prompt says to call `view_file`. The prompt wording is recorded in [[../quick-fixes/chat-prompt-names-wrong-tools]].

Open questions:

- Which paths count. The terminal hook uses a per-project filter with a plans-only default. A chat-side rule should match it, not invent a second one.
- Whether an edit to a file already open should refocus the viewer or only reload it.
