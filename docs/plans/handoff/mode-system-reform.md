---
title: Mode system reform — kill CHAT default, add research mode, review-as-skill-graph
created: 2026-04-26
status: in-flight
---

# Resume: Replace CHAT/architect/orchestrator mode cycle with plan/code/research; rewrite review mode as skill graph

## Active plans
- **Phase plan**: `/home/gary/projects/cade/docs/plans/research-mode/research-mode-feature.md` — defines research mode (plan/code/research triad). NOTE: the plan's static `mode-research.md` prompt is **superseded** by the skill-graph approach (see Key design decisions).

## Contract — how to use this file

This file is persistent working memory for one in-flight task. Procedure:

1. **Execute** — read this file first, then resume the Next actions below.
2. **Use as persistent reference while building** — update it as you go: tick off next-actions, add new gotchas, revise file lists.
3. **Graduate on completion** — once shipped, lift durable knowledge: research-mode design → `docs/architecture/`, skill-graph pattern → `docs/reference/`. Update the plan file or move it to `docs/plans/shipped/`.
4. **Delete this file** — after graduation, `rm` this handoff.

## Where we are
Just shipped alphaxiv MCP + MCP status plug icon + disabled enhanced CC (all uncommitted, see "In flight"). The user then asked to (a) fix the hardcoded "CHAT" mode label, (b) replace the mode cycle with `plan / code / research`, (c) make `review` a skill-graph mode that orchestrates `/update-plans` → `/review-codebase` → `/review-tests`.

## Worktree / branch
- Path: `/home/gary/projects/cade`
- Branch: `main` (28 commits ahead of `origin/main`)
- Last commit: `992167c fix: update help overlay with Alt shortcuts and Chat section`

## Shipped this session
None committed. All work is in the working tree — see "In flight".

## In flight (uncommitted work)

**alphaxiv MCP integration** (working, 28 tests passing):
- `/home/gary/projects/cade/core/backend/providers/http_mcp_tools.py` — new, `HTTPMCPToolAdapter` + `load_claude_oauth_token()` + `get_mcp_oauth_status()`
- `/home/gary/projects/cade/backend/providers/registry.py:48-67` — handles `type = "http"` MCP servers with `auth = "claude-oauth"`
- `/home/gary/projects/cade/backend/websocket.py:707-720` — sends `mcpStatus` in `connected` message
- `/home/gary/projects/cade/backend/tests/test_http_mcp_tools.py` — new, 28 passing tests
- `/home/gary/.cade/providers.toml` — alphaxiv MCP added to all 6 API providers

**Disabled enhanced CC**:
- `/home/gary/projects/cade/frontend/src/ui/help-overlay.ts:158` — removed "toggle enhanced" entry
- `/home/gary/projects/cade/frontend/src/input/keybindings.ts:54,266-272,499-504` — removed `toggleEnhanced` callback type, Alt+e handler, config-based handler
- `/home/gary/projects/cade/frontend/src/main.ts:441-443` — removed `toggleEnhanced` action
- `/home/gary/projects/cade/frontend/src/config/user-config.ts:102,246` — removed `toggleEnhanced` field + default

**MCP status plug icon** (left of perms button in chat statusline):
- `/home/gary/projects/cade/frontend/src/chat/mcp-status-icon.ts` — new, `MCPStatusIcon` component with two-prong plug SVG
- `/home/gary/projects/cade/frontend/src/chat/chat-pane.ts:27,93,184,189-190,437-439,1505` — wired in
- `/home/gary/projects/cade/frontend/src/types.ts:266` — `mcpStatus?` field on `ConnectedMessage`
- `/home/gary/projects/cade/frontend/src/tabs/project-context.ts:78-92,605-639` — pushes status to icon, shows toast on first connect, `showNotificationLink()` helper
- `/home/gary/projects/cade/frontend/styles/workspace/chat.css:895-957` — icon CSS (red when unauth, dim when ok)
- `/home/gary/projects/cade/frontend/styles/workspace/dashboard.css:1148-1153` — notification link style

## Next actions (ordered)

1. **Fix CHAT label** — `/home/gary/projects/cade/frontend/src/chat/chat-pane.ts:170`: change `this.modeEl.textContent = "CHAT"` → `this.modeEl.textContent = ""`. The label is updated by `setModeLabel()` (line 267) on `system-info` event arrival; empty until then is fine.

2. **Update mode cycle** — `/home/gary/projects/cade/frontend/src/main.ts:445,459`: change both `["architect", "code", "review", "orchestrator"]` → `["plan", "code", "research"]`. The cmd mapping at lines 448, 459 (`next === "architect" ? "plan" : ...`) becomes unnecessary — slash command equals mode name now. Simplify to `activeTab?.ws.sendChatMessage(\`/${next}\`);`. Review and orchestrator stay as modes accessible via `/review` and `/orch` directly, just not in the cycle.

3. **Add research mode to compose.py** — `/home/gary/projects/cade/backend/prompts/compose.py:38-52`:
   - Add `"research": ["research"]` to `MODE_MODULES`
   - Add `"research": ["nkrdn"]` to `ADDITIONAL`
   - Optionally alias `"plan"` to architect: add `"plan": ["architect"]` to `MODE_MODULES` so `/plan` resolves natively

4. **Create research mode prompt** — new file `/home/gary/projects/cade/backend/prompts/modules/research.md`. Per user's clarification (this conversation): the prompt is **minimal scaffolding** — tools/output format only. The actual knowledge context comes from running `/common-knowledge` + `/proven-research` skills which build/validate `docs/reference/` and `~/projects/common-knowledge/`. The mode prompt should:
   - State: research mode, read-only on code, write to `docs/reference/`
   - List tools: alphaxiv MCP (mcp__alphaxiv__*), WebSearch, scout-browse, Read/Write
   - Direct the agent: on entering, run `nkrdn search "<topic>" --source docs` → assess gaps → invoke `/common-knowledge` for foundational layer, `/proven-research` for project layer
   - Reference PROVEN format (don't duplicate it — `~/.claude/rules/proven-documentation.md` is bundled)

5. **Rewrite review mode as skill graph** — `/home/gary/projects/cade/backend/prompts/modules/review.md` (currently 1 paragraph). New content:
   - State: review mode, read-only
   - Skill graph: list `/update-plans`, `/review-codebase`, `/review-tests` with one-line purpose each (descriptions are already in the SKILL.md files at `~/.claude/skills/<name>/SKILL.md`)
   - **Targeted review**: pick the matching skill
   - **Full sweep order** (this is what the user explicitly wanted in the prompt): (1) `/update-plans` first — verify shipped phases match docs, so we know what's in scope; (2) `/review-codebase` second — code quality against documented architecture; (3) `/review-tests` last — coverage of what was just reviewed
   - The mode itself doesn't need new code/tools — it's purely a prompt rewrite

6. **Verify** — restart backend, confirm:
   - Statusline shows blank then real mode (not "CHAT")
   - `Alt+m`/`Alt+M` cycles plan → code → research
   - `/research` triggers research mode, prompt loads
   - `/review` shows the skill-graph guidance
   - All 28 HTTP MCP tests + 6 stdio MCP tests still pass: `.venv/bin/python -m pytest backend/tests/test_http_mcp_tools.py backend/tests/test_mcp_tools.py -q`

## Key design decisions

- **Research mode prompt is minimal scaffolding, not static instructions.** The `mode-research.md` block in the plan file (`docs/plans/research-mode/research-mode-feature.md`) is *not* what we want — that's a hand-written prompt. User clarified: the actual research context comes from `/common-knowledge` + `/proven-research` skills which validate existing research state via nkrdn and fill gaps via PROVEN pipeline. The mode prompt only sets context (mode name, tools, output dir) and tells the agent to invoke the pipeline.
- **Review mode is a skill orchestrator, not a separate review system.** Three skills already exist (`update-plans`, `review-codebase`, `review-tests`). Review mode's job is to (a) describe them so the agent knows when to pick which, (b) prescribe full-sweep order. No new code.
- **Mode cycle drops `architect` (renamed `plan`) and `orchestrator`.** `/orch` and `/review` still work as direct slash commands; they're just not in the Alt+m cycle. User wants the cycle to surface the three primary work modes.
- **Pre-existing test failures unrelated.** 3 frontend tests in `keybindings.test.ts` fail (`shouldDelegateToPaneHandler` not handling `.terminal-pane` xterm-textarea guard). Confirmed pre-existing by stashing — do not chase.

## Files touched / to touch

**Pending edits (next session):**
- `/home/gary/projects/cade/frontend/src/chat/chat-pane.ts:170` — empty CHAT default
- `/home/gary/projects/cade/frontend/src/main.ts:445,459` — mode cycle
- `/home/gary/projects/cade/backend/prompts/compose.py:38-52` — register research (and plan alias)
- `/home/gary/projects/cade/backend/prompts/modules/research.md` — new, minimal scaffolding prompt
- `/home/gary/projects/cade/backend/prompts/modules/review.md` — rewrite as skill graph

**Reference (don't edit):**
- `/home/gary/.claude/skills/proven-research/SKILL.md` — pipeline definition
- `/home/gary/.claude/skills/common-knowledge/SKILL.md` — two-layer model
- `/home/gary/.claude/skills/update-plans/SKILL.md` — review-skill #1
- `/home/gary/.claude/skills/review-codebase/SKILL.md` — review-skill #2
- `/home/gary/.claude/skills/review-tests/SKILL.md` — review-skill #3

## Build & verify

```
.venv/bin/python -m pytest backend/tests/test_http_mcp_tools.py backend/tests/test_mcp_tools.py backend/tests/test_bundled_defaults.py -q
cd frontend && npm run typecheck
```

For UI verification, restart the backend and check the statusline + `Alt+m` cycle in the chat pane.

## Gotchas encountered

- `streamablehttp_client` raises `asyncio.CancelledError` (a `BaseException`) on connect failure, not a regular `Exception`. The HTTP MCP adapter catches both via `except (Exception, BaseException)` with a `SystemExit/KeyboardInterrupt` re-raise. Don't simplify back to `except Exception`.
- `~/.claude/.credentials.json` stores MCP OAuth under keys like `"alphaxiv|<hash>"`. The hash varies per server fingerprint — match on prefix (`key.startswith(server_name)`), not equality.
- Three other user messages came in mid-session that are NOT part of this handoff but should be addressed next: (a) "bundle ../scout-engine/" — needs separate exploration, (b) the research-mode-uses-PROVEN clarification was a design-confirmation message, no code change requested.
