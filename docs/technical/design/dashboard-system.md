---
title: Dashboard System Design
created: 2026-11-26
updated: 2026-11-26
status: active
tags: [design, dashboard, config-driven, agents]
---

# Dashboard System Design

Why CADE's dashboards are driven by a config file, what the design was drawn from, and where the built system stops short of it.

This doc holds the reasoning. For how to write a config, see [[../../user/dashboard]]. For the action and push protocol, see [[../reference/dashboard-interactive-primitives]].

## Why config-driven

Before this system, each project dashboard was a hand-built single-file web app. Two existed, for job-finder and socials, each around 1,500 lines of HTML and vanilla JS, and each rebuilt the same patterns from nothing. (These sizes are from the March 2026 design notes. The two apps were not re-read for this doc.)

The dashboard is instead described by a YAML file, `.cade/dashboard.yml`, that CADE renders. An agent creates or changes a dashboard by editing that file. This was chosen because:

- An agent can build a dashboard without writing frontend code.
- An agent can change a running dashboard by editing the file. CADE reloads it on save.
- A dashboard definition is a small text file that can be versioned and diffed.
- The schema limits what a config can ask for, so a bad config costs one panel, not the renderer.

## Patterns the design was drawn from

The component set and schema come from what the two hand-built dashboards had in common. The table shows each pattern and how the built system expresses it.

| Pattern | Built as | State |
|---------|----------|-------|
| Several views with navigation | `views:` list, with optional `group` for a second navigation level | Built |
| Entities that move through statuses | `entity.statuses` on a source feeds the status select in tables. Kanban columns patch the status on move | Built. `entity.transitions` is parsed and not enforced |
| Summary cards with key fields and badges | `cards` and `cards_paged` with `fields` and `badges` | Built |
| Filterable, searchable lists | Panel `filter:`, plus `filterable` and `searchable` on `cards` and `table` | Built. View-level `sidebar_filters` and `tab_filter` are parsed and not rendered |
| Detail on click | `detail:` on a panel or a view, with `on_click: detail` | Built |
| Summary numbers | Top-level `stats:` strip, computed in the browser | Built |
| Editable notes | `expandable.editable` on a table row | Built for tables only |
| Buttons that depend on status | `actions_by_status` on a view | Parsed and not rendered |
| Activity log | `timeline` component | Built |

What differed between projects decided the data source design:

| Dimension | job-finder | socials | business-manager |
|-----------|-----------|---------|------------------|
| Where data lives | Database behind a REST API | One exported JSON file | Markdown files with frontmatter |
| Own backend | Yes, always running | No | No |
| Source types its config uses | `rest` | `json_file` | `markdown`, `directory`, `vault` |

The last row was read from each project's `.cade/dashboard.yml`. The other rows are from the design notes.

## Who owns what

| Layer | Owns | Lives in |
|-------|------|----------|
| Framework | Schema, renderer, data adapters, file watching, the action protocol, hosting the dashboard in a tab | CADE |
| Tools | Scraping, browsing, parsing, and the API backend pattern job-finder uses | scout-engine |
| Config | Which views, panels and sources a dashboard has | Each project |
| Workflow | When to create or change a dashboard, and how to react to the user | Each project's agents |

CADE holds no project-specific dashboard logic. A project that needs behaviour CADE lacks supplies an API or a provider, not a CADE change.

## Decisions

### YAML

YAML is readable, allows comments, and agents write it reliably. The backend parses it with `yaml.safe_load` and validates it into frozen dataclasses (`core/backend/dashboard/config.py`). A config that fails validation is not sent to the client. The client receives a `dashboard-config-error` message with the reason.

Validation is structural. It checks required keys and that each panel's `source` names a declared source. It does not reject unknown keys or unknown component names. See [[#Known limits]].

### Hybrid data sources

CADE reads simple sources itself. Anything complex stays behind a project's own REST API. A project with only files needs no backend, and a project with a database keeps its server while CADE just fetches from it.

Each `data_sources.<name>.type` selects one adapter in `core/backend/dashboard/adapters.py`. Sources are named and shared, so several panels can read one source and its refresh setting is stated once. File-based sources refresh when the file watcher reports a change. `refresh_interval` adds polling for sources a watcher cannot see, such as `rest`.

### Structured data in frontmatter, not prose

For markdown-backed sources, the dashboard reads YAML frontmatter and leaves the body free-form. Inferring fields from prose was rejected as unreliable. The `markdown` source type is the one exception: it parses a single file's list items, ranked lists or dated entries, selected by `parse:`.

This also makes write-back simple. A patch to a `directory` source rewrites the frontmatter of the file in that directory whose name matches the entity id.

### Interaction tiers

The design has three tiers of interaction. Only the first is built.

| Tier | What happens | State |
|------|--------------|-------|
| 1. Direct mutation | The dashboard changes data itself: check an item, move a kanban card, edit a table cell. No agent involved | Built |
| 2. Agent callback | A user action fires a named event that an agent picks up and answers | Not built |
| 3. Workflow | A user action starts a multi-step agent pipeline that reports progress | Not built |

Tier 1 was built first because it covers most of what the hand-built dashboards did. A `patch` action goes to `DashboardHandler`, which applies it and pushes fresh data. Patches are applied for `rest` (an HTTP PATCH to `<endpoint>/<id>`), `directory` and `json_file` sources. A patch against any other source type is dropped with no error, except `markdown`, which is covered under [[#Known limits]].

Two built pieces sit near the upper tiers without being them:

- **Provider messages.** A panel can forward a free-form frame to the active provider. This reaches a game or tool server behind a provider, not a CADE agent.
- **Agent to dashboard push.** An agent can push a panel or append rows to a `stream` source over HTTP. This covers progress reporting, which the design placed in tier 3.

Both are described in [[../reference/dashboard-interactive-primitives]]. Nothing yet carries a dashboard event back to a CADE agent.

## How it is built

- **Backend.** `core/backend/dashboard/` holds the schema (`config.py`), the adapters (`adapters.py`) and one `DashboardHandler` per connection (`handler.py`) that loads the config, watches it, fetches data and applies patches. See [[../../architecture/components]].
- **Frontend.** `frontend/src/dashboard/` renders the config. Components are plain TypeScript classes that extend `BaseDashboardComponent` and are looked up by name in `registry.ts`. There is no UI framework. Adding a component means writing the class and adding one line to `createDefaultRegistry()`.
- **Placement.** A dashboard appears as a mode of the right pane and as a full-tab view. Both are instances of the same `DashboardPane`.
- **Teaching agents.** Agents learn the schema from the prompt module `backend/prompts/modules/dashboard.md` and edit the YAML directly. CADE has no helper functions for generating configs.

## Built and not documented elsewhere

### `json_file_array` source

Reads one JSON file and takes its rows from an array nested inside it. `array_field` is required and is a dot-separated path to the array. Each row gains `_source_file` and `_source_field`.

```yaml
data_sources:
  items:
    type: json_file_array
    path: data/catalogue.json
    array_field: catalogue.items
```

### `json_directory_expand` source

Reads every JSON file in a directory and turns one field of each file into rows. Use it when each file holds a list or dict whose children are the records. `expand_field` is required. `exclude` takes a filename or a list of filenames to skip. Each row gains `_world_id` (the file's name without extension) and `_source_file`.

```yaml
data_sources:
  rooms:
    type: json_directory_expand
    path: data/worlds/
    expand_field: rooms
    exclude: [index.json]
```

### `push_sources`

A top-level list of source names that have no `data_sources` entry because the server sends their rows. Listing a name here lets validation accept panels that reference it. The rows arrive when a provider emits a `dashboard_data` event, which the backend forwards to the client as a `dashboard-data` message.

```yaml
push_sources:
  - game_inventory
  - game_room
```

### `dashboard_file`

A project can ship more than one dashboard. `dashboard_file:` in `.cade/launch.yml` names the config to load in place of the default `.cade/dashboard.yml` probe. A relative path resolves against the project root. A `?dashboard=<path>` URL parameter overrides it for one connection.

```yaml
# .cade/launch.yml
dashboard_file: .cade/dashboard-player.yml
```

## Known limits

These are gaps between what the schema accepts and what the screen does. The planned work is in [[../../plans/dashboard/agent-ui-system]], and the code-level fixes are in [[../../plans/quick-fixes/dashboard-schema-loose-ends]].

- **`theme` does nothing.** `dashboard.theme` is parsed and sent to the client. No frontend code reads it. Dashboards use CADE's own theme.
- **Unknown component names pass validation.** `KNOWN_COMPONENTS` in `config.py` lists the valid names and nothing checks against it. A misspelt component loads and its panel shows `Component "<name>" not yet available`.
- **Unknown keys pass validation.** No key is ever rejected. Extra keys on a panel or a source are kept in an `extra` map. Extra keys elsewhere are ignored.
- **Some accepted fields are not rendered.** `sidebar_filters`, `tab_filter`, `actions_by_status`, `entity.transitions` and `on_move` are parsed and no frontend code reads them. A kanban move always patches `status` to the target column.
- **Components send `id` as the entity id.** `entity.id_field` is used when patching a `json_file` source, but the components that emit patches read the row's `id` key.
- **A panel's `source` must be a name.** The schema also accepts a mapping there, but the renderer only resolves a string, so such a panel gets no rows.
- **Patching a `markdown` source is expected to fail.** The patch is routed to the code that looks for files inside a directory, and a `markdown` source's `path` is a single file. This was read from the code and not run.
- **No state is stored in the browser.** The dashboard code does not use `localStorage` or `sessionStorage`, so the active view, filters and expanded rows last only as long as the pane.

## See Also

- [[../../user/dashboard]]: config reference, every component and source type
- [[../reference/dashboard-interactive-primitives]]: actions, provider messages, push panels and stream events
- [[../../architecture/components]]: `DashboardHandler` and the renderer in the component map
- [[../../reference/dashboard-config-driven-ui]]: research on config-driven UI
- [[../../plans/dashboard/agent-ui-system]]: what is not built yet
