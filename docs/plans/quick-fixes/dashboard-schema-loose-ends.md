---
title: Dashboard Schema Loose Ends
created: 2026-11-26
updated: 2026-11-26
status: active
priority: medium
tags: [quick-fix, dashboard, schema, validation]
---

# Dashboard Schema Loose Ends

Small defects in the dashboard's config handling. None is fixed. Each was found by reading the code. Nothing here was reproduced in the running app unless the item says so.

The design these belong to is in [[../../technical/design/dashboard-system]]. The larger unbuilt work is in [[../dashboard/agent-ui-system]].

## 1. `KNOWN_COMPONENTS` is defined and never enforced

**Evidence**

- `core/backend/dashboard/config.py:22` defines `KNOWN_COMPONENTS`. A search of the repo's Python finds no other reference to it.
- `core/backend/dashboard/config.py:198` (`_parse_panel`) checks only that `component` is present.
- `frontend/src/dashboard/dashboard-pane.ts:530` shows `Component "<name>" not yet available` in the panel when the registry lacks the name.

**Effect.** A misspelt component name passes validation and the config loads. The agent that wrote it gets no error. The comment above the constant says to keep it in step with `frontend/src/dashboard/registry.ts`, and nothing checks that either. The two lists do match today, at 14 names each.

**Fix direction.** Raise `DashboardConfigError` in `_parse_panel` when the name is not in `KNOWN_COMPONENTS`, naming the valid options. Add a test that fails when the Python set and the frontend registry differ. Before turning this on, check existing configs for names outside the set: `frontend/src/dashboard/dashboard-pane.ts:504` mentions `npc_detail` and `world_detail`, which are in neither list.

## 2. Fields that are parsed and never rendered

**Evidence**

| Field | Parsed at (`core/backend/dashboard/config.py`) | Frontend use |
|-------|-----------------------------------------------|--------------|
| `dashboard.theme` | `:126`, `:290` | Only the type at `frontend/src/dashboard/types.ts:71` |
| `view.sidebar_filters` | `:116`, `:249` | Only the type at `types.ts:62` |
| `view.tab_filter` | `:117`, `:250` | Only the type at `types.ts:63` |
| `view.actions_by_status` | `:119`, `:252` | Only the type at `types.ts:65` |
| `entity.transitions` | `:54`, `:165` | Only the type at `types.ts:8` |
| `panel.on_move` | `:103`, `:224` | Only the type at `types.ts:51`. `frontend/src/dashboard/components/kanban.ts:228` always sends `patch: { status }` |

**Effect.** A config can set these and nothing happens. `on_move` and `transitions` are described in [[../../user/dashboard]] under `kanban` as if they were needed, and the kanban component reads neither.

**Fix direction.** For each field, either render it or remove it from the dataclass and reject it. Which fields to render is a product decision, listed in [[../dashboard/agent-ui-system]]. Correct the `kanban` section of the user guide in the same change.

## 3. Unknown keys are never rejected

**Evidence**

- `core/backend/dashboard/config.py:176` and `:203` collect unknown keys on a source or a panel into `extra`.
- `_parse_view` at `:229` and `validate_config` at `:273` read the keys they know and ignore the rest.

**Effect.** A typo such as `filterble:` is accepted and silently does nothing.

**Fix direction.** `extra` is used on purpose for type-specific options (`channel` and `buffer` on stream sources, `array_field`, `expand_field`), so a blanket rejection would break those. Give each source type and component a list of allowed extra keys and reject or warn on anything else.

## 4. The prompt module teaches a `file` source type that has no adapter

**Evidence**

- `backend/prompts/modules/dashboard.md:42` tells agents to give the `markdown` component `source: {type: file, path: docs/readme.md}`.
- `backend/prompts/modules/dashboard.md:53` lists `file` as a data source type.
- `core/backend/dashboard/adapters.py:973` registers ten source types. `file` is not one of them.
- A single markdown file is read by `type: markdown` with `parse: raw`, which returns one row with a `content` field (`core/backend/dashboard/adapters.py:210`).

**Effect, read from code and not run.** An agent following the prompt writes a mapping as the panel's `source`. Validation skips mappings (`config.py:317`), so the config loads, and the panel then gets no rows (item 5). A named source with `type: file` would load too, and its fetch would fail with "Unknown data source type" and return no rows (`adapters.py:987`, `:999`).

**Fix direction.** Change the prompt module to declare a named source with `type: markdown` and `parse: raw`. Confirm in the running app that the panel renders before and after.

## 5. A mapping given as a panel's `source` resolves to no data

**Evidence**

- `core/backend/dashboard/config.py:86` types `PanelConfig.source` as a string, a mapping or nothing.
- `frontend/src/dashboard/dashboard-pane.ts:136` and `:523` use the source only when it is a string. Otherwise the panel's rows are an empty list.
- No backend code was found that fetches data for a mapping source: `fetch_all_sources` at `core/backend/dashboard/adapters.py:995` iterates `config.data_sources` only.

**Effect, read from code and not run.** A panel with an inline source renders empty, with no error.

**Fix direction.** Either support it, by having the backend register each inline source under a generated name and send its rows, or narrow the type to a string and reject mappings in validation with a message pointing at `data_sources`.

## 6. Patching a `markdown` source goes down the directory path

**Evidence**

- `core/backend/dashboard/handler.py:220` sends patches for both `directory` and `markdown` sources to `_patch_file_source`.
- `_patch_file_source` at `core/backend/dashboard/handler.py:239` calls `iterdir()` on the source's `path`.
- A `markdown` source's `path` must be a file (`core/backend/dashboard/adapters.py:202`).

**Effect, read from code and not run.** `iterdir()` on a file raises `NotADirectoryError`. A checklist backed by a `markdown` source with `on_check` set would fail to save the tick. Where the exception surfaces was not traced.

**Fix direction.** Reproduce first. Then decide what a patch to a parsed markdown list means (rewrite the list item in place) and implement it, or stop routing `markdown` there and log that the source is read-only.

## 7. Components ignore `entity.id_field`

**Evidence**

- `frontend/src/dashboard/components/checklist.ts:41`, `kanban.ts:231` and `:282`, and `table.ts:132` and `:273` all send `entityId: String(item["id"] ?? "")`.
- The backend honours `id_field` when patching a `json_file` source (`core/backend/dashboard/handler.py:275`).

**Effect, read from code and not run.** On a source whose `id_field` is not `id`, a patch is sent with an empty entity id and matches nothing.

**Fix direction.** Have components read the id through the source's `entity.id_field`, defaulting to `id`. `DashboardComponentProps.config` already carries the sources.

## 8. Stale path in a comment

**Evidence.** `frontend/src/dashboard/types.ts:2` says the file "mirrors backend/dashboard/config.py". The schema is at `core/backend/dashboard/config.py`. `backend/dashboard/` contains only a `__pycache__` folder.

**Fix direction.** Correct the path in the comment. Check whether the empty `backend/dashboard/` folder can be removed.

## See also

- [[../../technical/design/dashboard-system]]: design and known limits
- [[../dashboard/agent-ui-system]]: unbuilt dashboard work
- [[../../user/dashboard]]: config reference
