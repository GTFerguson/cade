---
title: Tab Groups
created: 2026-11-25
updated: 2026-11-25
status: in-progress
tags: [plan, tabs, groups, attention]
---

# Tab Groups

Phase 1 of [[organisation-and-cleanup-roadmap]]. The roadmap called this
"workspaces above tabs"; the model settled on is tab groups as Chrome has them.

## Context

Work tabs (AirPLAi) and personal tabs sit in one flat tab bar. With eight or
more open, finding a tab and seeing which one is waiting takes reading every
name.

## What it adds

- A group is a name and a colour. A tab belongs to one group or to none.
- A group's tabs sit together in the tab bar behind a chip showing the name in
  the group's colour, and each tab carries a line in that colour.
- Clicking the chip collapses the group to the chip alone, or expands it. The
  sessions in a collapsed group keep running.
- A collapsed chip shows what its tabs need: a count of tabs waiting on the
  user, otherwise a working mark, otherwise a finished mark.
- "Show only this group" collapses every other group in one action, which is
  the workspace switch the roadmap described.

## Decisions (answered 25 Nov 2026)

| Question | Answer |
|----------|--------|
| Where a tab's group is stored | On the backend session, so every device agrees. Tab order and which groups are collapsed stay per browser. |
| How a tab gets its group | Both: a group may list folders, and a new session under one of them joins the group; any tab can be moved by hand, which the rule never undoes. |
| What a group carries | Name and colour only. Default folder, GitHub account and the like wait until phases 2 and 3 need them. |
| Shape | Chrome's tab groups: several groups visible at once, each collapsible, ungrouped tabs allowed. Not a switcher that shows one workspace at a time. |

## Design

**Session field.** `PTYSession.group` holds the group's name or `None`. It is
included in the session listing and carried across an in-place upgrade.

**Who decides the group.** The session on the backend is the authority:

- A new session takes the group the client sent with `set-project`; if it sent
  none, the first group whose folder list contains the project path.
- An existing session keeps its group whatever the client sends, so a stale
  copy in one browser's storage cannot undo a move made on another device.
- The `connected` reply carries the session's group and the tab adopts it.
- `set-group` moves a session. Every other client attached to the session is
  told with `group-changed`.

The tab keeps a copy of the group in browser storage only so that tabs restored
after a backend restart come back in their groups.

**Group definitions.** Name, colour and folder list live in
`~/.cade/tab-groups.json`, served and replaced through `/api/tab-groups`. A
session whose group has no definition (a remote backend's group, a deleted
definition) still shows as a group, in a default colour.

**Folder rule.** Applied once, when a session is created. Moving a tab by hand
afterwards needs no "do not regroup" marker because the rule never runs again
for that session.

**Tab bar.**

- Order is kept per browser. Grouped tabs are kept adjacent: moving a tab into
  a group places it after that group's last tab.
- Dragging reorders within the tab's own run (its group, or the ungrouped
  tabs). Changing group is done from the tab's menu, not by dragging.
- Right-click on a tab: move to an existing group, new group, remove from
  group. Right-click on a chip: rename, colour, show only this group, ungroup,
  auto-add a folder.
- Next and previous tab skip tabs in collapsed groups. Switching to a tab in a
  collapsed group by any other route expands the group.

**Attention roll-up.** For a collapsed group, in order: any tab waiting on the
user shows the waiting mark and the number of such tabs; else any tab working
shows the working mark; else any finished tab shows the finished mark with no
number. Five finished tabs therefore never look like one that needs input.

**Storage migration.** `AppState` goes to version 2 with `collapsedGroups`.
Version 1 state is upgraded in place; today a version mismatch discards the
saved tabs.

## Build order

1. Backend: session field, listing, upgrade handoff, `set-project` /
   `set-group` / `group-changed`, definitions file and endpoint, folder rule.
2. Frontend state: `TabInfo.group`, version 2 state with migration, tab manager
   operations (set group, adjacency, collapse, skip collapsed).
3. Tab bar: chips, colour line, collapse, roll-up, menus.
4. Phone: group name in the session strip. Grouped dots wait for phase 5.

## Open questions

- Key chords for collapse and "show only this group".
- Whether a group's definition should be shared between a local and a remote
  backend, or stay per backend as planned here.
