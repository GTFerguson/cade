---
title: Dynamic Permission Management
created: 2026-04-22
status: planning
---

# Dynamic Permission Management

Read and update `.claude` permission allowlists to streamline tool execution and reduce permission prompts.

## Overview

The system can read the current state of `~/.claude/settings.json` permission allowlists and dynamically update them as tools execute successfully. This reduces friction when running the same tools repeatedly across sessions.

## Current State

The harness maintains permission lists in `~/.claude/settings.json`:
- **Global permissions**: `settings.json` (user's shared config across all projects)
- **Project permissions**: `project/.claude/settings.json` (project-specific overrides)
- **Permission types**: Bash commands, read paths, write paths, etc.

## Design

### Reading Permissions

1. Load `~/.claude/settings.json` (global) and `project/.claude/settings.json` (local)
2. Parse allowlists and blocklists for each tool type
3. Check if a requested action matches an existing permission
4. If allowed, execute without prompting; if blocked, reject; if unknown, prompt user

### Writing Permissions

When a tool executes successfully, optionally add it to the allowlist:

```json
{
  "permissions": {
    "bash": {
      "allowlist": [
        "npm run build",
        "cd /home/gary/projects/cade && git status",
        "find . -name '*.md'"
      ]
    },
    "read": {
      "allowlist": [
        "/home/gary/projects/cade/src/**",
        "/home/gary/projects/cade/docs/**"
      ]
    }
  }
}
```

### Permission Scope

- **Global** (`~/.claude/settings.json`): Applies across all projects
- **Project-local** (`project/.claude/settings.json`): Overrides global, project-specific
- **Precedence**: Local > Global (local settings take precedence)

## Patterns

### Bash Commands
Match by:
- **Exact command**: `npm run build` (exact string match)
- **Command prefix**: `git` (matches `git status`, `git log`, etc.)
- **Pattern**: `find . -name '*'` (glob or regex match)

### File Read/Write
Match by:
- **Exact path**: `/home/gary/projects/cade/src/main.ts`
- **Directory**: `/home/gary/projects/cade/src/` (includes subdirs)
- **Pattern**: `/home/gary/projects/cade/**/*.ts` (glob pattern)

### MCP Tools
Match by:
- **Tool name**: `nkrdn`, `spawn_agent`
- **MCP server**: `cade-orchestrator`, `user-mcp-server`

## Implementation Strategy

### Phase 1: Read Permissions
- Load settings files at session start
- Check before prompting user on permission questions
- Skip prompt if action is in allowlist
- Still prompt if action is blocklisted (explicit deny)

### Phase 2: Write Permissions
- After successful tool execution, optionally add to allowlist
- Respect user's choice (e.g., "always allow this pattern?" prompt)
- Write to local or global based on scope

### Phase 3: Intelligent Generalization
- When adding a permission, offer suggestions for generalizing it
  - `git status` → `git *` (all git commands)?
  - `/home/gary/projects/cade/src/main.ts` → `/home/gary/projects/cade/src/**`?
- Let user choose specificity level

## Config Integration

Settings can control this behavior:

```json
{
  "permissions": {
    "auto_approve_matching": true,
    "auto_add_on_success": true,
    "generalization_strategy": "conservative"
  }
}
```

Options for `generalization_strategy`:
- `exact`: Never generalize, store exact commands/paths
- `conservative`: Only generalize obvious patterns (e.g., `git` → `git *`)
- `aggressive`: Aggressively generalize (e.g., `src/main.ts` → `src/**`)

## Error Handling

- **Missing settings file**: Create with defaults
- **Unparseable JSON**: Log warning, use defaults
- **Write conflict**: Merge changes gracefully (last-write-wins for now)
- **Permission denied**: Log error, continue without writing

## Future Enhancements

- Permission audit log showing what was approved/added over time
- Bulk permission management CLI tool
- Auto-revoke permissions if they fail/cause errors
- Per-session temporary permissions (don't persist)
