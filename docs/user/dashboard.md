---
title: Dashboard Guide
created: 2026-04-22
updated: 2026-04-22
status: active
tags: [dashboard, yaml, configuration, hot-reload]
---

# Dashboard Guide

The dashboard is a real-time, YAML-driven data visualisation layer built into CADE. It hot-reloads when either the config file or any data source changes on disk — no browser refresh needed.

## Quick Start

Create `.cade/dashboard.yml` in your project root:

```yaml
dashboard:
  title: "My Project"
  theme: terminal-dark

data_sources:
  tasks:
    type: markdown
    path: docs/tasks.md
    parse: ranked_list

views:
  - id: overview
    title: "Overview"
    panels:
      - id: task-list
        title: "Tasks"
        component: checklist
        source: tasks
        fields: [text]
```

Open CADE and click the **Dashboard** button (or press `Ctrl-a d`) to open the dashboard panel. Changes to `dashboard.yml` or `docs/tasks.md` will live-reload automatically.

## Config Structure

```yaml
dashboard:          # Metadata
data_sources:       # Where data comes from
views:              # How data is displayed
```

### `dashboard` block

```yaml
dashboard:
  title: "My Dashboard"     # shown in header
  subtitle: "optional"      # shown below title
  theme: terminal-dark       # built-in theme name
```

---

## Data Sources

Each data source has a name (used in panels) and a `type`.

### `markdown` — parse a single markdown file

Best for: priority lists, checklists, timelines in a single `.md` file.

```yaml
data_sources:
  priorities:
    type: markdown
    path: docs/priorities.md
    parse: ranked_list        # see parse modes below
```

**Parse modes:**

| Mode | What it does | Typical fields |
|------|-------------|----------------|
| `ranked_list` | Numbered/priority lists under section headers | `text`, `priority`, `status`, `done` |
| `list_items` | Bullet/dash lists, optionally with `- [x]` checkboxes | `text`, `done`, `heading` |
| `date_entries` | Markdown tables with date columns | `date`, `what`, `product`, `type`, `detail` |
| `raw` | Entire file as one record | `content` |

### `directory` — scan a folder for frontmatter files

Best for: a flat folder of markdown docs where each file is a record.

```yaml
data_sources:
  plans:
    type: directory
    path: docs/plans/
    parse: frontmatter
```

Every `.md` or `.yml` file in the folder becomes one record. For subdirectories, the adapter looks for `index.md` or a file named after the folder — **not** arbitrary filenames. If your files are named `application-guide.md` inside subdirectories, use `vault` instead.

**With entity config** (enables kanban drag-drop and status patching):

```yaml
data_sources:
  plans:
    type: directory
    path: docs/plans/
    parse: frontmatter
    entity:
      statuses: [draft, active, complete, blocked]
      transitions:
        draft: [active]
        active: [complete, blocked]
        blocked: [active]
```

### `vault` — recursively scan a directory tree

Best for: nested folder structures where files are not named after their parent folder (e.g. `applications/seedcorn/application-guide.md`).

```yaml
data_sources:
  applications:
    type: vault
    path: applications/
```

Walks the entire tree and adds every `.md` file as a record. Skips `README.md` and dotfiles. Exposes `_file`, `_path`, `_folder`, `_filename`, `_body`, plus any frontmatter fields.

### `json_file` — read a JSON file

```yaml
data_sources:
  config:
    type: json_file
    path: data/config.json
```

Expects a top-level array or object.

### `json_directory` — scan a folder of JSON files

```yaml
data_sources:
  items:
    type: json_directory
    path: data/items/
```

Each `.json` file = one record. Exposes `_filename`, `_json`.

### `rest` — call an API endpoint

```yaml
data_sources:
  releases:
    type: rest
    endpoint: "https://api.github.com/repos/owner/repo/releases"
    headers:
      Authorization: "Bearer ghp_xxx"
```

---

## Views and Panels

A view is a tab in the dashboard. Each view contains one or more panels.

```yaml
views:
  - id: overview
    title: "Overview"
    layout: grid-2col      # optional: grid-2col, grid-3col, or auto
    panels:
      - id: my-panel
        title: "Panel Title"
        component: checklist
        source: priorities
        fields: [text]
```

### Components

#### `checklist` — tick-box list

```yaml
component: checklist
source: tasks
fields: [text]
on_check:
  action: patch
  field: done
  value: true
```

Items with `done: true` render as checked. The `on_check` action patches the source file on click (requires a patchable source type: `directory`, `vault`, or `json_file`).

#### `timeline` — chronological event list

```yaml
component: timeline
source: timeline
fields: [what, product, type]
limit: 12           # show only the next N events
```

Sorts by `date` field. Use `date_entries` parse on a markdown table for this.

#### `cards` — card grid

```yaml
component: cards
source: plans
fields: [title, status, updated]
badges: [status]
searchable: [title]
```

#### `kanban` — status board with drag-drop

```yaml
component: kanban
source: applications
columns:
  - { status: draft, label: "Draft" }
  - { status: submitted, label: "Submitted" }
  - { status: shortlisted, label: "Shortlisted" }
  - { status: won, label: "Won" }
on_move:
  action: patch
  field: status
```

Drag-drop patches the `status` field in the source file. Requires `entity` config on the data source.

#### `table` — sortable, filterable table

```yaml
component: table
source: applications
columns: [title, status, deadline]
sortable: true
filterable: [status]
searchable: [title]
```

#### `markdown` — rendered markdown doc

```yaml
component: markdown
source: some_source
```

Renders `_body` or `content` field as full markdown with KaTeX and Mermaid support.

#### `key_value` — key/value pairs

```yaml
component: key_value
source: config
```

---

## Hot Reload

CADE watches two things:

1. **`.cade/dashboard.yml`** — any change to the config reloads the entire dashboard structure immediately.
2. **Data source files** — when a file referenced by a data source changes, only that source's data is re-fetched and pushed to the client. The page does not reload.

This means you can edit `docs/priorities.md` in one pane and watch the checklist update in real time.

---

## Patching (Write-Back)

Some components can write back to source files on user interaction (checkbox toggle, kanban drag-drop):

| Source type | Patchable? | What gets patched |
|------------|-----------|-------------------|
| `directory` | Yes | YAML frontmatter block in the `.md` file |
| `vault` | Yes | YAML frontmatter block in the `.md` file |
| `json_file` | Yes | The matching entity in the JSON array |
| `json_directory` | Yes | The individual `.json` file |
| `markdown` | No | Not supported |
| `rest` | Yes | PATCH request to `{endpoint}/{id}` |

For frontmatter patching to work, the markdown file must have a `---` frontmatter block.

---

## Real-World Example

This is the Business Manager dashboard (`business-manager/.cade/dashboard.yml`):

```yaml
dashboard:
  title: "Business Manager"
  subtitle: "Cognetic LTD"
  theme: terminal-dark

data_sources:
  priorities:
    type: markdown
    path: docs/plans/priorities.md
    parse: ranked_list

  timeline:
    type: markdown
    path: docs/plans/timeline.md
    parse: date_entries

  plans:
    type: directory
    path: docs/plans/
    parse: frontmatter

  products:
    type: directory
    path: docs/products/
    parse: frontmatter

  # vault used (not directory) because files are at applications/<name>/application-guide.md
  applications:
    type: vault
    path: applications/

views:
  - id: overview
    title: "Overview"
    layout: grid-2col
    panels:
      - id: priorities
        title: "Priority Actions"
        component: checklist
        source: priorities
        fields: [text]

      - id: deadlines
        title: "Upcoming Deadlines"
        component: timeline
        source: timeline
        limit: 12
        fields: [what, product, type]
```

---

## Troubleshooting

**Dashboard not showing** — check that `.cade/dashboard.yml` exists at the project root (the path CADE opened, not a subdirectory).

**Data source empty** — for `directory` type with subdirectories, the adapter only finds `index.md` or a file named after the folder. Use `vault` for nested structures.

**Kanban drag-drop not working** — the data source needs an `entity` block with `statuses` and `transitions`. The status value must match one of the column `status` keys.

**Checklist `on_check` not patching** — `markdown` type sources are read-only. Move the data into a `directory` or `vault` source if you need write-back.

**Parse mode produces unexpected fields** — use the table component first to inspect all fields returned by a source. Add `columns: [_filename, _body, status, title]` to see what's available.

## See Also

- [[README|User Guide]] — CADE overview
- [[../technical/reference/dashboard-interactive-primitives|Dashboard Interactive Primitives]] — technical reference for component actions
- [[../technical/reference/websocket-protocol|WebSocket Protocol]] — how config and data are pushed to the client
