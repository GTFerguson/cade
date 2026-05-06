---
title: Dashboard Guide
created: 2026-04-22
updated: 2026-05-06
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

---

## Config Structure

A dashboard config has six top-level keys:

```yaml
dashboard:      # Required. Metadata (title, subtitle, theme).
data_sources:   # Required. Where data comes from.
views:          # Required. How data is displayed.
stats:          # Optional. Top-strip KPIs computed from data sources.
extra_roots:    # Optional. Additional directories for the file tree.
watches:        # Optional. File watchers that trigger shell commands.
```

### `dashboard` block

```yaml
dashboard:
  title: "My Dashboard"     # shown in the dashboard header
  subtitle: "optional"      # shown below the title
  theme: terminal-dark       # built-in theme name
```

---

### `extra_roots` block

Defines additional directory roots accessible in the file tree alongside the current project. Useful for shared knowledge bases, monorepo siblings, or any directory you want to browse without switching projects.

```yaml
extra_roots:
  - name: common-knowledge      # internal identifier
    path: "../common-knowledge"  # relative to this project's root
    label: "common-knowledge"    # display label in the tab bar
    default: true                # open this root on load
```

**Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier. Keep it short and slug-like. |
| `path` | Yes | Path relative to the project root. `..` is fine. |
| `label` | No | Display name in the tab bar. Defaults to `name`. |
| `default` | No | If `true`, the file tree opens this root on load. |

**Multiple roots:**

```yaml
extra_roots:
  - name: common-knowledge
    path: "../common-knowledge"
    label: "common-knowledge"
    default: true
  - name: shared-types
    path: "../shared-types"
    label: "shared-types"
```

When more than two roots are configured, the tab bar shows a sliding window of two — the active root and the next — with a `+N` count for the hidden ones. Hold `r` to see all roots in a picker menu.

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `r` (tap) | Cycle to next root |
| `Shift+R` (tap) | Cycle to previous root |
| `r` (hold ~220 ms) | Open full root picker menu |
| `j` / `k` in menu | Navigate options |
| `Enter` or release `r` | Select highlighted root |
| `Esc` | Cancel |

Only paths explicitly listed in `extra_roots` that exist on disk are accessible — arbitrary paths cannot be requested by the client.

> [!TIP]
> **For agents:** add `extra_roots` pointing at `../common-knowledge` with `default: true` to make the shared knowledge base the default view in any project's file tree.

---

### `watches` block

Watches are file-glob triggers that run a shell command when matching files change. Useful for regenerating derived files, running validators, or triggering sync scripts.

```yaml
watches:
  - name: rebuild-index          # optional label for logs
    watch: "docs/**/*.md"        # glob relative to project root
    run: "scripts/rebuild-index.sh"
    exclude: "docs/drafts/**"    # optional glob to skip
```

Changes are debounced at 2 seconds, so rapid file writes (e.g. agent edits) only trigger the command once.

---

## Data Sources

Each source has a name (used in panels) and a `type`. File-based sources are watched automatically — when the file changes, connected dashboards update without polling.

### `markdown` — single markdown file

Best for: priority lists, checklists, timelines in a single `.md` file.

```yaml
data_sources:
  priorities:
    type: markdown
    path: docs/priorities.md
    parse: ranked_list
```

**Parse modes:**

| Mode | What it does | Typical fields |
|------|-------------|----------------|
| `ranked_list` | Numbered / priority lists under section headers | `text`, `priority`, `status`, `done` |
| `list_items` | Bullet / dash lists, optionally with `- [x]` checkboxes | `text`, `done`, `heading` |
| `date_entries` | Markdown tables with date columns | `date`, `what`, `product`, `type`, `detail` |
| `raw` | Entire file as one record | `content` |

### `directory` — folder of frontmatter files

Best for: a flat folder of markdown docs where each file is a record.

```yaml
data_sources:
  plans:
    type: directory
    path: docs/plans/
    parse: frontmatter
```

Every `.md` or `.yml` file in the folder becomes one record. For subdirectories, the adapter looks for `index.md` or a file named after the folder. If your files are arbitrarily named inside subdirectories, use `vault` instead.

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

### `vault` — recursive directory tree

Best for: nested folder structures where files are not named after their parent folder (e.g. `applications/seedcorn/application-guide.md`).

```yaml
data_sources:
  applications:
    type: vault
    path: applications/
```

Walks the entire tree and adds every `.md` file as a record. Skips `README.md` and dotfiles. Exposes `_file`, `_path`, `_folder`, `_filename`, `_body`, plus any frontmatter fields.

### `json_file` — single JSON file

```yaml
data_sources:
  config:
    type: json_file
    path: data/config.json
```

Expects a top-level array or object.

### `json_directory` — folder of JSON files

```yaml
data_sources:
  items:
    type: json_directory
    path: data/items/
```

Each `.json` file = one record. Exposes `_filename`, `_json`. Optional extras:

```yaml
data_sources:
  items:
    type: json_directory
    path: data/items/
    merge_suffix: ".meta.json"   # merge a sidecar file into each record
    exclude: "data/items/draft*" # glob of files to skip
```

### `rest` — HTTP endpoint

```yaml
data_sources:
  releases:
    type: rest
    endpoint: "https://api.github.com/repos/owner/repo/releases"
    headers:
      Authorization: "Bearer ghp_xxx"
    refresh_interval: 300   # re-fetch every 5 minutes
```

`refresh_interval` is in seconds. Omit or set to `0` to disable polling. File-based sources never need this — they update automatically via file watching.

### `stream` — agent push channel

Live-update sources fed by external scripts or agents — no polling, no file backing. The dashboard buffers a rolling window of events client-side and renders them through any list-shaped component (`timeline`, `cards`, `checklist`, `table`).

```yaml
data_sources:
  research_log:
    type: stream
    channel: research        # name to emit to; defaults to the source name
    buffer: 100              # rolling cap, oldest events fall off
```

Emit events from a shell, a worker, an agent — anything that can POST JSON:

```bash
curl -X POST http://localhost:$CADE_PORT/api/ui/stream-event \
  -H 'Content-Type: application/json' \
  -d '{"channel":"research","event":{"timestamp":"now","message":"fetched job"}}'
```

Each POST appends one row. Existing UI state (search query, filters, scroll position, expanded rows) is preserved across events — components diff in place rather than re-rendering. Reload starts the buffer empty; persistence is not server-side.

### `model_usage` — LLM call log analytics

Aggregates LLM usage from a server log file into per-model, per-project statistics.

```yaml
data_sources:
  llm_stats:
    type: model_usage
    path: ../server/logs/server.log
    parse: plog_llm          # log format: plog_llm or jsonl
    window: 7d               # rolling time window: 1d, 7d, 30d, etc.
    static_quotas:           # optional hard limits per model
      claude-3-5-sonnet: 1000000
```

Use with the `model_stats` component to render usage dashboards.

---

## Top-Strip Stats

Optional `stats:` block at the root renders a horizontal strip of KPI cells above the view nav. Each entry computes a value from the configured data sources via a tiny expression DSL.

```yaml
stats:
  - { id: tracked,     label: "Tracked",     source: "field(stats, total_jobs)" }
  - { id: applied,     label: "Applied",     source: "field(stats, applied)" }
  - { id: interviews,  label: "Interviews",  source: "field(stats, interviews)" }
  - { id: hit_rate,    label: "Hit Rate",    source: "ratio(interviews, applied)", format: percent }
  - { id: open_actions, label: "Open Actions", source: "count(actions)" }
```

**Expressions:**

| Form | Result |
|------|--------|
| `count(<source>)` | Total rows of the named source |
| `count(<source>, <field> == <value>)` | Rows where `field` equals `value` |
| `count(<source>, <field> != <value>)` | Rows where `field` does not equal `value` |
| `count(<source>, <field> in [a, b, c])` | Rows where `field` is in the list |
| `count(<source>, <field> not in [a, b])` | Rows where `field` is not in the list |
| `field(<source>, <fieldName>)` | Scalar lookup on the first row — use with single-object REST endpoints |
| `ratio(<statId>, <statId>)` | Numerator/denominator of two earlier `id`s in the list |

**Format:** `format: percent` multiplies by 100 and appends `%`. Otherwise integers render as-is and floats round to two decimals.

The bar refreshes automatically whenever any source's data changes.

---

## Views and Panels

A view is a tab in the dashboard. Each view contains one or more panels.

```yaml
views:
  - id: overview
    title: "Overview"
    layout: grid-2col      # optional layout variant
    panels:
      - id: my-panel
        title: "Panel Title"
        component: checklist
        source: priorities
        fields: [text]
```

### View fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier for the view. |
| `title` | Tab label. |
| `layout` | `grid-2col`, `grid-3col`, or omit for single-column. |
| `hidden` | `true` to hide the tab from the nav bar. Can be revealed programmatically via the `dashboard-focus-view` frame. Useful for detail views opened by card clicks. |
| `group` | Group name. Views sharing the same `group` are nested under a collapsible section in the tab bar. |
| `panels` | List of panel configs. |

### Panel filtering

Every panel can filter records before rendering. The `filter` field accepts field-value conditions:

```yaml
panels:
  - component: cards
    source: plans
    filter:
      status: active           # exact match
      tags: ["design"]         # value must appear in list field

  - component: cards
    source: plans
    filter:
      status: {not: archived}  # exclude a value
```

Multiple filter keys are ANDed together.

### `on_click` — open a file in the viewer

Panels can open a file in the right-pane viewer when a card or row is clicked:

```yaml
panels:
  - component: cards
    source: plans
    on_click:
      action: view_file
      field: _file            # which record field holds the relative path
```

When the user clicks a card, the file at `record[field]` is loaded into the markdown viewer. Works with any source that exposes a `_file` or `_path` field (`directory`, `vault`).

---

## Components

### `checklist` — tick-box list

```yaml
component: checklist
source: tasks
fields: [text]
on_check:
  action: patch
  field: done
  value: true
```

Items with `done: true` render as checked. The `on_check` action patches the source file on click (requires a patchable source: `directory`, `vault`, or `json_file`).

### `timeline` — chronological event list

```yaml
component: timeline
source: timeline
fields: [what, product, type]
limit: 12
```

Sorts by `date` field. Use `date_entries` parse mode on a markdown table.

### `cards` — card grid

```yaml
component: cards
source: plans
fields: [title, status, updated]
badges: [status]
searchable: [title]
on_click:
  action: view_file
  field: _file
```

`badges` renders the named field as a coloured pill. `searchable` adds a live-filter input above the grid.

**Inline detail expansion** — adding a `detail:` block to the panel makes each card click-expandable. Two shapes are supported:

```yaml
# Single-component detail
- component: cards
  source: jobs
  detail:
    component: markdown
    field: description

# Multi-section detail (renders sections in order)
- component: cards
  source: posts
  detail:
    sections:
      - { component: key_value, fields: [brand, platform, average_score] }
      - { component: markdown,  field: content }
```

**View-level `detail:`** — declare the detail config once on a view and let panels opt in via `on_click: detail`:

```yaml
views:
  - id: feed
    title: "Feed"
    detail:
      sections:
        - { component: key_value, fields: [brand, platform, average_score] }
        - { component: markdown,  field: content }
    panels:
      - component: cards
        source: posts
        on_click: detail            # uses the view's detail block
        fields: [brand, content]
```

When `on_click: detail` is set and the panel has no `detail:` of its own, the renderer hoists `view.detail` into the panel automatically.

### `cards_paged` — infinite-scroll card grid

A virtual-windowed variant of `cards` for large datasets. Only renders visible cards, loading more as you scroll.

```yaml
component: cards_paged
source: articles
fields: [title, date, tags]
badges: [tags]
extra:
  page_size: 20         # cards per page load
  favourite_field: starred  # field to toggle on star click
```

### `table` — sortable, filterable table

```yaml
component: table
source: applications
columns: [title, status, deadline]
sortable: true
filterable: [status]
searchable: [title]
```

`columns` can be strings (field names) or dicts for custom headers:

```yaml
columns:
  - { field: title, label: "Application" }
  - { field: status, label: "Stage" }
  - { field: deadline, label: "Due" }
```

**Inline editing:** `inline_edit: [field, …]` makes those columns editable in-place. Fields named `status` render as a `<select>` populated from the source's `entity.statuses`; everything else renders as an `<input>` (number for numeric values, text for strings). Each change emits a `patch` to the source.

```yaml
data_sources:
  jobs:
    type: rest
    endpoint: http://127.0.0.1:8787/api/jobs
    entity:
      id_field: id
      statuses: [new, reviewing, applying, applied, interview, offer, rejected]

views:
  - id: jobs
    panels:
      - component: table
        source: jobs
        columns: [priority, status, total_score, title, company]
        inline_edit: [status, priority]
```

**Expandable rows:** `expandable: { fields, editable }` adds a chevron column. Clicking opens a sub-row with a key/value grid of `expandable.fields`; any field listed in `expandable.editable` renders as a `<textarea>` that emits a `patch` on blur.

```yaml
- component: table
  source: jobs
  columns: [priority, status, title, company]
  expandable:
    fields: [url, description, posted_date, source, notes]
    editable: [notes]
```

Expanding does not trigger row-click navigation, so `expandable` and `_file`-driven row clicks are mutually exclusive — when both are present, expansion wins.

### `kanban` — status board with drag-drop

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

Drag-drop patches the `status` field in the source file. Requires `entity` config on the data source with `statuses` and `transitions`.

### `markdown` — rendered markdown document

```yaml
component: markdown
source: some_source
```

Renders the `_body` or `content` field as full markdown with KaTeX and Mermaid diagram support.

### `key_value` — key/value pairs

```yaml
component: key_value
source: config
```

Renders each record field as a labelled value row.

### `entity_detail` — composable record viewer

Generic detail view for a single record, configured as a sequence of sections in YAML. Each section type renders a different aspect of the record. Use this for content types where you want a structured view (header + cross-references + prose) without writing a custom component.

```yaml
component: entity_detail
options:
  ref_source: knowledge_enriched   # default source for ref-badge navigation
  sections:
    - type: header
      fields: [name, "{year_start} – {year_end}", type]
    - type: cross_refs
      field: cross_refs
      source: knowledge_enriched
    - type: claims
      field: claims
```

**Section types:**

| Type | Reads | Renders |
|------|-------|---------|
| `header` | `fields[]` (template-aware) | Title strip — first field is the name, rest are meta |
| `key_value` | `fields[]` | Label/value rows |
| `prose` | `field` (string) | Paragraphs with inline `@type:id` ref badges |
| `cross_refs` | `field` (object: `{rel: [id, ...]}`) | Grouped clickable badges by relation |
| `claims` | `field` (defaults to `"claims"`) | Embeds the `claims` component with ref-aware prose |

**Ref navigation:** Badges in `prose` and `cross_refs` sections look up the target entity in `allData[options.ref_source]` (or `section.source` if overridden) by `id`, then fire `view_file` with the target's `_file`. If the project has registered an `EntityResolver` via `setEntityResolver()`, it is consulted as a second-tier fallback. Refs with `_ref_status: "dead"` (pre-computed by an enricher) render unclickable.

**Use as a file viewer:** Adapter code can wrap `EntityDetailComponent` to render a JSON file outside the dashboard — pass a synthetic `DashboardComponentProps` and route `view_file` actions to your file-open callback.

### `model_stats` — LLM usage statistics

Renders call counts, token usage, latency, and quota gauges from a `model_usage` source.

```yaml
component: model_stats
source: llm_stats
options:
  show_tokens: true
  show_latency: true
  show_projects: true
```

### `basket` — dual-list drag-drop

Two labelled lists (left/right). Items can be dragged between them. Useful for assignment or triaging workflows.

```yaml
component: basket
source: candidates
options:
  left_label: "Pending"
  right_label: "Selected"
on_move:
  action: patch
  field: selected
```

### `graph` — network graph

Renders nodes and edges as an interactive network diagram.

```yaml
component: graph
source: relationships
extra:
  format: world-map    # optional: "world-map" for geographic layout
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
| `rest` | Yes | `PATCH {endpoint}/{id}` |
| `stream` | No | Append-only — no write-back path |

For frontmatter patching to work, the markdown file must have a valid `---` frontmatter block.

---

## Real-World Example

```yaml
dashboard:
  title: "Business Manager"
  subtitle: "Cognetic LTD"
  theme: terminal-dark

extra_roots:
  - name: common-knowledge
    path: "../common-knowledge"
    label: "common-knowledge"
    default: true

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
    entity:
      statuses: [draft, active, complete, blocked]

  applications:
    type: vault
    path: applications/

watches:
  - watch: "scripts/data/**"
    run: "scripts/rebuild-stats.sh"

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

  - id: plans
    title: "Plans"
    panels:
      - id: plan-board
        title: "Active Plans"
        component: kanban
        source: plans
        columns:
          - { status: draft, label: "Draft" }
          - { status: active, label: "Active" }
          - { status: complete, label: "Done" }
        on_move:
          action: patch
          field: status

  - id: applications
    title: "Applications"
    panels:
      - id: app-table
        component: table
        source: applications
        columns: [title, status, deadline]
        sortable: true
        filterable: [status]
        searchable: [title]
        on_click:
          action: view_file
          field: _file
```

---

## Troubleshooting

**Dashboard not showing** — check that `.cade/dashboard.yml` exists and has the required top-level `dashboard:` key with a `title`.

**Data source empty** — for `directory` type with subdirectories, the adapter only finds `index.md` or a file named after the folder. Use `vault` for nested structures with arbitrary filenames.

**Kanban drag-drop not working** — the data source needs an `entity` block with `statuses` and `transitions`. The dragged card's status must match one of the column `status` keys.

**Checklist `on_check` not patching** — `markdown` type sources are read-only. Move the data into a `directory` or `vault` source if you need write-back.

**Parse mode produces unexpected fields** — use the `table` component first to inspect all fields a source returns. Add `columns: [_filename, _body, status, title]` to see everything.

**Extra root not appearing** — the path must resolve to an existing directory on disk. If the directory doesn't exist, the root is silently excluded from the allowed list.

**`watches` command not running** — changes are debounced at 2 seconds. The command runs in a subprocess with the project root as the working directory.

**REST source not refreshing** — set `refresh_interval: N` (seconds) on the source. Without it, REST sources only load once on connection.

---

## See Also

- [[README|User Guide]] — CADE overview
- [[../technical/reference/dashboard-interactive-primitives|Dashboard Interactive Primitives]] — technical reference for component actions and the `provider_message` action type
- [[../technical/reference/websocket-protocol|WebSocket Protocol]] — how config and data are pushed to the client
