---
title: Pull Request and Work State on Tabs
created: 2026-11-25
updated: 2026-11-25
status: active
tags: [technical, backend, frontend, github, git, tabs, handoff]
---

# Pull Request and Work State on Tabs

How a tab shows where its work stands: the pull request for its branch as a badge on the tab, and a strip above its terminal with the pull request, the branch and what is pending on it, and the latest handoff. What is still planned is in [[../../plans/pr-monitoring]].

> [!NOTE]
> Built and tested, and checked against real `gh` output from a public repository. It had not yet run inside the installed app when this was written.

## Purpose

An agent in a tab opens a pull request and then the work leaves the window: checks run, reviews arrive and the branch falls behind on GitHub, where the tab cannot see it. The badge puts the one thing most worth knowing about that pull request on the tab.

It only reads. Nothing here changes a pull request; acting on one stays with the agent in the tab or with `gh`.

## How it works

```mermaid
graph LR
    M[PullRequestMonitor] -->|git: repo and branch| S[each live session]
    M -->|gh pr list, once per repo| G[GitHub]
    M -->|summary changed| P[session.pull_request]
    P -->|session-pr| T[tab badge]
```

`PullRequestMonitor` (`backend/pull_requests.py`) starts with the backend and loops:

1. For each live session, ask git which repository its project is in and which branch is checked out (`repo_and_branch`). A project outside a repository, or on a detached HEAD, has no pull request.
2. For each repository found, run `gh pr list` once (`open_pull_requests`), however many sessions share it, and key the open pull requests by head branch.
3. Give each session the summary for its branch, or `None`. A session whose summary changed tells its attached clients with a `session-pr` frame.

The summary (`summarise`) is `{ number, title, url, draft, checks, review, conflicts }`. `checks` reduces every check run and commit status to `failing`, `running` or `passing`; one failure outranks anything still running, since it will not pass as it stands. `review` is `approved`, `changes` or `required`. `conflicts` is true only when GitHub says the pull request conflicts with its base, not while it is still working that out.

The summary lives on the session (`PTYSession.pull_request`), like attention state, so every device attached to a session shows the same thing. It is sent once on attach and included in the session listing as `pullRequest`.

### On the tab

`frontend/src/tabs/pull-request.ts` reduces the summary to one state, worst first:

| State | Mark | When |
|---|---|---|
| conflicts | `≠` | Conflicts with its base |
| failing | `✗` | A check failed |
| changes | `✎` | Changes requested |
| running | `…` | Checks still running |
| approved | `✓` | Approved, nothing wrong |
| passing | none | Checks passed, not yet approved |
| open | none | Nothing else known |

The badge is the number and the mark, coloured by state (`PR_DISPLAY`, `.tab-pr` in `tabs.css`), and dimmed for a draft. Each state that needs attention has its own mark so the meaning does not rest on colour. The tooltip lists everything known, not only the state shown. Clicking opens the pull request in the browser through the shell (`openExternal`), without selecting the tab. `TabBar.setPullRequest` updates the tab in place, as a status change does.

## The strip above the terminal

Each tab has one line between the tab bar and its terminal (`ContextStrip`, `frontend/src/tabs/context-strip.ts`), mounted inside the terminal pane so it is as wide as the terminal and belongs to that tab. It has up to three cells, in this order:

| Cell | Says | Click |
|---|---|---|
| Pull request | Number, mark and state, then whatever the state leaves unsaid (draft, review required, and so on) | Opens it on GitHub |
| Branch | The branch, the number of uncommitted files, commits not yet pushed, or "clean" | |
| Handoff | The handoff most recently written for the project, and how long ago | Opens it in the viewer |

A cell appears only when there is something to put in it, and the strip is hidden when there are none, so a tab outside a repository with no handoffs looks as it did before. `stripCells` decides the cells and is tested without a DOM. When the line is too long for the pane the later cells give way with an ellipsis and the pull request keeps its room. The terminal refits itself when the strip appears or goes, through the resize observer it already has. The phone does not show it.

The branch and handoff come from `backend/session_context.py`, not from GitHub:

- `working_tree` runs `git status --porcelain=v2 --branch` once and reads the branch, the count of changed and untracked files, and how far the branch is ahead of its upstream. `unpushed` is `null` when the branch has no upstream, which is different from having nothing to push.
- `latest_handoff` is the newest brief in the project's `docs/plans/handoff/`, the list the project picker reads.
- `SessionContextMonitor` refreshes every `POLL_SECONDS` (30 s; the count of uncommitted files goes stale faster than anything on GitHub) and only for sessions with a client attached. A session is also read the moment a client attaches (`refresh_soon`), since what it held may predate a long absence. The result lives on `PTYSession.context` and travels as `session-context`.

The monitor owns every read it starts. A read begun on attach and left to run with nothing to end it hung the test suite at shutdown, which is why `refresh_soon` does nothing while the monitor is stopped and `stop` cancels what is outstanding.

A ticket cell is planned for when CADE can read Linear; see [[../../plans/pr-monitoring]].

## Design decisions

- **`gh`, not the GitHub API.** The user is already signed in to `gh`, so CADE stores no GitHub credentials of its own.
- **One call per repository.** Several tabs on one repository, or on worktrees of it, cost one request between them. A worktree is its own repository root to git, so each worktree is asked separately; that is correct, since each has its own branch.
- **Matched by branch on every poll.** A tab's branch can change under it, so nothing is remembered about which pull request a session "has".
- **A failed lookup changes nothing.** When `gh` cannot answer for a repository (signed out, no network, no GitHub remote), sessions there keep what they showed. A dropped connection is not a closed pull request.
- **Silent without `gh`.** If `gh` is not installed the monitor does not start and says so once in the log. There is no toast or prompt to sign in: a tab that never has a pull request should not hear about GitHub.
- **The newest pull request for a branch wins** when a branch has more than one open.

## Configuration

| Knob | Where | Default |
|---|---|---|
| Poll interval | `POLL_SECONDS` in `pull_requests.py` | 90 s |
| Interval while checks are running | `POLL_SECONDS_WHILE_RUNNING` | 20 s |
| Timeout for a `git` or `gh` call | `COMMAND_TIMEOUT_SECONDS` | 20 s |
| Open pull requests read per repository | `PR_LIMIT` | 100 |
| Working tree and handoff refresh | `POLL_SECONDS` in `session_context.py` | 30 s |

These are constants, not settings.

## Boundaries

- One GitHub account: whichever `gh` has active. Repositories that account cannot read show nothing.
- No notifications, no list of pull requests, no roll-up on a closed workspace chip, and no rate-limit check. Those are in the plan.
- A remote backend uses its own machine's `gh`, or shows nothing.
- The phone shows neither the badge nor the strip.

## See Also

- [[remote-sessions]] - sessions and how per-session state reaches clients
- [[tab-groups]] - workspaces and tab status marks
- [[../reference/websocket-protocol]] - `session-pr`, `session-context`
- [[project-picker]] - where handoffs are listed
