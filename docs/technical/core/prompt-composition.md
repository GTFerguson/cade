---
title: Modular Prompt Composition
created: 2026-04-23
updated: 2026-04-23
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
    ├── dashboard.md     — always included
    ├── code.md          — code mode
    ├── architect.md     — read-only planning mode
    ├── review.md        — read-only review mode
    └── orchestrator.md  — multi-agent delegation mode
```

## How It Works

`compose_prompt(mode)` loads two layers of modules:

1. **Always** — `dashboard.md` is always injected regardless of mode
2. **Mode-specific** — one of `code`, `architect`, `review`, or `orchestrator`

Modules are joined with `---` separators and returned as a single string passed to the provider.

```python
from backend.prompts import compose_prompt

prompt = compose_prompt("code")      # dashboard + code
prompt = compose_prompt("orchestrator")  # dashboard + orchestrator
```

## Provider Integration

Both provider types use `compose_prompt`:

| Provider | How prompt is injected |
|----------|------------------------|
| `ClaudeCodeProvider` | `--append-system-prompt` CLI flag |
| `APIProvider` | `system_prompt` field on `ProviderConfig` (set at registry creation if not explicitly configured) |

The `mode` for APIProvider defaults to `"code"` unless overridden via `mode = "..."` in the provider's `[provider.name]` TOML config block.

## Dashboard Module

The `dashboard.md` module is always included because every agent should be able to update the dashboard. Rather than an MCP tool that makes HTTP calls, agents write directly to `.cade/dashboard.yml` — the dashboard config file the frontend already reads. This is simpler, more reliable, and requires no special tool approval.

The module documents:
- Where the file lives (`.cade/dashboard.yml` relative to project root)
- The YAML schema (dashboard, data_sources, views, panels)
- Available components and their data shapes

## Adding a New Module

1. Create `backend/prompts/modules/<name>.md`
2. Add it to `ALWAYS` (injected every time) or `MODE_MODULES` (mode-specific) in `compose.py`

## See Also

- [[agent-orchestration]] — orchestrator mode and MCP agent spawning
- `backend/prompts/modules/` — module source files
