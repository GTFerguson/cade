---
title: Tab Groups
created: 2026-11-25
updated: 2026-11-25
status: active
tags: [technical, frontend, backend, tabs, groups, attention]
---

# Tab Groups

How tabs are grouped behind coloured, collapsible chips in the tab bar, and why the group belongs to the session on the backend. Groups build on the session directory and attention state described in [[remote-sessions]].

## Purpose

CADE is used as a host for many agent sessions at once, typically several for work beside several for personal projects. In one flat tab bar, finding a tab and seeing which one is waiting means reading every name. A group gathers related tabs behind one chip that can be collapsed, and a collapsed chip still reports what the agents inside it need, so a waiting agent is never hidden.

The model is the tab groups of a web browser: several groups visible at once, each collapsible, with ungrouped tabs allowed. A switcher that shows one workspace at a time was considered and rejected; "show only this group" gives that view when it is wanted without making it the only one.

## The session owns its group

A group is a name. `PTYSession.group` (`backend/terminal/sessions.py`) holds it, or `None`. It is included in the session listing and carried across an in-place upgrade (`SessionHandoff.group`, `backend/upgrade.py`).

The backend is the authority so that every device attached to a session agrees. `ConnectionHandler._assign_initial_group` (`backend/websocket.py`) applies these rules:

| Session | Group it gets |
|---|---|
| Being created, and the tab sent a `group` with `set-project` | That group |
| Being created, with no group sent | The group whose folder list holds the project path, if any |
| Already running | The one it has, whatever the client sent |

The third rule is the important one. A tab keeps a copy of its group in browser storage, and that copy can be stale: another device may have moved the session since. If an existing session accepted the client's copy, opening an old browser tab would undo the move. The saved copy is used only when the session is being created, which is what brings tabs back in their groups after the backend restarts and has forgotten them.

The `connected` reply carries the session's group and the tab adopts it. `set-group` moves a session, and every other client attached to it receives `group-changed`. Message shapes are in [[../reference/websocket-protocol]].

## Definitions: colour and folders

What a group looks like, and which folders join it automatically, live in `~/.cade/tab-groups.json`, read and written by `TabGroupStore` (`backend/terminal/tab_groups.py`) and served by `GET` / `PUT /api/tab-groups`. `PUT` replaces the whole list; entries without a usable name and repeated names are dropped.

A session whose group has no definition still shows as a group, in the default colour. That covers a group from a remote backend (definitions are per backend) and a definition deleted while tabs still carry the name.

**Folder rule.** A definition may list folders. A new session under one of them joins the group; when folders nest, the deepest wins, so a group for one project can sit inside a group covering the folder above it. The rule runs once, when the session is created. Moving a tab by hand afterwards therefore needs no marker to stop the rule regrouping it.

Ungrouping deletes the definition as well as clearing the tabs. Keeping the folder rule would bring the group straight back with the next tab opened there.

## Tab bar

The rules for laying out grouped tabs are pure functions in `frontend/src/tabs/tab-groups.ts`; `TabManager` holds the state and `TabBar` draws it.

- **Adjacency.** A group's tabs always sit together (`arrangeByGroup`). A tab joining a group goes to the end of it; a tab leaving goes just past it.
- **Order and collapse are per browser.** Tab order and the set of collapsed groups are saved in `localStorage` with the tabs (`AppState.collapsedGroups`). Only membership is shared between devices, because a phone and a desktop want different things on show.
- **Dragging stays inside a run.** Each run of tabs (one group, or adjacent ungrouped tabs) has its own `TabDragController`, so a drag reorders within the group and cannot change it. Changing group is done from the tab's right-click menu.
- **Collapsed groups are skipped.** Next tab, previous tab and go-to-tab count only tabs on show. Switching to a tab in a collapsed group by any other route expands the group. Collapsing the group that holds the active tab moves to the nearest tab still on show; if nothing else is on show, the active tab stays on screen.
- **Menus.** `tab-menu.ts` is the right-click menu for tabs (move to group, new group, remove from group) and chips (rename, colour, show only this group, folders to auto-add, ungroup).

### What a collapsed group shows

`groupRollup` reduces the attention states of a group's tabs to one mark on the chip:

| Tabs inside | Chip shows |
|---|---|
| Any waiting on the user | The waiting mark, with the number of waiting tabs when more than one |
| Else any working | The working mark |
| Else any finished | The finished mark, with no number |
| None reporting | Nothing |

Only waiting tabs are counted. A group of five finished tabs must not look like one that needs the user. The marks and colours are the ones a tab uses for its own status (`STATUS_DISPLAY` in `tab-bar.ts`).

### Colours

`GROUP_COLOURS` lists the colours a group may take, in the order new groups receive them. Blue, cyan and orange come late in that order because on a tab they already mean working, finished and waiting.

## Saved state

`AppState` is at version 2. `migrateAppState` (`tab-manager.ts`) upgrades version 1 state in place, with no groups. Before this, any version mismatch discarded the saved tabs.

## Boundaries

- A group carries a name and a colour only. Settings such as a default folder or a GitHub account are not part of it.
- Definitions are per backend and are not synchronised between a local and a remote backend.
- The phone shows the active session's group in the session strip; it has no chips or collapsing.
- There are no key chords for collapsing a group or showing only one.

## See Also

- [[remote-sessions]] - session directory, attention state, in-place upgrade
- [[frontend-architecture]] - component architecture
- [[../reference/websocket-protocol]] - `set-group`, `group-changed`
