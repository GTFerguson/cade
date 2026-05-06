---
title: Agent Orchestration Framework
created: 2026-04-22
status: partially-shipped
verified: 2026-05-05
---

# Agent Orchestration Framework

Multi-agent system allowing the orchestrator to spawn specialized agents for parallel task execution, with provenance tracking and hierarchical spawning.

## Completed Phases

### Phase 1 — Basic Spawning — Completed 2026-04-22

Agents spawn with UUID + human name. Full state machine: PENDING → STARTING → BUSY → DONE/REVIEW/ERROR → CLOSED. Approval workflow: `agent-approval-request` sent to owner connection before execution begins; approve/reject via `approve_agent`/`reject_agent`. Agent history stored per session. Completion reports with summary/decisions/artifacts surfaced via REVIEW state before final close.

Key code: `backend/orchestrator/manager.py` (605 lines, OrchestratorManager), `backend/orchestrator/models.py` (AgentRecord, AgentSpec, AgentState), `core/backend/providers/agent_spawner.py` (spawn_agent tool, 88 lines), `backend/orchestrator/mcp_server.py`, `backend/prompts/modules/orchestrator.md`

Tests: `backend/tests/test_orchestrator_manager.py` (383 lines), `backend/tests/test_agent_spawner.py` (104 lines)

### Phase 2 — Hierarchical Spawning — Completed 2026-04-22

`parent_agent_id` tracked in AgentRecord; `_root_connection_id()` walks the chain to the original WS connection for broadcast routing. Nested completion reports surfaced to root owner. Multi-turn steering via per-agent message queues + `completion_event`.

Key code: `backend/orchestrator/manager.py` lines 170–183 (parent/root tracking)

### Phase 3 — Parallel Scheduling — Completed 2026-04-22

`_message_queues` dict manages per-agent message routing; concurrent agent execution verified in tests. Mode isolation per worker: `pm.set_mode(record.mode, connection_id=agent_id)`.

Key code: `backend/orchestrator/manager.py` (queue routing), `backend/tests/test_orchestrator_manager.py::TestParallelToolExecution`

Gotcha: `AgentRecord.cost` is always `0.0` — field exists but the populate path is never called. Cost tracking is a known gap (see quick-fix `orchestration-cost-tracking`).

## Remaining Work

### Phase 4 — Smart Naming

Suggest agent names based on task description. Validate uniqueness within current session. Auto-generate if needed.

**Naming convention** (shipped agents follow this informally, Phase 4 enforces it): kebab-case, descriptive of the task — e.g., `auth-refactor`, `docs-migration`, `test-suite-fix`. Name must be unique among *current* sub-agents only; reusing a name from a completed agent is fine (different agent_id). Currently uses `f"agent-{spec.name}-{uuid.uuid4().hex[:6]}"` suffix with no uniqueness validation.

## Future Enhancements

- Agent templates (pre-configured agents for common tasks)
- Cost tracking — `AgentRecord.cost` field is ready; populate path needs wiring
- Provenance graph traversal API — `parent_agent_id` stored per record but no DAG traversal endpoint
- Agent performance metrics (success rate, avg completion time)
- Agent teaming (two agents collaborate on a single task)
