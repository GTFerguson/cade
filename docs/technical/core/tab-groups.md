---
title: Tab Groups
created: 2026-11-25
updated: 2026-11-25
status: active
tags: [technical, frontend, backend, tabs, groups, attention]
---

# Tab Groups

How tabs are grouped into workspaces, one open at a time, each behind a coloured chip in the tab bar, and why the group belongs to the session on the backend. "Group" is the name in the code and the protocol; the interface calls an open group a workspace. Groups build on the session directory and attention state described in [[remote-sessions]].

## Purpose

CADE is used as a host for many agent sessions at once, typically several for work beside several for personal projects. In one flat tab bar, finding a tab and seeing which one is waiting means reading every name, and the keys that move between tabs stop being useful past nine or ten of them.

A group gathers related tabs behind one chip. One group is open at a time, as the workspace on screen; the others are closed to their chips. The tab keys (next, previous, go to tab 1–9) then act only on the open workspace, so twenty or thirty sessions stay navigable, and a closed chip still reports what the agents inside it need, so a waiting agent is never hidden.

The first version followed the tab groups of a web browser: several groups open at once, each collapsed by hand. It was replaced because nothing could be done from the keyboard, and because with many sessions the numbered keys pointed at whatever happened to be expanded.

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
- **The open workspace is the active tab's group.** `TabManager.getOpenWorkspace` reads it from the active tab, and `getCollapsedGroups` is every other group. Nothing stores which groups are closed, so the two cannot disagree. Switching to any tab, by any route, opens its workspace and closes the one left.
- **Ungrouped tabs are a workspace too.** They are a stop when moving between workspaces, and while a named workspace is open they close to one small unnamed chip showing their count, wherever on the bar they sit (`UNGROUPED` in `tab-groups.ts`).
- **Each workspace reopens where it was left.** `TabManager` remembers the tab last active in each (`lastTabInWorkspace`); `switchWorkspace` returns to it, or to the first tab when that one has gone.
- **Order and the open workspace are per browser.** Tab order is saved in `localStorage` with the tabs. Only membership is shared between devices, because a phone and a desktop want different things on show.
- **Dragging stays inside a run.** Each run of tabs has its own `TabDragController`, so a drag reorders within the workspace and cannot change it. Changing group is done from the tab's right-click menu.
- **A new tab joins the open workspace.** The project picker starts with the open workspace selected (see [[project-picker]]); the folder rule applies only when a tab is opened with no group chosen.
- **Menus.** `tab-menu.ts` is the right-click menu for tabs (move to group, new group, remove from group) and chips (rename, colour, open this workspace, folders to auto-add, ungroup). Clicking a chip opens its workspace.

### Moving between workspaces

`Alt+w` and `Alt+Shift+w` go to the next and previous workspace in tab bar order, wrapping (`TabManager.workspaceAt`). The switch happens on each press. Holding `Alt` for longer than `HOLD_MS` after a press brings up the list of workspaces (`frontend/src/tabs/workspace-switcher.ts`) with the open one marked, each with its tab count and the number waiting; letting go puts it away. The list is a view of what has already happened, never a pending choice, so a tap behaves the same whether or not the list had time to appear.

### Sliding

When the open workspace changes, the tabs of the one left shrink into its chip while the new one's grow out of theirs, over `ACCORDION_MS` (`tab-bar.ts`). The bar is rebuilt on every render, so the closing tabs are drawn once more as a picture with no ids or handlers and removed when the slide ends. One switch renders the bar more than once; a slide is therefore tied to the time it began, and a render that lands while it runs redraws it part-way through (a negative `animation-delay`) instead of restarting or dropping it. The animated property is a grid track, since a width of `auto` cannot be animated. Reduced-motion settings turn it off.

### What a closed chip shows

`groupRollup` reduces the attention states of a group's tabs to one mark on the chip, in the slot, glyphs and colours a tab uses for its own status (`STATUS_DISPLAY` in `tab-bar.ts`):

| Tabs inside | Chip shows |
|---|---|
| Several waiting on the user | A disc in the waiting colour with their number cut out of it |
| One waiting | The waiting mark |
| Else any working | The working mark |
| Else any finished | The finished mark |
| None reporting | The dim dot a quiet tab shows |

Only waiting tabs are counted. A group of five finished tabs must not look like one that needs the user. A closed chip with a tab waiting or finished is also tinted as that tab would be. The open workspace's chip shows no mark: its tabs are on the bar.

The chip carries its group's colour on its name and as a bar on its left edge. An earlier underline and background tint in the group colour were dropped as too heavy beside the tabs.

### Colours

`GROUP_COLOURS` lists the colours a group may take, in the order new groups receive them. Blue, cyan and orange come late in that order because on a tab they already mean working, finished and waiting.

## Saved state

`AppState` is at version 2. Its `collapsedGroups` field is still written, for a build that reads it, but is no longer read: which groups are closed follows from the active tab. `migrateAppState` (`tab-manager.ts`) upgrades version 1 state in place, with no groups. Before this, any version mismatch discarded the saved tabs.

## Boundaries

- A group carries a name and a colour only. Settings such as a default folder or a GitHub account are not part of it.
- Definitions are per backend and are not synchronised between a local and a remote backend.
- The phone has no chips. Its session strip names the open workspace, its arrows and swipes stay inside it (`workspaceTabs` in `frontend/src/ui/mobile/session-strip.ts`), and a `!N` there counts sessions waiting in other workspaces. The command menu lists sessions under their workspaces, which is how to move between them.
- Moving a tab to another workspace is done from the tab's right-click menu; there is no key for it.
- There are no key chords for collapsing a group or showing only one.

## See Also

- [[remote-sessions]] - session directory, attention state, in-place upgrade
- [[project-picker]] - where a new tab's workspace is chosen
- [[frontend-architecture]] - component architecture
- [[../reference/websocket-protocol]] - `set-group`, `group-changed`
