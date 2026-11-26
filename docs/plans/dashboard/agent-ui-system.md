---
title: Agent UI System
status: partially-shipped
verified: 2026-11-26
created: 2026-03-24
updated: 2026-11-26
tags: [dashboard, agent-ui, components, config-driven]
---

# Agent UI System

Dashboards that agents create and change by writing configuration, and that carry the user's actions back to agents. The first half is built. This plan holds the second half and the gaps left in the first.

## Shipped

**Phase 1: schema, components, data adapters, direct mutation.** A project's `.cade/dashboard.yml` is validated, rendered, hot-reloaded and written back to. Config reference: [[../../user/dashboard]]. Design and reasoning: [[../../technical/design/dashboard-system]].

**Phase 2: proving it on existing dashboards.** job-finder and socials have configs alongside their hand-built dashboards. The gaps this exposed are closed and documented in [[../../user/dashboard]]: inline editing and expandable rows on tables, detail on click, the `stats:` strip. Agent push through stream sources is in [[../../technical/reference/dashboard-interactive-primitives]]. One item is left over, below.

## What it adds

### 1. Score-radar component

The socials dashboard shows each post's persona scores across five dimensions (attention, relevance, interest, engagement, follow). No built component can draw this. It needs a new component and a panel option naming the score field and its dimensions.

### 2. Fields the schema accepts and the screen ignores

The schema was written ahead of the renderer. These parse without error and do nothing:

| Field | Where | Intended behaviour |
|-------|-------|--------------------|
| `sidebar_filters` | view | Filter controls beside the view, such as brand pills |
| `tab_filter` | view | Tabs across the view that filter by one field, with counts |
| `actions_by_status` | view | Buttons in the detail panel that depend on the entity's status |
| `entity.transitions` | data source | Limit a status change to the allowed next statuses |
| `on_move` | panel | Set what a kanban move patches. Today a move always patches `status` |
| `theme` | `dashboard` | Per-project look. See open questions |
| mapping as `source` | panel | A one-off source declared on the panel itself |

Each needs one of two outcomes: render it, or remove it from the schema so configs that use it fail validation.

Components that appear in the original design and were never built: `grouped_cards` (cards grouped by a field, with an action per group), `post_preview`, `feedback_list`, `notes`, `list`, `chart`, `form`, `iframe`. Build these only when a dashboard needs one. `chart`, `form` and `iframe` are also proposed in [[dashboard-schema-overhaul]].

The related code defects are in [[../quick-fixes/dashboard-schema-loose-ends]].

### 3. Agent callbacks

A user action fires a named event that an agent picks up and answers. Examples:

- The user checks off a task and the agent asks what progress was made.
- The user clicks a deadline and the agent drafts a preparation checklist.
- The user rejects a job and the agent suggests similar ones to reject.

```yaml
on_check:
  action: agent_callback
  event: task_completed
```

This needs an event channel from the dashboard to an agent, a way for an agent to subscribe, and a way for the agent to answer in the dashboard, including asking a follow-up question through a form or panel.

### 4. Workflows started from a dashboard

A user action starts a multi-step agent pipeline. The config names the trigger and the agent owns the pipeline.

- The user clicks "Generate" on an idea. The agent researches, drafts, scores the draft and pushes the result.
- The user clicks "Tailor CV". The agent analyses the job, rewrites sections and shows a diff.

```yaml
action: { label: "Generate", event: generate }
```

This needs dashboard triggers that spawn orchestrator worker agents. Progress reporting does not need new work: an agent can already append rows to a stream source.

### 5. Config-generation helpers

Python utilities that let an agent build and change a dashboard config in code: inspect a project's data, produce a valid config, and adjust it as the context changes. Today agents write the YAML by hand from the schema in their prompt.

## Key challenges

- **Reaching the right agent.** A dashboard belongs to a project tab. An event must reach an agent working in that project, and there may be none running, or several.
- **Events with no listener.** A callback fired when no agent is subscribed must do something visible: queue, start an agent, or tell the user.
- **Schema growth.** Each new dashboard may need something the schema cannot express. The choice is between extending the schema and offering an escape hatch such as a raw HTML component. [[dashboard-schema-overhaul]] proposes the second.
- **Tightening validation.** Rejecting unknown components and fields will break any existing config that relies on them being ignored. Nine projects under `~/projects` have a dashboard config.

## Integration points

- **Action routing.** `DashboardHandler.handle_action` in `core/backend/dashboard/handler.py` routes `patch` and `provider_message`. An agent callback is a third action type there.
- **Orchestrator.** Spawning workers from a trigger goes through the same orchestrator that serves `spawn_agent`.
- **Agent to dashboard.** `POST /api/ui/push-panel` and `POST /api/ui/stream-event` already exist for the agent's reply.
- **Prompt module.** `backend/prompts/modules/dashboard.md` teaches agents the schema and must change with it.

## Open questions

- Should configs support inheritance or composition, such as a base dashboard with project overrides?
- What should survive a page reload: the active view, filters, expanded rows, scroll position? Nothing is stored today.
- Should each project be able to restyle its dashboard? The `theme` field was meant for this, for example accent colour overrides, and is unused.
- Should the hand-built job-finder and socials dashboards be retired once their configs cover them? Whether both are still in use was not checked.
- How does an agent learn the user acted: a subscription it holds open, or a message delivered on its next turn?

## See also

- [[../../technical/design/dashboard-system]]: design, decisions and known limits of what is built
- [[../../user/dashboard]]: config reference
- [[../../technical/reference/dashboard-interactive-primitives]]: actions and push
- [[dashboard-schema-overhaul]]: the deferred proposal for a richer schema
- [[../quick-fixes/dashboard-schema-loose-ends]]: small code defects in the current schema
