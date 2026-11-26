---
title: Seamless Upgrade
created: 2026-11-04
updated: 2026-11-26
status: partially-shipped
tags: [plan, infrastructure, sessions, upgrade, pty]
---

# Seamless Upgrade

Install a new CADE build and switch the running backend to it without losing a terminal session. This plan holds what is left to build.

Parent: [[../README]] (plans index).

## Shipped

On Linux the backend upgrades itself in place. It execs the installed build with its PTYs and listening socket inherited, carries session state across in a handoff manifest, and `make install-desktop` triggers it. The desktop window loads its interface from the local backend, and a page that learns a newer interface is installed offers it as an "update ready" marker.

- Design, decisions, boundaries and measured costs: [[../../architecture/components#In-place Upgrade]]
- Sequence: [[../../architecture/data-flow#9. In-place Upgrade]]
- Desktop loader and the update marker: [[../../technical/core/frontend-architecture#Desktop Loader and Live Interface Updates]]
- Tabs that send their handshake late after an upgrade: [[../../technical/core/remote-sessions#Handshake: the client names its session first]]
- Install workflow: [[../../technical/core/development-setup#Keeping the Installed App Current (Linux)]]

## Remaining

### Upgrade state in the interface

The backend has the pieces: `GET /api/upgrade` reports a pending upgrade and why it is waiting, `POST` takes `now`, `DELETE` cancels. Nothing in the frontend uses them, and the `upgrading` message is only logged to the browser console.

- Show that an upgrade is pending and what it is waiting for, and that one is in progress.
- A "now" action that skips the idle wait.
- A cancel action. `cade-backend upgrade` has `--now` and `--status` but no way to cancel either.

### Controller across the upgrade

Which client controlled each terminal's size is not in the manifest. After an upgrade no terminal has a controller, and a terminal with none can be resized by any client that connects. The window in control before the upgrade should keep control across it.

Connection ids are made per socket, so the old id means nothing after the exec. The manifest would need something that identifies the client across a reconnect.

### One-folder build in versioned directories

Build the backend as a PyInstaller one-folder build instead of one file, and install each version under `/usr/lib/CADE/versions/<version>/` with a symlink flipped on install. This is a packaging change: `scripts/pyinstaller.spec`, `scripts/build-desktop.sh` and the Tauri bundle config.

What it would remove:

- **The lazy-import hazard.** A one-file binary opens its own path on each lazy import, so replacing it under a running backend crashes that backend later. With a directory per version, a build can sit installed and not activated for as long as needed. Today `install-desktop` calls the upgrade straight after dpkg to keep that window to seconds.
- **The launcher chain.** With no launcher, the exec'd process is the backend itself and no process is left waiting per upgrade.
- **Zombie shells.** The backend is again the parent of its shells and can reap them, and `InheritedPTY.is_alive` no longer needs its `/proc` fallback.
- **The unpack into `/tmp` at each upgrade**, and the removal of the previous build's directory that follows it.

What it would not remove on its own: the old image's file-watch workers. The handoff does not stop them, and the new image has no handle on them, so they would still end as zombies under the backend unless the old image stops them before the exec or the new one reaps them. This follows from reading the code and has not been tried.

### Open descriptors after the exec are not tested

Everything that must not reach the new image has to stay close-on-exec, and everything that must survive has to have the flag cleared. `backend/tests/test_upgrade_handoff.py` proves a shell outlives a real exec, but nothing asserts the exact set of descriptors the new image starts with. A test that execs into a checker script and compares that set would catch a leak.

### Deferred

- **Session-host daemon.** PTY ownership in a separate long-lived process. Windows needs it, because it has no `exec` and ConPTY handles do not travel. So does upgrading the Tauri shell and the loader page without restarting the app.
- **Remote deployments.** `scripts/deploy.sh` restarts through systemd, which ends the process and its sessions. It could call the upgrade endpoint instead, but the unit's own restart policy must not fight it.

## Open questions

- Should an orchestrator worker in the middle of its task delay the upgrade? Today only a streaming chat reply does, and a worker is cut. The alternative is to accept that workers restart from their task string.
- What should the idle cap be? It is ten minutes today (`DEFAULT_IDLE_CAP_SECONDS`).
- Should the Rust side learn about upgrades? Its readiness poll runs only at startup, and with the one-file build the pid it holds is the top of a chain of launchers.

## Evidence links

- [[../../reference/session-persistence]] for PTY persistence patterns and what state is worth carrying.
