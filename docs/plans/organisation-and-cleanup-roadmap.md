---
title: Organisation and Cleanup Roadmap
created: 2026-11-25
updated: 2026-11-27
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
| 1 | Workspaces | Felt daily, and it settles where tab state lives |
| 2 | One project picker | Small, and the picker is where a workspace is chosen |
| 3 | Pull request monitoring | Builds on the tab and workspace marks from phase 1 |
| 4 | Organisational surfaces | Needs phases 1–3 to know what it is organising |
| 5 | Mobile experience | Follows the desktop model once it has settled |
| 6 | Cleanup and modernisation | Runs alongside; each item is independent |

## 1. Workspaces (was "tab groups")

Shipped 25 and 26 Nov 2026: one workspace open at a time, keys to move between them and to carry a tab along, dragging a tab onto a chip. See [[../technical/core/tab-groups]].

## 2. One project picker

Shipped 25 Nov 2026: one keyboard-driven picker on desktop, browser and phone, with handoffs, the workspace and the agent chosen there. See [[../technical/core/project-picker]].

## 3. Pull request monitoring

Step 1 shipped 25 and 26 Nov 2026: a badge on each tab for its pull request, and a strip above the terminal with the tab's ticket, pull request, branch and handoff. See [[../technical/core/pull-requests]]. The list per workspace, notifications, and opening an agent on a pull request are in [[pr-monitoring]].

## 4. Organisational surfaces

Begun 26 Nov 2026 as the board (`Alt+b`): one screen per project listing its streams of work, each a handoff with the tickets, worktrees, branches and pull requests it carries, grouped by what each needs, plus the handoffs and worktrees no ticket claims. Ticket titles, statuses and parents are read from Linear when a key is set up. See [[../technical/core/board]]. The strip above each tab's terminal ([[../technical/core/pull-requests]]) shows the same for that tab's own stream.

**Still to do.**

- The board does not show which stream has a session running. A tab's stream is already worked out for its strip; the board does not use it.
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
  screen shows one at a time: the tab name and workspace across the top, what
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
- **Pull request state.** Shipped 27 Nov 2026: the session strip shows the
  active session's pull request mark and the command menu each session's in
  words. See [[../technical/core/frontend-architecture#MobileUI (`mobile.ts`)]].

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

**Decided (Gary, 27 Nov 2026).**

- Default view: undecided until both exist. Build the reading view, show it
  beside the terminal, and Gary picks.
- The queue holds finished turns too, after every blocked session: blocked
  ones are quicker to deal with, so they come first.
- Quick-draw is phone only for now. A desktop "next blocked tab" key is a
  conversation for much later.

## 6. Cleanup and modernisation

Found by a size and dependency survey on 2026-11-25, not a line-by-line audit.

**Oversized files to split by feature.** The largest in the survey, biggest first; each was over a thousand lines.

| File | Note |
|------|------|
| `frontend/styles/workspace/dashboard.css` | |
| `backend/websocket.py` | Every message handler in one class |
| `backend/main.py` | Every route in one function |
| `frontend/src/chat/chat-pane.ts` | |
| `frontend/src/main.ts` | |
| `frontend/src/tabs/project-context.ts` | |

**Other items.**

- The provider registry carries `cli` and `failover` branches although only
  `api` serves chat. `subprocess` and `websocket` are not dead: project-local
  `launch.yml` providers use them.
- Dependencies behind current: Vite 5, Vitest 2, marked 9, Milkdown 7.3.
- Three markdown stacks (marked, mertex.md, Milkdown); both jsdom and
  happy-dom installed, plus puppeteer.
- Python dependencies are listed in both `requirements.txt` and
  `pyproject.toml`.
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
