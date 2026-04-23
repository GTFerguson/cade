---
title: Skills + Rules Integration
created: 2026-04-23
status: in-flight
tags: [prompts, skills, rules, agent, cade]
---

# Skills + Rules Integration

## Context

CADE currently has a prompt composition system (`backend/prompts/compose.py`) with:
- `ALWAYS` — base identity, dashboard, neovim (loaded for all modes)
- `MODE_MODULES` — one mode-specific module (code, architect, etc.)
- `ADDITIONAL` — per-mode additional modules (nkrdn on all modes)

The user has 14 skills and 6 rules in `~/.claude/` that should be integrated:
- **Rules** → loaded into the composite system prompt (always-on guidance)
- **Skills** → loaded on-demand via `/<skill>` commands, not in the base prompt

---

## Audit Results

### Skills (`~/.claude/skills/`)

| Skill | Purpose | When Used |
|-------|---------|-----------|
| `handoff` | Write structured session-handoff brief to `docs/plans/handoff/<slug>.md` | End of session, context getting full, "hand off" |
| `code-intel` | Enforce nkrdn usage for code understanding | Invoked explicitly, not auto-loaded |
| `proven-research` | PROVEN-quality research: alphaxiv + PubMed + WebSearch | User asks to research, write reference doc |
| `review-codebase` | Systematic code quality review with scoring | User asks to review/audit/assess code |
| `update-plans` | Audit plan docs — verify statuses, graduate completed, delete finished | After features ship, plans may be stale |
| `focus` | Assess/docs for a topic, cluster loose files, surface phase status | Starting a session on a topic area |
| `design-bible` | Create/update a design bible document | User asks to create design system doc |
| `document-codebase` | Document a codebase systematically | User asks to document a project |
| `pitch-deck` | Generate a pitch deck (HTML) | User asks to create pitch deck |
| `frontend-slides` | Create animation patterns and HTML slides | User asks for frontend animation |
| `playwright` | Browser automation via playwright-cli (NOT MCP) | Web automation tasks |
| `scout-browse` | Browser automation via scout-browse (anti-detect) | Web research, sites blocking bots |
| `visual-audit` | Mobile + desktop visual audit of web app | User asks for visual review |
| `review-tests` | Systematic test quality review | User asks to review tests |

### Rules (`~/.claude/rules/`)

| Rule | Purpose | Integration |
|------|---------|-------------|
| `code-comments.md` | Comment standards (WHY not WHAT, no tracking refs) | Always (composite prompt) |
| `code-intel.md` | nkrdn usage guide — duplicates `nkrdn.md`, replace not augment | Always (composite prompt) |
| `markdown-formatting.md` | Obsidian.md compatibility (blank lines before tables) | Always (composite prompt) |
| `proven-documentation.md` | PROVEN doc principles (provenance, evidence tiers, lifecycle) | Always (composite prompt) |
| `test-driven-debugging.md` | Write tests to trace execution path, not guess | Always (composite prompt) |
| `scout-browse.md` | Scout Browse usage over MCP playwright tools | Always (composite prompt) |

### Deduplication

- `code-intel.md` (rule) duplicates `nkrdn.md` (module) — consolidate by **removing `nkrdn.md` from `ADDITIONAL`** and using `code-intel.md` from rules instead. The rule is more comprehensive.
- `proven-documentation.md` is relevant to all modes, not just code → add to `RULES` (see below).

---

## Proposed Architecture

### Prompt Composition Layers

```
System Prompt = BASE → RULES → ALWAYS → MODE_MODULES → ADDITIONAL

Where:
  BASE         = backend/prompts/modules/base.md (CADE identity)
  RULES        = ~/.claude/rules/*.md (always-on guidance, loaded from disk at startup)
  ALWAYS       = dashboard, neovim
  MODE_MODULES = code | architect | review | orchestrator
  ADDITIONAL   = nkrdn (for all modes) — will be replaced by code-intel rule
```

### Rules Loading

Add a `RULES` constant to `compose.py` that reads from `~/.claude/rules/`:

```python
RULES_DIR = Path.home() / ".claude" / "rules"

RULES = sorted(f.stem for f in RULES_DIR.glob("*.md"))
```

Rules are loaded from disk at startup, not hardcoded — changes to `~/.claude/rules/` take effect on next restart.

### Skills Loading (on-demand)

Skills are NOT in the system prompt. They are triggered by `/<skillname>` in chat:

1. **Frontend** receives `slashCommands` from backend (see below) and shows tab-completion hints
2. **User types `/handoff`** — this goes to backend as a regular user message
3. **Backend detects skill invocation** — parses `slashCommands`, loads `~/.claude/skills/<skillname>/SKILL.md`
4. **SKILL.md content injected as system-level instruction** — the agent sees the full skill prompt and follows it
5. **Skill completes** — agent returns to normal operation

### Slash Commands Delivery

The backend already sends `slashCommands` in `SystemInfo`. Currently `websocket.py` sends a list of built-in Claude Code commands. This needs to include CADE custom skills too.

The backend should:
1. Read `~/.claude/skills/` directory
2. Extract `name` from each `SKILL.md` frontmatter (`name: handoff`)
3. Combine with any CADE-native commands
4. Send as `slashCommands` in `SystemInfo`

Frontend's `SLASH_DESCRIPTIONS` maps command names to human-readable descriptions — this needs to be populated from the backend (per-skill `description` field in frontmatter), not hardcoded.

### Filter Claude Code Native Commands

Claude Code has built-in `/` commands. CADE should:
- Keep mode-switching commands (`/plan` → architect, `/code` → code, `/review` → review)
- **Exclude** commands that don't apply in CADE context (e.g., `/pr-comments`, `/release-notes`, `/security-review` unless we implement them)
- Only expose commands that are actually usable in CADE

This requires a `CADE_COMMAND_ALLOWLIST` in the backend that filters the full list.

---

## Implementation Steps

### Step 1 — Add `RULES` to compose.py

Modify `backend/prompts/compose.py`:

```python
from pathlib import Path

RULES_DIR = Path.home() / ".claude" / "rules"

def _load_rules() -> list[str]:
    if not RULES_DIR.exists():
        return []
    return sorted(f.stem for f in RULES_DIR.glob("*.md"))

RULES = _load_rules()  # loaded at import time

def compose_prompt(mode: str) -> str:
    base = _load_file("base")
    rules = "\n\n---\n\n".join(_load_file(r) for r in RULES)
    always = "\n\n---\n\n".join(_load_file(a) for a in ALWAYS)
    mode_mod = "\n\n---\n\n".join(_load_file(m) for m in MODE_MODULES.get(mode, []))
    additional = "\n\n---\n\n".join(_load_file(a) for a in ADDITIONAL.get(mode, []))
    return "\n\n---\n\n".join(filter(None, [base, rules, always, mode_mod, additional]))
```

**Order**: base → rules → always → mode → additional

### Step 2 — Build slashCommands from skills

Modify `backend/websocket.py` to:
1. Scan `~/.claude/skills/` at startup
2. Parse `name:` and `description:` from each `SKILL.md` frontmatter
3. Combine with CADE-native commands (mode switches, `compact`, `cost`, `context`)
4. Send as `slashCommands` in `SystemInfo`

```python
SKILLS_DIR = Path.home() / ".claude" / "skills"

def _load_skill_commands() -> list[dict]:
    commands = []
    if SKILLS_DIR.exists():
        for skill_dir in SKILLS_DIR.iterdir():
            skill_md = skill_dir / "SKILL.md"
            if skill_md.exists():
                # parse frontmatter name + description
                ...
    return commands
```

### Step 3 — Detect and inject skill on invocation

When a user message starts with `/<skillname>`:
1. Check if skill exists in `~/.claude/skills/<skillname>/SKILL.md`
2. If yes, load the file and inject its content as a system instruction (or prepend to messages)
3. Strip the `/<skillname>` prefix from the user's actual message

This could be in `backend/session.py` or `backend/websocket.py`.

### Step 4 — Update `SLASH_DESCRIPTIONS` in frontend

Currently hardcoded. After Step 2, the backend sends skill names + descriptions. The frontend should:
1. Accept `slashCommands` as `Array<{name: string, description: string}>` instead of just `string[]`
2. Render hints dynamically from backend data

### Step 5 — Deduplicate nkrdn

- Remove `nkrdn.md` from `ADDITIONAL` in `compose.py`
- Ensure `code-intel.md` (from rules) covers nkrdn usage
- `base.md` already has a condensed nkrdn summary — this stays as orientation content only

---

## Files to Modify

| File | Change |
|------|--------|
| `backend/prompts/compose.py` | Add RULES loading, update `compose_prompt()` |
| `backend/websocket.py` | Build and send `slashCommands` from skills |
| `frontend/src/chat/chat-pane.ts` | Accept dynamic slash command descriptions, render from backend |
| `backend/prompts/modules/base.md` | Possibly trim the nkrdn summary (rules cover it) |
| `backend/prompts/modules/nkrdn.md` | Remove from ADDITIONAL (code-intel rule replaces it) |

---

## Skills That Need Skill Execution Logic

Not all skills just inject a prompt — some have specific execution requirements:

| Skill | Execution Model |
|-------|-----------------|
| `handoff` | Writes `docs/plans/handoff/<slug>.md`, outputs path to user |
| `proven-research` | Uses alphaxiv MCP + PubMed + WebSearch — needs MCP tools available |
| `review-codebase` | Spawns sub-agents per component, writes review docs |
| `update-plans` | Spawns per-plan agents, then updates/deletes based on results |
| `focus` | Spawns Explore agents, then reorganises docs |
| `visual-audit` | Uses playwright-cli — needs browser environment |
| `scout-browse` | Uses scout-browse CLI — needs CLI available |
| `design-bible` | Interactive (asks user about philosophy), outputs doc |
| `document-codebase` | Systematic doc generation |
| `pitch-deck` | HTML generation |

Skills that spawn agents or use specific tools should only be available when those capabilities are present. MCP tools (alphaxiv) should be checked at skill load time.

---

## Verification

After implementation:
1. Rules should appear in every agent's system prompt (visible via `/context` or debug mode)
2. Typing `/` in chat should show CADE skills alongside native commands
3. `/handoff` should load the handoff skill and guide the agent to write a brief
4. `proven-research` should have access to alphaxiv MCP tools
5. No duplicate nkrdn content (rules + module both present)

---

## Status: shipped

## Implementation Notes

### What was built

1. **providers.toml** — created at `.cade/providers.toml` with minimax as default provider (replacing the incorrect `.yml` format)
2. **compose.py RULES loading** — rules from `~/.claude/rules/` are loaded at import time and prepended to every system prompt (base → rules → always → mode → additional)
3. **slashCommands delivery** — `websocket.py` now builds `slashCommands` from both rules (with `description` frontmatter) and skill directories, plus CADE-native commands (plan, code, review, orchestrator, compact, cost, context)
4. **Frontend dynamic hints** — `chat-pane.ts` now accepts `slashCommands` as `Array<{name, description}>` and renders hints dynamically from backend data
5. **base.md nkrdn trimmed** — condensed nkrdn table removed from base.md (rules cover it fully)
6. **code-intel → explore** — `~/.claude/rules/code-intel.md` is the always-on nkrdn usage rule; the skill version `~/.claude/skills/code-intel/` is for explicit invocation if needed