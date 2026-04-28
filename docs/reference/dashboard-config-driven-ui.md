---
title: "Config-Driven UI: Live Rendering from Declarative Configuration"
created: 2026-04-28
updated: 2026-04-28
status: active
tags: [research, dashboard, ui, configuration, hot-reload]
---

# Config-Driven UI: Live Rendering from Declarative Configuration

Declarative configuration-driven UI is a pattern where a structured config file defines the layout, components, and data bindings of a user interface, which is then rendered and updated live without requiring application restarts. CADE's dashboard (`.cade/dashboard.yml`) exemplifies this pattern: a YAML file drives the entire panel system, hot-reloading on change.

This document surveys the research and industry practice behind this architectural pattern, covering implementation strategies, security considerations, schema design, and hot-reload mechanisms.

---

## Overview

The core idea is simple: **separate the description of a UI from its implementation**. Instead of writing code to construct UI elements imperatively, a configuration file describes *what* should be displayed and *how*, and a runtime renderer produces the live UI from that description.

This pattern appears across production systems:

| System | Config Format | Key Mechanism |
|--------|--------------|----------------|
| Grafana | JSON | File watching + WebSocket push |
| Linear | TypeScript/JSON | Server-driven live sync |
| Raycast | JSON | Extension hot-load |
| CADE | YAML | File watcher + WS push |
| Vercel dashboards | JSON | CDN edge config + polling |
| Microsoft Portal UX | Typed JSON | LLM planner + deterministic renderer |

The pattern consistently involves:

1. **Config parsing** — reading and validating the declarative description
2. **Schema validation** — enforcing that config conforms to known structure
3. **Component mapping** — translating config keys into renderable components
4. **Live update propagation** — detecting config or data changes and updating the UI

---

## Implementation Strategies

### Layered Architecture

A config-driven UI system typically has three distinct layers:

```
┌─────────────────────────────────────────────────────────┐
│  Config Author (YAML/JSON)                             │
│  ─ "component: cards, source: plans, fields: [title]"   │
└──────────────────────┬────────────────────────────────┘
                       │ parse + validate
┌──────────────────────▼────────────────────────────────┐
│  Declarative Model (internal intermediate representation) │
│  ─ typed object graph matching the schema               │
└──────────────────────┬────────────────────────────────┘
                       │ component mapping
┌──────────────────────▼────────────────────────────────┐
│  Renderable UI (React/Vue/vanilla)                     │
│  ─ concrete components instantiated from config          │
└───────────────────────────────────────────────────────┘
```

This separation is intentional. It enables independent evolution of each layer:

- **Config layer** can be authored by humans, AI agents, or other programs
- **Model layer** is the stable API contract between config and renderer
- **Renderer layer** can be replaced without breaking existing configs

### Portal UX Agent: Bounded Generation

Microsoft's Portal UX Agent (Li et al., 2025) demonstrates a refined version of this pattern for LLM-driven UI generation. The key innovation is **bounded generation** — decoupling an LLM-based semantic planner from a deterministic renderer:

1. **LLM Planner** receives a natural-language intent and emits a *typed composition* (schema-constrained JSON)
2. **Deterministic Renderer** takes the typed composition and produces the UI from a vetted component inventory

This prevents common failure modes of unconstrained code generation: malformed DOM structures, inaccessible elements, design system violations.

**Key insight:** The renderer only instantiates components from a pre-approved library. The config never contains arbitrary code — only references to registered components with typed properties.

Source: (Li et al., 2025, *Portal UX Agent*, arXiv:2511.00843)

### Model-Driven Dashboard Generation

Academic research on dashboard generation (Rossi et al., 2024) formalizes the transformation chain:

1. **KPI Definition** — operator specifies data sources and metric definitions
2. **Automatic Visualization Assignment** — system infers appropriate chart types from data dimensions
3. **Technology-Specific Generation** — generates final config for target platform (Grafana, Kibana)

The metamodel captures layout structure, data source bindings, and visualization types as first-class concepts. This allows technology-agnostic dashboards to be migrated across platforms by swapping the generation step.

Source: (Rossi et al., 2024, *Towards Model-Driven Dashboard Generation*, arXiv:2402.15257)

### CADE's Current Implementation

CADE's dashboard follows the layered architecture:

- **Config:** `.cade/dashboard.yml` (YAML)
- **Model:** `DashboardConfig` TypeScript interface — defines `dashboard`, `data_sources`, `views`, `panels`, `component`, `props`
- **Renderer:** React components in `frontend/src/dashboard/components/` — each component reads `props.data` and `props.options`

The config-to-model translation happens in the backend (`DashboardHandler` in Python), which parses YAML, validates structure, and pushes the config tree to the frontend via WebSocket. Data fetching is handled by adapters (frontmatter parser, REST client, file watcher) that return row arrays consumed by components.

---

## Schema Design Best Practices

A well-designed config schema balances expressiveness with implementability. Based on research and industry practice:

### Use Typed, Structured Schemas

JSON Schema or Zod schemas provide machine-readable contracts for configs. This enables:

- **Early error detection** before the UI renders
- **IDE autocomplete** for config authors
- **Documentation generation** from schema annotations

For production systems handling user-authored configs, compile-time schema validation (e.g., Blaze's 10× faster approach) reduces runtime overhead significantly.

Source: (Viotti & Mior, 2025, *Blaze: Compiling JSON Schema*, arXiv:2503.02770)

### Define Explicit Component Registries

Instead of allowing arbitrary string component names, define a closed registry:

```yaml
# Good: explicit component list
panels:
  - component: cards    # must be in registry
    source: plans
    fields: [title]

# Avoid: freeform component names
panels:
  - component: "myCustomReactComponent"
    inlineCode: "..."   # security risk
```

This matches the Portal UX Agent's approach: all UI elements are drawn from a vetted, auditable inventory.

### Keep Schema Versions Stable

Once agents or users start building dashboards, schema changes become breaking. Strategies:

- **Additive changes only** — new fields default sensibly for old configs
- **Deprecation warnings** — flag deprecated fields with migration guidance
- **Version field** — explicit version marker enables forward-compatibility logic

### Expose Cross-Cutting Concerns Explicitly

CADE's schema explicitly handles concerns that cut across many components:

| Concern | How Exposed | Example |
|---------|-------------|---------|
| Data binding | `source:` field | `source: plans` |
| User actions | `on_<event>:` | `on_click: { action: view_file }` |
| Filtering | `filter:` block | `filter: { status: active }` |
| Cross-source reads | `allData` prop | components read multiple sources |

Avoid burying these in component-specific props — consistent surface makes configs more predictable.

---

## Hot-Reload Mechanisms

Hot-reload for config-driven UIs operates at two levels:

### 1. Config Structure Reload

When the config file itself changes (new panel, changed layout), the entire config tree must be re-parsed and re-validated. Strategy:

- **File watcher** detects changes (inotify on Linux, FSEvents on macOS)
- **Debounce** rapid changes (CADE uses 2s debounce for `watches`, immediate for config)
- **Graceful degradation** — if new config is invalid, keep rendering last valid state + show error banner
- **Incremental diff** — push only changed portions, not full re-render

### 2. Data Source Refresh

When underlying data changes but config stays the same, only affected panels re-fetch. Strategies:

- **File watching** — for local files (markdown, YAML frontmatter)
- **Polling with backoff** — for REST sources (e.g., every 5 min, exponential backoff on errors)
- **WebSocket push** — for server-driven updates (CADE uses this for server-initiated dashboard focus)

### Live Update Propagation

CADE's mechanism (based on the WebSocket protocol):

1. Backend file watcher detects change in data source file
2. Adapter re-parses the source, returns updated rows
3. Backend pushes `dashboard_data` message via WebSocket
4. Frontend `DashboardPane` receives update, merges into component data props
5. React reconciliation updates only affected components

This is a **push-based reactive model** — the server drives updates, client responds. No polling, no full-page refresh.

### Production Considerations

| Concern | Mitigation |
|---------|------------|
| Race conditions during rapid edits | Config writes are atomic; parser validates before applying |
| Invalid config crashes render | Try/catch around parse; show error state, keep previous UI |
| Large data sources cause lag | Virtualized rendering (`cards_paged` component) |
| Stale data on reconnect | Server sends full state on connection; client reconciles |

---

## Security Considerations for User-Authored Configs

User-authored configs (even AI-authored) introduce security surface area. The primary risk is **injection**: a malicious or malformed config causing unintended side effects.

### Threat Model

| Threat | Attack Vector | Severity |
|--------|---------------|----------|
| Arbitrary code execution | `eval` in config or component props | Critical |
| File system access | Malicious paths in `source` fields | Critical |
| Data exfiltration | `source` reading sensitive files, leaking via UI | High |
| DoS via resource exhaustion | Large datasets, deep recursion in configs | Medium |
| XSS in rendered content | Unsanitized content from data sources | High |

### Defense Layers

#### 1. Sandboxing

**SafeJS** (Cassou et al., 2013) provides hermetic JavaScript sandboxing using Web Workers. Each untrusted script runs in isolation with a virtual DOM that cannot directly modify the main document.

For config-driven UIs, the equivalent strategy is: **never execute user config as code**. The config describes *what to render*, not *how to compute*. Component logic is fixed TypeScript/React code; config only parameterizes it.

Source: (Cassou et al., 2013, *SafeJS: Hermetic Sandboxing*, arXiv:1309.3914)

#### 2. Path Allowlisting

CADE's `extra_roots` only exposes explicitly listed directories. The server validates all file paths against this allowlist — no path traversal, no arbitrary filesystem access.

#### 3. Input Sanitization

Data fetched from sources (markdown body, JSON fields) is sanitized before rendering:

- Markdown parsed with a safe subset (no raw HTML unless explicitly enabled)
- JSON fields rendered as text, not evaluated
- URLs validated before opening

#### 4. Schema Enforcement

Strict schema validation prevents configs from including unexpected fields:

```yaml
# Schema rejects this (unknown field):
panels:
  - component: cards
    __proto__: { evil: true }   # rejected by schema
```

Zod or JSON Schema with `additionalProperties: false` enforces closed schemas.

#### 5. Resource Limits

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Max config size | 1MB | Prevents memory exhaustion |
| Max panels per view | 20 | Prevents layout DoS |
| Max rows per source | 10,000 | Virtualized rendering caps |
| Max data fetch timeout | 30s | Prevents hanging on remote sources |

#### 6. Audit Logging

Log all config changes with authorship attribution (user vs agent). Enable post-hoc investigation if a config causes issues.

---

## Component Mapping

The bridge between config and rendered UI is **component mapping** — a registry that maps config keys to concrete implementations.

### Registry Pattern

```typescript
// Registry: component name → factory function
const COMPONENT_REGISTRY = {
  cards: CardsComponent,
  checklist: ChecklistComponent,
  kanban: KanbanComponent,
  table: TableComponent,
  key_value: KeyValueComponent,
} as const;

type ComponentName = keyof typeof COMPONENT_REGISTRY;

// Resolution: config → component instance
function resolveComponent(name: ComponentName, props: ComponentProps) {
  const Component = COMPONENT_REGISTRY[name];
  if (!Component) throw new Error(`Unknown component: ${name}`);
  return new Component(props);
}
```

### Component Props Interface

Each component receives a consistent props interface:

```typescript
interface DashboardComponentProps {
  panel: PanelConfig;           // full panel config from YAML
  data: Row[];                 // filtered rows from data source
  allData: Record<string, Row[]>; // cross-source data map
  options: PanelOptions;        // panel.options block
  onAction: (action: Action) => void; // event handler
}
```

This uniformity enables cross-source components (like `basket` or `entity_detail`) that read from multiple sources, and makes adding new components a matter of implementing the interface.

### Extensibility

Three extension points, in order of risk:

| Extension Point | How | Risk Level |
|---------------|-----|------------|
| New component in registry | Add factory + TypeScript file | Low — fixed code |
| New data source adapter | Implement `DataAdapter` interface | Low — runs server-side |
| New config field | Schema update + optional prop support | Medium — may affect existing components |

**Do not** add dynamic component loading from config (e.g., `component: "eval(something)"`). That reopens the code execution attack surface.

---

## See Also

- [[../user/dashboard|Dashboard Guide]] — user-facing documentation for CADE's dashboard
- [[dashboard-interactive-primitives|Interactive Dashboard Primitives]] — component actions, provider messages, and server→client signals
- [[dashboard-schema-overhaul|Dashboard Schema Overhaul]] — proposed future schema with richer layout, named sources, and action system
- [[../technical/reference/websocket-protocol|WebSocket Protocol]] — how config and data are pushed to the frontend

---

## References

- Li, X., Jiang, N., & Selvaraj, J. (2025). *Portal UX Agent: A Plug-and-Play Engine for Rendering UIs from Natural-Language Specifications*. Microsoft Research. arXiv:2511.00843.
- Rossi, M. T., Tundo, A., & Mariani, L. (2024). *Towards Model-Driven Dashboard Generation for Systems-of-Systems*. University of Milano-Bicocca. arXiv:2402.15257.
- Viotti, J. C., & Mior, M. J. (2025). *Blaze: Compiling JSON Schema for 10× Faster Validation*. Sourcemeta Ltd / RIT. arXiv:2503.02770.
- Cassou, D., Ducasse, S., & Petton, N. (2013). *SafeJS: Hermetic Sandboxing for JavaScript*. INRIA / Université de Lille. arXiv:1309.3914.
- Grafana Labs. (2023). *Grafana Documentation*. https://grafana.com/docs/
