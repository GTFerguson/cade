---
title: Plans
created: 2026-03-24
updated: 2026-11-25
status: active
tags: [index, plans]
---

# Plans

Intent before code exists. Plans are ephemeral — once the work ships and design knowledge graduates to architecture docs, the plan is deleted.

## Active Plans

| Plan | Status | Remaining work |
|------|--------|----------------|
| [[base-prompt-and-tooling]] | partially-shipped | Phase 2e: auto-trigger handoff on budget threshold |
| [[infrastructure/tool-support-and-failover]] | partially-shipped | Phase 2e: same as above |
| [[infrastructure/phase3-context-ui]] | partially-shipped | 3b (permissions), 3c (orchestration) |
| [[infrastructure/cli-coding-agent-adapters]] | shipped | All 5 phases complete; end-to-end testing with real Codex/Cursor installs outstanding |
| [[system-prompt/cade-agent-context]] | partially-shipped | Custom component API; 4 open questions |
| [[dashboard/agent-ui-system]] | partially-shipped | Phases 2–4; missing components |
| [[permissions/dynamic-permission-management]] | planning | All phases (foundation ready) |
| [[remote-access-overhaul]] | partially-shipped | Phases 1–4 shipped and graduated; device measurement, chat parity, QR, topology decision |
| [[infrastructure/seamless-upgrade]] | partially-shipped | Phases 1–3 shipped (exec-in-place, API, CLI, "update ready" marker in place of a reload, placed above the file tree); UX toasts, versioned install dirs, session host |
| [[organisation-and-cleanup-roadmap]] | partially-shipped | Workspaces, picker, pull request badge and strip, and the board shipped; live tracker data, tab-to-stream link, cleanup skill, mobile and modernisation remain |
| [[pr-monitoring]] | partially-shipped | Tab badge shipped; per-workspace list, notifications, open-agent-on-PR remain |
| [[worktree-cleanup]] | partially-shipped | Verdicts and listing shipped in the board; the cleanup skill and a visible count remain |
| [[right-pane-browser]] | planning | Phase 1: URL in the viewer frame |
| [[integrated-scout-browser]] | planning | Session awareness, live view, take-over, agent tools, remote |

## Deferred

| Plan | Notes |
|------|-------|
| [[dashboard/dashboard-schema-overhaul]] | ~40% features exist; layout/expressions/new components unbuilt |

## Design

Active designs and mockups: [[design/]].
