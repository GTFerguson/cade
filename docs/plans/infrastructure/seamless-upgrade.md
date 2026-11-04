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

Decisions made while building, for the architecture doc when the plan graduates:

- **The listening socket is bound by the backend, not uvicorn**, and passed via `Server.run(sockets=[...])`, so it is a known descriptor the manifest can name. uvicorn's own `fd` option was avoided because it wraps the fd as `AF_UNIX` regardless of family.
- **Readers are paused, not cancelled.** `BasePTY.stop_reading()` lets the worker thread finish its current `read` and publish the chunk; cancelling the task would have dropped it. Output the shell writes after the pause waits in the kernel's PTY buffer for the new image.
- **The old `_MEIPASS` is removed by the new image, not the old one**, and only when it is a sibling of the new image's own extraction directory. Deleting it before `exec` would have left the old process unable to import anything if the `exec` then failed; this way a failed handoff rolls back to a fully working backend.
- **Not carried:** orchestrator workers, in-flight chat streams (the partial reply is kept as the user saw it), file-tree caches, index builds. The idle gate makes the first two rare.
- **The UI has no upgrade affordance yet.** Pending state is visible only via `GET /api/upgrade` and the CLI's `--status`; the planned toast with a "now" button is in phase 3b below.

## Remaining phases

3b. **UX.** "Upgrade pending" and "upgrading" toasts; a "now" button; cancel from the UI. Reconnect after the exec is the ordinary backoff path today (1s, 2s, 4s), which covers the measured 1.6s gap.
4. **Safe install.** Versioned install directories (`/usr/lib/CADE/versions/<version>/`) and a symlink flip, so a build can sit installed-but-not-activated indefinitely without the one-file lazy-import hazard. Until then `install-desktop` triggers the upgrade immediately after dpkg, which keeps the window to seconds.
5. **Deferred.** Session-host daemon (PTY ownership in a separate long-lived process) for Windows and for upgrading the Tauri shell itself; remote deployment hook so `deploy.sh` calls the endpoint instead of `systemctl restart`.

## Open questions

- Is it worth carrying orchestrator worker state, or is "workers restart from their task string" acceptable? With the idle gate, a worker mid-report delays the upgrade rather than being cut, so restarting from the task string only matters for the capped case.
- What should the idle cap be, and should the UI let the user cancel a pending upgrade outright rather than only bring it forward?
- Tauri's readiness poll runs only at startup. Should the Rust side learn about upgrades at all, or is "the child pid is still alive" enough?

## Evidence links

- [[../../reference/session-persistence]] for PTY persistence patterns and what state is worth carrying.
- nginx and HAProxy perform zero-downtime reloads by passing listening sockets to a new process; the exec-in-place variant used here is the same idea with fewer moving parts because the pid is kept.
