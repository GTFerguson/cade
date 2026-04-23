---
title: Agent Lifecycle & Orchestration
created: 2026-01-31
updated: 2026-04-23
status: implemented
tags: [agents, orchestration, lifecycle, architecture]
---

# Agent Lifecycle & Orchestration

Multi-agent coordination system enabling multiple Claude Code instances to work together within a project. Shipped as orchestrator mode (`/orch`) with two-gate approval flow, MCP-based agent spawning, and per-agent tabs.

## What Was Built

- Orchestrator mode via `/orch` slash command
- Two-gate approval flow: spawn approval (in orchestrator chat) → agent executes → report approval (in agent tab)
- Each worker agent gets its own tab with full ChatPane output
- MCP server provides `spawn_agent` and `list_agents` tools to the orchestrator CC instance
- Blocking lifecycle: MCP tool blocks until agent report is approved/rejected, then returns the result
- Agent overview pane with state indicators and management controls
- Modular prompt system — all mode-specific and capability instructions composed from `backend/prompts/modules/*.md`

## Original Design

> [!NOTE]
> The sections below capture the original design thinking. Some details were implemented differently — the description above reflects what was actually shipped.

## Core Components

### 1. Agent State Detection

Mechanically infer agent state from process IO without requiring explicit state signals from the model.

**Detectable states:**

| State | Detection Method |
|-------|------------------|
| `running` | Active stdout/stderr output within last N seconds |
| `idle` | No output, stdin available, terminal shows prompt pattern |
| `blocked` | No output, waiting on subprocess, file I/O, or tool completion |
| `exited` | Process terminated, exit code available |

**Implementation approach:**
- Leverage Claude Code's existing hook system if available
- Research what lifecycle hooks Claude Code provides
- Fallback to creative solutions (pattern matching, subprocess tracking) if hooks are insufficient

**Challenges:**
- Distinguishing "waiting for user input" from "blocked on tool" is non-trivial
- May need to detect Claude Code's prompt pattern or analyze subprocess activity

### 2. Lifecycle Hooks

Event-driven hooks that fire during agent state transitions.

**Hook points:**

| Hook | Trigger |
|------|---------|
| `on_output` | Agent writes to stdout/stderr |
| `on_silence` | No output for configurable duration (e.g., 5s) |
| `on_prompt_detected` | Terminal shows recognized prompt pattern |
| `on_input_sent` | User or orchestrator sends input to agent |
| `on_exit` | Agent process terminates |

**Implementation:**
- Leverage Claude Code's existing hook infrastructure if it provides lifecycle hooks
- If Claude Code hooks are insufficient, implement custom detection in CADE

**Potential consumers:**
- UI updates (state indicators, progress animations)
- User scripts (custom automation, notifications)
- Orchestrator logic (task delegation, monitoring)

### 3. Multi-Agent Single-Project Support

Multiple Claude instances operating within the same project workspace.

**Architecture:**

```
Project "cade"
├── Agent 1 (main)     - Terminal 1, shared file tree
├── Agent 2 (tests)    - Terminal 2, shared file tree
└── Agent 3 (docs)     - Terminal 3, shared file tree
```

**Properties:**
- All agents share the same file tree and project directory
- Each agent has its own isolated terminal/PTY
- Agents can read/write the same files (coordination left to orchestrator)

**Open questions:**
- How does this change the current tab model? Multiple agents per tab, or agents span tabs?
- Do agents share a single file tree UI instance, or does each have its own view?
- How do we handle file conflicts when multiple agents edit the same file?

### 4. Orchestrator Agent

A specialized Claude instance that coordinates worker agents but doesn't directly manipulate terminals or files.

**Orchestrator capabilities:**
- Observe state of all worker agents
- Send task instructions to worker agents
- Receive structured responses (summaries, diffs, questions)
- Does NOT control terminals directly
- Does NOT write code directly

**Communication flow:**

```
User
  ↓ task request
Orchestrator
  ↓ delegate subtasks
Worker Agents (parallel execution)
  ↓ structured responses
Orchestrator
  ↓ synthesized result
User
```

**Open questions:**
- What format for structured responses? JSON? Markdown with sections?
- Does the orchestrator have its own UI pane, or is it headless?
- How does the orchestrator send tasks - via stdin injection, API, or message queue?
- What prevents autonomous agent-to-agent chatter (enforcement mechanism)?

## Use Cases

**Parallel development:**
```
Orchestrator: "Implement user authentication"
  → Agent 1: "Write backend auth endpoints"
  → Agent 2: "Write frontend login form"
  → Agent 3: "Write integration tests"
```

**Long-running tasks:**
```
Agent 1: Running test suite (5 minutes)
Agent 2: Available for user interaction
UI: Shows Agent 1 as "running", Agent 2 as "idle"
```

**Code review workflow:**
```
Agent 1: "Review this PR"
  → Reads files, analyzes changes
  → Returns structured feedback
User: Reviews feedback, asks follow-up
Agent 1: "Check if suggestion X would break Y"
  → Tests locally, returns result
```

## UI Design

### Three-Pane Layout (Preserved)

CADE's existing three-pane layout remains unchanged. The **right pane toggles** between two modes:

**Standard Mode:**
```
┌──────────┬─────────────────────┬──────────────┐
│          │                     │              │
│   File   │   Active Agent      │   Markdown   │
│   Tree   │   Terminal          │   Viewer     │
│          │                     │              │
└──────────┴─────────────────────┴──────────────┘
```

- Center: Active agent terminal (full screen)
- Right: Markdown viewer (current behavior)
- Toggle through agents like shell switching (Ctrl+Shift+Tab / Ctrl+Tab)

**Orchestrator Mode:**
```
┌──────────┬─────────────────────┬──────────────┐
│          │                     │ Agent 1      │
│   File   │   Orchestrator      │ (main)       │
│   Tree   │   Terminal          ├──────────────┤
│          │                     │ Agent 2      │
│          │                     │ (tests)      │
│          │                     ├──────────────┤
│          │                     │ Agent 3      │
│          │                     │ (docs)       │
└──────────┴─────────────────────┴──────────────┘
```

- Center: Orchestrator terminal (primary interaction)
- Right: Vertically stacked worker agent terminals
- User interacts with orchestrator, which delegates to workers
- Can see all worker agents simultaneously

**Toggling modes:**
- Keyboard shortcut or command palette
- When orchestrator mode is active, right pane shows sub-agents instead of markdown viewer
- File tree remains consistent on the left in both modes

**Sub-agent pane features:**
- **Scrollable** - Vertical scroll when more agents than can fit on screen
- **Collapsible** - Click to expand/collapse individual agent terminals
- **Reorderable** - Drag-and-drop to rearrange agent order
- Allows users to customize workspace to their workflow

### Agent State Indicators

| State | Visual |
|-------|--------|
| Running | Animated spinner or pulsing indicator |
| Idle | Neutral (ready for input) |
| Blocked | Warning icon or amber color |
| Exited | Grayed out or error indicator |

## Implementation Considerations

### State Detection Mechanism

**Approach 1: Backend monitoring**
- Backend tracks PTY I/O activity
- Analyzes output patterns for prompt detection
- Emits state change events via WebSocket

**Approach 2: Frontend inference**
- Frontend monitors terminal output
- Uses timers to detect silence
- Pattern matching on rendered terminal content

**Approach 3: Hybrid**
- Backend tracks process-level state (running/exited)
- Frontend tracks terminal-level state (idle/blocked)

### Agent Communication Protocol

**Hybrid approach using multiple channels:**

**1. File-based knowledge base (primary)**
- Obsidian-style markdown documents with YAML frontmatter
- Stored in `.cade/agents/` directory
- Searchable metadata via frontmatter
- Shared knowledge base accessible to all agents

Example task file (`.cade/agents/tasks/auth-backend.md`):
```yaml
---
task_id: auth-backend-001
assigned_to: agent-1
status: in_progress
priority: high
created: 2026-01-31T14:23:00Z
---

# Implement Backend Auth Endpoints

Create REST endpoints for user authentication...
```

**2. Stdin injection (when appropriate)**
- Simple commands and queries
- Interactive workflows
- Note: Can have edge cases where input timing is unreliable

**3. Side-channel API (WebSocket messages)**
- Structured agent-to-agent messages separate from terminal I/O
- Keeps terminal clean for user interaction
- State updates, progress notifications
- Requires custom WebSocket message types in CADE backend

**Benefits of hybrid approach:**
- File-based provides persistence and searchability
- Stdin injection works for simple, immediate commands
- Side-channel keeps terminal output readable
- Markdown with frontmatter creates queryable knowledge base

## Security & Safety

**Prevent runaway agents:**
- Rate limiting on agent spawning
- Maximum concurrent agents per project
- User approval for orchestrator → worker communication?

**Isolation:**
- Each agent maintains separate terminal session
- No direct memory sharing between agents
- File system is shared (requires coordination)

## Migration Path

**Phase 1: State detection**
- Implement state detection for single agent
- Add UI indicators for current tab
- No multi-agent support yet

**Phase 2: Lifecycle hooks**
- Implement hook system
- Allow user scripts to react to state changes
- Test with single-agent workflows

**Phase 3: Multi-agent support**
- Allow multiple Claude instances per project
- Shared file tree, isolated terminals
- Manual task delegation by user

**Phase 4: Orchestrator**
- Implement orchestrator agent type
- Structured communication protocol
- Automated task delegation

## Open Questions & Research Needed

1. **Claude Code hooks:**
   - What lifecycle hooks does Claude Code currently provide?
   - Can we hook into process state changes, output events, prompt detection?
   - Documentation: Research Claude Code's hook system capabilities

2. **Hooks consumers:**
   - Who consumes hooks? UI updates, user scripts, orchestrator, or all three?
   - Should hooks be user-configurable or hardcoded?

3. **File tree coordination:**
   - All agents share the single file tree UI (left pane)
   - How to handle conflicts when multiple agents edit the same file?
   - Should we show indicators for which agent is editing which file (e.g., colored dots)?

4. **Agent spawning:**
   - How does user spawn additional agents in a project?
   - UI for creating/managing agents (right-click menu, command palette, dedicated panel)?
   - Should there be agent templates (e.g., "test runner", "documentation")?

5. **Orchestrator enforcement:**
   - How to prevent agents from autonomous agent-to-agent chatter?
   - Technical enforcement vs relying on Claude Code's instruction following?
   - Should worker agents even know other workers exist?

6. **Knowledge base schema:**
   - Standardized frontmatter fields for task documents?
   - Response document format?
   - How to handle task lifecycle (pending → in_progress → completed)?

## See Also

- [[../technical/core/frontend-architecture|Frontend Architecture]]
- [[../technical/core/backend-architecture|Backend Architecture]] (if exists)
- [[state-management-refactor|State Management Refactor]]
