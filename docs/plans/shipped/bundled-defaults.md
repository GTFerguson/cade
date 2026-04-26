---
title: Bundled Defaults Architecture
status: shipped
tags: [prompts, bundling, defaults]
---

# Bundled Defaults Architecture Plan

> **Status:** `shipped` ✅

## Directory Structure

```
backend/prompts/
├── modules/          # Mode prompt modules (existing)
├── bundled/          # CADE-bundled defaults
│   ├── rules/
│   │   ├── coding-standards.md
│   │   ├── context-management.md
│   │   └── tool-usage.md
│   └── skills/
│       └── handoff/
│           └── SKILL.md
```

**Rationale:** `bundled/` is alongside `modules/` under `backend/prompts/`. Using `Path(__file__).parent` from `compose.py` gives the prompts directory, so `bundled/` is always found correctly.

## Loading Order & Merge Strategy

### Rules

| Priority | Source | Path |
|----------|--------|------|
| 1 (first) | Bundled defaults | `backend/prompts/bundled/rules/` |
| 2 | User additions | `~/.claude/rules/` |
| 3 (last) | Project overrides | `{working_dir}/.claude/rules/` |

**Merge behavior:**
- Bundled rules are **not overridable by name** — if a bundled rule exists and user also has one with the same name, **both are included** (user version is ignored to protect CADE's defaults)
- Sort alphabetically within each source layer

### Skills

| Priority | Source | Path |
|----------|--------|------|
| 1 (first) | Bundled skills | `backend/prompts/bundled/skills/` |
| 2 (last) | User skills | `~/.claude/skills/` |

## Migration

**No migration needed.** The new architecture is additive:
- Existing user rules/skills continue to work unchanged
- User content in `~/.claude/` is never deleted
