---
title: Worktree and Branch Cleanup
created: 2026-11-25
updated: 2026-11-26
status: partially-shipped
tags: [plan, git, worktrees, github, skills]
---

# Worktree and Branch Cleanup

Part of [[organisation-and-cleanup-roadmap]]. The tracking half is built into the board. Still to build: two facts the worktree list lacks, a check for a running session, a count where it will be seen, and the cleanup skill.

## Context

Each stream of work gets its own worktree and branch, an agent opens a pull request from it, the pull request merges, and the worktree stays. Until the board, nothing showed which ones were finished, and nothing removes them yet.

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

So about a quarter could probably go, and telling which by hand means checking each one's pull request, working tree and unpushed commits.

A merge cannot be read from git alone. In the same repository 22 branch tips were inside `origin/main` against 18 merged pull requests, and the two sets differed, because a squash merge leaves the branch's commits outside the base branch. The board goes by the pull request's own state, and the skill must too.

## Built

The board (`Alt+b`) lists every worktree of a project and of the clones under its `repos/` folder, with its branch, pull request, uncommitted files and unpushed commits. It gives each a verdict: finished, merged holds work, in review, closed, or no pull request. How a verdict is reached, how GitHub is asked by branch so that a pull request merged long ago is still found, and what a read costs are in [[../technical/core/board#Worktrees and their verdicts]].

## What is left

Tracking in CADE, cleaning by an agent. CADE never deletes a worktree or a branch itself.

1. **Two more facts on each worktree**: whether a session is running in it, and when it was last worked on.
2. **A "finished" that knows about sessions.** The verdict looks at the pull request, the commits and the working tree. A worktree with an agent running in it can still be called finished. The verdict has to rule that out, or the skill has to check before it removes anything.
3. **A count where it will be seen**: how many are finished, on the workspace chip or the picker, so the backlog is visible without opening the board. Today the count is on the board's own top line and nowhere else.
4. **A cleanup skill**: an agent skill that takes the finished ones, shows exactly what it will remove, waits for a yes, removes each worktree and its local branch, and reports what it left and why. CADE offers "clean up finished worktrees" as an action that opens a tab running the skill on the selection.

## Key challenges

- **Losing work.** The board's "finished" is strict: anything uncommitted, or newer than what merged, keeps a worktree out of it. The skill is a second guard. It uses `git worktree remove` and `git branch -d`, which refuse on their own in those cases, and never their forcing forms.
- **Which session is in which worktree.** A tab is often opened on the project root while its agent works in a worktree beneath it, so the tab's folder is not enough. `backend/session_context.py` works out a tab's stream, and that stream's worktree, for the strip above the terminal. A tab whose handoff cannot be worked out has no known worktree.
- **A count needs a full read.** Verdicts come only from the board's full read, which runs `git status` in every worktree. The lighter read the strip uses gives none. A count shown outside the board therefore needs the full read done in the background, for projects whose board nobody has opened.
- **Things that point at a worktree.** A handoff or a work board row may name the worktree. The skill should report those links; whether it edits them is a decision for the workspace that owns them.
- **Remote branches.** Deleting the branch on GitHub is a write to a shared repository. Out of scope for the first version; most repositories delete it on merge anyway.

## Integration points

- `backend/board.py`: the worktree list and `verdict`. The missing facts and the session check belong here, so that the board, the count and the skill agree on what "finished" means.
- `backend/session_context.py`: which stream and worktree a tab is on.
- `backend/projects.py` and the project picker ([[../technical/core/project-picker]]): one place a count could sit, on a project's row.
- Workspace chips ([[../technical/core/tab-groups]]): the other place a count could sit.
- `~/.claude/skills/`: where the cleanup skill would live, beside `handoff`.

## Open questions

- Should the skill also remove the remote branch when the pull request is merged, with its own confirmation?
- Is disk size worth showing per worktree? It is the reason to clean, and slow to measure.
