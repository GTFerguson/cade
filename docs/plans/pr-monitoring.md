---
title: Pull Request Monitoring
created: 2026-11-25
updated: 2026-11-25
status: planning
tags: [plan, github, tabs, notifications]
---

# Pull Request Monitoring

Phase 3 of [[organisation-and-cleanup-roadmap]]. Nothing is built yet.

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

## How the first step works

A backend poller asks the `gh` CLI, which is already signed in on the machine,
so CADE stores no GitHub credentials of its own.

- **What is polled.** One call per repository that has a session open, not one
  per tab: `gh pr list --json` for the repository returns every open pull
  request with its head branch, checks, review decision and mergeable state,
  and each session is matched to a pull request by its current branch.
- **How often.** Slowly by default, faster for a pull request whose checks are
  still running, and not at all for a repository with no session. The interval
  is a setting. GitHub's GraphQL API, which `gh pr list` uses, allows a signed-in
  user 5,000 points an hour (GitHub Docs, "Rate limits and query limits for the
  GraphQL API"); a handful of repositories polled once a minute is a small share
  of that, and the poller reads `gh api rate_limit` rather than assuming.
- **Where it goes.** The session holds its pull request state, as it holds its
  attention state, and the state travels the same way: in the `connected`
  message and in a frame sent when it changes. The tab bar draws it beside the
  agent status.
- **When `gh` is missing or signed out.** No badge and one line in the log. No
  toast, no prompt to sign in: a tab that never has a pull request should not
  hear about GitHub at all.

## Key challenges

- **Two GitHub accounts.** The work (AirPLAi) repositories belong to a
  separate work account; personal ones to `GTFerguson`. On this machine `gh`
  is signed in to `GTFerguson` only, which owns 24 of the 25 repositories under
  `~/projects`. `gh` holds several accounts with one active at a time, so the
  poller must name the account per repository instead of switching the active
  one under the agents that also use `gh`.
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

- The work account needs `gh auth login` on this machine before its
  repositories can be polled. How is a repository mapped to an account: by the
  owner in its remote URL, or by tab group?
- Is polling enough, or are webhooks through a relay worth their setup for
  faster notifications?
- Should the badge show on a tab whose branch has a pull request that is not
  mine (a colleague's branch checked out for review)?
- When do actions (re-run checks, request review, merge) come in, if ever? They
  would need their own confirmation step.
