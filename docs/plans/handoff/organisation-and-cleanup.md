---
title: Organisation roadmap: workspaces, picker, pull request state and the board are shipped; next is the board on real data, Linear, and the cleanup skill
created: 2026-11-25
updated: 2026-11-26
status: in-flight
---

# Resume: get Gary's verdict on the board with his real tickets, then Linear access, the cleanup skill, and linking a tab to its stream

## Active plans

- **Roadmap**: `/home/gary/projects/cade/docs/plans/organisation-and-cleanup-roadmap.md` — phases 1 to 3 shipped or part-shipped; 4 has begun as the board
- **Pull request monitoring**: `/home/gary/projects/cade/docs/plans/pr-monitoring.md` — step 1 shipped; list, notifications and open-agent-on-PR remain
- **Worktree cleanup**: `/home/gary/projects/cade/docs/plans/worktree-cleanup.md` — verdicts shipped in the board; the skill and a visible count remain
- **Upgrades**: `/home/gary/projects/cade/docs/plans/infrastructure/seamless-upgrade.md` — what is left of in-place upgrade

Shipped work is documented, not here: `docs/technical/core/tab-groups.md` (workspaces), `project-picker.md`, `pull-requests.md` (badge and strip), `board.md`, `remote-sessions.md`; the watcher in `docs/architecture/components.md`; light-theme rules in `docs/technical/design/visual-design-philosophy.md`.

## Contract — how to use this file

This file is persistent working memory for one in-flight task. Procedure:

1. **Orient, then proceed on safe work** — read this file, then open with a one-sentence status plus a one-line preview of the next step or two. Proceed immediately with `[safe]` next-actions (reads, validators, local edits). Stop and confirm only for `[confirm]`-tagged steps or anything irreversible / externally visible (deploys, migrations, external API calls, branch operations). The handoff captures what the *writing* agent planned — the user can redirect if it's stale, but they don't want to grant permission for every safe step.
2. **Use as persistent reference while building** — update it as you go: tick off next-actions, add new gotchas, revise file lists. This is the single source of truth for "where is this work right now".
3. **Graduate on completion** — once the task ships, lift the durable knowledge out: design decisions → `docs/architecture/`, research findings → `docs/reference/`. Don't leave it stranded in here.
4. **Delete this file** — after graduation, `rm` the handoff. Its existence means work is still in the air; absence means done.

## Where we are

Everything built on 25 and 26 Nov is committed, pushed and installed (last install 26 Nov 12:48, HEAD `6f90cbae`). Gary's window needs the "update ready" marker clicked to load the newest interface; from this build on the marker sits at the top left, above the file tree.

In use and liked: workspaces (`Alt+w` / `Alt+Shift+w`, hold `Alt` for the list, `Ctrl+Alt+w` or a drag onto a chip to move a tab, `Alt+x` closes a tab), the strip above the terminal, quiet upgrades. Built and waiting for Gary's opinion: the board (`Alt+b`) with his real tickets, and the daylight theme fixes.

Not built: live Linear data, the cleanup skill, tickets and pull requests on the picker's rows (mock only, `docs/plans/design/workspace-board-mock.html`).

## Worktree / branch

- Path: `/home/gary/projects/cade` (main checkout)
- Branch: `main`, pushed. The repository is **public**.

## In flight (uncommitted work)

Nothing. Untracked files from other sessions, leave alone and never stage: `AGENTS.md`, `docs/plans/handoff/remote-access-iteration.md`, `docs/plans/padarax-gm-crossrefs.md`.

## Next actions (ordered)

1. Ask Gary how the board reads with his 62 real tickets. Expected complaints: the length of the In Progress list, and the number of filled red section bars. He rejected a first mock of it as "trashy", so iterate on what he says, in the picker's visual language. `[safe]`
2. Ask whether daylight is readable now, and whether he changed Claude Code's own theme (`/theme`; his was `dark-daltonized`, which is why agent output and the agent-drawn cursor were pale). `[safe]`
3. Linear: waits on Gary. CADE has no access; he would have to supply a personal API key somewhere CADE reads (`~/.cade/.env`). **Do not search for credentials**: a scan of env files was refused by the permission check. With a key, the board's statuses and titles come live instead of from `work-board.md`. `[confirm]`
4. Link a tab to its stream. Gary opens AirPLAi tabs on the project root (`~/projects/airplai`), not on a worktree, so the strip and badge show the root's branch. Options: a `ticket:` and `worktree:` field in handoff frontmatter (changes the AirPLAi workspace's own rules, ask first), or remembering which handoff a tab was opened from and reading the board's row for it. `[safe]` to design, `[confirm]` before touching AirPLAi's files.
5. The cleanup skill (`docs/plans/worktree-cleanup.md`): takes the board's "finished" worktrees, shows what it will remove, waits for a yes, uses only `git worktree remove` and `git branch -d`. 15 are finished on the AirPLAi project today. `[safe]` to write; running it is Gary's.
6. Keep the board warm in the background for projects with open tabs, if the 6 s full read still drags. `[safe]`
7. Pull request monitoring steps 2 to 4 (`pr-monitoring.md`). `[safe]`
8. Offered, not accepted yet: after an in-place upgrade every terminal has no controller, so any client that connects can resize it (this is how a diagnostic garbled Gary's tab). The window in control before the upgrade should keep control across it. `[safe]`
9. Tabs past the end of a crowded workspace are cut off (still reachable by key). Wants a real answer if Gary keeps many tabs in one workspace. `[safe]`

## Key design decisions

- **Workspaces**: one open at a time, which is the active tab's group; everything else is a chip. Nothing stores which are closed. The session on the backend owns its group.
- **A picker or board choice starts the agent** (`startAgent`, one-off) even though Gary's `~/.config/cade/behavior.toml` asks for idle shells; restored tabs still open a shell.
- **A handoff is handed to the agent as its path and nothing else.** "Resume the work" and "report and wait" were both rejected as over-steering.
- **The board reads the hand-kept `docs/plans/work-board.md`** for tickets and joins live git, GitHub and handoff state. Verdicts on worktrees are worked out in the backend.
- **GitHub is asked by branch**, one GraphQL request per repository, never by listing a repository's pull requests.
- **The watcher skips gitignored and ignored folders entirely**; Gary works from a parent folder with the clones beneath it and does not need them watched.
- **Light themes dim with colour, never opacity**, and the terminal enforces 4.5:1 on text.
- **Docs need no approval**: document what is built, in the same piece of work; plans are for before.
- **glann is retired.** Never deploy to it or raise it.

## Build & verify

```
cd /home/gary/projects/cade && .venv/bin/python -m pytest backend/tests -q -p no:cacheprovider
cd /home/gary/projects/cade/frontend && npx tsc --noEmit -p . && npx vitest run
cd /home/gary/projects/cade && PATH="$PWD/.venv/bin:$PATH" make install-desktop
```

Both suites green at `6f90cbae` (1,419 backend, 853 frontend). An install needs Gary's explicit go-ahead each time; the permission check blocks it otherwise.

## Gotchas encountered

- **Never attach a test client to one of Gary's live sessions.** A headless page attached to his tab resized its PTY and garbled it. Use a throwaway backend with its own home: `HOME=<scratch>/home .venv/bin/python -m backend.main serve --port <free> --host 127.0.0.1 --no-browser`, optionally `CADE_CLI_AGENT=<fake script>`. To repair a garbled agent screen, nudge its PTY one row and back with `stty -F /dev/pts/N rows R-1` then `rows R`.
- **Stage files by name.** A broad `git add docs` swept other sessions' untracked files into a pushed commit on this public repository, one holding a Tailscale hostname. History was left as it is at Gary's word.
- **The desktop window is not a browser.** Its page is served by the app shell, so use `apiBase()` for requests; its window buttons are drawn over the right end of the tab bar; it cannot be inspected. To reproduce it, serve `frontend/dist/shell.html` and load it headless with `__TAURI__` and `__BACKEND_URL__` set, against a throwaway backend. For anything else, have the page send `ws.sendDiagnostic(kind, detail)` and read `~/.cade/logs/cade.log`.
- **A slow first guess about slowness.** The board's 20 s was GitHub, not git; measure each phase before optimising.
- **Do not leave a task running with nothing to end it.** A read started on attach hung the test suite at shutdown; the monitor that starts a task must own and cancel it.
- **Do not remove or replace behaviour Gary did not ask to change**, and keep messages to him short: a long explanation of the hostname mistake got "wa da fok u on aou".
- **Do not install after every change**; batch, and say what the install carries.
- **Check that an install really upgraded**: look for "Upgrading in place" and "Resumed N session(s)" in the log, and probe something the new build has.
- The Vite dev server needs file watches; if the machine is out of them it dies with ENOSPC. `CHOKIDAR_USEPOLLING=true` gets round it, and the per-process count recipe is in the memory note on inotify.
- A puppeteer script must sit inside `frontend/` to resolve its modules; `captureBeyondViewport: false` stops a clipped screenshot firing a resize.
- Never kill by pattern from this shell; record the pid and kill that. `python` is not on PATH; use `.venv/bin/python`.
- Do not edit frontend files while a desktop build is running, and never `git stash` mid-session.
