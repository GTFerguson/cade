---
title: Skills + Rules Integration
created: 2026-04-23
status: shipped
tags: [prompts, skills, rules, agent]
---

# Skills + Rules Integration

## Status: shipped

### What was built

1. **providers.toml** — created at `.cade/providers.toml` with minimax as default provider
2. **compose.py RULES loading** — rules from `~/.claude/rules/` loaded at import time and prepended to every system prompt (base → rules → always → mode → additional)
3. **slashCommands delivery** — `websocket.py` builds `slashCommands` from both rules and skill directories, plus CADE-native commands (plan, code, review, orchestrator, compact, cost, context)
4. **Frontend dynamic hints** — `chat-pane.ts` accepts `slashCommands` as `Array<{name, description}>` and renders hints dynamically from backend data
5. **base.md nkrdn trimmed** — condensed nkrdn table removed from base.md (rules cover it fully)
6. **code-intel → explore** — `~/.claude/rules/code-intel.md` is the always-on nkrdn usage rule

## Prompt Composition Layers

```
System Prompt = BASE → RULES → ALWAYS → MODE_MODULES → ADDITIONAL

Where:
  BASE         = backend/prompts/modules/base.md (CADE identity)
  RULES        = ~/.claude/rules/*.md (always-on guidance, loaded from disk at startup)
  ALWAYS       = dashboard, neovim
  MODE_MODULES = code | architect | review | orchestrator
  ADDITIONAL   = nkrdn (for all modes) — replaced by code-intel rule
```

## Skills Loading (on-demand)

Skills are NOT in the system prompt. They are triggered by `/<skillname>` in chat:
1. Frontend receives `slashCommands` from backend and shows tab-completion hints
2. User types `/handoff` — goes to backend as a regular user message
3. Backend detects skill invocation, loads `~/.claude/skills/<skillname>/SKILL.md`
4. SKILL.md content injected as system-level instruction
5. Skill completes — agent returns to normal operation

## Verification

After implementation:
1. Rules should appear in every agent's system prompt
2. Typing `/` in chat should show CADE skills alongside native commands
3. `/handoff` should load the handoff skill and guide the agent to write a brief
4. `proven-research` should have access to alphaxiv MCP tools
5. No duplicate nkrdn content (rules + module both present)
