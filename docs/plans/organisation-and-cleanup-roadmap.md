---
title: Organisation and Cleanup Roadmap
created: 2026-11-25
updated: 2026-11-25
status: planning
tags: [plan, roadmap, tabs, workspaces, github, mobile, cleanup]
---

# Organisation and Cleanup Roadmap

A roadmap for the next round of work: a tier above tabs, the surfaces that sit
above a single session, pull request monitoring, the mobile experience, and a
cleanup and modernisation pass. Each phase becomes its own plan doc when work
on it starts; until then this doc holds the intent.

## Context

CADE is now used almost entirely as a host for Claude Code and Codex running in
terminal tabs. Day to day that means several tabs for work (AirPLAi) open next
to several for personal projects, in one flat tab bar. The surfaces above a
single session (picking a project, finding a running session, seeing what needs
attention) grew one feature at a time and differ between desktop, browser and
phone. Code is rarely read or written by hand any more, so what the interface
is for has shifted towards visibility: what each agent is doing, what changed,
what is waiting.

## Phases

| # | Phase | Why this order |
|---|-------|----------------|
| 1 | Workspaces above tabs | Felt daily, and it settles where tab state lives |
| 2 | One project picker | Small, and the picker is where a workspace is chosen |
| 3 | Pull request monitoring | Builds on the tab and workspace badges from phase 1 |
| 4 | Organisational surfaces | Needs phases 1–3 to know what it is organising |
| 5 | Mobile experience | Follows the desktop model once it has settled |
| 6 | Cleanup and modernisation | Runs alongside; each item is independent |

## 1. Workspaces above tabs

**What it adds.** A workspace is a named group of tabs. The tab bar shows the
active workspace's tabs only. Switching workspace is one key chord. Sessions in
other workspaces keep running, and their status (working, needs input, done)
rolls up to a badge on the workspace so a waiting agent is never hidden.

**Key challenges.**

- Tabs live in browser storage (`cade-app-state`, `frontend/src/tabs/tab-manager.ts`)
  while sessions live on the backend. A grouping kept only in the browser is
  lost when storage is cleared and is invisible to the phone.
- A tab adopted from another device (`adoptSession`) needs a workspace too.
- Rolling attention up must not turn into noise: a workspace with five idle
  "done" tabs should not look like one that needs input.

**Integration points.** `TabInfo` / `AppState` (`frontend/src/tabs/types.ts`),
the tab bar, `PTYSession` and the session listing
(`backend/terminal/session_listing.py`), the attention state
(`backend/terminal/attention.py`), the phone's session strip.

**Open questions.**

- Does the workspace belong to the session on the backend (my recommendation,
  so every device agrees), with only tab order kept per browser?
- Are tabs assigned by a path rule (everything under one folder is AirPLAi),
  by hand, or both?
- Is a workspace only a filter on the tab bar, or does it also carry settings
  such as a default project folder, theme accent, or GitHub account?

## 2. One project picker

**What it adds.** The keyboard-driven picker used in the browser
(`frontend/src/local/LocalProjectSelector.ts`) replaces the native folder
dialog on desktop (`pickProjectFolder`, called from `frontend/src/main.ts`).
It lists the projects already open first, so opening a second tab on the same
project is two key presses, then the project folder listing below.

**Improvements to make while unifying it.**

- Recently used projects, not only the currently open ones.
- Type-to-filter, using the fuzzy matcher the phone already has
  (`frontend/src/ui/mobile/fuzzy.ts`).
- Choose the agent (Claude Code, Codex) and the workspace at the point of
  opening.
- Live sessions that have no tab on this device, so attaching is part of the
  same picker instead of a separate splash option.
- Its own styles: it currently borrows the remote selector's class names.

**Open questions.** Should the native dialog stay reachable for folders outside
the usual project roots, or is path entry in the picker enough?

## 3. Pull request monitoring

**What it adds.**

- On each tab, the state of the pull request for that tab's branch: checks,
  review state, conflicts with base.
- Per workspace, a panel of open pull requests: mine, and those waiting on my
  review.
- Notifications through the existing attention and push path when checks fail,
  a review is requested, or a pull request is approved.
- A key to open an agent tab on a pull request (checked out, with the review
  comments or failing check as the opening prompt).

**Key challenges.**

- No GitHub integration exists today. The cheapest source is the `gh` CLI the
  user is already signed in to; polling has to stay inside rate limits across
  many repos.
- Work and personal repos may sit under different GitHub accounts.
- A remote backend has its own credentials, or none.

**Integration points.** A new backend poller; a dashboard data source so the
panel reuses the existing cards and table components
(`core/backend/dashboard/`, `frontend/src/dashboard/`); tab badges from phase 1.

**Open questions.** Poll, or receive webhooks through a relay? Is read-only
enough to start, with actions (re-run checks, request review) later?

## 4. Organisational surfaces

**What it adds.** One coherent top level in place of today's separate pieces:
the start splash with its attach options, the local and remote project
selectors, the dashboard, and the plans pane.

**Open questions.** Which of these are the ones that feel broken, and what
should the top level answer first: "what needs me", "what is running", or
"what changed"? This phase is not scoped until that is answered.

## 5. Mobile experience

**What it adds.** The phone follows the desktop model: workspaces in the
session strip, pull request state, the same picker.

**Integration points.** The remaining items in [[remote-access-overhaul]]
(measurement on a device, chat parity, QR sign-in) stay in that plan; this
phase covers what phases 1–4 change for the phone.

**Open questions.** What is wrong with the phone today in daily use? No
specific complaints are recorded yet.

## 6. Cleanup and modernisation

Found by a size and dependency survey on 2026-11-25, not a line-by-line audit.

**Oversized files to split by feature.**

| File | Lines | Note |
|------|-------|------|
| `frontend/styles/workspace/dashboard.css` | 2,892 | |
| `backend/websocket.py` | 2,511 | 30 message handlers in one class |
| `backend/main.py` | 2,060 | 46 routes in one function |
| `frontend/src/chat/chat-pane.ts` | 1,879 | |
| `frontend/src/main.ts` | 1,370 | |
| `frontend/src/tabs/project-context.ts` | 1,105 | |

**Other items.**

- The provider registry still carries `cli`, `failover`, `subprocess` and
  `websocket` branches although only `api` serves chat.
- Dependencies behind current: Vite 5, Vitest 2, marked 9, Milkdown 7.3.
- Three markdown stacks (marked, mertex.md, Milkdown); both jsdom and
  happy-dom installed, plus puppeteer.
- Python dependencies are listed in both `requirements.txt` and
  `pyproject.toml`.
- Six backend tests fail on `main` (chat-handler compact ×2, config loading,
  memory graph ×2, nkrdn paths) and one MCP adapter test fails only in a full
  run.
- `docs/plans/` has a stale `readme.md` beside `README.md`, describing
  subdirectories that no longer exist; mockups are split between `mockups/`
  and `docs/plans/`.
- The desktop loader replaces the document, which drops listeners the shell
  installed. Zoom and window dragging are restored in
  `frontend/src/platform/shell-listeners.ts`; anything else the shell injects
  needs the same check.

**Kept deliberately.** The Neovim pane stays. It is unused today, but it is the
place for direct visibility into code and has integration potential.

**Open questions.** Is the built-in chat pane and its LiteLLM stack (modes,
permissions, orchestrator) still used directly? It is the largest body of code
outside the terminal path, and it also powers agent delegation, so nothing
there is removed without a decision.
