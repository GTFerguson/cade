---
title: Pull Request Monitoring
created: 2026-11-25
updated: 2026-11-25
status: planning
tags: [plan, github, tabs, notifications]
---

# Pull Request Monitoring

Phase 3 of [[organisation-and-cleanup-roadmap]]. Step 1 (the tab badge) is built; steps 2 to 4 are not.

## Context

Agents in CADE tabs open pull requests and then the work leaves the window:
checks run, reviews arrive and branches fall behind on github.com, and the tab
that produced the pull request shows none of it. Finding out means leaving CADE
or asking the agent to look. With several tabs per tab group, each on its own
branch, the question "which of these is waiting on me" has no answer in the
interface.

## What it adds

Read-only to start. CADE shows the state of pull requests and never changes
them; acting on one stays with the agent in the tab or with `gh`.

1. **A badge on each tab** for the pull request of that tab's branch: checks
   (passing, failing, running), review (approved, changes requested, review
   requested) and whether it conflicts with its base. No pull request, no badge.
2. **A list per tab group** of open pull requests across the group's projects:
   mine, and those waiting on my review.
3. **Notifications** through the existing attention and push path when checks
   fail, a review is requested from me, or a pull request of mine is approved or
   has changes requested.
4. **A key to open an agent tab on a pull request**, checked out, with the
   failing check or the review comments as the opening prompt.

The order above is the build order. Each step is usable without the next.

## Step 1: shipped

The tab badge is built (`17aa85bc`, 25 Nov 2026) and documented in [[../technical/core/pull-requests]]. Still to do from this step: a look at it in the installed app, the rate-limit check (`gh api rate_limit`), and a setting for the interval.

## Key challenges

- **GitHub accounts.** Checked 25 Nov 2026: `gh` on this machine is signed in to one account, `GTFerguson`, and that account can read the work organisation's repositories (it listed open and merged pull requests there). So one account covers both work and personal repositories, and nothing has to choose between accounts. If a repository ever needs a second `gh` account, the poller must name the account per repository instead of switching the active one under the agents that also use `gh`.
- **A branch is not a pull request.** A tab's branch can change under it, a
  pull request can come from a fork, and several tabs can share a repository on
  different branches (worktrees). Matching is by repository and head branch,
  re-read on every poll.
- **Remote backends.** A backend on a server has its own `gh`, or none. The
  badge follows whatever that machine can see.
- **Notification noise.** A check that fails, is re-run and fails again is one
  event, not three. Notify on a change of state, and only for pull requests that
  are mine or ask for my review.

## Integration points

- `backend/terminal/attention.py`: the model for per-session state that is
  broadcast to attached clients and can raise a push notification.
- `backend/push.py`: push delivery to the phone.
- `frontend/src/tabs/tab-bar.ts`: tab status glyphs and the tab group chip's
  rolled-up status, where the badge and the group's count belong.
- `core/backend/dashboard/` and `frontend/src/dashboard/`: cards and tables for
  the per-group list in step 2.
- [[../technical/core/tab-groups]]: which projects a group covers.

## Open questions

- Is polling enough, or are webhooks through a relay worth their setup for
  faster notifications?
- Should the badge show on a tab whose branch has a pull request that is not
  mine (a colleague's branch checked out for review)?
- When do actions (re-run checks, request review, merge) come in, if ever? They
  would need their own confirmation step.
