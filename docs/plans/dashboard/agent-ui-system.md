---
title: Agent UI System
status: draft
created: 2026-03-24
tags: [dashboard, agent-ui, components, config-driven]
---

# Agent UI System

Config-driven dashboard framework where agents create and modify interactive interfaces by writing configuration, not code. CADE renders the configs, users interact through them, agents adapt on the fly.

## Context

Multiple projects need dashboards for agent-user interaction. Two already exist (job-finder, socials), each built from scratch as 1,500+ line single-file HTML apps. business-manager needs one next. Every new dashboard restarts from zero — same patterns rebuilt each time.

CADE is evolving beyond a development environment into a **modular, extendable framework for agent-integrated dashboards**. The development environment is one module within a larger system where any project can register agent-driven UI workflows.

## Core Idea: Config-Driven Dashboards

Same pattern as scout-engine's scraping — YAML configs drive scraper behavior, agents can write new configs to scrape new sources. Apply this to dashboards:

1. **Agent generates a dashboard config** (YAML/JSON) describing what to show — views, components, data sources, interactions
2. **CADE reads the config and renders it** — component library maps config to React components
3. **User interacts** — clicks, form fills, selections flow back to the agent
4. **Agent modifies the config** — adapts the dashboard on the fly, adds panels, changes layout, creates entirely new views

Because it's config, not code:
- Agents can create new dashboards without writing React/TypeScript
- Agents can modify running dashboards by editing the config file
- Dashboard definitions are portable, versionable, diffable
- The config schema constrains what's possible — agents can't break the renderer

## Existing Dashboards: Patterns Extracted

### job-finder (1,534 lines — FastAPI + vanilla JS)

**Tech:** FastAPI backend (scout-engine `create_app()`), SQLite via SQLAlchemy, SSE for agent push, 5-second polling for data changes.

**Views (7 tabs):**
- Hot Dashboard — priority jobs (cards), open actions (checklist), recruiters to contact (cards)
- Jobs Table — sortable/filterable table with expandable detail rows, inline status dropdowns
- Recruiters — card grid with metadata, status dropdowns
- Actions — checklist with check/complete, priority indicators, deadline badges
- Activity Log — timeline of all changes (old→new values)
- Agent — live SSE panels pushed by agent
- CV Tools — analysis and tailoring pages

**Interactions:** Inline status editing (dropdowns), notes textarea, checkbox completion, sort by column, filter by status/mode/priority/contract/IR35, search, expandable detail rows, entity linking (names→recruiter panel).

**Data model:** 4 SQLAlchemy tables (Job, Recruiter, Action, ActivityLog). Status enums with defined transitions.

### socials (1,759 lines — static HTML + vanilla JS)

**Tech:** No backend server. Fetches static `data/posts.json` exported by batch pipeline. No live updates.

**Views (3 views via sidebar nav):**
- Feed — post cards with score visualisations (5-dimension radar), status tabs (draft/review/ready/posted), brand filtering
- Ideas — grouped by maturity (ready to write, rough, scheduled, open slots), promote/generate actions
- Personas — searchable card grid, full persona profiles with stats, filterable by brand/platform

**Interactions:** Status transitions (draft→review→ready→posted with context-sensitive buttons), copy to clipboard, notes editing, persona profile drill-down, click persona avatar in feedback to navigate to their profile.

**Data model:** JSON objects per post with nested persona_scores. File-based storage (per-post directories with iterations).

### Common Patterns

These recur in both dashboards and likely in any future one:

| Pattern | Description | Config expression |
|---------|-------------|-------------------|
| **Multi-view navigation** | Tabs or sidebar switching between views | `views:` list with names and icons |
| **Status-driven workflows** | Entities move through status states with defined transitions | `statuses:` enum with allowed transitions |
| **Entity cards** | Summary cards in grids/lists with key fields, badges, indicators | `component: cards` with `fields:` and `badges:` |
| **Filterable lists** | Filter entities by status + domain-specific fields | `filters:` per view with field references |
| **Detail panel** | Click entity → expanded view with full fields + related data | `detail:` config per entity type |
| **Summary stats** | Top-level KPIs (counts, rates, ratios) | `stats:` with computed aggregations |
| **Notes/text editing** | Per-entity editable text field | `editable_fields:` on entity schema |
| **Context-sensitive actions** | Buttons that change based on current status | `actions:` per status with transitions |
| **Activity timeline** | Chronological log of changes | `component: timeline` sourced from change log |
| **Toast notifications** | Ephemeral feedback on user actions | Built into framework, not config |

### What Differs (and the config must handle)

| Dimension | job-finder | socials | business-manager |
|-----------|-----------|---------|------------------|
| **Data source** | SQLite + REST API | Static JSON file | Markdown docs + frontmatter |
| **Backend** | FastAPI server (always running) | None (static) | TBD |
| **Agent integration** | SSE push (live) | None (batch pipeline) | Agent-driven (live) |
| **Entity complexity** | Multi-table with relations | Nested JSON with arrays | Flat files with frontmatter |
| **Interaction depth** | Inline editing, sorting, pagination | Status transitions, clipboard | Status changes, file updates |

## Architecture

### Separation of Concerns

| Layer | What | Where |
|-------|------|-------|
| **Framework** | Config schema, component renderer, interaction protocol, tab hosting | CADE |
| **Tools** | Scraping, browsing, parsing, caching, credentials, data pipelines | scout-engine |
| **Configs** | Dashboard definitions — views, components, data sources, interactions | Each project |
| **Workflows** | Agent logic — when to create/modify dashboards, how to respond to interactions | Each project's agents |

### CADE's role

CADE owns the presentation framework:
- **Config schema** — defines what's valid in a dashboard config
- **Component library** — React components for each component type
- **Config watcher** — hot-reloads when agent modifies a config file
- **Interaction protocol** — user events flow back to agents
- **Tab system** — each project's dashboard(s) accessible as tabs
- **Data fetching** — adapters for REST API, JSON file, markdown, frontmatter

### scout-engine's role

scout-engine stays as the toolbox:
- **Backend capabilities** agents use (scraping, browser automation, parsing, caching, credentials)
- **Data source adapters** — markdown/frontmatter/YAML parsing into dashboard-consumable structures
- **Schema helpers** — Python utilities for generating valid dashboard configs
- **Existing dashboard** (`src/scout/dashboard/`) — the `create_app()` factory and SSE transport that job-finder already uses; continues as the API backend pattern

### Each project's role

- Dashboard config(s) describing what to show
- API backend if needed (job-finder's FastAPI routes, or scout-engine `create_app()`)
- Agent logic for creating/modifying configs and responding to interactions

## What a Config Looks Like

Grounded in what the existing dashboards actually need:

```yaml
# Job-finder dashboard expressed as config
dashboard:
  title: "Hunt CTRL"
  theme: terminal-dark

stats:
  - { id: tracked, label: "Tracked", source: "count(jobs)" }
  - { id: applied, label: "Applied", source: "count(jobs, status in [applied, interview, offer])" }
  - { id: interviews, label: "Interviews", source: "count(jobs, status == interview)" }
  - { id: hit_rate, label: "Hit Rate", source: "ratio(interviews, applied)", format: percent }
  - { id: recruiters, label: "Recruiters", source: "count(recruiters, status != not_contacted) / count(recruiters)" }

data_sources:
  jobs:
    type: rest
    endpoint: /api/jobs
    entity:
      id_field: id
      statuses: [new, reviewing, applying, applied, interview, offer, rejected, withdrawn, skipped]
      transitions:
        new: [reviewing, skipped]
        reviewing: [applying, skipped]
        applying: [applied, withdrawn]
        applied: [interview, rejected]
        interview: [offer, rejected]
  recruiters:
    type: rest
    endpoint: /api/recruiters
  actions:
    type: rest
    endpoint: /api/actions

views:
  - id: hot
    title: "Dashboard"
    layout: grid-2col
    panels:
      - id: priority-jobs
        title: "Priority Jobs"
        component: cards
        source: jobs
        filter: { priority: [1, 2], status: { not: [rejected, skipped] } }
        limit: 10
        fields: [title, company, total_score, work_mode, status]
        badges: [priority, work_mode, contract_type]
        on_click: detail

      - id: open-actions
        title: "Actions"
        component: checklist
        source: actions
        filter: { status: { not: done } }
        fields: [description, category, deadline]
        on_check: { patch: { status: done } }

      - id: recruiters-to-contact
        title: "Recruiters to Contact"
        component: cards
        source: recruiters
        filter: { status: not_contacted }
        fields: [name, agency, specialism]

  - id: jobs
    title: "Jobs"
    panels:
      - component: table
        source: jobs
        columns: [priority, status, total_score, title, company, location, work_mode, contract_type, salary]
        sortable: true
        filterable: [status, work_mode, priority, contract_type, ir35_status]
        searchable: [title, company, location]
        inline_edit: [status, priority, verdict, deadline]
        expandable:
          fields: [url, description, notes, posted_date, source]
          editable: [notes]

  - id: activity
    title: "Activity Log"
    panels:
      - component: timeline
        source: { type: rest, endpoint: /api/logs }
        fields: [timestamp, event, old_value, new_value, message]
```

```yaml
# Socials dashboard expressed as config
dashboard:
  title: "Socials"
  subtitle: "content pipeline"
  theme: terminal-dark

data_sources:
  posts:
    type: json_file
    path: data/posts.json
    entity:
      id_field: id
      statuses: [draft, review, ready, posted, rejected]
      transitions:
        draft: [review, rejected]
        review: [draft, ready]
        ready: [posted]

views:
  - id: feed
    title: "Feed"
    sidebar_filters:
      - { field: brand, type: pills, options: [all, gary, tensyl] }
    tab_filter: { field: status, show_counts: true }
    panels:
      - component: cards
        source: posts
        layout: list
        fields: [brand, platform, content_preview, average_score]
        badges: [platform, source]
        score_display: { field: average_score, dimensions: [attention, relevance, interest, engagement, follow] }
        on_click: detail
    detail:
      sections:
        - component: post_preview
          fields: [content, platform, brand, created_at]
          score_grid: [attention, relevance, interest, engagement, follow]
        - component: feedback_list
          source: persona_scores
          fields: [feedback, average, verdict]
          style: chat_bubbles
        - component: notes
          field: notes
          editable: true
      actions_by_status:
        draft: [{ label: "Reject", transition: rejected }, { label: "Send to Review", transition: review }]
        review: [{ label: "Back to Draft", transition: draft }, { label: "Approve", transition: ready }]
        ready: [{ label: "Copy", action: clipboard }, { label: "Post", transition: posted }]
        posted: [{ label: "Copy", action: clipboard }]

  - id: ideas
    title: "Ideas"
    panels:
      - component: grouped_cards
        source: ideas
        group_by: maturity
        groups:
          - { value: ready, label: "Ready to write", color: green, action: { label: "Generate", event: generate } }
          - { value: rough, label: "Rough ideas", color: amber, action: { label: "Promote", event: promote } }
          - { value: scheduled, label: "Scheduled", color: blue }
          - { value: open, label: "Open slots", color: accent }

  - id: personas
    title: "Personas"
    panels:
      - component: cards
        source: personas
        layout: grid-2col
        searchable: [name, role]
        filterable: [brand, platform]
        filter_style: pills
        on_click: detail
    detail:
      sections:
        - component: key_value
          fields: [average_score, review_count, engagement_rate]
        - component: markdown
          field: about
        - component: list
          field: cares_about
        - component: list
          field: turned_off_by
```

```yaml
# Business-manager dashboard expressed as config
dashboard:
  title: "Business Manager"
  theme: terminal-dark

data_sources:
  timeline:
    type: markdown
    path: docs/plans/timeline.md
    parse: date_entries
  applications:
    type: directory
    path: applications/
    parse: frontmatter
    entity:
      statuses: [researching, drafting, submitted, shortlisted, rejected, won]
  products:
    type: directory
    path: docs/products/
    parse: frontmatter
  priorities:
    type: markdown
    path: docs/plans/priorities.md
    parse: ranked_list

views:
  - id: overview
    title: "Overview"
    layout: grid-2col
    panels:
      - id: deadlines
        title: "Next 30 Days"
        component: timeline
        source: timeline
        options: { horizon: 30d, highlight: overdue }

      - id: pipeline
        title: "Funding Pipeline"
        component: kanban
        source: applications
        columns:
          - { status: drafting, label: "Drafting" }
          - { status: submitted, label: "Submitted" }
          - { status: shortlisted, label: "Shortlisted" }
          - { status: won, label: "Won" }
        on_move: { patch: { status: "$column" } }

      - id: products
        title: "Portfolio"
        component: cards
        source: products
        fields: [name, stage, revenue_status, priority]

      - id: this-week
        title: "This Week"
        component: checklist
        source: priorities
        filter: { priority: critical }
        on_check: { action: agent_callback, event: task_completed }
```

## Key Challenges

### Config schema expressiveness

The schema needs to be expressive enough for real dashboards but constrained enough for agents to generate reliably. The examples above show it's possible for these three dashboards. The risk is the 4th dashboard needing something the schema can't express — at which point we either extend the schema or provide an escape hatch (custom component with raw HTML/JS).

### Data source abstraction

**Decision: Hybrid approach (Option C).** CADE handles simple sources natively, complex sources go through project-provided APIs.

| Adapter | Handled by | Use case |
|---------|-----------|----------|
| `type: rest` | CADE fetches from project API | job-finder (database behind FastAPI) |
| `type: json_file` | CADE reads file directly | socials (static export) |
| `type: directory` + `parse: frontmatter` | CADE scans dir, parses YAML frontmatter | business-manager (application files) |
| `type: markdown` + `parse: date_entries` | CADE parses structured markdown | business-manager (timeline) |

Simple projects (business-manager) don't need a backend — CADE reads their files directly. Complex projects (job-finder) keep their FastAPI and CADE just fetches the API. Each `data_sources.type` in the config selects which adapter handles it.

For markdown parsing to work reliably, structured data should live in YAML frontmatter rather than being inferred from prose. The markdown body stays freeform for humans, the frontmatter is what the dashboard reads.

### Interaction model

**Decision: Three tiers, built incrementally.** All three are needed to support existing dashboards, but they ship in different phases.

**Tier 1: Direct mutation** (Phase 1) — dashboard handles it alone, no agent involved.
- User checks off an action → `PATCH /api/actions/5 {status: "done"}`
- User moves a kanban card → update frontmatter status field
- User edits notes → save to API or file

```yaml
on_check: { patch: { status: done } }
on_move: { patch: { status: "$column" } }
```

Covers most of what both existing dashboards do today. The dashboard is self-sufficient.

**Tier 2: Agent callback** (Phase 3) — user action triggers an event the agent responds to intelligently.
- User checks off "Prepare Seedcorn application" → agent asks "what progress did you make?"
- User clicks a deadline → agent generates a prep checklist for that event
- User clicks "Reject" on a job → agent suggests similar jobs to also reject

```yaml
on_check:
  action: agent_callback
  event: task_completed
```

Dashboard fires an event, agent picks it up, thinks, pushes new UI. This is the conversational loop.

**Tier 3: Complex workflow** (Phase 3+) — user triggers a multi-step agent pipeline.
- User clicks "Generate" on an idea → agent researches, writes draft, scores with personas, pushes result
- User clicks "Tailor CV" → agent analyses job, rewrites sections, shows diff

```yaml
action: { label: "Generate", event: generate }
```

Config just names the trigger. Agent handles the pipeline, pushing progress updates along the way. Leans on CADE's existing orchestration infrastructure.

### Migration path for existing dashboards

job-finder and socials already work. Rewriting them in config is only worth it if the config versions are genuinely easier to maintain and extend. The migration should be gradual — build the framework, prove it with business-manager, then optionally migrate the others when it makes sense (e.g., when adding features to job-finder, rebuild it in config rather than extending the 1,500-line HTML).

## Decisions Made

- **Config format:** YAML — readable, agent-friendly, supports comments
- **Data source strategy:** Hybrid (Option C) — CADE handles simple sources (JSON, frontmatter, markdown) natively, complex sources go through project-provided REST APIs
- **Interaction model:** Three tiers built incrementally — tier 1 (direct mutations) in phase 1, tiers 2+3 (agent callbacks, complex workflows) in phase 3
- **Component vocabulary:** Start with what existing dashboards need (cards, table, checklist, timeline, kanban, key-value, markdown), extend as needed

## Open Questions

- How does CADE discover project dashboards? Config in CADE's project registry? Scan for `.cade/dashboards/`?
- Should configs support inheritance/composition? (base dashboard + project overrides)
- State persistence — what survives page refresh? (expanded panels, scroll position, active filters)
- Can users edit configs directly? (power-user mode alongside agent generation)
- How do computed stats work? Simple counts/ratios in config, or does the backend compute and the config just displays?
- **Project themes**: Each project could override CADE's theme to match its brand/domain. Socials dashboard gets a content-pipeline aesthetic, business-manager gets a corporate feel. Config-level: `dashboard.theme: custom` with accent colour overrides. Allows the environment to be styled to the use case.

## Phases

### Phase 1: Config schema + component library + tier 1 interactions + data adapters

Everything needed to render a working dashboard from a YAML config with real data and basic interactions.

**Config schema:**
- YAML format definition
- Validation (fail loud on bad configs)
- Dashboard metadata, data sources, views, panels, components

**Component library (React):**
- Cards — grid/list of entity summary cards with fields, badges
- Checklist — items with completion state, priority indicators
- Timeline — date-ordered events with status highlighting
- Kanban — columns with moveable cards (status-driven)
- Key-value — label/value pairs for summary stats
- Table — sortable columns, filterable, searchable, expandable rows
- Markdown — rich text rendering

**Data source adapters:**
- `rest` — fetch JSON from project API endpoint
- `json_file` — read static JSON file
- `directory` — scan directory, parse YAML frontmatter from each file
- `markdown` — parse structured markdown (date entries, ranked lists)

**Tier 1 interactions:**
- Status transitions (dropdown, kanban move, button click) → PATCH API or update frontmatter
- Checkbox completion → PATCH status
- Notes editing → save to API or file
- Sort, filter, search (client-side)

**Infrastructure:**
- Config file watcher with hot-reload
- Tab integration — project dashboards as CADE tabs
- CADE-level theming (terminal-dark base, per-project accents)

**First consumer:** business-manager dashboard.

**Delivers:** agent writes a YAML config, CADE renders a live interactive dashboard with real data. No agent intelligence needed yet — dashboard is self-sufficient for basic workflows.

### Phase 2: Migrate an existing dashboard

Rebuild job-finder or socials dashboard in config. Stress-test the framework with a more complex case (sorting, filtering, inline editing, SSE push, score visualisations). Expand component vocabulary as needed.

**Delivers:** proof the framework generalises beyond business-manager. Identifies gaps in the component set and config schema.

### Phase 3: Agent interaction (tiers 2 + 3)

Bidirectional agent-user workflows through the dashboard.

**Tier 2 — Agent callbacks:**
- Event channel: dashboard fires named events, agent subscribes and responds
- Agent pushes new UI in response to user actions
- Conversational loops (agent asks follow-up questions via dynamic form/panel)

**Tier 3 — Complex workflows:**
- Agent pipelines triggered by dashboard actions
- Progress streaming (agent pushes incremental updates)
- Integration with CADE orchestration (spawn worker agents from dashboard triggers)

**Delivers:** dashboards become genuinely agent-integrated, not just agent-built.

### Phase 4: Agent config generation

Python utilities for agents to programmatically build and modify dashboard configs. Agent analyses a project's data shape, generates an appropriate config, modifies it on the fly as context changes.

**Delivers:** agents create entirely new dashboards without human config authoring.
