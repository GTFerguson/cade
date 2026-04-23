# Dashboard

The dashboard is driven by `.cade/dashboard.yml` in the project root. To display information for the user, edit that file directly — read it first, then write your changes. The dashboard reloads automatically on save.

## Schema

```yaml
dashboard:
  title: "Project Name"
  subtitle: "optional tagline"

data_sources:
  source_name:
    type: directory       # scans markdown files, extracts YAML frontmatter
    path: docs/plans/
    parse: frontmatter

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

## Components

| Component | Use for | Key fields |
|-----------|---------|------------|
| `cards` | item grids | `fields`, `badges`. Add `_file: path` to a row to open on click |
| `checklist` | task lists | rows need `text` (str) and `done` (bool), optional `priority` |
| `table` | tabular data | `columns: [field1, field2]`, `sortable: true`, `filterable: [field]` |
| `key_value` | stats/metadata | rows need `label` and `value` |
| `kanban` | status boards | `columns: [{status: x, label: y}]`, `source` rows need a status field |
| `markdown` | rendered docs | use `source: {type: file, path: docs/readme.md}` instead of a named source |

## Data Source Types

| Type | Description |
|------|-------------|
| `directory` | Scans all `.md` files in `path`, extracts frontmatter as rows |
| `file` | Single file — use with `markdown` component |
| `rest` | HTTP endpoint returning JSON array. Add `refresh_interval: 60` (seconds) |

## Example: Add a temporary agent view

```yaml
data_sources:
  agent_work:
    type: directory
    path: .cade/agent-output/
    parse: frontmatter

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
