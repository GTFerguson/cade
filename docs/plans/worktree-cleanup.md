---
title: Worktree and Branch Cleanup
created: 2026-11-25
updated: 2026-11-25
status: planning
tags: [plan, git, worktrees, github, skills]
---

# Worktree and Branch Cleanup

Part of [[organisation-and-cleanup-roadmap]]. Nothing is built yet. It shares the pull request poller described in [[../technical/core/pull-requests]].

## Context

Each stream of work gets its own worktree and branch, an agent opens a pull request from it, the pull request merges, and the worktree stays. Nothing shows which ones are finished, so they are never removed.

Measured on 25 Nov 2026 in the main work repository (`gh` and `git`, read-only):

| | |
|---|---|
| Worktrees of the repository | 67 |
| Size of the folder holding them and nine other clones | 96 GB |
| Branch has a merged pull request | 18 |
| Branch has an open pull request | 3 |
| Branch has a closed, unmerged pull request | 2 |
| No pull request found among the newest 400 | 44 |
| Worktrees with uncommitted changes | 14 |
| Local branches with no worktree | 5 |

So about a quarter could probably go today, and telling which by hand means checking each one's pull request, working tree and unpushed commits.

## What it adds

Tracking in CADE, cleaning by an agent. CADE never deletes a worktree or a branch itself.

1. **A worktree list per repository**: each worktree with its branch, its pull request and state, whether it has uncommitted changes or commits not on the remote, whether a session is running in it, and when it was last worked on.
2. **A verdict on each**, worked out the same way every time:

   | Verdict | Means |
   |---|---|
   | Finished | Pull request merged, branch has nothing beyond what was merged, working tree clean, no session running |
   | Merged, but | Pull request merged and something local would be lost: uncommitted changes, or commits made after the merge |
   | In review | Pull request open |
   | Abandoned? | Pull request closed without merging |
   | Local only | No pull request |

3. **A count where it will be seen**: how many are finished, on the workspace chip or the picker, so the backlog is visible without opening the list.
4. **A cleanup skill**: an agent skill that takes the finished ones, shows exactly what it will remove, waits for a yes, removes each worktree and its local branch, and reports what it left and why. CADE offers "clean up finished worktrees" as an action that opens a tab running the skill on the selection.

## Key challenges

- **"Merged" cannot be read from git alone.** A squash merge leaves the branch's commits outside the base branch, so an ancestry test misses it: 22 branch tips here are inside `origin/main`, against 18 merged pull requests, and the two sets differ. The pull request's own state is the signal, matched to the branch by name and checked against its head commit so that work added after the merge is noticed.
- **Losing work.** The verdict has to be conservative: anything uncommitted, unpushed or newer than the merge keeps a worktree out of "finished". The skill uses `git worktree remove` and `git branch -d`, which refuse on their own in those cases, and never their forcing forms.
- **Old pull requests.** `gh pr list` returns the newest first up to a limit; a branch whose pull request merged long ago falls outside it. Those need a lookup by branch name, done only for worktrees with no match.
- **Cost of looking.** Sixty-odd worktrees each need a `git status`. That is a list opened on request and refreshed in the background, not a poll every minute.
- **Things that point at a worktree.** A handoff or a work board row may name the worktree. The skill should report those links; whether it edits them is a decision for the workspace that owns them.
- **Remote branches.** Deleting the branch on GitHub is a write to a shared repository. Out of scope for the first version; most repositories delete it on merge anyway.

## Integration points

- `backend/pull_requests.py`: already asks `gh` for pull requests per repository; needs merged and closed ones as well as open, and the head commit.
- `backend/projects.py` and the project picker ([[../technical/core/project-picker]]): where projects and their handoffs are listed today.
- Workspace chips ([[../technical/core/tab-groups]]): where a count could sit.
- `~/.claude/skills/`: where the cleanup skill would live, beside `handoff`.

## Open questions

- Where does the list live: a section of the picker, its own pane, or the same board as tickets and pull requests if the Linear work goes ahead? One board of "ticket, handoff, worktree, pull request, state" would cover all three.
- Should the skill also remove the remote branch when the pull request is merged, with its own confirmation?
- Is disk size worth showing per worktree? It is the reason to clean, and slow to measure.
- Which repositories: every repository with a session open, or every repository under the projects root?
