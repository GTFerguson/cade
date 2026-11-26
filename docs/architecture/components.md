---
title: CADE Component Inventory
created: 2026-04-24
updated: 2026-11-26
status: active
tags: [architecture, components, inventory]
---

# Component Inventory

Full inventory of every significant component in CADE, with location, responsibility, and dependency relationships.

## Backend Components

### ConnectionHandler

| Field | Value |
|-------|-------|
| File | `backend/websocket.py` (~1,957 lines) |
| Entry | `ConnectionHandler.handle()` |
| Responsibility | Manages one WebSocket connection lifecycle — authentication, project routing, message dispatch, PTY lifecycle, chat streaming, file ops, Neovim, dashboard, agent events, permission prompts |

**Key methods:**

- `handle()` — Top-level connection loop; authenticates, calls `_setup()`, then runs receive/PTY output loops concurrently
- `_setup()` — Spawns PTY, joins the directory's shared `ProjectServices`, initialises provider registry and permission manager
- `_forward_file_changes()` — Sends this connection's queued file-change bursts as `file-changes` messages and feeds them to its `DashboardHandler`
- `_handle_message()` — Routes incoming WebSocket messages to sub-handlers by type
- `_stream_chat_response()` — Opens a provider stream and forwards `ChatEvent` objects to the client
- `_pty_output_loop()` — Reads PTY output bytes and sends them as OUTPUT messages

**Depends on:** `Config`, `ProviderRegistry`, `PermissionManager`, `OrchestratorManager`, `FileToolExecutor`, `NeovimManager`, `DashboardHandler`, `ChatSession`

**Depended on by:** FastAPI route in `main.py`

---

### ProjectServices

| Field | Value |
|-------|-------|
| File | `backend/project_services.py` |
| Entry | `acquire_project(root, listener)` / `release_project(services, listener)` |
| Responsibility | Owns the `WatchProcess`, `DocIndexService` and `NkrdnService` for one resolved directory, shared by every connection open on it |

Each tab is its own WebSocket connection, and several tabs are often open on one project. When each connection ran its own watcher and index services, a burst of file changes was processed once per tab and every code edit started one nkrdn rebuild per tab. Connections now register a `ProjectListener` with the directory's single `ProjectServices`; the first registration starts the watcher and the last release stops it and cancels pending rebuilds.

**How it works:**

- The watch loop reads `WatchProcess.watch_batches()`, so a debounced burst moves through the system as one list. Each burst goes to the index services per event (they debounce their own rebuilds) and to every listener as a whole.
- Listener callbacks are synchronous and only enqueue. Each `ConnectionHandler` drains its own queue in `_forward_file_changes()`, so a slow or dead socket delays only its own tab, and a listener that raises is logged without stopping the others.
- `enable_indexing()` creates the index services and runs their initial builds once, on the first non-kiosk connection. Later tabs reuse the result and receive the current graph on connect. A directory opened only in kiosk mode is watched but not indexed.
- Watcher failures (including a worker that exits on its own) are retried with exponential backoff (2s, 4s, 8s) by recreating the watcher; after that, watching stays off and tabs stop receiving live updates.

**Why the watcher is a separate process:** watchfiles registers a recursive inotify watch inside its Rust constructor while holding the GIL, and registration walks every entry under the root. On a project with a few hundred thousand files that is about seven seconds with a warm cache, during which the whole backend was frozen and every tab's terminal stopped; running the constructor on a thread does not help because of the GIL. `WatchProcess` (`backend/watch_process.py`) launches `backend/watch_worker.py` as a child process, one per open project, which runs the in-process `FileWatcher` and streams each burst back as a JSON line on stdout. The child is driven with a plain `Popen` and blocking reads on worker threads rather than asyncio's subprocess transport, because cancelling a task while that transport is still connecting its pipes leaves the event loop unable to close on CPython 3.12. The worker stops when its stdin closes, so a backend that dies takes its workers with it. The packaged binary exposes it as `cade-backend watch <dir>`, dispatched at the top of `backend/main.py` before the server imports so each worker stays small.

**What the watcher watches:** not everything under the root. A recursive watch costs one inotify watch per directory whether or not its events are wanted, and filtering events from an ignored folder gives none of them back. On 26 Nov 2026 one worker held 456,207 of the machine's 524,288 watches, because the project keeps 73 worktrees and its build output in gitignored folders (470,788 directories there, about a hundred elsewhere), and with another project's worker the budget was gone: no other program on the machine could start watching files. `FileWatcher` (`core/backend/watcher.py`) now walks the tree itself (`watched_dirs`), never enters a folder that is ignored by name (`WATCH_IGNORE_DIRS`) or that its `prune` callback rejects, and puts one non-recursive watch on each directory that is left. The worker passes the project's gitignore rules as `prune`. On that project it holds 105 watches.

A running watch cannot be given another directory, so a new folder ends the round: its tree is walked, whatever was already inside is reported as created (a folder and its first file are often made before the watch on it exists), and watching starts again with it included. A deleted folder is dropped the same way. At most `MAX_WATCHED_DIRS` directories are watched under one root, shallowest first, so a root as broad as a home directory cannot take the budget either; the worker says so in its log when it stops short.

The cost is that the file tree does not update live inside gitignored folders. That is deliberate: when work is driven from a parent folder with the clones beneath it, nothing in the interface is looking at those files.

**Boundaries:** `DashboardHandler` stays per connection, because each tab may show a different dashboard file. Opening a second tab no longer re-runs the initial nkrdn build; the directory is already being watched, so the graph is current.

**Probes before indexing:** `has_code()` (`nkrdn_service.py`) and `has_docs()` (`doc_index.py`) decide whether a directory is worth indexing. Both use `walk_project()` in `backend/files/listing.py`, which prunes the directories the file tree ignores (name-ignored and root-gitignored) and stops after a bounded number of directories, answering "yes" past the limit so the indexer decides. They run in a thread. An unpruned `rglob` on the event loop took six seconds on a project whose gitignored trees held a million files, with every tab frozen for the duration.

- Before fan-out, each event is tagged with whether the root `.gitignore` hides its path (`gitignore_matcher`, one `.gitignore` read per burst), and the worker has already recorded whether a created path is a directory. Tabs patch their file trees from these events instead of refetching them, so the message has to carry what a client cannot find out for itself.

**Depends on:** `WatchProcess` (wrapping `FileWatcher` in a child process), `DocIndexService`, `NkrdnService`, file-tree cache (invalidated for each changed path that lies within the levels a cached tree shows)

**Depended on by:** `ConnectionHandler`

---

### FastAPI Application (`main.py`)

| Field | Value |
|-------|-------|
| File | `backend/main.py` (~1,174 lines) |
| Entry | `create_app()` → ASGI app; `main()` → CLI |
| Responsibility | Mounts all HTTP routes, WebSocket endpoint, static files, auth middleware; CLI parsing for `serve`/`view`/`setup-hook` subcommands |

**REST API groups:**

| Prefix | Module | Purpose |
|--------|--------|---------|
| `/api/orchestrator/` | orchestrator router | Agent spawn, approve, reject, status |
| `/api/permissions/` | permissions router | Prompt-and-wait, approve, deny, state, set |
| `/api/view` | inline | Receive hook POST, broadcast VIEW_FILE |
| `/api/neovim/` | neovim router | Diff endpoints |
| `/ws` | websocket handler | Main WebSocket connection |
| `/` | StaticFiles | Serves `frontend/dist/` |

**Depends on:** All backend subsystem modules

---

### OrchestratorManager

| Field | Value |
|-------|-------|
| File | `backend/orchestrator/manager.py` (~400 lines) |
| Responsibility | Spawns AI agent subprocesses, manages two-gate approval flow (spawn approval + report approval), tracks agent state, routes output to owning connection only |

**Agent lifecycle:**

```mermaid
stateDiagram-v2
    [*] --> PENDING : spawn_agent()
    PENDING --> RUNNING : approve_agent()
    PENDING --> [*] : reject_agent()
    RUNNING --> REVIEW : agent completes, has report
    RUNNING --> COMPLETED : agent completes, no report
    RUNNING --> FAILED : subprocess error
    REVIEW --> COMPLETED : approve_report()
    REVIEW --> RUNNING : reject_report() → re-runs
    COMPLETED --> [*]
    FAILED --> [*]
```

**Key methods:**

- `spawn_agent(spec)` → `AgentRecord` in PENDING state
- `approve_agent(agent_id)` → starts an `APIProvider` worker via `_make_worker_provider()`
- `await_completion(agent_id)` → blocks until COMPLETED/FAILED
- `approve_report()` / `reject_report()` → gate on final summary review

**Depends on:** `PermissionManager`, `APIProvider`

**Depended on by:** `ConnectionHandler`, orchestrator HTTP router

---

### PermissionManager

| Field | Value |
|-------|-------|
| File | `backend/permissions/manager.py` (~400 lines) |
| Responsibility | Single source of truth for current mode, category toggles, and interactive approval requests |

**Permission model:**

```mermaid
graph TD
    REQ[Tool request] --> MODE{Mode allows?}
    MODE -- No --> DENY[Deny immediately]
    MODE -- Yes --> CAT{Category toggle ON?}
    CAT -- Yes --> ALLOW[Allow]
    CAT -- No --> UI[Show UI approval prompt]
    UI --> USER{User decision}
    USER -- Approve --> CACHE[Cache path, Allow]
    USER -- Deny --> DENY
```

**Toggles:** `allow_read`, `allow_write`, `allow_tools`, `allow_subagents`, `auto_approve_reports`

**Modes:** `code`, `architect`, `review`, `orchestrator`

**Tool classification:**

- READ_TOOLS: `Read`, `Glob`, `Grep`, `LS`, `list_directory`, `View`, `Cat`
- WRITE_TOOLS: `Write`, `Edit`, `MultiEdit`, `Create`, `Delete`, `Move`, `Rename`

**Depends on:** `asyncio.Event` (for blocking approval), WebSocket sender reference

**Depended on by:** `ConnectionHandler`, `FileToolExecutor`, `OrchestratorManager`, permissions HTTP router

---

### ProviderRegistry

| Field | Value |
|-------|-------|
| File | `backend/providers/registry.py` |
| Responsibility | Manages provider instances; resolves global vs project-local providers; handles provider switching |

**Resolution order:** project-local (`launch.yml`) → global (`~/.cade/providers.toml`) → default

**Depended on by:** `ConnectionHandler`, orchestrator

---

### SubprocessProvider

| Field | Value |
|-------|-------|
| File | `core/backend/providers/subprocess_provider.py` |
| Responsibility | Runs an arbitrary CLI command with streaming JSON output; supports `initial_command` for bootstrap |

**Depended on by:** `ProviderRegistry` (project-local providers in `launch.yml`)

---

### WebSocketProvider

| Field | Value |
|-------|-------|
| File | `core/backend/providers/websocket_provider.py` |
| Responsibility | Connects to a persistent WebSocket server; handles unsolicited server-pushed events; supports Google OAuth auth; implements `set_event_handler()` and `send_frame()` |

**Depended on by:** `ProviderRegistry` (used by Padarax game engine and similar)

---

### FileToolExecutor

| Field | Value |
|-------|-------|
| File | `backend/tools/file_tools.py` (~150 lines) |
| Responsibility | Executes file read/write MCP tools with permission enforcement and path scope checking |

**Tools exposed:**

| Tool | Description |
|------|-------------|
| `read_file` | Read file content, optional line range |
| `list_directory` | List files in directory |
| `write_file` | Overwrite entire file |
| `edit_file` | Replace unique string in file |
| `delete_file` | Delete file |

**Depends on:** `PermissionManager`

**Depended on by:** MCP tool registry passed to `APIProvider`

---

### Hooks System

| Field | Value |
|-------|-------|
| Files | `backend/hooks/commands.py`, `installer.py`, `settings.py`, `wsl_path.py` |
| Responsibility | Generates and installs a Claude Code `PostToolUse` hook; receives HTTP POST when CC edits a file; broadcasts `VIEW_FILE` to connected clients |

**Hook flow:** CC edits file → hook script → `POST /api/view` → `VIEW_FILE` WebSocket message → frontend viewer overlay

**Depended on by:** `main.py` (`/api/view` route), CLI `setup-hook` subcommand

---

### Prompts & Skills

| Field | Value |
|-------|-------|
| Files | `backend/prompts/__init__.py`, `backend/prompts/slash_commands.py` |
| Responsibility | Assembles mode-specific system prompts from modular markdown files; loads bundled and user-defined skills as slash commands |

**compose_prompt(mode)** — Concatenates: base rules + mode-specific instructions + bundled rules from `.claude/rules/`

**build_slash_commands()** — Returns registered skills: bundled (handoff, plan, architect, code, review, orch, compact) + user skills from `~/.claude/skills/`

**Depends on:** `backend/prompts/bundled/`, `~/.claude/skills/`, `~/.claude/rules/`

**Depended on by:** `ConnectionHandler` (prompt injection), `WebSocketClient` (skill invocation)

---

### DashboardHandler

| Field | Value |
|-------|-------|
| Files | `core/backend/dashboard/handler.py`, `core/backend/dashboard/config.py` |
| Responsibility | Loads `.cade/dashboard.yml`, watches for config changes, polls data sources, broadcasts updates to frontend |

**Data source types:** `directory` (scans markdown frontmatter), `rest` (polls HTTP endpoint), `model_usage` (LiteLLM metrics)

**Config watch:** the handler notices `.cade/dashboard.yml` appearing, changing or vanishing with two *non-recursive* watches, one on the project root (to see `.cade/` itself come or go) and one on `.cade/` when it exists, re-registering when that directory appears or disappears. It used to be one recursive watch over the whole project per connection. watchfiles registers a recursive watch while holding the GIL, so each tab opened on a 188k-directory project froze the backend for 14 to 26 seconds, and the watches it held (one per directory, per tab) exhausted the user's inotify budget, after which nothing on the machine could register a new watch.

**Depended on by:** `ConnectionHandler`

---

### PTY Manager / Terminal

| Field | Value |
|-------|-------|
| File | `backend/terminal/` |
| Responsibility | Spawns and manages PTY sessions; supports session resumption with scrollback; handles resize |

**Platform support:** pexpect (Unix), pywinpty (Windows), plus `InheritedPTY` for a master descriptor and child pid taken over from a previous program image (see In-place Upgrade). `BasePTY.stop_reading()` pauses a reader after the chunk in flight instead of cancelling it, so a handoff loses nothing the worker thread had already read.

**Depended on by:** `ConnectionHandler`, `backend/upgrade.py`

---

### In-place Upgrade

| Field | Value |
|-------|-------|
| File | `backend/upgrade.py` |
| Entry | `POST /api/upgrade`, `cade-backend upgrade`, `UpgradeCoordinator` |
| Responsibility | Switch the running backend to a newly installed build without ending any terminal session |

The backend is the parent of every shell and holds every PTY master, so a restart ends every session. An upgrade instead replaces the process's program image with `os.execve`. The pid is unchanged, so the desktop sidecar's handle on the child stays valid with no Rust changes. The PTY masters and the HTTP listening socket are descriptors and survive the exec once their close-on-exec flag is cleared. Everything else (session ids, labels, tab groups, each session's agent, working directories, scrollback with sequence numbers, terminal sizes, attention state, enhanced-chat history) travels in a JSON manifest at `~/.cade/upgrade/handoff.json`, which the new image adopts in its lifespan before any tab reconnects.

What runs behind that pid afterwards depends on the build. From a source checkout the exec'd interpreter is the backend itself, and the shells stay its children. The installed backend is a one-file PyInstaller binary: the exec'd image is its launcher, which unpacks the build and runs the backend as a child. The shells are then children of the launcher and siblings of the backend. The design decisions below say why that was accepted.

**How it works:**

1. `request()` verifies the target binary answers `--version` (a one-file PyInstaller build extracts itself first, so this is allowed 30s) and marks the upgrade pending. The default target is the backend's own path, which after a reinstall holds the new build.
2. The coordinator waits until no chat response is streaming, capped at ten minutes (`DEFAULT_IDLE_CAP_SECONDS`), then proceeds anyway with the partial reply kept. Shells and CLI agents mid-task do not count as busy: their processes are untouched.
3. `perform_handoff()` broadcasts `upgrading` to every tab, pauses each PTY reader, exports the registry and chat sessions, marks the descriptors inheritable, writes the manifest, flushes the logs and execs `exec_argv()` in the environment from `exec_environment()`: the same `serve` arguments this process started with plus `--resume-handoff <manifest>`, and the switch that makes a one-file build unpack its own files.
4. The new image binds nothing: `run_serve` adopts the listener from the manifest and hands it to uvicorn, and `lifespan` rebuilds each session around `PTYManager.adopt(fd, pid)` with its scrollback and `last_seq`, adopts the chat registry, removes the old image's extraction directory and deletes the manifest.
5. Tabs see their socket drop and reconnect by the ordinary backoff, all at once. A page redrawing many terminals can send some of its handshakes seconds late. The backend waits for a handshake the client announced, and closes a connection whose handshake arrives after setup so that it reconnects onto its own session; see [[../technical/core/remote-sessions#Handshake: the client names its session first]].
6. A client whose page the backend serves sends `reloadOnUpgrade` in `set-project`, and its `connected` reply carries `buildVersion` and `frontendVersion`. A page that sees the interface's id change shows an "update ready" marker and reloads only when the marker is clicked. Its tabs then re-attach to their live sessions as on any reconnect. The page's side is in [[../technical/core/frontend-architecture#Desktop Loader and Live Interface Updates]].

Measured on a dev backend: same pid, about 1.6s between the exec and the first reconnect, pre-upgrade scrollback replayed. That is the exec alone; the handshake section linked in step 5 has the time for ten tabs to be back on their sessions.

**Design decisions:**

- *Exec in place rather than fd passing to a second process.* Passing descriptors over `SCM_RIGHTS` works, but the Tauri sidecar handle would point at a dead pid once the old process exited, and the shells would be reparented to init. Keeping the pid keeps the handle valid and needs no protocol. From a source checkout it also keeps the shells as the backend's children; the one-file build gives that part up, as the next two points explain.
- *The new image unpacks its own files.* PyInstaller's launcher leaves variables in the environment that tell a one-file binary started beneath it to run from the directory already unpacked. A new build exec'd with them set would run from the previous build's directory, which holds that build's frontend, data files and native libraries. `exec_environment()` sets `PYINSTALLER_RESET_ENVIRONMENT=1` (`FRESH_UNPACK_FLAG`), so the new image starts as a new instance and unpacks its own copy. The price is that the exec'd process is a launcher and the backend is its child.
- *A shell that is not our child has its state read from `/proc`.* `InheritedPTY.is_alive` tries `waitpid` first. Under a one-file build that raises `ChildProcessError`, because the shell belongs to the launcher. The launcher does not reap, and a signal probe still succeeds against a process that has exited and not been reaped, so `_is_running` reads the state field of `/proc/<pid>/stat` and counts a zombie as exited.
- *The listening socket is bound by the backend, not uvicorn.* `run_serve` binds it (`bind_listener`) and passes it to `uvicorn.Server.run(sockets=[...])`, so it is a known descriptor the manifest can name. uvicorn's own `fd` option was avoided because it wraps the fd as `AF_UNIX` regardless of family.
- *Readers are paused, not cancelled.* Cancelling the reader task would drop the chunk the worker thread was mid-`read`. `stop_reading()` lets that read finish and publish; output the shell writes afterwards waits in the kernel's PTY buffer for the new image's reader.
- *The old `_MEIPASS` is removed by the new image.* The PyInstaller bootloader cleans its extraction directory only on a normal exit, which exec is not. Deleting it before the exec would leave the old process unable to import anything if the exec then failed, so the new image deletes it, and only when it is a sibling of its own extraction directory (`remove_old_extraction`). A failed handoff rolls back to a fully working backend: readers restart and descriptors go back to close-on-exec.
- *A failed `--version` refuses the upgrade* rather than exec'ing into a binary that may not start. Nothing is exported until the target checks out.
- *Build ids go only to clients that ask.* A page the backend does not serve, such as a desktop window running the copy built into the app, gets the same page back from a reload, so telling it about a new build can only interrupt its sessions. The choice sits on the backend (`_reload_on_upgrade` in `ConnectionHandler`) so that a page which does not know to ask is never shown a build id to react to.
- *The page is judged by the interface's identity, not the backend's.* `frontend_id()` hashes the built `index.html`, which names its scripts and styles by content hash. An upgrade that changes only the backend leaves that hash alone, so the page has nothing to offer and no terminal is redrawn. A backend that sends no `frontendVersion` is judged by `buildVersion`.

**Configuration:** `POST /api/upgrade` with optional `{"executable": path, "now": true}`; `GET` reports state (`idle`, `pending` with `busyReason`, `upgrading`, `unsupported`) and the running `buildVersion`; `DELETE` cancels a pending upgrade. `cade-backend upgrade [--exe PATH] [--now] [--status]` wraps the API using `~/.cade/port` and `~/.cade/host`. `make install-desktop` calls it after dpkg, so the window between "new binary on disk" and "old image still lazily importing from that path" is seconds; a one-file PyInstaller binary opens its own path on each lazy import, and swapping it under a long-running old image crashes that image with a zlib "incorrect header check". `make install-desktop-built` installs the built package with no upgrade call, for a build that should wait for the next launch; it refuses while a backend is running, for the same reason.

**Boundaries:**

- Not carried: orchestrator worker agents (in-process tasks, re-spawnable from their task string), in-flight chat streams (the partial reply is kept), file-tree caches and index builds (they restart), and which client controlled each terminal's size. After an upgrade a terminal has no controller, and `PTYSession._controls` lets any client resize a terminal that has none.
- Only a streaming chat reply delays the exec (`default_busy_reason`). An orchestrator worker in the middle of its task does not, and is lost with the old image.
- Windows has no `exec` and ConPTY handles do not travel this way, so `supported()` is false there and an upgrade still means a restart.
- The Tauri shell and the desktop loader page are compiled into the `cade` binary and cannot be upgraded this way.
- A backend older than this feature has no endpoint, so the first upgrade onto a build that has it is still a restart.
- The installed build leaves processes behind at each upgrade, until the app closes. The exec'd launcher stays, waiting on its backend, so the chain under the desktop app grows by one process per upgrade. A launcher does not reap, so anything that was a child of the old backend and exits later stays a zombie.
  - Measured on the installed app on 26 November 2026: 26 `cade-backend serve` processes in one chain (the launcher from the app's start, 24 former backends now waiting as launchers, and the running backend), with 56 zombie `cade-backend` processes and 21 zombie shells under the old ones.
  - The zombie shells fit sessions that ended after the upgrade that turned their parent into a launcher. They were not traced one by one.
  - What the `cade-backend` zombies are is inferred, not observed, because a zombie keeps no command line. `perform_handoff()` does not stop the file-watch workers. Each is a `cade-backend watch <root>` child that exits when its stdin closes (`backend/watch_worker.py`), which the exec would cause if the pipe to it is close-on-exec. The running backend's only `cade-backend` children at the time were its four watch workers. Old watch workers are the likely source.
  - What the waiting launchers cost in memory was not measured.

**Depended on by:** `main.py` (routes, `--resume-handoff`, listener), `ConnectionHandler` (`buildVersion`, `frontendVersion`), `Makefile` (`install-desktop`, `install-desktop-built`)

---

### NeovimManager

| Field | Value |
|-------|-------|
| File | `backend/neovim/` |
| Responsibility | Spawns Neovim as a PTY subprocess; forwards I/O; generates diff hunks for file edits |

**Depended on by:** `ConnectionHandler`

---

## Frontend Components

### App Bootstrap (`main.ts`)

| Field | Value |
|-------|-------|
| File | `frontend/src/main.ts` (~38,800 lines) |
| Responsibility | Initializes WebSocket client, mounts root UI, wires global keyboard shortcuts, manages layout (tab bar, pane splits) |

---

### WebSocketClient

| Field | Value |
|-------|-------|
| File | `frontend/src/platform/websocket.ts` |
| Responsibility | Typed WebSocket wrapper; appends auth tokens to URL; routes server events to registered listeners; handles reconnection |

**Depends on:** `core/frontend/platform/` base classes

---

### Chat Pane

| Field | Value |
|-------|-------|
| File | `frontend/src/chat/chat-pane.ts` (~40,200 lines) |
| Responsibility | Renders chat history; streams incoming events (text-delta, tool-use-start, tool-result); handles slash commands, mode switches, provider selection; shows permission prompt modals |

---

### Terminal Manager

| Field | Value |
|-------|-------|
| Files | `frontend/src/terminal/terminal.ts` (~15,100), `terminal-manager.ts` (~22,400) |
| Responsibility | xterm.js wrapper (canvas/WebGL renderer, fit addon); multi-terminal orchestration for Claude + manual sessions; session restoration with scrollback |

---

### File Tree

| Field | Value |
|-------|-------|
| File | `frontend/src/file-tree/` |
| Responsibility | Lazy-load directory children; gitignore-aware filtering; file type icons; click-to-open |

---

### Markdown Viewer

| Field | Value |
|-------|-------|
| File | `frontend/src/markdown/` |
| Responsibility | Milkdown editor for GFM rendering with math (LaTeX), diagrams (Mermaid), and syntax highlighting; editor mode for interactive editing |

---

### Neovim Pane

| Field | Value |
|-------|-------|
| File | `frontend/src/neovim/neovim-pane.ts` |
| Responsibility | Renders Neovim PTY output; forwards key input; shows diff split view |

---

### Dashboard Renderer

| Field | Value |
|-------|-------|
| File | `frontend/src/dashboard/` |
| Responsibility | Renders dashboard panels from config (cards, table, checklist, kanban, key_value, markdown, entity_detail); hot-reloads on config changes |

Components extend `BaseDashboardComponent` and receive `{ panel, data, allData, config, onAction }`. The `entity_detail` component is composition-driven — its layout is declared in YAML via `options.sections`, with each section delegating to either inline renderers (header, key_value, prose, cross_refs) or another registered component (claims). New content types are added by writing YAML, not TypeScript.

### EntityResolver

| Field | Value |
|-------|-------|
| File | `frontend/src/platform/entity-resolver.ts` |
| Responsibility | Pluggable interface for resolving `@type:id` cross-reference tokens to file paths. Projects register an implementation at startup via `setEntityResolver()`; dashboard components call `getEntityResolver()` as a fallback when in-memory `allData` lookups miss |

**When to register one:** if your project's content uses `@type:id` cross-reference syntax inside prose fields and you want clicks to navigate. Without a resolver registered, `entity_detail` and `claims` components fall back to `allData` lookup only — fine if every referenced entity is already loaded as a dashboard data source, but it won't navigate to entities outside the dashboard's loaded scope.

**Pre-computed liveness via `_ref_status`:** if you also generate enriched copies of your content with a per-ref `_ref_status` map (`{"@type:id": "resolved" | "stub" | "dead"}`), components prefer that over runtime resolution — a ref marked `"dead"` renders unclickable even if the resolver would build a path for it. This lets a build-time validator (which has full corpus knowledge) drive the viewer's UX without runtime indexing.

---

### Type Definitions

| Field | Value |
|-------|-------|
| File | `frontend/src/types.ts` (~14,900 lines) |
| Responsibility | TypeScript interfaces for all WebSocket message payloads; shared by all frontend components |

---

## Core Shared Module

| Component | File | Purpose |
|-----------|------|---------|
| `BaseProvider` | `core/backend/providers/base.py` | Abstract interface: `stream_chat()`, `capabilities`, lifecycle |
| `ChatEvent` types | `core/backend/providers/types.py` | `TextDelta`, `ThinkingDelta`, `ToolUseStart`, `ToolResult`, `ChatDone`, `ChatError` |
| `ChatMessage` | `core/backend/providers/types.py` | `{role, content}` conversation turn |
| `ToolDefinition` | `core/backend/providers/types.py` | `{name, description, parameters_schema}` |
| `ProviderConfig` | `core/backend/providers/config.py` | Config loading from TOML with env-var interpolation |
| `ChatSession` | `core/backend/chat/session.py` | In-memory history registry keyed by session ID |
| `DashboardConfig` | `core/backend/dashboard/config.py` | YAML schema for dashboard configuration |
| `FileWatcher` | `core/backend/watcher.py` | Debounced file change notifications via watchfiles; `watch_batches()` yields each burst as a list, `watch()` yields single events |
| `WatchProcess` | `backend/watch_process.py` | Same surface as `FileWatcher`, but runs it in a `backend/watch_worker.py` child process so registering watches on a huge tree cannot stall the backend |

---

## Dependency Graph

```mermaid
graph TD
    MAIN[main.py] --> WS_H[ConnectionHandler]
    MAIN --> PERM_R[permissions router]
    MAIN --> ORCH_R[orchestrator router]

    WS_H --> PTY[PTY Manager]
    WS_H --> PROV_R[ProviderRegistry]
    WS_H --> PERM_M[PermissionManager]
    WS_H --> ORCH_M[OrchestratorManager]
    WS_H --> HOOK[Hooks Handler]
    WS_H --> DASH[DashboardHandler]
    WS_H --> NV[NeovimManager]
    WS_H --> CHAT_S[ChatSession]

    PROV_R --> API[APIProvider]
    PROV_R --> SP[SubprocessProvider]
    PROV_R --> WSP[WebSocketProvider]

    API -->|LiteLLM| LLM[LLM APIs]
    API -->|MCP stdio| MCP[MCP Servers]

    ORCH_M --> PERM_M
    ORCH_M --> API

    PERM_M --> FILE_T[FileToolExecutor]

    HOOK -->|POST /api/view| WS_H

    PERM_R --> PERM_M
    ORCH_R --> ORCH_M
```

## See Also

- [[overview|Architecture Overview]]
- [[data-flow|Data Flow]]
- [[dependencies|Dependencies]]
- [[../technical/reference/websocket-protocol|WebSocket Protocol Reference]]
