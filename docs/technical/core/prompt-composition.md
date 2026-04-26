---
title: Modular Prompt Composition
created: 2026-04-23
updated: 2026-04-26
status: implemented
tags: [prompts, agents, architecture]
---

# Modular Prompt Composition

Agent system prompts are assembled at runtime from small, single-purpose markdown files. This replaces the old approach of hardcoded prompt strings scattered across provider files.

## Structure

```
backend/prompts/
├── __init__.py          — exports compose_prompt
├── compose.py           — assembles modules by mode
└── modules/
    ├── base.md              — CADE identity, output channels, dashboard overview
    ├── dashboard.md         — always included: dashboard write instructions
    ├── neovim.md            — always included: Neovim integration
    ├── nkrdn.md             — knowledge graph orientation (added per mode)
    ├── test-driven-debugging.md  — debugging methodology (code mode only)
    ├── code.md              — primary development mode
    ├── plan.md              — read-only architecture / planning mode
    ├── research.md          — PROVEN research pipeline mode
    ├── review.md            — skill-graph review orchestrator
    └── orchestrator.md      — multi-agent delegation mode
```

## Compose Order

`compose_prompt(mode, working_dir)` assembles modules in this fixed order:

1. **Datetime** — current UTC timestamp injected fresh each call
2. **Base** — `base.md`: CADE identity and core instructions
3. **Rules** — bundled rules from `backend/prompts/bundled/rules/`
4. **Always** — `dashboard.md`, `neovim.md`: present in every mode
5. **Mode** — one mode-specific module from `MODE_MODULES`
6. **Additional** — supporting modules from `ADDITIONAL` (e.g. `nkrdn.md`, `test-driven-debugging.md`)
7. **Project** — `CLAUDE.md` and `.claude/rules/*.md` from the working directory

Modules are joined with `---` separators and returned as a single string.

```python
from backend.prompts import compose_prompt

prompt = compose_prompt("code", working_dir=Path("/home/user/myproject"))
```

## Mode Table

| Mode | Module | Additional modules | Purpose |
|------|--------|--------------------|---------|
| `code` | `code.md` | `nkrdn`, `test-driven-debugging` | Primary development |
| `plan` | `plan.md` | `nkrdn` | Read-only architecture planning |
| `research` | `research.md` | `nkrdn` | PROVEN research pipeline |
| `review` | `review.md` | `nkrdn` | Skill-graph sweep: update-plans → review-codebase → review-tests |
| `orchestrator` | `orchestrator.md` | `nkrdn` | Multi-agent delegation |

## Mode Cycle

The frontend cycles through modes in this order via `Alt+m` / `Alt+M`:

```
plan → code → research → review → orchestrator → plan → ...
```

Switching mode sends `/plan`, `/code`, `/research`, `/review`, or `/orch` as a chat command, which the backend routes to the matching `compose_prompt` call.

## Provider Integration

Both provider types use `compose_prompt`:

| Provider | How prompt is injected |
|----------|------------------------|
| `ClaudeCodeProvider` | `--append-system-prompt` CLI flag |
| `APIProvider` | `system_prompt` field on `ProviderConfig` (set at registry creation if not explicitly configured) |

The `mode` for APIProvider defaults to `"code"` unless overridden via `mode = "..."` in the provider's `[provider.name]` TOML config block.

## Review Mode — Skill Graph

`review.md` does not introduce new tools. It describes three existing skills and prescribes their execution order for a full sweep:

1. `/update-plans` — verify shipped phases match docs; delete stale plans
2. `/review-codebase` — code quality audit against documented architecture
3. `/review-tests` — test suite coverage, assertion quality, DRY

For targeted review the agent picks the matching skill only. This pattern (mode as skill orchestrator) avoids duplicating logic that already lives in the skill definitions.

## Research Mode — PROVEN Pipeline

`research.md` is minimal scaffolding: it names the mode, lists available tools (`mcp__alphaxiv__*`, WebSearch, scout-browse), and directs the agent to invoke `/common-knowledge` + `/proven-research` skills. The actual research methodology is defined in `~/.claude/rules/proven-documentation.md` (bundled into every prompt via the rules layer), so the module doesn't duplicate it.

## Dashboard Module

`dashboard.md` is always included because every agent should be able to update the dashboard. Agents write directly to `.cade/dashboard.yml` — the dashboard config file the frontend already reads. This is simpler than an MCP tool that makes HTTP calls and requires no special tool approval.

## Adding a New Module

1. Create `backend/prompts/modules/<name>.md`
2. Add it to `ALWAYS` (injected every time), `MODE_MODULES` (mode-specific), or `ADDITIONAL` (per-mode supplements) in `compose.py`

## See Also

- [[agent-orchestration]] — orchestrator mode and MCP agent spawning
- `backend/prompts/modules/` — module source files
