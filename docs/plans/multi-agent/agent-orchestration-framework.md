---
title: Agent Orchestration Framework
created: 2026-04-22
status: planning
---

# Agent Orchestration Framework

Multi-agent system allowing the orchestrator to spawn specialized agents for parallel task execution, with provenance tracking and hierarchical spawning.

## Overview

In orchestrator mode, Claude Code can spawn multiple agents to work on independent tasks in parallel. Each agent operates in its own session with full access (or restricted mode), reports back with a comprehensive completion report, and the orchestrator can spawn further sub-agents recursively.

## Core Concepts

### Agent Identity
- **Agent ID**: Unique UUID assigned by system at spawn time (e.g., `550e8400-e29b-41d4-a716-446655440000`)
- **Agent Name**: Human-readable logical name assigned by orchestrator (e.g., `server-refactoring`, `frontend-integration-testing`)
- **Uniqueness**: Name must be unique among current sub-agents only. If orchestrator reuses a name from a completed agent, it's fine (different ID).
- **Naming convention**: kebab-case, descriptive of the task (e.g., `auth-refactor`, `docs-migration`, `test-suite-fix`)

### Agent Modes
- **`code`** (full access): Agent can read/write files, run commands, etc. Use for implementation work.
- **`architect`** (read-only): Agent can only read code and documentation. Use for planning and design reviews.
- **`orchestrator`** (meta): Agent can spawn further sub-agents. Parent continues in parallel with children.

### Hierarchical Spawning
```
Root Orchestrator
├── Agent: auth-refactor (code mode)
├── Agent: frontend-testing (code mode)
│   ├── Sub-agent: e2e-tests (code mode)
│   └── Sub-agent: unit-tests (code mode)
└── Agent: documentation (architect mode)
```

Each agent operates independently. Parent doesn't wait for children (unless explicitly requested via task dependencies).

## Agent Lifecycle

### 1. Spawn
Orchestrator calls `spawn_agent` with:
- `name`: Logical name for this agent
- `task`: Full task description
- `mode`: code | architect | orchestrator
- `context_handoff`: Optional brief from parent (summary of completed work, decisions, artifacts)

### 2. Execution
- Agent runs in separate session
- Has access to project files (same working directory)
- Can spawn sub-agents if in orchestrator mode
- Reports to user for approval/review before starting work

### 3. Completion
- Agent generates comprehensive completion report with:
  - **Summary**: What was accomplished
  - **Decisions**: Key technical/architectural choices made
  - **Artifacts**: Files created, modified, or deleted
  - **Issues**: Any problems encountered or left for future work
  - **Sub-agent reports**: If this agent spawned children, include their reports (nested)

Report format:
```
## Summary
Implemented authentication refactoring: moved from session tokens to JWT-based auth.

## Decisions
- Chose RS256 (RSA) for JWT signing over HS256 for better key rotation story
- Token refresh handled client-side to reduce server load
- Backward compatibility maintained for 2 weeks via dual-mode auth

## Artifacts
- `core/auth/jwt_handler.py` (new)
- `core/auth/token_manager.py` (new)
- `backend/migrations/001_jwt_auth.py` (new)
- `frontend/src/auth/token-store.ts` (modified)
- Removed: `backend/session_manager.py` (20 lines, no longer needed)

## Sub-agent Reports
### Agent: test-auth-migration (550e8400-...)
[nested report...]

## Issues
- LDAP integration not tested yet (deferred to next phase)
- Session cleanup cron job needs to be updated (TODO)
```

### 4. Return to Orchestrator
- Orchestrator receives completion report with agent ID
- Can spawn more agents, continue work, or conclude
- Report is archived in session history for reference

## Communication Protocol

### Spawning an Agent
```json
{
  "action": "spawn_agent",
  "agent_name": "server-refactoring",
  "task": "Refactor the API server to use dependency injection...",
  "mode": "code",
  "context_handoff": "Previous session completed auth migration. JWT tokens now used..."
}
```

### Agent Reports
```json
{
  "agent_id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_name": "server-refactoring",
  "status": "completed",
  "summary": "...",
  "decisions": ["...", "..."],
  "artifacts": {
    "created": ["file1.ts", "file2.ts"],
    "modified": ["file3.ts"],
    "deleted": ["file4.ts"]
  },
  "sub_agents": [
    {
      "agent_id": "...",
      "agent_name": "...",
      "status": "completed",
      ...
    }
  ]
}
```

## Provenance Tracking

Each agent maintains a node in a directed graph:
```
Root (orchestrator session)
├── Edge to: auth-refactor [agent_id_1, mode=code]
├── Edge to: frontend-testing [agent_id_2, mode=code]
│   ├── Edge to: e2e-tests [agent_id_3, mode=code]
│   └── Edge to: unit-tests [agent_id_4, mode=code]
└── Edge to: documentation [agent_id_5, mode=architect]
```

Nodes store:
- Agent ID and name
- Mode (code/architect/orchestrator)
- Task description
- Completion time
- Report summary (or full report link)
- Sub-agents

This allows:
- Tracing work back to which agent did it
- Understanding dependencies and ordering
- Replicating agent chains if needed

## Parallel Execution

Agents run in parallel (no blocking). Orchestrator can:
- Spawn agent A, B, C in sequence
- Wait for all to complete
- Or continue with new work while they're running
- Or spawn agent D as a sub-agent of A while A is still working

No enforced ordering unless explicitly sequenced by orchestrator.

## Error Handling

- **Agent crashes**: Report sent with error status and stack trace
- **Agent incomplete**: Can re-spawn same agent with updated task
- **Agent deadlock**: Can timeout or cancel and spawn replacement
- **Sub-agent failure**: Parent agent decides whether to retry, fail, or ignore

## Config Integration

```toml
[orchestrator]
# Maximum concurrent agents (default: 5)
max_concurrent_agents = 5

# Agent spawn timeout (default: 3600s / 1 hour)
agent_timeout_seconds = 3600

# Require approval before spawning agents (default: true in code mode)
require_approval = true

# Modes allowed (default: ["code", "architect"])
allowed_modes = ["code", "architect", "orchestrator"]
```

## Implementation Phases

### Phase 1: Basic Spawning
- Spawn single agent with name/task/mode
- Agent works, reports back
- Store agent history in session

### Phase 2: Hierarchical Spawning
- Agents in orchestrator mode can spawn sub-agents
- Build provenance graph
- Return nested reports

### Phase 3: Parallel Scheduling
- Multiple agents running in parallel
- Orchestrator can manage 5-10 concurrent agents
- Resource management (don't spawn too many at once)

### Phase 4: Smart Naming
- Suggest agent names based on task description
- Validate uniqueness within current session
- Auto-generate if needed

## Future Enhancements

- Agent templates (pre-configured agents for common tasks)
- Agent specialization (route to best agent type for task)
- Cost tracking (tokens used per agent, total session cost)
- Agent performance metrics (success rate, avg completion time)
- Agent teaming (two agents collaborate on a task)
