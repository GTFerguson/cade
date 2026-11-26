---
title: Seamless Upgrade
created: 2026-11-04
updated: 2026-11-04
status: partially-shipped
tags: [plan, infrastructure, sessions, upgrade, pty]
---

# Seamless Upgrade

Install a new CADE build and switch the running backend to it without losing a single terminal session. Claude Code, Codex and manual shells all keep running; tabs reconnect and carry on.

Parent: [[../README]] (plans index). Related shipped substrate: [[../../technical/core/remote-sessions]] (session registry, sequenced reconnect), [[../../architecture/components]] (ProjectServices, watch worker).

## Context

Every upgrade today kills every session, because the backend process is the parent of every shell and holds every PTY master descriptor. Quitting it ends them all. Two things made this bite on 4 Nov 2026:

- A fix for a backend bug (the dashboard watcher exhausting inotify) could be installed but not activated, because activating it meant restarting the backend and ending a day's worth of agent sessions.
- Installing while the backend runs is itself unsafe: the backend is a one-file PyInstaller binary that opens its own executable by path on each lazy import, so swapping `/usr/bin/cade-backend` under it crashes the old process at the next import with a zlib "incorrect header check". The Makefile already waits for nkrdn for exactly this reason; nothing protects the backend.

The handoff resume wrapper (`cade-resume.sh`, `claude --resume`) was tried as a softer landing and did not work reliably, and it is Claude-specific. With Codex in daily use, the fix has to sit at the PTY level, where the agent is just a process in a terminal.

The remote-access work explicitly dropped "persist the session registry to disk" because PTYs do not survive a restart ([[../remote-access-overhaul]]). This plan is the other half: make the PTYs survive, then persisting the registry becomes worthwhile.

## What it adds

- **In-place backend upgrade.** A running backend can replace itself with a newly installed build while its shells, agents and PTYs keep running. Tabs see a reconnect, not a dead terminal.
- **State carried across.** Session ids, labels, working directories, scrollback ring buffers, terminal sizes, and enhanced-chat history survive the switch.
- **A trigger.** An HTTP endpoint and a CLI verb so the installer, a deploy script, or a button in the UI can ask the backend to upgrade.
- **Frontend refresh.** Tabs notice the new build version on reconnect and reload themselves to pick up new JS, then re-attach to their live sessions.
- **Safe install.** Installing a new version never destabilises the running one.

## How it works

### The core trick: exec, not restart

The old backend replaces its own program image with the new binary using `os.execv`. The process id does not change, so:

- Every shell stays a child of the same process. `waitpid` keeps working; nothing is reparented to init.
- Tauri's sidecar handle (`desktop/src-tauri/src/python.rs`, `PythonProcess`) still points at a live child. The desktop app needs no changes to survive the upgrade.
- File descriptors survive `exec` if their close-on-exec flag is cleared. The PTY masters and the HTTP listening socket are passed this way. No `SCM_RIGHTS`, no second process, no socket protocol.

Everything that is not a descriptor is written to a handoff manifest before `exec` and read back after.

### Handoff sequence

```mermaid
sequenceDiagram
    participant I as Installer / UI
    participant O as Old backend (pid N)
    participant FS as ~/.cade/upgrade/
    participant N as New backend (pid N)
    participant T as Tab (frontend)

    I->>O: POST /api/upgrade
    O->>O: stop accepting WS; cancel watch workers, index builds
    O->>T: WS close (code: upgrading)
    O->>FS: handoff.json + scrollback blobs
    O->>O: clear CLOEXEC on PTY fds and listener fd
    O->>N: execv(new cade-backend, [... --resume-handoff])
    N->>FS: read manifest, re-wrap fds
    N->>N: uvicorn on inherited listener fd
    T->>N: reconnect (same port), connected{buildVersion}
    T->>T: version changed → location.reload()
    T->>N: get_or_create(session_id) → live session, replay since seq
```

### Handoff manifest

One JSON file per upgrade at `~/.cade/upgrade/handoff.json`, plus one scrollback blob per terminal. Contents per session:

| Field | Source today | Notes |
|-------|--------------|-------|
| `session_id`, `project_path`, `label`, `last_activity` | `PTYSession` | |
| per terminal: `session_key`, `master_fd`, `pid`, `size`, `last_seq`, `scrollback_path` | `TerminalState`, `UnixPTY._process` (pexpect `child_fd`, `pid`) | fd numbers are stable across exec |
| `controller_connection_id`, remembered sizes | `PTYSession` | may be dropped; connections are new anyway |
| enhanced chat: messages, provider name | `ChatSession` (`core/backend/chat/session.py`) | serialise `_messages` to role/content JSON |
| `listener_fd` | uvicorn server socket | uvicorn accepts a pre-bound socket via its `fd` option |

Not carried, by design: orchestrator worker agents (in-process asyncio tasks over API providers; they are short-lived and re-spawnable), in-flight chat streams (the stream is cut; the message so far is kept), file-tree caches, nkrdn and doc-index build tasks (they restart on their own via ProjectServices).

### A PTY class for inherited descriptors

`UnixPTY` wraps `pexpect.spawn`, which cannot be reconstructed from an fd and a pid. Add `InheritedPTY(BasePTY)` that works directly on the descriptor: `os.read`/`os.write` on the master fd, `fcntl.ioctl(TIOCSWINSZ)` for resize, `os.waitpid(pid, WNOHANG)` for liveness, `os.killpg` for close. pexpect is only needed for spawning, so this is small, and `TerminalState.ensure_reader()` already drives any `BasePTY`.

### Trigger and safety

- `POST /api/upgrade` (token-protected like the rest of the API) and `cade-backend upgrade` as a CLI verb that calls it on the port in `~/.cade/port`. `make install-desktop` calls it after dpkg finishes, so the window between "new binary on disk" and "old process still lazily importing from its path" is a few seconds instead of hours.
- **Queued, not immediate.** The request marks the backend as "upgrade pending" and the exec happens at the next idle moment: no enhanced-chat stream in flight and no orchestrator worker mid-report. Shells and CLI agents do not count as busy, since their processes are untouched by the exec. A pending upgrade is visible in the UI (toast with a "now" button) and in `GET /api/upgrade`, and a second install while one is pending simply updates the target. If the backend never goes idle, the pending upgrade fires after a cap (default 10 minutes) with the stream cut; the message so far is kept.
- **Clean exit from the old image.** PyInstaller's one-file bootloader removes its `_MEI*` extraction directory when the process exits normally, which `exec` is not. Just before `exec`, after every import the handoff path needs is done, the old backend deletes its own `sys._MEIPASS`. The new image extracts to a fresh directory, so nothing accumulates.
- The handler verifies the new binary first: it runs `<new> --version` and refuses to exec into something that does not answer. If the new process fails to come up (manifest unreadable, listener bind fails), it logs and exits non-zero; Tauri's existing 30s readiness poll and the frontend's reconnect backoff handle the fallout, and the shells are lost as they would be today. No worse than now; the common case is much better.
- Versioned install directories (`/usr/lib/CADE/versions/<version>/`, symlink flipped on install) remove the lazy-import hazard entirely, so an install can sit on disk for as long as it likes before the upgrade is triggered. This is a packaging change to `scripts/build-desktop.sh` and the Tauri bundle config.

### Frontend

`connected` already carries `connectionId`; add `buildVersion`. A tab that sees a different version from the one its JS was built with calls `location.reload()` once. Tabs are persisted in localStorage and re-attach to live sessions by id through `SessionRegistry.get_or_create`, which is how a plain WebSocket reconnect already works, so the user sees a brief reconnect and then the same terminal with scrollback replayed from the carried buffer.

## Key challenges

- **Descriptor hygiene.** Everything that must not leak into the new process (watch worker pipes, sockets to clients, nkrdn subprocess pipes) has to be closed or left close-on-exec, and everything that must survive has to have the flag cleared. Python 3.4+ makes new fds non-inheritable by default, which is the right default here. A test that execs into a checker script and asserts the exact set of open fds catches regressions.
- **Reader loop handover.** `TerminalState._read_loop` is mid-`os.read` on a worker thread at exec time. Output between "last captured" and "new process starts reading" is still in the kernel's PTY buffer and is not lost, but the sequence numbers must continue from the carried `last_seq` so reconnecting tabs replay correctly.
- **uvicorn on an inherited socket.** uvicorn supports `fd=`; the Tauri sidecar passes `--port`, so the new process must prefer the inherited fd when present and ignore `--port`. Keep `--port` for the Tauri readiness poll URL.
- **The exec'd binary is still a one-file PyInstaller build** and extracts to a fresh `/tmp/_MEI*`; the old extraction directory is left behind unless the bootloader cleans it. Check what PyInstaller does on exec; a stale 100MB directory per upgrade is not acceptable.
- **Windows.** There is no `exec` on Windows and ConPTY handles do not travel the same way. Windows keeps the current behaviour (upgrade restarts sessions) until a session-host daemon exists (see below). The plan is Linux-first because that is where the pain is.
- **Remote deployments** restart via systemd, which kills the process. The deploy script can call the upgrade endpoint instead of `systemctl restart`, but the unit's own restart policy must not fight it. Later phase.

## Integration points

- `backend/terminal/pty.py` (`InheritedPTY`), `backend/terminal/sessions.py` (export and import of registry state)
- `core/backend/chat/session.py` (chat history serialisation)
- `backend/main.py` (CLI verb, `--resume-handoff`, uvicorn `fd`)
- `backend/websocket.py` (`buildVersion` in `connected`, upgrade close code)
- `frontend/src/platform/websocket.ts` (version check and reload)
- `scripts/build-desktop.sh`, `Makefile` (`install-desktop` triggers the upgrade; versioned dirs)
- `desktop/src-tauri/src/python.rs` (no change expected; verify the child handle survives exec)

## Shipped

Phases 1 to 3 landed on 4 Nov 2026 (`backend/upgrade.py`, `InheritedPTY` in `backend/terminal/pty.py`, `POST /api/upgrade`, `cade-backend upgrade`, the `install-desktop` trigger, `buildVersion` on `connected` with a one-shot reload in `frontend/src/platform/websocket.ts`). Verified with a real `execv` in `backend/tests/test_upgrade_handoff.py` and a live run: a dev backend upgraded itself with a shell session open, came back on the same pid in about 1.6s, replayed the pre-upgrade scrollback to the reconnecting tab, and left no manifest or extraction directory behind.

Design and rationale have graduated to [[../../architecture/components#In-place Upgrade]] and the sequence to [[../../architecture/data-flow#9. In-place Upgrade]]; the install workflow is in [[../../technical/core/development-setup#Keeping the Installed App Current (Linux)]]. The sections below on how it works and the handoff manifest are kept only until the remaining phases ship, then this plan is deleted.

### Desktop reload stranded every tab (found and fixed 14 Nov 2026)

The first live upgrade of the installed desktop app (not a dev backend) kept the backend half of the promise and broke the frontend half. The backend log shows the exec at 12:59:53, "Resumed 4 session(s)" and all four tabs reconnected by 12:59:55; at 12:59:56 every tab closed its socket to reload on the new build id, and none ever reconnected. The app had to be restarted, which lost the sessions the upgrade had just preserved.

Two faults, both specific to the desktop shell:

- **A reload cannot find the backend.** The shell tells the page its backend address by evaluating a script once at startup (`window.__BACKEND_URL__`, `__TAURI__`, `__HOME_DIR__` in `desktop/src-tauri/src/main.rs`). A reload wipes those globals and nothing sets them again, so the page computes its own origin as the backend. This also broke any manual reload. Fixed in `frontend/src/config/config.ts`: the values are mirrored to sessionStorage and restored when a page loads without them.
- **The reload was pointless there anyway.** The desktop frontend is built into the running `cade` binary, so reloading returns the same page. The reload is now opt-in: a client sends `reloadOnUpgrade` in `set-project` when the backend serves its page, and the backend puts `buildVersion` on `connected` only for those clients. A desktop window therefore reconnects and carries on with its existing interface until the app next restarts.

The opt-in sits on the backend side deliberately: a desktop frontend from before this fix is still running wherever the app has not been restarted, and it would reload into the dead page on any build id it is shown. Withholding the id from clients that do not ask keeps the next install safe for it too.

The gap this left: after an upgrade the desktop ran a new backend under an old interface until restart, and nothing told the user so. Closed on 24 Nov 2026 (next section).

### Desktop frontend upgrades live (24 Nov 2026)

The desktop window now opens a loader page (`frontend/shell.html`, `frontend/src/shell/loader.ts`) instead of the interface built into the app. The loader fetches `index.html` from the local backend and writes it into its own document, so the JS and CSS always belong to the backend that is running, and the ordinary reload-on-upgrade path applies to the desktop too.

Decisions:

- **The document stays on the shell's origin; it does not navigate to the backend.** The backend port is random per launch (`desktop/src-tauri/src/port.rs`), so its origin changes every start and localStorage (tabs, theme) would be empty each time. It also keeps the Tauri capability set unchanged: no remote-origin IPC grant is needed.
- **Asset URLs are made absolute rather than using `<base href>`.** The loader rewrites root-relative `src`/`href` in the fetched page, and `experimental.renderBuiltUrl` in `frontend/vite.config.ts` prefixes runtime-loaded chunks, preloaded CSS and worker URLs with `globalThis.__ASSET_ORIGIN__`, which only the loader sets. A `<base>` element would also redirect fragment links and SVG `url(#id)` references, a known hazard for Mermaid markers.
- **Local backends only.** The loader takes the interface only from `127.0.0.1`/`localhost`; with a remote backend configured it loads the built-in copy, because a remote page would run with the shell's native commands in reach.
- **Fallback.** Ten fetch attempts half a second apart cover the exec gap; after that, or if the response is not the app page, the loader replaces itself with the built-in `index.html`. A window on the built-in copy does not ask for `reloadOnUpgrade`, exactly as before.
- **The shell re-supplies its globals on every load** (`on_page_load` in `desktop/src-tauri/src/main.rs`); the sessionStorage mirror remains as the copy the loader reads first.

What still needs an app restart: the Rust shell and the loader itself, which are compiled into the running binary. A new frontend that calls a Tauri command the running shell lacks will find it missing until then. Upgrading those live is the session host in phase 5.

Verified in a headless browser with two servers standing in for the built-in copy and the backend: with the built-in copy's entry script deleted the app still booted from the backend's files, and with the backend stopped the loader landed on the built-in `index.html`. **Not yet verified in the installed desktop app (WebKitGTK) through a real upgrade**; that needs one restart onto a build containing the loader, then an install on top of it.

The earlier "live run" verification used a dev backend with a browser tab, which is exactly the case that works. A desktop-shell run should be part of verifying any change to this path.

### The upgraded backend ran from the old build's files (25 Nov 2026)

Until this fix an in-place upgrade of the installed app never loaded the new frontend. PyInstaller's bootloader leaves `_PYI_ARCHIVE_FILE` and `_PYI_APPLICATION_HOME_DIR` in the environment; a one-file binary exec'd with them set takes itself for a worker of the launching build and runs from the directory unpacked at launch. Python code came from the new binary, while the frontend, data files and native libraries stayed those of the build the app was started with. Confirmed on the installed binary with `strace`: no new `/tmp/_MEI*` directory was created unless `PYINSTALLER_RESET_ENVIRONMENT=1` was set.

- **The exec sets that switch** (`exec_environment` in `backend/upgrade.py`), so the new image unpacks its own files and the old directory is removed on resume, as the design assumed.
- **The pid no longer holds the backend.** Unpacking makes the exec'd process a launcher and runs the backend as its child, so the shells are the backend's siblings and it cannot `waitpid` them. `InheritedPTY.is_alive` reads the process state from `/proc` instead; an exited shell stays a zombie until the app closes, because the launcher does not reap.
- **Each upgrade adds one idle launcher process** to the chain under the desktop app. Versioned install directories with a one-directory build (phase 4) remove both this and the zombie caveat.
- **The first upgrade after installing this fix still runs the old exec path**, since the running backend performs it; a second `cade-backend upgrade` then unpacks properly. The build id does not change between the two, so windows need one manual reload.

Verified on a throwaway frozen backend with its own home directory and one shell session: the new image unpacked a fresh directory and removed the old one, the session stayed alive, the build's frontend was served, a killed shell was reported as exited, and a second upgrade repeated all of it. Then on the installed app: nine sessions resumed and the served entry script matched the build.

### The page no longer reloads itself (25 Nov 2026)

Every install reloaded the window, which redraws every terminal, even when only the backend had changed. Two changes (`1691e3a9`):

- **The page is judged by its own identity.** `connected` carries `frontendVersion` next to `buildVersion`: a hash of the built `index.html`, which names its scripts and styles by content hash (`frontend_id` in `backend/upgrade.py`). A tab compares that, so an upgrade that leaves the interface alone is invisible to it. A backend that sends none is judged by its build id as before.
- **A changed interface is offered, not applied.** The tab bar shows "update ready" at its right end; clicking it reloads and reopens the tabs (`WebSocketClient.reloadForUpdate`, `TabBar.setUpdateReady`). Until then the old interface runs against the new backend, which is the state a desktop window on its built-in copy has always been in. A message type the old interface does not know is the risk to watch for.

The install that first carries this still reloads the window once, because the page running at that moment is the old code.

**The marker was invisible in the desktop window (found 26 Nov 2026).** It was placed at the end of the tab area. The desktop window's minimise, maximise and close buttons are positioned over the right end of the bar with their own background, so whenever the tab area reached the window's edge they covered it: the page had the notice, drew the marker, and nobody could see it, across four installs. It could not be found from a browser run, which has no window buttons, nor from the backend, which sent the right versions; it was found by loading the installed `shell.html` in a headless browser with the shell's globals set and asking which element was topmost at the marker's position. In the desktop window the marker now goes inside the window buttons' box, to their left (`TabBar.render`). The page also reports what it was told and what it drew as `build-notice` and `update-ready` client diagnostics in the backend log.

## Remaining phases

3b. **UX.** "Upgrade pending" and "upgrading" toasts, and on the desktop a notice that the interface updates at the next restart; a "now" button; cancel from the UI. Reconnect after the exec is the ordinary backoff path today (1s, 2s, 4s), which covers the measured 1.6s gap.
4. **Safe install.** Versioned install directories (`/usr/lib/CADE/versions/<version>/`) and a symlink flip, so a build can sit installed-but-not-activated indefinitely without the one-file lazy-import hazard. Until then `install-desktop` triggers the upgrade immediately after dpkg, which keeps the window to seconds.
5. **Deferred.** Session-host daemon (PTY ownership in a separate long-lived process) for Windows and for upgrading the Tauri shell itself; remote deployment hook so `deploy.sh` calls the endpoint instead of `systemctl restart`.

## Open questions

- Is it worth carrying orchestrator worker state, or is "workers restart from their task string" acceptable? With the idle gate, a worker mid-report delays the upgrade rather than being cut, so restarting from the task string only matters for the capped case.
- What should the idle cap be, and should the UI let the user cancel a pending upgrade outright rather than only bring it forward?
- Tauri's readiness poll runs only at startup. Should the Rust side learn about upgrades at all, or is "the child pid is still alive" enough?

## Evidence links

- [[../../reference/session-persistence]] for PTY persistence patterns and what state is worth carrying.
- nginx and HAProxy perform zero-downtime reloads by passing listening sockets to a new process; the exec-in-place variant used here is the same idea with fewer moving parts because the pid is kept.
