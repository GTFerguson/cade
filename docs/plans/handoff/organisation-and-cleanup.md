---
title: Organisation roadmap: workspaces, picker, per-tab strip, the board, Linear and the handshake fix are shipped; next is checking the strip in the real app, then the cleanup skill
created: 2026-11-25
updated: 2026-11-26
status: in-flight
---

# Resume: install the Codex and attention fixes when Gary says, check them, get his verdict on the strip, board and daylight, then the cleanup skill

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

Everything through `19e8508f` is committed, pushed and installed (26 Nov 17:40): the rebuilt board, live Linear data, the workspace list that slides in at the right, the strip that follows each tab's own stream, the efficiency pass, and the handshake fix. No errors in `~/.cade/logs/cade.log` since the 17:03 install. The installed backend was sampled for 65 s with ten tabs attached and started 26 processes (21 `git`, 5 `gh`). What each tab's strip should say was worked out from source against the live sessions and given to Gary to compare with his screen, since nothing can read a tab's strip from outside without attaching to it; his answer is still open.

The handshake fix (`docs/technical/core/remote-sessions.md`, "Handshake") was seen working on its own install: four tabs sent their handshake 4 to 7 s late, were closed and were back on their own sessions and workspaces 12 s after the upgrade. Gary's window has been on the new page since 18:29, so a late tab is now waited for instead of bounced.

Committed and pushed after that install, **not installed** (both backend only):

- `22d241e0` CADE no longer writes its two helper servers into `~/.codex/config.toml`. Every Codex thread on the machine started both, each unpacking a 219 MB copy of the backend into `/tmp` (21 running, 4.6 GB, on a disk with about 20 GB free). Gary does not use the orchestrator from Codex. The notify command is still written.
- `fcabe41e` Claude Code's idle reminder no longer turns a finished tab into one waiting on him.
- `be3b062c` The chat agent's base prompt names the file tools it has.

Every plan was checked against the code on 26 Nov and cut to what is unbuilt; what they alone recorded moved into `docs/technical/` and `docs/architecture/` (new: `core/provider-stack.md`, `design/dashboard-system.md`). Code defects found on the way are written up in `docs/plans/quick-fixes/`, not fixed. The one that matters most: a failover provider never falls back (`failover-never-triggers.md`).

In use and liked: workspaces (`Alt+w` / `Alt+Shift+w`, hold `Alt` for the list, `Ctrl+Alt+w` or a drag onto a chip to move a tab, `Alt+x` closes a tab), the strip above the terminal, quiet upgrades. Built and waiting for Gary's opinion: the rebuilt board (`Alt+b`) and the daylight theme fixes.

Not built: the cleanup skill, tickets and pull requests on the picker's rows (mock only, `docs/plans/design/workspace-board-mock.html`).

One session is running with no tab: `2f56e385` "Clean up handoffs" (AirPLAi, Codex). Its tab was one of the stuck ones and was closed while it was attached to nothing, so the close never reached the session. Gary's to reattach or end.

## Worktree / branch

- Path: `/home/gary/projects/cade` (main checkout)
- Branch: `main`, pushed. The repository is **public**.

## In flight (uncommitted work)

Nothing. Untracked files from other sessions, leave alone and never stage: `AGENTS.md`, `docs/plans/handoff/remote-access-iteration.md`, `docs/plans/padarax-gm-crossrefs.md`.

## Next actions (ordered)

1. Install when Gary says in so many words (`make install-desktop`); the permission check refused it on a loose "okay". It carries the three commits above. Then check: the `cade-orchestrator` and `cade-permissions` blocks are gone from `~/.codex/config.toml` once a Codex tab has reconnected and its `notify` line is still there; a new Codex thread starts no `cade-backend mcp-server`; a Claude Code tab that finishes still shows finished two minutes later. The helper processes already running, and their copies in `/tmp`, last until their Codex threads end. `[confirm]`
   - Before deleting anything under `/tmp/_MEI*`, check maps, open files, cwd and environment of every process for the directory: most of what looks stale is in use. 12 that nothing touched were deleted on 26 Nov (2.6 GB); where they came from was not established.
   - Left alone: Claude Code tabs are still given both helper servers per session (`--mcp-config`), each of which would unpack its own copy when started, and the backend is a chain of launcher processes, one per upgrade since it started, with the watchers each old image left behind as zombies under them. Building the backend unpacked (PyInstaller one-folder) would end all of it; raise it if `/tmp` fills again.
2. Ask how the rebuilt board reads (streams grouped as needs you / in review / close out / in progress, `v` for a view by parent ticket, `]` `[` by section), and whether daylight is readable now. His Claude Code theme was `dark-daltonized`, which is why agent output and the agent-drawn cursor were pale. `[safe]`
3. The cleanup skill (`docs/plans/worktree-cleanup.md`): takes the board's "finished" worktrees, shows what it will remove, waits for a yes, uses only `git worktree remove` and `git branch -d`. `[safe]` to write; running it is Gary's.
4. Keep the board warm in the background for projects with open tabs, if the full read still drags. `[safe]`
5. Pull request monitoring steps 2 to 4 (`pr-monitoring.md`). `[safe]`
6. Offered, not accepted yet: after an in-place upgrade every terminal has no controller, so any client that connects can resize it (this is how a diagnostic garbled Gary's tab). The window in control before the upgrade should keep control across it. `[safe]`
7. Tabs past the end of a crowded workspace are cut off (still reachable by key). Wants a real answer if Gary keeps many tabs in one workspace. `[safe]`
8. A connection that names no session still gets a shell, a file watcher and a knowledge graph build on the backend's working directory, which for the desktop app is the home folder. Nothing in the app needs that any more; worth removing if it shows up as load. `[safe]` to investigate.
9. The quick fixes in `docs/plans/quick-fixes/`, failover first. Each file has the evidence and a direction; the failover one was confirmed with stub providers and by reading the code, not against a live provider. `[safe]`

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

Both suites green at `fcabe41e` (1,480 backend, 910 frontend). `test_session_scope.py::TestFallback::test_runs_as_a_plain_child_without_systemd` failed once in a full run and passes alone and on rerun. An install needs Gary's explicit go-ahead each time; the permission check blocks it otherwise.

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
