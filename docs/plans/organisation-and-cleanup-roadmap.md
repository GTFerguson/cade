---
title: Organisation and Cleanup Roadmap
created: 2026-11-25
updated: 2026-11-26
status: partially-shipped
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
| 1 | Tab groups | Felt daily, and it settles where tab state lives |
| 2 | One project picker | Small, and the picker is where a tab group is chosen |
| 3 | Pull request monitoring | Builds on the tab and group badges from phase 1 |
| 4 | Organisational surfaces | Needs phases 1–3 to know what it is organising |
| 5 | Mobile experience | Follows the desktop model once it has settled |
| 6 | Cleanup and modernisation | Runs alongside; each item is independent |

## 1. Tab groups (was "workspaces above tabs")

Shipped 25 Nov 2026: see [[../technical/core/tab-groups]]. Left for later: key
chords for collapsing a group and for showing only one, and dragging a tab
onto a chip to change its group.

## 2. One project picker

Built 25 Nov 2026: `frontend/src/local/project-picker.ts` (view),
`picker-model.ts` (what is listed and how it is filtered), `backend/projects.py`
(projects and handoffs), `backend/terminal/session_agents.py` (per-tab agent).

One keyboard-driven picker on desktop, browser and phone in place of the native
folder dialog. The first screen lists the projects already open and recently
opened, then every folder under the main working folder (`CADE_PROJECTS_ROOT`,
default `~/projects`), most recently worked on first. `h` and `l` walk up and
down folders anywhere on disk. Enter chooses a folder as the project, which
shows a new session and its handoffs newest first; choosing a handoff opens a
tab whose agent starts by reading it. The agent (Claude Code or Codex) and the
tab group are shown at the top and switched with `a` and `g`. `/` filters or
takes a typed path. The system explorer is the last entry.

**Left.**

- The projects folder is set by an environment variable only; there is no
  setting for it in the interface or the user config file.
- "Last worked on" is read from the project folder, its visible top-level
  entries, git's index and reflog, and its handoffs. An edit deep in the tree
  that is never staged does not count.
- The design is not yet written into `docs/technical/` (needs approval).

## 3. Pull request monitoring

Step 1 shipped 25 Nov 2026: a badge on each tab for its branch's pull request, and the pull request in the strip above the terminal. See [[../technical/core/pull-requests]]. The list per workspace, notifications, and opening an agent on a pull request are in [[pr-monitoring]].

## 4. Organisational surfaces

Begun 26 Nov 2026 as the board (`Alt+b`): one screen per project with each ticket and the handoff, worktree, branch and pull request that carry it, plus the handoffs and worktrees no ticket claims. See [[../technical/core/board]]. The strip above each tab's terminal ([[../technical/core/pull-requests]]) is the same information for the tab in front.

**Still to do.**

- Ticket titles and statuses read live from the tracker; today they come from the project's hand-kept `docs/plans/work-board.md`. Needs credentials CADE does not have.
- A link from a running tab to its stream, for tabs opened on a project root instead of a worktree.
- Tickets and pull requests on the project picker's rows (mocked in `design/workspace-board-mock.html`).
- Removing finished worktrees: [[worktree-cleanup]].

**Open question.** The start splash, the remote project selector, the dashboard and the plans pane are still separate surfaces. Whether the board should absorb any of them is not decided.

## 5. Mobile experience

**The problem.** The phone shows a desktop terminal on a small screen: dense,
hard to read, and awkward to type into. With several projects running, most of
the time on the phone is spent finding the session that is blocked and
answering it.

**What it adds.**

- **Quick-draw mode.** A queue of the sessions that are blocked, permission
  prompts first, then agents waiting on a question, then finished turns. The
  screen shows one at a time: the tab name and group across the top, what
  the agent is asking, and the answer controls. Answering moves straight to
  the next one. Empty queue, empty screen.
- **One-tap permission answers.** A permission prompt becomes a card naming
  the tool and what it wants to do, with large buttons for the prompt's own
  choices (allow, allow always, deny). A button sends the same keystroke the
  terminal would take, so nothing new has to be trusted.
- **A reading view in place of the terminal.** The agent's last message and
  recent tool calls as wrapped text and collapsed blocks, built from the
  agent's own session transcript rather than from terminal output. The raw
  terminal stays one tap away for anything the reading view does not cover.
- The phone follows the desktop model for the rest: tab groups in the session
  strip, pull request state, the same picker.

**Key challenges.**

- The permission card needs the tool name and its input. Claude Code can
  supply both through a hook; Codex only retitles its terminal, so its prompt
  has to be read from the screen, which is fragile.
- The answer keys differ by agent and by prompt (two choices or three), so the
  buttons must come from the prompt actually shown, never a fixed layout: a
  wrong key on an approval is the one mistake this mode must not make.
- The reading view depends on each agent's transcript format, which neither
  agent promises to keep stable.
- An answer given on the phone must clear the prompt on the desktop tab too,
  and the reverse, without a stale card inviting a second answer.

**Integration points.** Attention state and push
(`backend/terminal/attention.py`), agent hooks (`backend/hooks/`), the session
strip and composer (`frontend/src/ui/mobile/`), transcript lookup
(`backend/cc_session_resolver.py`). The remaining items in
[[remote-access-overhaul]] (measurement on a device, chat parity, QR sign-in)
stay in that plan.

**Open questions.**

- Is the reading view the default on the phone, with the terminal as the
  fallback, or the other way round until it has proved itself?
- Should finished turns sit in the queue at all, or only sessions that are
  truly blocked?
- Does quick-draw belong on desktop too, as a "next blocked tab" key?

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

- The provider registry carries `cli` and `failover` branches although only
  `api` serves chat. `subprocess` and `websocket` are not dead: project-local
  `launch.yml` providers use them.
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
