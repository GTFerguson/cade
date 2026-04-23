# Bundled Defaults Architecture Plan

> **Status:** `shipped` ✅

## Context

CADE currently loads rules and skills only from user home directories:
- Rules: `~/.claude/rules/`
- Skills: `~/.claude/skills/`

This means CADE has no built-in defaults — everything must be user-provided. This plan adds bundled defaults that ship with CADE, layered with user additions.

---

## Directory Structure

```
backend/prompts/
├── modules/          # Mode prompt modules (existing)
├── bundled/          # NEW: CADE-bundled defaults
│   ├── rules/
│   │   ├── coding-standards.md
│   │   ├── context-management.md
│   │   └── tool-usage.md
│   └── skills/
│       ├── handoff/
│       │   └── SKILL.md
│       └── ...
```

**Rationale:** `bundled/` is alongside `modules/` under `backend/prompts/`. Using `Path(__file__).parent` from `compose.py` gives the prompts directory, so `bundled/` is always found correctly regardless of whether CADE is installed via pip or run from source.

---

## Install Location Discovery

CADE discovers its bundled location using:

```python
# In backend/prompts/compose.py
BUNDLED_DIR = Path(__file__).parent / "bundled"
BUNDLED_RULES_DIR = BUNDLED_DIR / "rules"
BUNDLED_SKILLS_DIR = BUNDLED_DIR / "skills"
```

This works for:
- **Source layout:** `cade/backend/prompts/bundled/`  
- **Installed layout:** `site-packages/cade/backend/prompts/bundled/`

---

## Loading Order & Merge Strategy

### Rules

| Priority | Source | Path |
|----------|--------|------|
| 1 (first) | Bundled defaults | `backend/prompts/bundled/rules/` |
| 2 | User additions | `~/.claude/rules/` |
| 3 (last) | Project overrides | `{working_dir}/.claude/rules/` |

**Merge behavior:**
- All rules from all sources are included
- **Bundled rules are not overridable by name** — if a bundled rule named `coding-standards` exists and user also has `coding-standards.md`, **both are included** (user version is ignored to protect CADE's defaults)
- Sort alphabetically within each source layer
- Composite order: bundled (alphabetical) → user (alphabetical) → project (alphabetical)

### Skills

| Priority | Source | Path |
|----------|--------|------|
| 1 (first) | Bundled skills | `backend/prompts/bundled/skills/` |
| 2 (last) | User skills | `~/.claude/skills/` |

**Merge behavior:**
- Bundled skills are loaded first
- **User skills with the same name are ignored** (same rule as above — protects CADE's bundled skills from accidental override)
- Skills sorted alphabetically within each layer

### Rationale for Non-Override by Name

Bundled defaults represent CADE's core behavior guarantees. Allowing users to completely override them would mean:
1. CADE could silently break if a user rule conflicts with internal assumptions
2. CADE updates could behave unpredictably if user's overridden version is stale

The chosen approach (ignore user versions of same-named bundled content) keeps CADE's behavior predictable and debuggable while still allowing user additions under different names.

---

## Files to Change

### 1. `backend/prompts/compose.py`

**Changes:**
- Add `BUNDLED_DIR`, `BUNDLED_RULES_DIR` constants
- Modify `_load_rules()` to load from both bundled and user directories
- Rename or replace the module-level `RULES` constant to reflect merged loading

**New `_load_rules()` logic:**
```python
def _load_rules() -> list[tuple[str, str, str]]:
    bundled = _load_rules_from_dir(BUNDLED_RULES_DIR)
    user = _load_rules_from_dir(RULES_DIR)
    # Merge: bundled first, then user items whose names don't appear in bundled
    bundled_names = {name for name, _, _ in bundled}
    merged = list(bundled)
    for name, content, desc in user:
        if name not in bundled_names:
            merged.append((name, content, desc))
    return merged
```

### 2. `backend/websocket.py`

**Changes in `_send_connected()` (lines 697-719):**
- When building `slashCommands`, include bundled skills from `BUNDLED_SKILLS_DIR` alongside `~/.claude/skills/`
- Same non-override logic: bundled skills take precedence, user skills with same name are skipped

**Changes in `_try_load_skill()` (lines 1346-1373):**
- Check bundled skills dir first, then user skills dir
- Example: for `/handoff`, check `bundled/skills/handoff/SKILL.md` before `~/.claude/skills/handoff/SKILL.md`

**New helper method:**
```python
def _get_skill_path(skill_name: str) -> Path | None:
    """Return Path to skill's SKILL.md if it exists (bundled first, then user)."""
    bundled = BUNDLED_SKILLS_DIR / skill_name / "SKILL.md"
    if bundled.exists():
        return bundled
    user = Path.home() / ".claude" / "skills" / skill_name / "SKILL.md"
    if user.exists():
        return user
    return None
```

---

## Migration: Existing `~/.claude/rules/` and `~/.claude/skills/`

**No migration needed.** The new architecture is additive:
- Existing user rules/skills continue to work unchanged
- They extend bundled defaults rather than replacing them
- User content in `~/.claude/` is never deleted

**Note for future:** A README in `bundled/rules/` and `bundled/skills/` can inform users that modifications to these directories are not recommended (they'll be overwritten on CADE updates), while `~/.claude/rules/` and `~/.claude/skills/` are the correct places for user customizations.

---

## Project-Level Overrides

Project-level overrides live at:
- `{working_dir}/.claude/rules/` — project-specific rules
- `{working_dir}/.claude/skills/` — project-specific skills

These are loaded last (highest priority) and **do override** bundled/user content of the same name when they come from a project directory. This allows projects to enforce specific behaviors (e.g., a project might require specific PR templates via a project-level rule).

**Implementation note:** The project-level rules are only loaded when `working_dir` is set on `ConnectionHandler`. The `compose_prompt()` function needs a variant or parameter to also consider project-level rules. For now, project-level can be considered out of scope for v1 unless explicitly needed.

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/prompts/compose.py` | Load bundled rules in addition to user rules |
| `backend/websocket.py` | Load bundled skills for slash commands, check bundled first in `_try_load_skill` |
| `backend/prompts/bundled/rules/` | **NEW** — placeholder bundled rules |
| `backend/prompts/bundled/skills/` | **NEW** — placeholder bundled skills |

---

## Example Bundled Content (for later implementation)

### `backend/prompts/bundled/rules/coding-standards.md`
```markdown
---
description: Enforce consistent code quality practices
---

## Coding Standards

- Write self-documenting code with clear variable/function names
- Add comments only for non-obvious decisions or complex algorithms
- Keep functions small and focused (single responsibility)
- Prefer explicit returns over deep nesting
```

### `backend/prompts/bundled/rules/context-management.md`
```markdown
---
description: Guidelines for context window budget
---

## Context Management

- Monitor token usage via the context budget indicator
- Use compaction when context exceeds 80% capacity
- Prefer targeted retrieval over broad context stuffing
- When context is tight, summarize older conversation segments
```

### `backend/prompts/bundled/skills/handoff/SKILL.md`
```markdown
---
name: handoff
description: Hand off to another agent with full context
---

## Handoff Skill

Use this when another agent should take over a task:

1. Summarize current state and progress
2. List remaining steps and their priority
3. Note any constraints or special considerations
4. Include relevant file paths and line numbers
5. Transfer any in-progress files that need completion