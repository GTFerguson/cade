---
title: Plans
created: 2026-03-24
updated: 2026-11-26
status: active
tags: [index, plans]
---

# Plans

Intent before code exists. A plan holds only what is not built yet: once something ships, its design moves to `docs/technical/` or `docs/architecture/` and the plan shrinks, and a plan with nothing left is deleted.

Every plan here was checked against the code on 26 November 2026.

## Active Plans

| Plan | Status | Remaining work |
|------|--------|----------------|
| [[organisation-and-cleanup-roadmap]] | partially-shipped | Workspaces, the picker, the pull request badge and strip, the board and live tracker data are shipped. Left: the board showing which stream has a session running, tickets and pull requests on the picker's rows, the cleanup skill, pull request state on the phone, modernisation |
| [[pr-monitoring]] | partially-shipped | A list per workspace, notifications, a key to open an agent on a pull request |
| [[worktree-cleanup]] | partially-shipped | Whether a session is running in a worktree and when it was last worked on, a count shown outside the board, the cleanup skill |
| [[infrastructure/seamless-upgrade]] | partially-shipped | Upgrade state in the interface, keeping the size controller across an upgrade, a one-folder build in versioned install directories, a test of open descriptors. Deferred: session-host daemon, remote deployments |
| [[infrastructure/cli-coding-agent-adapters]] | partially-shipped | Named agents in a config file, `.cade/launch.yml` choosing the agent, session resolution for agents other than Claude Code |
| [[infrastructure/tool-support-and-failover]] | partially-shipped | Compact automatically when the context budget is crossed, which needs a context figure per turn first |
| [[remote-access-overhaul]] | partially-shipped | Device measurement, chat on the phone, QR sign-in, a "take control" action, writing up the route in use once it is confirmed |
| [[dashboard/agent-ui-system]] | partially-shipped | Score-radar component, rendering for fields the schema accepts and the screen ignores, agent callbacks and workflows started from a dashboard, config-generation helpers |
| [[system-prompt/cade-agent-context]] | planning | Dashboard components added at run time, plan docs opening for chat agents as they do for the terminal |
| [[permissions/dynamic-permission-management]] | planning | All of it: honouring and saving Claude Code's allow rules for the chat agent's own prompts. Approval for the session exists |
| [[right-pane-browser]] | planning | A URL in the viewer frame |
| [[integrated-scout-browser]] | planning | Session awareness, live view, take-over, agent tools |

## Deferred

| Plan | Notes |
|------|-------|
| [[dashboard/dashboard-schema-overhaul]] | Not started: layout objects, actions, visibility expressions, new source and component types |

## Quick fixes

Known defects with evidence and a fix direction, not yet fixed: [[quick-fixes/README|quick-fixes]].

## Handoffs

Working state for streams in flight is in `handoff/`. A handoff is deleted when its work is done.

## Design

Mockups: [[design/README|design]].
