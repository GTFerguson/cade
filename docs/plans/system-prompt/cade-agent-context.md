---
title: CADE Agent Context — System Prompt Affordances
created: 2026-04-23
status: planning
tags: [agent, system-prompt, ux, dashboard, context]
---

# CADE Agent Context

The CADE system prompt must tell the agent what makes CADE different from a generic IDE or terminal. An agent unaware of these affordances will default to chat responses when better surfaces exist, and miss interaction patterns unique to the environment.

## Core Principle

The agent is not running in a terminal. It is running inside CADE — a purpose-built environment with output channels, interactive surfaces, and UX conventions that a generic Claude Code agent knows nothing about. The system prompt's job is to make these first-class.

## CADE-Specific Affordances the Agent Must Know

### 1. The Dashboard is an Interactive Surface

`.cade/dashboard.yml` is a live, hot-reloading configuration file. When the agent writes to it, the user sees the result immediately — no reload, no build step.

The agent can:
- **Add panels and views** to surface information in structured form (tables, cards, kanban, gauges, key-value)
- **Build new generic components** when existing component types don't fit the need — the dashboard is extensible, not fixed
- **Create interactive elements** — the dashboard is not read-only output; it can serve as a real interaction surface between agent and user

This makes the dashboard a unique output channel. Instead of dumping structured data into chat, the agent should route it to an appropriate dashboard view. Instead of describing a kanban board of tasks, it should write one.

**When to use it:** Structured data, progress tracking, multi-item status, anything the user will want to refer back to or interact with rather than read once.

### 2. Plan Docs Auto-Open for the User

Files created in `docs/plans/` are automatically opened and rendered for the user as structured markdown. This is a first-class output channel for anything that is too long, too structured, or too valuable to put in a chat response.

The agent should use `docs/plans/` when:
- The response would be a wall of text in chat
- The content has headings, tables, code blocks, or cross-references that benefit from rendering
- The user will want to navigate, edit, or refer back to the output
- The work is a plan, analysis, or structured document rather than a direct answer

**Preference rule:** If a response would exceed a few paragraphs, or if it has document-like structure, write it to `docs/plans/` and tell the user where to find it. Don't apologise for not putting it in chat — this is the better experience.

### 3. The Dashboard Can Be Built On Demand

The agent is not limited to the components currently defined in `dashboard.yml`. If a need arises that no existing component satisfies — a custom visualisation, a new interaction pattern, a project-specific panel — the agent can design and implement a new generic component.

This means the dashboard is not a constraint. The agent should think of it as: "what is the right surface for this information?" and build toward that answer, rather than fitting output into whatever already exists.

## Output Channel Decision Tree

When the agent has information to communicate:

```
Is it a direct answer to a question?
  → Chat response

Is it structured data (table, list, status, metrics)?
  → Dashboard panel

Is it a document (plan, analysis, long-form, multi-section)?
  → docs/plans/ (auto-opens for user)

Is it a completed reference or architecture record?
  → docs/reference/ or docs/technical/ (with user approval)
```

## What This Enables

These affordances make CADE's UX qualitatively different from a generic IDE agent:

- **Agent-built dashboards** — the agent assembles views appropriate to the current work, not a fixed layout the user configured upfront
- **Structured handoff** — long outputs land in rendered documents the user can navigate, not chat walls
- **Interactive collaboration** — the dashboard is a shared space the agent and user both work with, not just a status display

## Open Questions

- What is the trigger for a plans doc auto-opening? File creation, or explicit signal from the agent?
- Should the agent be able to write directly to a running dashboard session, or only via config file?
- Is there a component API the agent can call, or does it always go through `dashboard.yml`?
- How does the agent signal "I wrote this to plans/" in chat — automatic notification, or explicit mention?
