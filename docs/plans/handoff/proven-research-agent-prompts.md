---
title: PROVEN research — coding agent prompts, ACE, self-improving agents
created: 2026-04-22
status: in-flight
---

# Resume: Continue research on coding agent prompts and self-improving agent architectures

## Active plans

- **Research mode feature**: `docs/plans/research-mode-feature.md` — dynamic context switching plan (plan/code/research modes)
- **Phase 3 context UI**: `docs/plans/handoff/phase3-context-ui.md` — context budget indicator (Phase 3a shipped; permissions and orchestration remain)

## Contract — how to use this file

1. **Execute** — read this file first, then resume the Next actions below.
2. **Update as you go** — tick off next-actions, add new gotchas, revise file lists.
3. **Graduate on completion** — lift research findings to `docs/reference/`, design decisions to `docs/architecture/`.
4. **Delete this file** — after graduation. Its existence means work is still in the air.

## Where we are

Mid-research-session. We were conducting PROVEN research into coding agent prompts, ACE, agent memory, and self-improving agents. User interrupted to handoff while we were reading padarax's NPC reflection architecture (which is directly inspirational for CADE agent design). The open question the user posed was: **"which are the cream of the crop and why?"** — we need to synthesize a clear winner/loser analysis before diving deeper.

## Worktree / branch

- Path: `/home/gary/projects/cade`
- Branch: `main`
- Last commit: `43ea106 Handoff: Phase 3 ready to implement, start with context budget UI`

## Shipped this session

- Context budget indicator: `frontend/src/components/context-budget-indicator.ts` + wired into `frontend/src/chat/chat-pane.ts` + CSS (not committed yet — see In flight)
- API keys copied from `../padarax/.env` to `.env` (MISTRAL, CEREBRAS, GROQ, GOOGLE, NOTION, RESEND, PADARAX_ADMIN)
- `docs/reference/coding-agent-prompts.md` — PROVEN reference doc with Alchemy, ACE, research mode sections
- `docs/reference/agentic-context-engineering.md` — full ACE paper breakdown (Zhang et al., 2025)
- `docs/plans/research-mode-feature.md` — implementation plan for research/plan/code mode switching

## In flight (uncommitted work)

All files above are uncommitted. Working tree dirty:
- `frontend/src/components/context-budget-indicator.ts` — new file
- `frontend/src/chat/chat-pane.ts` — imports + wires indicator into statusline
- `frontend/styles/workspace/chat.css` — indicator styles, removed `margin-left: auto` from `.status-tokens`
- `docs/reference/coding-agent-prompts.md` — new file
- `docs/reference/agentic-context-engineering.md` — new file
- `docs/plans/research-mode-feature.md` — new file
- `.env` — API keys added

Frontend builds clean (`cd frontend && npm run build`). Tests still pass (532 passing, 11 pre-existing failures unrelated to our work).

## Next actions (ordered)

- [x] **Answer the open question**: synthesized in `docs/reference/self-improving-agent-systems.md` §1
- [x] **Read padarax NPC reference docs** — all five docs read, insights extracted
- [x] **Deep-read standout self-improvement papers** — SICA, Memento-Skills, SkillClaw, EvolveR
- [x] **Write synthesis reference doc**: `docs/reference/self-improving-agent-systems.md`
- [x] **Commit all outstanding work**

**Research session complete. This file can be deleted.**

## Key design decisions

- **Padarax inspiration**: NPC reflection system is a production implementation of exactly what we want for CADE agents. Importance scoring (5 yes/no rubric, 0-5 scale), accumulator-triggered reflection, seeded vs. generated memories — all directly applicable.
- **ACE as the architectural north star**: Itemized playbook bullets + Generator-Reflector-Curator is the most evidence-backed approach (+10.6% gains, 82-91% cost reduction, model-agnostic). Should be the backbone of CADE's agent context management.
- **Reflection = ACE's Reflector**: Padarax's reflection system IS an implementation of ACE's Reflector phase. They converged independently — strong signal this is the right pattern.
- **0-5 importance scale** (Kouba et al. 2026, cited in padarax): Outperforms Park's 1-10 for LLM-judge alignment. Use this in CADE's importance scoring if implemented.
- **Research mode** is architecturally sound and maps directly to the roocode plan/code split the user referenced. Planned: `/research`, `/plan`, `/code` commands switching system prompt + tools + output directory.

## Files touched / to touch

**New reference docs:**
- `/home/gary/projects/cade/docs/reference/coding-agent-prompts.md` — created, covers Alchemy + ACE + research mode
- `/home/gary/projects/cade/docs/reference/agentic-context-engineering.md` — created, full ACE breakdown

**New plan docs:**
- `/home/gary/projects/cade/docs/plans/research-mode-feature.md` — created
- `/home/gary/projects/cade/docs/plans/handoff/proven-research-agent-prompts.md` — this file

**Frontend (context budget indicator, uncommitted):**
- `/home/gary/projects/cade/frontend/src/components/context-budget-indicator.ts`
- `/home/gary/projects/cade/frontend/src/chat/chat-pane.ts`
- `/home/gary/projects/cade/frontend/styles/workspace/chat.css`

**Env:**
- `/home/gary/projects/cade/.env` — API keys added

**Padarax reference docs to read next:**
- `/home/gary/projects/padarax/docs/reference/memory/generative-agents-park-2023.md`
- `/home/gary/projects/padarax/docs/reference/memory/reflection-trigger-tuning.md`
- `/home/gary/projects/padarax/docs/reference/memory/memory-importance-scoring.md`
- `/home/gary/projects/padarax/docs/reference/llm-craft/narrative-coherence-for-narrator-agents.md`
- `/home/gary/projects/padarax/docs/architecture/npc-agency.md`

## Build & verify

```bash
cd /home/gary/projects/cade/frontend && npm run build
.venv/bin/pytest -q 2>&1 | tail -5
```

## Gotchas encountered

- Padarax's `npc-memory.md` cites "Kouba et al. (2026)" for the 0-5 scale preference — this is a reference doc in the padarax repo, not an external paper. Worth reading to get the actual evidence.
- The 11 pre-existing test failures are in `test_connection_handler.py`, `test_startup_chain.py`, `test_websocket_integration.py` — unrelated to our changes.
- The research found 45+ papers. The user's key unanswered question is which approaches are universally strong vs. task-dependent. Short answer forming: ACE and execution-driven refinement (Alchemy) are universal; memory architecture is more task-dependent (long-horizon tasks need it, short tasks don't).
