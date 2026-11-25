---
title: Iterate the phone-over-Tailscale experience until it is smooth
created: 2026-10-15
status: in-flight
---

# Resume: iterate the remote (phone) session experience against the real backend

## Active plans
- **Phase plan**: `docs/plans/remote-access-overhaul.md` — phases 1–4 shipped; remaining items listed there
- **Architecture**: `docs/technical/core/remote-sessions.md` — how the substrate works (read before changing attach/size/attention code)

## Contract — how to use this file

This file is persistent working memory for one in-flight task. Procedure:

1. **Orient, then proceed on safe work** — read this file, then open with a one-sentence status plus a one-line preview of the next step or two. Proceed immediately with `[safe]` next-actions (reads, validators, local edits). Stop and confirm only for `[confirm]`-tagged steps or anything irreversible / externally visible (deploys, migrations, external API calls, branch operations). The handoff captures what the *writing* agent planned — the user can redirect if it's stale, but they don't want to grant permission for every safe step.
2. **Use as persistent reference while building** — update it as you go: tick off next-actions, add new gotchas, revise file lists. This is the single source of truth for "where is this work right now".
3. **Graduate on completion** — once the task ships, lift the durable knowledge out: design decisions → `docs/architecture/`, research findings → `docs/reference/`. Don't leave it stranded in here.
4. **Delete this file** — after graduation, `rm` the handoff. Its existence means work is still in the air; absence means done.

## Where we are

The phone is attached and driving sessions over Tailscale (`https://gary-lenovo-legion-7-15imhg05.taild222d5.ts.net/` → desktop backend on `127.0.0.1:34101`; the port changes on each app relaunch, so `tailscale serve --bg <port>` must be repointed). Gary is reporting UX kinks one at a time; fixed so far: splash ATTACH entries, logo font, cache headers, touch scrolling, pinch lag, menu layout, detach. For frontend-only fixes a Vite dev server on the tailnet IP (`BACKEND_PORT=<port> npm --prefix frontend run dev -- --host 100.126.166.112 --port 5175`, phone opens `http://100.126.166.112:5175/`) gives instant reloads without a reinstall; backend changes still need rebuild → `sudo -n apt-get install --reinstall` → Gary relaunches the app (never restart it yourself).

## Worktree / branch
- Path: `/home/gary/projects/cade` (main checkout)
- Branch: `main`, pushed
- Last commit: see `git log --oneline -1` (mobile UX fixes, 15 Oct)

## Shipped this session
- `1caf169a` Gary's in-flight work (tab drag, auto-start/resume toggles, get-tree storm log)
- `cd4c84c4` Remote sessions: broadcaster, seq replay, size policy, session directory, attention hooks, push, PWA, mobile shell, files
- `497bb79f` Docs for the above; `c5c5320b` CRLF restore in pyinstaller.spec
- `a5d99a7d` Splash ATTACH entries + logo font

## In flight (uncommitted work)
None. Untracked and deliberately left alone: `AGENTS.md` (looks like a mechanical Codex substitution of CLAUDE.md), `docs/plans/padarax-gm-crossrefs.md`.

## Next actions (ordered)

1. Confirm the new backend is live: `curl -s http://127.0.0.1:40253/api/sessions | head -c 200` should return JSON, not 404. If 404, the desktop app was not relaunched. `[safe]`
2. Ask the user what the phone shows now; fix each kink in place. Likely areas: composer/keyboard behaviour on iOS (`frontend/src/ui/touch-toolbar.ts`), font fit when mirroring (`frontend/src/terminal/terminal.ts:applyPtySize`), attention dots not appearing (check `~/.cade/hook.log` for `attention:` lines; hooks install on backend start via `backend/hooks/__init__.py`). `[safe]`
3. After each backend/frontend fix: `npx tsc --noEmit` + `npx vitest run --root /home/gary/projects/cade/frontend`, backend `.venv/bin/pytest -p no:cacheprovider -q backend/tests`, commit, push, then rebuild + reinstall (see Build & verify). The reinstall needs sudo; `sudo -n` works passwordless here. Relaunching the desktop app kills the Claude session running inside it — write a fresh handoff first. `[confirm]`
4. Still open from the plan: on-device measurement (renderer, latency), chat pane parity, QR sign-in. `[safe]`

## Key design decisions
- Controller-owns-size (last device to type) rather than tmux's smallest-client rule.
- Splash polls `/api/sessions` every 4 s and lists live sessions as ATTACH entries; the command menu's "on server" list is the same data once a tab exists.
- Backend stays loopback-bound conceptually; Tailscale Serve provides HTTPS. Note the sidecar currently runs `--host 0.0.0.0` with auth off (pre-existing), so it is also reachable as plain HTTP on the tailnet IP and LAN. Tightening = bind sidecar to 127.0.0.1 (desktop/src-tauri config) if the user wants it.

## Files touched / to touch
- Backend: `/home/gary/projects/cade/backend/terminal/sessions.py`, `backend/websocket.py` (`_attach_terminal`, `_drain_output`, `_handle_resize`, `_handle_input`), `backend/terminal/attention.py`, `backend/push.py`, `backend/main.py` (routes `/api/sessions`, `/api/sessions/attention`, `/api/push/*`), `backend/hooks/attention_hook.py`
- Frontend: `frontend/src/platform/websocket.ts`, `frontend/src/terminal/terminal.ts`, `frontend/src/terminal/font-size.ts`, `frontend/src/ui/touch-toolbar.ts`, `frontend/src/ui/mobile.ts`, `frontend/src/ui/mobile/*`, `frontend/src/main.ts` (`pollSplashSessions`, attention tracking), `frontend/src/push.ts`, `frontend/public/sw.js`, `frontend/styles/mobile.css`
- Tests: `backend/tests/test_output_broadcast.py`, `test_multi_client_attach.py`, `test_attention.py`, `test_push.py`, `test_file_listing_and_diff.py`; `frontend/src/platform/websocket.test.ts`, `frontend/src/ui/mobile/*.test.ts`

## Build & verify
```
cd /home/gary/projects/cade/frontend && npx tsc --noEmit && npx vitest run --root /home/gary/projects/cade/frontend
cd /home/gary/projects/cade && .venv/bin/pytest -p no:cacheprovider -q backend/tests   # 4 known pre-existing failures: 2× test_chat_handler compact, test_config_loading default, test_http_mcp_tools (order-dependent)
cd frontend && npm run build && cd ../desktop && PATH="$PWD/../.venv/bin:$PATH" npm run tauri build   # ~5 min
sudo -n apt-get install -y --reinstall ./desktop/src-tauri/target/release/bundle/deb/CADE_0.1.0_amd64.deb   # then user relaunches the desktop app
```
Headless phone check: `npm --prefix frontend run dev -- --port 5175` then `scout-browse --headless open "http://localhost:5175/?demo=mobile-remote"`, `resize 390 844`, `goto` again, `screenshot`. Menu rows are divs with no refs: open with the `[cmd]` button ref, navigate with keys, select with `scout-browse type $'\n'`. For the real splash ATTACH flow, run a throwaway backend `CADE_AUTO_START_CLAUDE=false .venv/bin/python -m backend.main serve -p 40399 -H 127.0.0.1 --dummy --no-browser -d /home/gary/projects/cade`, create a session over `ws://127.0.0.1:40399/ws` with a `set-project` carrying `sessionId`, and start Vite with `BACKEND_PORT=40399`.

## Gotchas encountered
- `pkill -f "<pattern>"` matches the bash command line it is typed in and kills the session (exit 144). Kill by port: `fuser -k 5175/tcp`.
- Shell cwd does not persist reliably between tool calls; use absolute paths and `npm --prefix`.
- `git apply --unidiff-zero` misplaced hunks when splitting commits; the self-checking applier is in the scratchpad history only — if splitting is needed again, reconstruct files by applying chosen hunks in Python and assert that applying all hunks reproduces the tree.
- `tailscale serve --bg 40253` is the working syntax (not `https:443 http://…`). First HTTPS request takes ~25 s for cert issuance.
- `python3 pathlib.read_text/write_text` normalises CRLF → LF; `scripts/pyinstaller.spec` is CRLF.
