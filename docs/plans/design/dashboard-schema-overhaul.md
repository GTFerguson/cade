---
title: "Dashboard Schema Overhaul"
created: 2026-01-20
status: draft
tags: [dashboard, schema, UI, agent-tooling]
---

# Dashboard Schema Overhaul

## Context

The current dashboard (`dashboard.yml`) is a useful start but has a shallow schema — fixed component types, limited data sources, no layout hierarchy beyond "a list of panels." As CADE grows into non-dev use cases (business management, personal workflows), this ceiling will become a wall.

The goal is a **declarative, agent-authored, project-specific UI layer** — one that agents can build fluently and that stays flexible enough to model almost any workflow.

## What This Replaces

The current `dashboard.yml` schema is replaced entirely. The directory `.cade/` remains the storage location.

---

## Proposed Schema

### Top Level

```yaml
dashboard:
  title: string              # displayed in the UI header
  subtitle: string?          # optional tagline
  layout: LayoutConfig       # overall arrangement
  sources: SourcesMap        # named data sources
  views: View[]              # top-level view tabs
```

### Layout Config

```yaml
layout:
  type: grid | stack | tabs | split | custom
  # grid: CSS Grid with defined columns/rows
  # stack: vertical flow
  # tabs: view-switcher
  # split: resizable 50/50 pane
  # custom: agents write inline CSS-style config
  columns?: number | string  # e.g. 3, "1fr 2fr 1fr"
  rows?: number | string
  gap?: string               # e.g. "1rem"
  areas?: string[]           # named grid areas
```

### Sources Map

Every view/panel references a named source. Sources are pluggable:

```yaml
sources:
  <source_name>:
    type: directory | file | rest | shell | eval | constant
    path?: string            # for directory/file
    url?: string             # for rest
    command?: string         # for shell
    script?: string          # for eval (inline JS/DSL)
    value?: any              # for constant
    refresh_interval?: number # seconds, default no auto-refresh
    parse?: frontmatter | json | csv | yaml | text
    schema?: object          # field definitions for the data
    params?: object          # template vars for shell/rest
```

**On `eval` sources:** agents can write a small inline expression or script that returns data. The eval runs in a sandboxed context. This is intentionally minimal — it's for transforming/composing from other sources, not for complex logic.

### Views

```yaml
views:
  - id: string
    title: string
    layout: LayoutConfig?
    default?: boolean        # which view is shown on open
    panels: Panel[]
```

### Panel Config

```yaml
panels:
  - id: string
    title: string?
    area?: string            # grid area name from layout.areas
    source: string           # name of a source in sources{}
    component: ComponentName
    props?: object           # component-specific props
    actions?: Action[]       # click/key handlers
    visibility?: expression  # show/hide based on data or state
```

### Built-in Components

| Component | Props | Description |
|---|---|---|
| `cards` | `fields[]`, `badges[]`, `image?`, `_file?` | Grid of clickable cards |
| `table` | `columns[]`, `sortable[]?`, `filterable[]?` | Sortable/filterable table |
| `checklist` | — | `done` bool + `text` str per row |
| `kanban` | `columns[{status, label}]` | Drag-aware status board |
| `key_value` | — | Label/value pairs |
| `markdown` | — | Rendered markdown from source |
| `chart` | `type: bar\|line\|pie\|gauge`, `x`, `y[]` | Simple charting |
| `form` | `fields[]`, `submit_label?` | Input form that triggers an action |
| `iframe` | `src` | Embedded external URL |
| `metric` | `value`, `label`, `trend?` | Single large number with trend |
| `log` | `tail?`, `filter?` | Streaming log output |
| `custom` | `html` | Raw HTML — agents own the rendering |

### Actions

```yaml
actions:
  - trigger: click | select | submit | key
    target: string           # panel id or _dashboard
    behavior: navigate | spawn | emit | refresh
    params?: object
```

Example: click a card → spawn an agent with the file path:

```yaml
actions:
  - trigger: click
    target: _dashboard
    behavior: spawn
    params:
      mode: code
      task: "Open and review {row._file}"
```

### Expressions

Simple filter/visibility language — not Turing complete:

```
data.status == "active"
data.count > 5
data.priority in ["high", "critical"]
true  # always visible
```

Used for `visibility?`, and optionally for derived sources.

---

## Agent-Authoring UX

An agent building a dashboard should think in this sequence:

1. **What data do I need?** → define sources
2. **How should it be laid out?** → set layout
3. **What does each panel show?** → pick components + wire to sources
4. **What should be interactive?** → add actions

The YAML should be readable back — an agent reviewing a project's `.cade/dashboard.yml` should immediately understand what it does without running it.

**Minimal working example** (a project health panel):

```yaml
dashboard:
  title: "Acme Corp — Q1 Review"
  sources:
    tasks:
      type: directory
      path: tasks/
      parse: frontmatter
    metrics:
      type: shell
      command: "echo '{\"revenue\": 142000, \"target\": 150000}'"
      parse: json
  views:
    - id: main
      default: true
      layout:
        type: grid
        columns: "2fr 1fr"
      panels:
        - id: task-board
          source: tasks
          component: kanban
          props:
            columns:
              - status: todo
                label: To Do
              - status: in-progress
                label: In Progress
              - status: done
                label: Done
        - id: revenue-metric
          source: metrics
          component: metric
          props:
            value: "{data.revenue}"
            label: "Q1 Revenue"
            trend: up
```

---

## Key Design Decisions

### 1. Layout-first vs panel-first

The proposed schema makes layout explicit (`layout` at view level, optional `area` on panels). The alternative was a free-form "panels float into place" model. Layout-first was chosen because:

- Agents can reason about the structure without rendering
- Resizable split panes need explicit geometry anyway
- A grid is easier to read back than "I put this panel there and it worked"

### 2. Sources are named and composable

Instead of each panel embedding its own data fetching, sources are named and shared. This means:

- A `shell` source can be referenced by multiple panels
- `refresh_interval` is set once per source, not per panel
- Agents can add a source, then wire several panels to it

### 3. `eval` sources are intentionally minimal

We could add a full scripting source. We won't — that's a slippery slope toward agents building mini-apps inside the dashboard. `eval` handles the 80% case of "transform/combine from other sources." For anything complex, the agent should write a script to a file and source it as `shell`.

### 4. The `custom` HTML component

Agents writing raw HTML is a power-user feature. It's opt-in and self-contained per panel. The alternative (a component builder UI) adds complexity that defeats the goal of "agents build this fluently." We document the risk: malformed HTML breaks the panel, not the dashboard.

### 5. Actions are agent-oriented, not user-oriented

The `spawn` action for `behavior` means "trigger an agent task." This is the primary interaction model — a user clicks a card, the agent handles the rest. Direct user actions (user navigates somewhere) are secondary and handled by `navigate`.

---

## Open Questions

- **File-based vs live config**: `.yml` is static. Should sources also support a live mode where the agent updates the config file and the dashboard hot-reloads? Or is the file the source of truth and agents always edit it?
- **Dashboard isolation**: if multiple agents edit the dashboard simultaneously (multi-agent sessions), what happens? Last-write-wins? Locking?
- **History/undo**: agents will get the YAML wrong. Should the dashboard maintain a `.cade/dashboard.history.yml` with diffs?
- **Built-in component expansion**: chart support is minimal. Do we want proper charting ( Vega-Lite, Chart.js) or is that scope creep?
- **Cross-project dashboard**: the current model is project-local. Should CADE have a workspace-level dashboard that aggregates from multiple repos?
- **The `custom` component security model**: raw HTML injection is a concern. Should `custom` components be sandboxed in an iframe? That trades simplicity for safety.

---

## What This Adds

1. Rich layout system (grid, split, tabs, custom areas)
2. Named, composable data sources
3. More built-in components (chart, form, metric, iframe, log, custom HTML)
4. Action system — panels can trigger agent tasks or navigation
5. Visibility expressions — conditional panel rendering
6. Per-source refresh intervals for live data

## Key Challenges

1. **Eval sandboxing** — we need a safe execution context that can't escape to the filesystem or network
2. **Hot reload UX** — agents editing YAML while the dashboard is open; need clear error feedback if the YAML is malformed
3. **Component API stability** — once agents start building dashboards, changing component props is a breaking change
4. **Schema validation** — agents writing invalid YAML is the most common failure mode; a JSON Schema or Zod schema for the dashboard file would catch errors early

## Integration Points

- **nkrdn**: dashboards can source from nkrdn queries directly (new `nkrdn` source type)
- **Orchestrator**: `spawn` action wires into `mcp__cade-orchestrator__spawn_agent`
- **File system**: `directory` source remains the most common pattern for dev projects
- **Plans**: plan docs already have frontmatter that maps cleanly to `checklist`/`cards` components — a "plans view" is a natural first use case

---

## Graduated Artifact

Once shipped, this becomes `docs/architecture/dashboard-system.md`. The plan doc is deleted.
