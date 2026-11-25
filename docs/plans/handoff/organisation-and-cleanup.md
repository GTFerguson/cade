---
title: Organisation roadmap: tab groups and project picker shipped; next is quieter upgrades, the alphaxiv popup, then PR monitoring
created: 2026-11-25
status: in-flight
---

# Resume: stop upgrades reloading the window, remove the alphaxiv popup outside API chat, fix the remaining desktop requests, then start pull request monitoring

## Active plans

- **Roadmap**: `/home/gary/projects/cade/docs/plans/organisation-and-cleanup-roadmap.md` — six phases; 1 and 2 are built, 3 (pull request monitoring) is next
- **Phase 1 (shipped)**: `/home/gary/projects/cade/docs/technical/core/tab-groups.md` — tab groups design
- **Related**: `/home/gary/projects/cade/docs/plans/infrastructure/seamless-upgrade.md` — in-place upgrade; the reload work in next-action 1 belongs with it
- **Related**: `/home/gary/projects/cade/docs/plans/remote-access-overhaul.md` — remaining remote/mobile items

## Contract — how to use this file

This file is persistent working memory for one in-flight task. Procedure:

1. **Orient, then proceed on safe work** — read this file, then open with a one-sentence status plus a one-line preview of the next step or two. Proceed immediately with `[safe]` next-actions (reads, validators, local edits). Stop and confirm only for `[confirm]`-tagged steps or anything irreversible / externally visible (deploys, migrations, external API calls, branch operations). The handoff captures what the *writing* agent planned — the user can redirect if it's stale, but they don't want to grant permission for every safe step.
2. **Use as persistent reference while building** — update it as you go: tick off next-actions, add new gotchas, revise file lists. This is the single source of truth for "where is this work right now".
3. **Graduate on completion** — once the task ships, lift the durable knowledge out: design decisions → `docs/architecture/`, research findings → `docs/reference/`. Don't leave it stranded in here.
4. **Delete this file** — after graduation, `rm` the handoff. Its existence means work is still in the air; absence means done.

## Where we are

Tab groups became workspaces on 25 Nov: one open at a time, `Alt+j`/`Alt+k` to move, hold `Alt` for the list, closed chips with one status mark, a slide when switching, the open workspace outlined with its tabs. Gary is happy with it. Design is in `docs/technical/core/tab-groups.md`. Earlier the same day: quieter upgrades, the alphaxiv toast, the desktop fetch fixes, dependency lists, the picker doc. glann is retired; never deploy to it.

**Open problem: the "update ready" marker did not appear in the desktop window** after two installs that changed the interface (15:59, 16:09), though the backend sent the new `frontendVersion` and the installed bundle shows the marker in a headless browser against the live backend. Gary reloaded by hand at 16:45. `cefbff7f` makes the page log `build-notice` and `update-ready` diagnostics ("Client diagnostic" in `~/.cade/logs/cade.log`); they report from the second install after it, since the running page predates it.

**Not installed**: `95231e7e` (no `[claude]` corner label), `cefbff7f` (diagnostic), `2aaa6780` (outline). An install needs Gary's go-ahead each time; the permission check blocks it otherwise.

## Worktree / branch

- Path: `/home/gary/projects/cade` (main checkout)
- Branch: `main`, pushed
- Last commit: `2aaa6780` Workspaces: the open workspace's colour runs round its chip and then under its tabs

**Installed build is `3b1d00f9`** (plus the tab-groups doc commit).

## In flight (uncommitted work)

Nothing. Untracked files from other sessions, leave alone: `/home/gary/projects/cade/AGENTS.md`, `/home/gary/projects/cade/docs/plans/handoff/remote-access-iteration.md`, `/home/gary/projects/cade/docs/plans/padarax-gm-crossrefs.md`.

## Next actions (ordered)

1. ~~Quieter upgrades~~ Done in `1691e3a9`. The backend sends `frontendVersion` (hash of the built `index.html`, `backend/upgrade.py: frontend_id`) with `buildVersion`; the page compares that and never reloads by itself. A changed interface shows "update ready" at the right of the tab bar (`TabBar.setUpdateReady`, `WebSocketClient.reloadForUpdate`). Checked headless only; the first install carrying it still reloads, because the page running at that moment is the old code.
2. ~~alphaxiv popup~~ Done in `fe44bddf`. The toast now waits until the chat pane is on screen (`frontend/src/chat/mcp-auth-nudge.ts`, wired in `project-context.ts` through `TerminalManager.onModeChange`). The backend still logs `No valid OAuth token found` on each connect; left alone.
3. ~~Relative fetches~~ Done in `9f696ea8`: all swapped to `apiBase()`. `main.ts`'s `/api/auth/check` is left on `basePath`; it never runs in the desktop window.
4. Install for the batch: started 25 Nov after Gary's "sort them all out". Confirm the backend switched (a `connected` message now carries `frontendVersion`; `cade-backend --version` build id) before calling it live.
5. Check in the real app what was only unit-tested: a Codex tab opened from the picker (launch line, MCP entries in `~/.codex/config.toml`, resume on exit), a handoff opened from the picker in each agent, and whether background tabs come back clean after a reload (the scrambled-text fix). Ask Gary; he has not reported on any of them. `[safe]`
6. ~~docs/technical write-up~~ Done in `8372ece9`: `docs/technical/core/project-picker.md` (picker, per-tab agent) and a "When a session ends" section in `core/remote-sessions.md`. Gap: `docs/technical/reference/websocket-protocol.md` does not list `close-session`.
7. Phase 3, pull request monitoring: plan written at `docs/plans/pr-monitoring.md` (read-only, polls `gh`, tab badge first). `gh` here is signed in to one account, `GTFerguson`, which owns 24 of 25 repos under `~/projects`. Gary: AirPLAi repos are under his work account (a separate GitHub login; `gh` here is not signed in to it). Next: Gary reads the plan, then build step 1 for the personal account first. `[safe]`
8. ~~Dependency lists~~ Done in `f6115de3`: both lists name the same packages, kept so by `backend/tests/test_dependency_lists.py`. `nkrdn` and `fastembed` stay pyproject-only. glann is retired (Gary, 25 Nov); nothing to deploy.
## Key design decisions

- **Tab groups**: the session on the backend owns its group; a tab's saved copy is only used when the session is being created. Definitions in `~/.cade/tab-groups.json`. Collapse and order are per browser.
- **Picker**: two columns — left is the folder being browsed (projects under `CADE_PROJECTS_ROOT`, default `~/projects`, by last worked on), right is quick choices (open, running without a tab, recent). `j`/`k` within a column, Tab crosses, `h`/`l` are folder navigation only and never open anything, Enter chooses a folder and always shows new session + handoffs. Agent and tab group toggles in a strip at the top right, no captions. System dialog is the last entry, labelled "open system explorer".
- **Per-tab agent**: `set-project` may name `agent`; a new session takes it, an existing one keeps its own. The resume wrapper picks its adapter from `CADE_CLI_AGENT_ADAPTER` in the PTY env, so one script serves both agents.
- **Tab close ends the session** unless another client is attached (`close-session` message). A dropped connection keeps it. The phone's `[detach]` deliberately still leaves it running. `DELETE /api/sessions/{id}` ends an unattached session.
- **Scrollback restore** carries the PTY size; the terminal takes that size before replaying, then refits (`Terminal.restore`).
- **Neovim pane stays.** Codex status comes from its terminal title. `subprocess`/`websocket` provider types are used by `launch.yml`, not dead.
- **Open, Gary to answer**: which "higher level organisational surfaces" feel broken (phase 4); whether the chat pane and LiteLLM stack are still used directly (it powers `spawn_agent`).

## Files touched / to touch

- Picker (built):
  - `/home/gary/projects/cade/frontend/src/local/project-picker.ts`, `picker-model.ts`, `recent-projects.ts`
  - `/home/gary/projects/cade/frontend/styles/screens/project-picker.css`
  - `/home/gary/projects/cade/backend/projects.py`, `backend/main.py` (`/api/projects`, `/api/projects/handoffs`)
- Per-tab agent (built):
  - `/home/gary/projects/cade/backend/terminal/session_agents.py`, `backend/terminal/agent_launch.py`, `backend/websocket.py` (`_cli_agent`)
- Tab groups (built):
  - `/home/gary/projects/cade/backend/terminal/tab_groups.py`
  - `/home/gary/projects/cade/frontend/src/tabs/tab-groups.ts`, `tab-manager.ts`, `tab-bar.ts`, `tab-menu.ts`
- Sessions and terminals (built):
  - `/home/gary/projects/cade/backend/websocket.py` (`_handle_close_session`, `_attach_terminal`)
  - `/home/gary/projects/cade/backend/terminal/pty.py` (`shell_environment`)
  - `/home/gary/projects/cade/frontend/src/terminal/terminal.ts` (`restore`)
  - `/home/gary/projects/cade/frontend/src/config/config.ts` (`apiBase`)
- Pending:
  - `/home/gary/projects/cade/frontend/src/platform/websocket.ts` — upgrade reload behaviour
  - alphaxiv popup: files under next-action 2
  - relative fetches: files under next-action 3

## Build & verify

```
cd /home/gary/projects/cade && .venv/bin/python -m pytest backend/tests -q -p no:cacheprovider
cd /home/gary/projects/cade/frontend && npx tsc --noEmit -p . && npx vitest run
cd /home/gary/projects/cade && PATH="$PWD/.venv/bin:$PATH" make install-desktop
```

Frontend green at `2aaa6780` (774); backend green at `f6115de3` (1,329).

## Gotchas encountered

- **The desktop window's page is served by the app shell, not the backend.** A `fetch("/api/...")` there goes to the shell and comes back empty with no error. Use `apiBase()`. This broke the picker and tab group definitions on desktop while every test and headless demo passed. To reproduce desktop conditions headless: load the Vite page (`npm run dev -- --port 5183`, `?demo=viewer`), `delete window.__MOCK_BROWSE__`, set `window.__BACKEND_URL__ = "http://localhost:<port in ~/.cade/port>"`, and drive the real API with puppeteer from `frontend/node_modules` (script must sit inside `frontend/`).
- **Do not remove or replace behaviour Gary did not ask to change.** Asked to add things to the picker, the open/recent sections were dropped and `l` was repurposed; he was angry about both. Add, and keep what is there.
- **Do not install after every change.** Gary: "you don't need to do it for every little change its annoying, it still refreshes all the terminals". Commit and push; install once per batch, or when he is waiting to try a feature, and say so first.
- **Check that an install really upgraded the backend.** An install once printed "No running backend to upgrade" and exited 0 when `cade-backend upgrade` had crashed on stale PyInstaller variables. The Makefile now clears them and shows the error; still probe something the new build has before saying it is live.
- **Another session may be committing to the same files.** `cf3b2d22` (a picker restyle) landed mid-session from another agent. Run `git log -3 -- <file>` and read the file before editing something not touched for a while. `git checkout <file>` to discard edits is blocked by the permission classifier here.
- **Edit with exact, unique anchors.** A Python `s.index(".tab-add-button {")` matched an earlier `.tab-bar.empty .tab-add-button` rule and deleted a block of `tabs.css`; caught only by the headless screenshot.
- **Never kill by pattern from this shell**: `pkill -f <script>` matched the shell running it.
- A puppeteer screenshot with `clip` fires a window resize, which closes menus; pass `captureBeyondViewport: false`.
- `python` is not on PATH; use `.venv/bin/python`. `make` targets need `.venv/bin` on PATH.
- `scout-browse` shares one browser with other agents' sessions; use puppeteer for local renders.
- The desktop window cannot be inspected. To see what it does, send `ws.sendDiagnostic(kind, detail)` and read `~/.cade/logs/cade.log` ("Client diagnostic").
- Gary said he still has to choose RESUME SESSION after an install, but the log shows tabs reattaching 2 s after the reload with no click (`a3057798`). Unresolved; if he repeats it, add a diagnostic on startup reporting `takeResumeAfterUpgrade()` and `hasSavedSession()`.
- An empty `/tmp/.git` exists on this machine and makes `nkrdn_root` treat `/tmp` as a repo.
- Never `git stash` in this repo mid-session, and do not edit frontend files while a desktop build is running.
