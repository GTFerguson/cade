---
title: Modular Prompt Composition
created: 2026-04-23
updated: 2026-11-26
status: implemented
tags: [prompts, agents, architecture]
---

# Modular Prompt Composition

Agent system prompts are assembled at runtime from small, single-purpose markdown files. This replaces the old approach of hardcoded prompt strings scattered across provider files.

## Why the Prompt Teaches Output Channels

A chat agent in CADE is not writing to a bare terminal. It has a chat pane, a dashboard that reloads when its config file changes, and a viewer that renders documents. A model that is not told this puts everything in chat, including tables and long documents that read better elsewhere. So `base.md` opens with a short decision tree (direct answer, structured data, long-form document, finished reference) that maps each kind of output to a surface, and `dashboard.md` is loaded in every mode so any agent can act on it.

## Structure

```
backend/prompts/
├── __init__.py          — exports compose_prompt
├── compose.py           — assembles modules by mode
├── bundled/rules/       — rules loaded into every prompt
└── modules/
    ├── base.md              — CADE identity, output channels, dashboard overview
    ├── dashboard.md         — always included: dashboard write instructions
    ├── neovim.md            — always included: Neovim integration
    ├── nkrdn.md             — knowledge graph orientation (added per mode)
    ├── agent-memory.md      — recording decisions, attempts and notes (added per mode)
    ├── test-driven-debugging.md  — debugging methodology (code mode only)
    ├── code.md              — primary development mode
    ├── plan.md              — read-only architecture / planning mode
    ├── research.md          — PROVEN research pipeline mode
    ├── review.md            — skill-graph review orchestrator
    ├── triage.md            — transaction triage mode
    └── orchestrator.md      — delegation overlay, added on top of any mode
```

## Compose Order

`compose_prompt(mode, working_dir, orchestrator=False)` assembles modules in this fixed order:

1. **Datetime** — current UTC timestamp injected fresh each call
2. **Base** — `base.md`: CADE identity and core instructions
3. **Rules** — bundled rules from `backend/prompts/bundled/rules/`
4. **Always** — `dashboard.md`, `neovim.md`: present in every mode
5. **Mode** — one mode-specific module from `MODE_MODULES`
6. **Additional** — supporting modules from `ADDITIONAL` (e.g. `nkrdn.md`, `agent-memory.md`, `test-driven-debugging.md`)
7. **Orchestrator overlay** — `orchestrator.md`, only when `orchestrator=True`
8. **Project** — `CLAUDE.md` and `.claude/rules/*.md` from the working directory

Modules are joined with `---` separators and returned as a single string.

```python
from backend.prompts import compose_prompt

prompt = compose_prompt("code", working_dir=Path("/home/user/myproject"))
```

## Mode Registry

All mode definitions live in `backend/modes.toml`. This is the single source of truth — editing it automatically updates the slash command dropdown, write permissions, prompt composition, and frontend color theming without touching Python or TypeScript.

Each mode entry has:

| Field | Purpose |
|-------|---------|
| `label` | Display string in the statusline (e.g. `"CODE"`) |
| `description` | Text shown in the `/` command dropdown |
| `color` | CSS value applied to the mode badge (e.g. `"var(--accent-green)"`) |
| `modules` | Prompt modules loaded as the mode body |
| `additional_modules` | Supporting modules appended after the mode body |
| `write_access` | `"all"` / `"docs_plans"` / `"none"` |
| `slash_names` | List of slash commands that switch to this mode (first entry is canonical) |

The registry is loaded once at startup by `backend/modes.py` into `MODES: dict[str, ModeConfig]` and `MODE_SLASH_MAP: dict[str, str]`. Both `compose.py`, `slash_commands.py`, `mode_permissions.py`, and `websocket.py` import from it — none of those files contain hardcoded mode lists.

The frontend receives `{ name → { label, color } }` in the `system-info` WebSocket message and applies label and color dynamically in `setMode()`, so no CSS class changes are needed when adding or recolouring a mode.

## Mode Table

| Mode | Module | Additional modules | Write access | Statusline color |
|------|--------|--------------------|--------------|-----------------|
| `plan` | `plan.md` | `nkrdn`, `agent-memory` | none | `--accent-orange` |
| `code` | `code.md` | `nkrdn`, `test-driven-debugging`, `agent-memory` | all | `--accent-green` |
| `research` | `research.md` | `nkrdn`, `agent-memory` | none | `--accent-cyan` |
| `review` | `review.md` | `nkrdn`, `agent-memory` | docs/plans only | `--accent-blue` |
| `triage` | `triage.md` | `nkrdn`, `agent-memory` | none | `--accent-purple` |

`backend/modes.toml` is the source for this table.

## Orchestrator Overlay

Orchestrator is not a mode. `/orch` (or `/orchestrator`) toggles a flag on the connection, and the current mode stays as it is. While the flag is on, `compose_prompt` appends `orchestrator.md` after the mode's own modules, and the provider offers the `spawn_agent` and `list_agents` tools (see [[provider-stack#Orchestrator tools]]). Write access still comes from the current mode. Turning the flag off kills the worker agents the connection owns.

## Mode Cycle

The frontend cycles through modes in this order via `Alt+m` / `Alt+M`:

```
plan → code → research → review → plan → ...
```

Switching mode sends `/plan`, `/code`, `/research` or `/review` as a chat command. The backend records the new mode, and the next message is composed with it. `triage` is not in the cycle; `/triage` switches to it.

## Provider Integration

The chat handler composes the prompt for the current mode on every message and passes it to `stream_chat`. `ProviderConfig.system_prompt` is the fallback when no prompt is passed. It is set at registry creation, for the provider's `mode`, if the config does not give one.

The `mode` for APIProvider defaults to `"code"` unless overridden via `mode = "..."` in the provider's `[provider.name]` TOML config block.

## Review Mode — Skill Graph

`review.md` does not introduce new tools. It describes three existing skills and prescribes their execution order for a full sweep:

1. `/update-plans` — verify shipped phases match docs; delete stale plans
2. `/review-codebase` — code quality audit against documented architecture
3. `/review-tests` — test suite coverage, assertion quality, DRY

For targeted review the agent picks the matching skill only. This pattern (mode as skill orchestrator) avoids duplicating logic that already lives in the skill definitions.

## Research Mode — PROVEN Pipeline

`research.md` is minimal scaffolding: it names the mode, lists available tools (`mcp__alphaxiv__*`, WebSearch, scout-browse), and directs the agent to invoke `/common-knowledge` + `/proven-research` skills. The actual research methodology is defined in `backend/prompts/bundled/rules/proven-documentation.md` (loaded into every prompt via the rules layer), so the module doesn't duplicate it.

## Dashboard Module

`dashboard.md` is always included because every agent should be able to update the dashboard. Agents write directly to `.cade/dashboard.yml` — the dashboard config file the frontend already reads. This is simpler than an MCP tool that makes HTTP calls and requires no special tool approval.

## Adding a New Mode

1. Add an entry to `backend/modes.toml` with all required fields
2. Create the mode prompt module at `backend/prompts/modules/<mode>.md`
3. That's it — slash command, write permissions, frontend color, and prompt wiring are all derived from the TOML entry

## Adding a New Module to an Existing Mode

1. Create `backend/prompts/modules/<name>.md`
2. Add `<name>` to the relevant mode's `additional_modules` list in `backend/modes.toml`
3. Or add to `ALWAYS` in `compose.py` if it should load in every mode

## See Also

- [[agent-orchestration]] — the orchestrator overlay and MCP agent spawning
- [[provider-stack]] — how the composed prompt reaches the model
- `backend/prompts/modules/` — module source files
