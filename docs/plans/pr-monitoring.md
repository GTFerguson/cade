---
title: Pull Request Monitoring
created: 2026-11-25
updated: 2026-11-26
status: partially-shipped
tags: [plan, github, tabs, notifications]
---

# Pull Request Monitoring

Phase 3 of [[organisation-and-cleanup-roadmap]]. Step 1 is built: a badge on each tab and a strip above its terminal, both following the tab's own stream where that is known. Steps 2 to 4 are not.

## Context

Agents in CADE tabs open pull requests and then the work leaves the window:
checks run, reviews arrive and branches fall behind on github.com. A tab now
shows its own pull request, and the board's "Needs you" section answers "which
of these is waiting on me" for one project ([[../technical/core/board]]).

Still missing:

- The same answer across all the projects of a workspace, without opening each
  project's board.
- Pull requests that ask for my review. The badge and the board only know the
  branches checked out here.
- Being told when something changes. Today it has to be looked at.

## What it adds

Read-only to start. CADE shows the state of pull requests and never changes
them; acting on one stays with the agent in the tab or with `gh`.

1. **A badge on each tab** for its pull request. Shipped; see below.
2. **A list per workspace** of open pull requests across the workspace's
   projects: mine, and those waiting on my review.
3. **Notifications** through the existing attention and push path when checks
   fail, a review is requested from me, or a pull request of mine is approved or
   has changes requested.
4. **A key to open an agent tab on a pull request**, checked out, with the
   failing check or the review comments as the opening prompt.

The order above is the build order. Each step is usable without the next.

## Step 1: shipped

The tab badge (`17aa85bc`) and the strip that follows each tab's stream (`fb2ca188`) are built and documented in [[../technical/core/pull-requests]]. Still to do from this step:

- Check what each tab's badge and strip show in the installed app against what they should show.
- The rate-limit check (`gh api rate_limit`).
- A setting for the poll interval, which is a constant today.

## Key challenges

- **GitHub accounts.** One `gh` account reads both work and personal repositories today, and the active account is never switched ([[../technical/core/pull-requests#Design decisions]]). A list across a workspace's projects has to keep to that.
- **A branch is not a pull request.** A tab's branch can change under it, a
  pull request can come from a fork, and several tabs can share a repository on
  different branches (worktrees). How the badge and the strip match a tab to
  its pull request is in [[../technical/core/pull-requests]].
- **Remote backends.** A backend on a server has its own `gh`, or none. The
  list and the notifications follow whatever that machine can see, as the
  badge does.
- **Notification noise.** A check that fails, is re-run and fails again is one
  event, not three. Notify on a change of state, and only for pull requests that
  are mine or ask for my review.

## Integration points

- `backend/terminal/attention.py`: the model for per-session state that is
  broadcast to attached clients and can raise a push notification.
- `backend/push.py`: push delivery to the phone.
- `frontend/src/tabs/tab-bar.ts`: the workspace chip's rolled-up status, where
  a workspace's count belongs. The chip rolls up attention states only today.
- `backend/board.py` and `frontend/src/board/`: already ask GitHub about a
  project's checked-out branches and list its streams with their pull
  requests. One candidate home for the list in step 2.
- `core/backend/dashboard/` and `frontend/src/dashboard/`: cards and tables,
  the other candidate.
- [[../technical/core/tab-groups]]: which projects a workspace covers.

## Open questions

- Is polling enough, or are webhooks through a relay worth their setup for
  faster notifications?
- The badge shows any open pull request on the tab's branch, whoever opened it,
  so a colleague's branch checked out for review gets one. Should it stay that
  way, be marked as not mine, or be left out?
- When do actions (re-run checks, request review, merge) come in, if ever? They
  would need their own confirmation step.
