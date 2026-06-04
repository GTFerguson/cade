# Task delegation (CADE orchestrator)

When `mcp__cade-orchestrator__spawn_agent` is available, use it to offload execution to CADE's API workers (configured in `~/.cade/providers.toml`, typically Minimax). Stay on Claude Code for planning and review; delegate the bulk of token-heavy work.

## Delegate via spawn_agent

- Implementation and multi-file refactors
- Test writing and test fixes
- Repetitive edits, grep-heavy exploration, boilerplate
- Research that requires reading many project files (`mode="research"`)

## Keep on Claude Code (Max plan)

- Planning, architecture, and trade-off decisions
- Brainstorming and ambiguous requirements
- Final review and sign-off before declaring work done

## How to spawn

The orchestrator tools are **deferred** — their schemas are not loaded by default. Before calling any `mcp__cade-orchestrator__*` tool, load the schemas with ToolSearch:

```text
ToolSearch(query="select:mcp__cade-orchestrator__list_agents,mcp__cade-orchestrator__spawn_agent,mcp__cade-orchestrator__view_file")
```

Do this once at the start of any session where you intend to delegate. After that, the tools are callable normally.

Each task must be **self-contained**: goal, files to touch, constraints, acceptance criteria. Workers cannot see your conversation — only the task string.

```text
mcp__cade-orchestrator__spawn_agent(
  name="impl-feature-x",
  task="Implement … Acceptance: … Files: …",
  mode="code"
)
```

Parallelize independent subtasks with concurrent spawn calls. After the report returns, review the diff yourself before marking done.

Spawn and report approval are automatic for Claude Code CLI sessions — no UI confirmation required.
