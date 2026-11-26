---
title: Project Picker and Per-Tab Agent
created: 2026-11-25
updated: 2026-11-25
status: active
tags: [technical, frontend, backend, tabs, picker, agents, handoff]
---

# Project Picker and Per-Tab Agent

How a new tab chooses its project, the handoff it starts from, its tab group and the agent it runs. Sessions and their lifetime are in [[remote-sessions]]; groups are in [[tab-groups]].

## Purpose

Opening a tab used to mean the operating system's folder dialog on the desktop, a different browser in the web page and a third on the phone, and none of them knew about running sessions, handoffs or which agent the tab should run. The picker is one keyboard-driven screen for all three, and it is where every per-tab choice is made before the session exists.

## How it works

The picker (`frontend/src/local/project-picker.ts`) draws what `picker-model.ts` returns; the model holds no DOM, so what is listed and how it is filtered is tested without a browser.

Two columns:

| Column | Contents |
|---|---|
| Left | The folder being browsed. At the projects folder, every project in it, most recently worked on first. Elsewhere, plain folders. |
| Right | Quick choices: projects already open in a tab, sessions running on the backend with no tab, and projects opened lately on this device. |

Keys: `j`/`k` move within a column, Tab crosses between them, `h`/`l` walk up and down folders and never open anything, Enter chooses. `/` filters, or takes a typed path. Choosing a folder shows its second screen: a new session, then the project's handoffs newest first. `a` switches the agent and `g` the workspace (tab group). The workspace toggle sits in the top left corner and the agent toggle in the top right: one says where the tab goes, the other what runs in it. The group starts as the workspace that is open, so a new tab joins the work on screen unless `g` says otherwise. The system folder dialog is the last entry.

The picker resolves to one of three results (`PickerResult`): open a tab on a project (with optional group, agent and handoff), attach a tab to a session already running, or fall back to the system dialog.

### Where the lists come from

| List | Source |
|---|---|
| Projects | `GET /api/projects` (`backend/projects.py`): folders under the projects root, with a last-worked-on time and a handoff count. The same response lists the agents a tab may choose and whether each is installed. |
| Handoffs | `GET /api/projects/handoffs?path=`: the briefs in the project's `docs/plans/handoff/`, titled from frontmatter or first heading. A README there is an index, not a brief. |
| Folders elsewhere | `GET /api/browse?path=` |
| Running sessions | `GET /api/sessions`, the session directory |
| Recent projects | The browser's `localStorage` (`recent-projects.ts`) |

"Last worked on" is the newest of `.git/index`, `.git/logs/HEAD` and the handoff folder. A project folder's own time only moves when a top-level entry is added or removed, which says little about whether work happened there.

Recent projects are kept in the browser, not on the backend, because "recent" is about what this person opened on this device.

### Starting from a handoff

Choosing a handoff opens a tab whose `set-project` carries an `initialPrompt` (`handoffPrompt` in `picker-model.ts`), which the backend passes to the agent at launch. The prompt asks the agent to read the brief, say where things stand and what it would do next, and wait for a go-ahead before changing anything, even if the brief says to proceed. Opening a handoff is often the start of a discussion, and an agent told to resume would be at work before the user had said what the session is for.

## Per-tab agent

The backend has one configured agent (`CADE_CLI_AGENT_ADAPTER`, Claude Code by default). A tab may ask for another when it opens: `set-project` may name `agent`, and the picker offers Claude Code and Codex (`SELECTABLE_AGENTS` in `backend/terminal/session_agents.py`).

- **The session owns the choice.** A new session takes the agent its first tab asked for and records it; a tab attaching to an existing session gets that session's agent whatever it asked for. This is the same rule as tab groups, for the same reason: a second device must not change what is already running.
- **An unknown agent id is ignored**, and the tab runs the configured agent.
- **The configured agent keeps its configured command and prompt convention.** Any other agent gets its adapter's defaults, since the configured values were written for a different program.
- **One resume script serves every agent.** The wrapper that launches the agent and relaunches it on a fresh handoff (`backend/terminal/agent_launch.py`) has the configured agent baked in and reads `CADE_CLI_AGENT`, `CADE_CLI_AGENT_ADAPTER`, `CADE_CLI_AGENT_SEED_STYLE` and `CADE_CLI_AGENT_SEED_FLAG` from the PTY environment to override it. A per-tab agent is those four variables (`agent_env`), not a second script.

The picker remembers the last agent chosen on the device.

### A picker choice starts the agent

`behavior.toml` can ask for idle shells (`auto-start-claude = false`), so that any agent can be started by hand. That setting predates the picker's agent choice, and obeying it made every tab opened from the picker land in a shell with the chosen agent and handoff ignored. A tab opened from the picker therefore sends `startAgent` in `set-project`, and `ConnectionHandler._auto_start_agent` starts the agent for it, as it does for any tab with an `initialPrompt`. The idle-shell setting still applies to tabs that did not say what they want.

`startAgent` is a one-off, like `initialPrompt`: it is not saved with the tab, so a tab brought back after the backend has lost its session opens a shell and does not launch an agent nobody asked for. A server run with the agent switched off (`--no-claude` / `CADE_AUTO_START_CLAUDE=false`) never starts one.

## Desktop window

The desktop window's page is served by the app shell, not the backend, so a request to a path relative to the page reaches the shell and comes back empty with no error. Every request the picker makes goes through `apiBase()` (`frontend/src/config/config.ts`), which returns the backend's address there and the page's own base path in a browser.

## Configuration

| Knob | Where | Default |
|---|---|---|
| Projects root | `CADE_PROJECTS_ROOT` | `~/projects` |
| Configured agent | `CADE_CLI_AGENT_ADAPTER` | `claude-code` |
| Agents offered per tab | `SELECTABLE_AGENTS` in `session_agents.py` | Claude Code, Codex |
| Recent projects kept | `RECENTS_LIMIT` in `picker-model.ts` | |

## Boundaries

- The picker lists projects on the backend it is talking to. Remote backends are chosen elsewhere (Shift+click on the tab bar's plus).
- It does not create projects or folders.
- Changing a running session's agent is not supported; close the tab and open another.

## See Also

- [[tab-groups]]
- [[remote-sessions]]
- [[frontend-architecture]]
