---
title: Interactive Dashboard Primitives
created: 2026-04-17
updated: 2026-04-17
status: complete
tags: [reference, dashboard, protocol, components]
---

# Interactive Dashboard Primitives

CADE dashboards began as read-only panels — display data, never drive behaviour. The interactive primitives documented here extend that surface so panels can dispatch actions back to a backend (either CADE's file-patch path, or through a provider to a game/IDE server), and so server state can drive dashboard UX programmatically (focus a tab when a build starts, when a trade session opens, etc).

The shape is deliberately generic: panels emit actions with a freeform `message`; the server emits events with a freeform payload. Specific use cases (barter, macro buttons, build-status focus) are supplied entirely by the consumer via YAML config + component choice.

## Panel action flow

A dashboard component calls `props.onAction({ action, source, ... })` when the user interacts with it (checkbox toggle, stepper click, Confirm press). The `DashboardPane.handleAction` method dispatches on `action` type:

| Action           | Route                                                | Notes |
|------------------|------------------------------------------------------|-------|
| `view_file`      | Client-side — opens the file in the markdown viewer. | Pre-existing. |
| `patch`          | Server: `DashboardHandler._handle_patch_action`. Applies a field-level mutation to the named data source (REST, directory, markdown adapter). Handler re-fetches + pushes fresh data. | Pre-existing. |
| `provider_message` | Server: `DashboardHandler._handle_provider_message`. Forwards `data.message` through the active provider's `send_frame` to the engine. Fire-and-forget; server-side effects drive dashboard refresh via the normal file-watch loop. | **New.** |

A panel declares its action shape in YAML under `options.on_<event>`:

```yaml
panels:
  - component: basket
    source: game_barter
    options:
      on_confirm:
        action: provider_message
        message:
          type: trade_commit           # consumer-specific frame shape
          counterpart_id: merchant_01   # component appends { basket: {left, right} } at emit
```

The component is responsible for reading its own `on_<event>` keys out of `panel.options` and building the action object; `handleAction` doesn't care what `action` string it gets, only how to route it.

## Provider `send_frame`

`BaseProvider.send_frame(frame: dict) -> None` is the backend-side transport for `provider_message` actions. Default implementation raises `NotImplementedError` — only providers with a persistent engine channel can forward frames.

| Provider              | `send_frame` behaviour |
|-----------------------|------------------------|
| `WebsocketProvider`   | Writes `json.dumps(frame)` to the persistent WS connection; lazy-connects if closed. |
| `SubprocessProvider`  | Default (raises). Per-turn subprocess has no persistent channel. |
| `APIProvider`         | Default (raises). Request/response only. |
| `ClaudeCodeProvider`  | Default (raises). No custom engine link. |

`DashboardHandler` receives the active provider at construction (from `ProviderRegistry.get_default()` in `ConnectionHandler._setup`). When an interactive panel emits `provider_message` but the active provider doesn't support `send_frame`, the handler logs a warning and drops the action — the frontend gets no explicit rejection signal today.

## Cross-source component props

`DashboardComponentProps.allData: Record<string, Row[]>` carries the full map of declared-source name → fetched rows, populated by `DashboardPane` from its own data cache. Panels that need to read across sources (a basket checking a wallet source for affordability; a diagnostics panel correlating build output with test-result data; a task panel cross-referencing a priorities source) consume this alongside their own `data`.

Before the addition, components saw only their own filtered source data. Existing components ignore `allData`; only components that opt into cross-source semantics need to read it.

## Server → client dashboard signals

Server-pushed frames that drive dashboard UX without being a direct response to a user action. Routed via `WebsocketProvider._route_frame` → `UnsolicitedEventHandler` → `ConnectionHandler._on_unsolicited_provider_event` → frontend WS message.

| Frame                       | Client message             | Frontend handler                      | Effect |
|-----------------------------|----------------------------|---------------------------------------|--------|
| `{type: "dashboard_focus", view_id}` | `MessageType.DASHBOARD_FOCUS_VIEW` | `DashboardPane.focusView(view_id)` | Switches the active tab to `view_id` if it's declared by the current config; silent no-op otherwise. |

More server → client signals can be added the same way: new case in `_route_frame`, new case in `_on_unsolicited_provider_event`, new `MessageType`, new handler call on the frontend pane. Keep the signals narrow — each frame type should correspond to exactly one UX affordance.

## Components

Built-in components that emit actions:

| Component     | Action                              | Notes |
|---------------|-------------------------------------|-------|
| `checklist`   | `patch`                             | Toggle a row's done state. |
| `kanban`      | `patch`                             | Move a card between columns. |
| `basket`      | `provider_message` or user-defined  | Two-column stepper basket with balance + Confirm. |
| `cards_paged` | `provider_message` or user-defined  | Windowed infinite-scroll card list. Favourite toggle + expandable detail panel. |

### `cards_paged`

A windowed variant of `cards` for data sources that grow unboundedly (live-push event logs, journals, feed-style lists). Renders a sliding slice of whatever the source last pushed — no server pagination required, no request per scroll event.

Configurable via `panel.extra`:

| Key           | Default  | Description |
|---------------|----------|-------------|
| `target_size` | `15`     | Entries to render by default (and to trim back to after idle). |
| `buffer_size` | `5`      | Overflow before trim triggers — max window = target + buffer. |
| `page_size`   | `5`      | Entries added per scroll-to-bottom load. |
| `stale_ms`    | `180000` | Gap in ms since the panel was hidden; if exceeded and the first entry changed, the window resets to `target_size` and expanded state is cleared. |

Trim logic: when `windowSize > target + buffer` AND the scroll has been idle for 800 ms AND the viewport is within 50 px of the top, the oldest entries are discarded back to `target_size`. This keeps the DOM lean while preserving entries the user is actively reading further down.

Scroll-position preservation: saves `scrollTop` on dispose (view-switch or data rebuild) and restores it on the next render, so live data pushes don't snap the view.

Return-to-top: a margin-tab strip (`[ ↑ latest ]`) is injected directly into the scroll container so `position: sticky` works despite `overflow: hidden` on `.dashboard-panel`. It appears after 80 px of scroll and scrolls smoothly to the top on click.

Supports the full `cards` feature set: `fields`, `badges`, `favourite` toggle (via `options.on_favourite`), and expandable `detail` sub-components (e.g. `split_markdown`). Expansion state is preserved across view switches.

Example config snippet:

```yaml
- component: cards_paged
  source: game_journal
  fields: [title, location, timestamp]
  badges: [kind, favourite]
  filterable: [kind, favourite]
  searchable: [title, location, _body, _notes]
  extra:
    page_size: 25
  detail:
    component: split_markdown
    options:
      read_field: _body
      edit_field: _notes
      on_save:
        action: provider_message
        message: { type: journal_note_update }
  options:
    on_favourite:
      action: provider_message
      message: { type: journal_note_update }
```

### `basket`

A generic primitive for "pick quantities from two pools and submit." One data source, rows carry `side: "left"` or `"right"`. Each row renders with a `+`/`−` stepper that accumulates into a basket kept on the component instance. A footer shows the running balance and a Confirm button.

Key options:

- `left_label` / `right_label` — column headers
- `unit` — string appended to value labels (e.g. `"g"` for gold)
- `left_budget_source` / `right_budget_source` — optional cross-source references (read via `allData`). When set, the column header shows the budget value ("Shop — 200g"), and if the basket would overdraw the *paying* side's budget, the balance text turns red and Confirm is disabled
- `balance_labels` — override prose for positive / negative / overdraw_left / overdraw_right / empty / even states; templates accept `{n}`, `{budget}`, `{unit}` placeholders
- `on_confirm` — action shape to emit. The component appends `basket: { left: [{id, qty}], right: [{id, qty}] }` to the message at emit time

Used by Padarax for barter; usable in an IDE for moving files/tasks between pools, reassigning budget across allocations, or any similar dual-column stepper workflow.

## Writing a new interactive component

1. Extend `BaseDashboardComponent` in `frontend/src/dashboard/components/<name>.ts`. Implement `build()` to render from `this.props.data` (and optionally `this.props.allData` for cross-source reads).
2. Call `this.props.onAction({ action, source, ... })` on user interaction. Pick an action type:
   - `patch` — if the interaction is a file/data-source mutation that CADE's backend should apply directly
   - `provider_message` — if the interaction should be dispatched to the engine through the active provider (requires `BaseProvider.send_frame` support)
3. Export from `components/index.ts`, register in `createDefaultRegistry()` in `registry.ts`.
4. Document the `panel.options` schema your component reads in its own source-file docstring — it's the panel author's user-facing API.

No changes to `DashboardPane.handleAction` are needed unless a genuinely new action routing model is required (beyond client-side / backend-patch / provider-forward). Add a new branch in `handleAction` + `DashboardHandler.handle_action` in that case.
