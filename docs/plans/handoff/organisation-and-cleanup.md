---
title: Organisation roadmap: workspaces, picker, per-tab strip, the board and Linear are shipped; next is an install carrying the handshake fix, then the cleanup skill
created: 2026-11-25
updated: 2026-11-26
status: in-flight
---

# Resume: install the handshake fix when Gary says, check the per-tab strip in the real app, then the cleanup skill

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

Everything through `7c079e1a` is committed, pushed and installed (26 Nov 17:03): the rebuilt board, live Linear data, the workspace list that slides in at the right, the strip that follows each tab's own stream, and the efficiency pass. No errors in `~/.cade/logs/cade.log` since that install. What that install was meant to be followed by, and was not: looking at what each tab's strip reports in the real app, and the installed backend's process counts.

Committed and pushed after it, **not installed**: the handshake fix (`docs/technical/core/remote-sessions.md`, "Handshake"). After an upgrade the backend gave up on slow tabs after two seconds, attached them to a fresh shell in the home folder and told them "no group", which is what kept emptying the AirPLAi workspace and making sessions look killed.

In use and liked: workspaces (`Alt+w` / `Alt+Shift+w`, hold `Alt` for the list, `Ctrl+Alt+w` or a drag onto a chip to move a tab, `Alt+x` closes a tab), the strip above the terminal, quiet upgrades. Built and waiting for Gary's opinion: the rebuilt board (`Alt+b`) and the daylight theme fixes.

Not built: the cleanup skill, tickets and pull requests on the picker's rows (mock only, `docs/plans/design/workspace-board-mock.html`).

One session is running with no tab: `2f56e385` "Clean up handoffs" (AirPLAi, Codex). Its tab was one of the stuck ones and was closed while it was attached to nothing, so the close never reached the session. Gary's to reattach or end.

## Worktree / branch

- Path: `/home/gary/projects/cade` (main checkout)
- Branch: `main`, pushed. The repository is **public**.

## In flight (uncommitted work)

Nothing. Untracked files from other sessions, leave alone and never stage: `AGENTS.md`, `docs/plans/handoff/remote-access-iteration.md`, `docs/plans/padarax-gm-crossrefs.md`.

## Next actions (ordered)

1. Install when Gary says (`make install-desktop`); it carries only the handshake fix. Afterwards check the log: every session in `GET /api/sessions` should have a client again within seconds, and a tab that was late shows as "SET_PROJECT arrived after setup" followed by a reattach, never as a tab left on the home folder. `[confirm]`
2. Look at what each tab's strip reports in the installed app, and the backend's process counts, which the 17:03 install was never followed by. `[safe]`, without attaching anything to a live session.
3. Ask how the rebuilt board reads (streams grouped as needs you / in review / close out / in progress, `v` for a view by parent ticket, `]` `[` by section), and whether daylight is readable now. His Claude Code theme was `dark-daltonized`, which is why agent output and the agent-drawn cursor were pale. `[safe]`
4. The cleanup skill (`docs/plans/worktree-cleanup.md`): takes the board's "finished" worktrees, shows what it will remove, waits for a yes, uses only `git worktree remove` and `git branch -d`. `[safe]` to write; running it is Gary's.
5. Keep the board warm in the background for projects with open tabs, if the full read still drags. `[safe]`
6. Pull request monitoring steps 2 to 4 (`pr-monitoring.md`). `[safe]`
7. Offered, not accepted yet: after an in-place upgrade every terminal has no controller, so any client that connects can resize it (this is how a diagnostic garbled Gary's tab). The window in control before the upgrade should keep control across it. `[safe]`
8. Tabs past the end of a crowded workspace are cut off (still reachable by key). Wants a real answer if Gary keeps many tabs in one workspace. `[safe]`
9. A connection that names no session still gets a shell, a file watcher and a knowledge graph build on the backend's working directory, which for the desktop app is the home folder. Nothing in the app needs that any more; worth removing if it shows up as load. `[safe]` to investigate.

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

Both suites green with the handshake fix (1,473 backend, 910 frontend). An install needs Gary's explicit go-ahead each time; the permission check blocks it otherwise.

## Gotchas encountered

- **Never attach a test client to one of Gary's live sessions.** A headless page attached to his tab resized its PTY and garbled it. Use a throwaway backend with its own home: `HOME=<scratch>/home .venv/bin/python -m backend.main serve --port <free> --host 127.0.0.1 --no-browser`, optionally `CADE_CLI_AGENT=<fake script>`. To repair a garbled agent screen, nudge its PTY one row and back with `stty -F /dev/pts/N rows R-1` then `rows R`.
- **Stage files by name.** A broad `git add docs` swept other sessions' untracked files into a pushed commit on this public repository, one holding a Tailscale hostname. History was left as it is at Gary's word.
- **The desktop window is not a browser.** Its page is served by the app shell, so use `apiBase()` for requests; its window buttons are drawn over the right end of the tab bar; it cannot be inspected. To reproduce it, serve `frontend/dist/shell.html` and load it headless with `__TAURI__` and `__BACKEND_URL__` set, against a throwaway backend. For anything else, have the page send `ws.sendDiagnostic(kind, detail)` and read `~/.cade/logs/cade.log`.
- **A slow first guess about slowness.** The board's 20 s was GitHub, not git; measure each phase before optimising.
- **Do not leave a task running with nothing to end it.** A read started on attach hung the test suite at shutdown; the monitor that starts a task must own and cancel it.
- **Do not remove or replace behaviour Gary did not ask to change**, and keep messages to him short: a long explanation of the hostname mistake got "wa da fok u on aou".
- **Do not install after every change**; batch, and say what the install carries.
- **Check that an install really upgraded**: look for "Upgrading in place" and "Resumed N session(s)" in the log, and probe something the new build has. "Resumed N" is the backend's side only: compare it with the clients in `GET /api/sessions` to see that every tab came back.
- **The linear key is in `~/.cade/.env`** (`LINEAR_API_KEY`, read-only, mode 600). Tests never reach the tracker (`conftest.py` switches the key off).
- The Vite dev server needs file watches; if the machine is out of them it dies with ENOSPC. `CHOKIDAR_USEPOLLING=true` gets round it, and the per-process count recipe is in the memory note on inotify.
- A puppeteer script must sit inside `frontend/` to resolve its modules; `captureBeyondViewport: false` stops a clipped screenshot firing a resize.
- Never kill by pattern from this shell; record the pid and kill that. `python` is not on PATH; use `.venv/bin/python`.
- Do not edit frontend files while a desktop build is running, and never `git stash` mid-session.
