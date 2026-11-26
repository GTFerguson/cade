# Dashboard

The dashboard is driven by `.cade/dashboard.yml` in the project root. To display information for the user, edit that file directly. Read it first, then write your changes. The dashboard reloads automatically on save.

## Schema

```yaml
dashboard:
  title: "Project Name"
  subtitle: "optional tagline"

data_sources:
  source_name:
    type: directory       # scans markdown files, extracts YAML frontmatter
    path: docs/plans/

views:
  - id: view-id
    title: "View Title"
    layout: grid-2col     # optional: grid-2col, grid-3col, or omit for single column
    panels:
      - id: panel-id
        title: "Panel Title"
        component: cards  # see components below
        source: source_name
        fields: [title, status, created]
        badges: [status]
```

A panel's `source` is the name of an entry under `data_sources`. Declare every source there, even one used by a single panel.

A config that breaks the schema, such as a panel naming a source that does not exist, does not load. Keys the dashboard does not read, unknown component names and unknown source types still load, and are listed as warnings at the top of the dashboard pane. Fix them rather than leaving them: each one is something you wrote that has no effect.

## Components

| Component | Use for | Key fields |
|-----------|---------|------------|
| `cards` | item grids | `fields`, `badges`. A row with a `_file` field opens that file on click |
| `cards_paged` | long card lists | same shape as `cards`, renders a window of the rows and loads more on scroll. `target_size`, `page_size` and `buffer_size` tune the window; write them on the panel or under `extra:`. Use when the source can grow past ~50 rows |
| `checklist` | task lists | text from the first of `fields` (default `text`); a row shows ticked when `done` is true or `status` is `done`; optional `priority`. Add `on_check: {patch: {done: true}}` to save a tick on a source that supports write-back. The same patch is sent on untick |
| `table` | tabular data | `columns: [field1, field2]`, `sortable: true`, `filterable: [field]`, `inline_edit: [field]` |
| `key_value` | stats/metadata | `fields: [a, b]` names the rows; values come from the source's single row. With several rows each value shows the row count |
| `kanban` | status boards | `columns: [{status: x, label: y}]`, rows grouped by their `status` field. A move sends `on_move.patch` with `$column` replaced by the target column, or `{status: <column>}` without one. Moves the source's `entity.transitions` forbid are refused |
| `timeline` | dated events | each row shows `date` and the first of `fields` (default `text`); a change of `heading` starts a new section. Rows render in source order |
| `markdown` | rendered docs | renders the `content` field of the source's first row. For one file, declare a source with `type: markdown` and `parse: raw` |
| `entity_detail` | record viewer | `options.sections: [{type, title, ...}]`. Built-in section types are `header`, `key_value`, `prose`, `cross_refs` and `claims`. Each section renders fields from one row |
| `basket` | dual-pool steppers | rows carry a `side: "left"\|"right"` field. Use for any "pick quantities from two pools" workflow. `options.left_label`, `options.right_label`, `options.unit`, `options.on_confirm` |
| `graph` | 2D node/edge maps | the source's first row carries `nodes: [{id, label, x, y}]` and `edges: [{from, to}]`. Clicking a node sends a `provider_message`, which only a provider with an engine channel receives |
| `model_stats` | LLM usage charts | use with the `model_usage` data source; renders call-frequency, token, and quota bars. `options: {show_tokens, show_latency, show_projects}` |

## Data Source Types

| Type | Description |
|------|-------------|
| `directory` | One row per `.md` or `.yml` file in `path`, from its YAML frontmatter. Supports write-back |
| `markdown` | One markdown file. `parse: raw` gives one row with the whole file as `content`; `list_items`, `ranked_list` and `date_entries` turn lists or tables into rows. Read-only |
| `json_file` | One JSON file holding an array or an object. Supports write-back when it holds an array |
| `rest` | HTTP endpoint returning JSON. Add `refresh_interval: 60` (seconds) to poll it. Supports write-back with `PATCH <endpoint>/<id>` |
| `stream` | Agent push channel. Declare with `channel: <name>` and optional `buffer: 100` (rolling cap). Initial state is empty; rows appear as the agent emits events |

For a single markdown file:

```yaml
data_sources:
  readme:
    type: markdown
    path: docs/readme.md
    parse: raw

views:
  - id: readme
    title: "Readme"
    panels:
      - component: markdown
        source: readme
```

## Streaming Live Updates

For live agent to dashboard updates (progress logs, token-by-token output, work in progress), declare a `type: stream` source:

```yaml
data_sources:
  research_log:
    type: stream
    channel: research        # name agents emit to; defaults to source name
    buffer: 100              # rolling cap, oldest events fall off

views:
  - id: research
    title: "Research"
    panels:
      - component: timeline
        source: research_log
        fields: [timestamp, message]
```

Emit events from anywhere (the agent's own bash, a worker, a script):

```bash
curl -s -X POST http://localhost:$CADE_PORT/api/ui/stream-event \
  -H 'Content-Type: application/json' \
  -d '{"channel":"research","event":{"timestamp":"now","message":"fetched job description"}}'
```

Each POST appends one row. Components render new rows the same way they render polled data: `timeline`, `cards`, `table`, and `checklist` all work without modification.

## Example: Add a temporary agent view

```yaml
data_sources:
  agent_work:
    type: directory
    path: .cade/agent-output/

views:
  - id: agent-results
    title: "Agent Results"
    panels:
      - id: results
        component: cards
        source: agent_work
        fields: [title, status, summary]
        badges: [status]
```

Write markdown files with frontmatter into `.cade/agent-output/` and they appear in the panel automatically.
