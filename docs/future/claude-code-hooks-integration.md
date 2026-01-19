---
title: Claude Code Hooks Integration
created: 2026-01-17
updated: 2026-01-17
status: planned
tags: [feature, integration, claude-code, hooks]
---

# Claude Code Hooks Integration

Lightweight integration between CADE and Claude Code using hooks instead of MCP.

## Why Hooks Over MCP

- **Minimal overhead** - No additional server processes or protocol negotiation
- **Simple implementation** - Shell commands, easy to debug
- **Composable** - Works with existing Unix tools
- **No dependencies** - Just the CADE CLI

## Claude Code Hooks Overview

Claude Code supports hooks that execute on specific events:

| Hook | Trigger |
|------|---------|
| `PreToolUse` | Before a tool executes |
| `PostToolUse` | After a tool executes |
| `Notification` | On notifications/status updates |
| `Stop` | When Claude stops responding |

Hooks are configured in `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "CADE notify file-changed \"$CLAUDE_FILE_PATH\""
      }
    ]
  }
}
```

## Proposed CADE CLI Commands

### File Viewing

```bash
# Open file in CADE viewer pane
CADE view <path>

# Open file at specific line
CADE view <path>:<line>

# Open in slide-out on mobile
CADE view --mobile <path>
```

### Notifications

```bash
# Notify CADE of file change (triggers viewer refresh)
CADE notify file-changed <path>

# Show status message in CADE
CADE notify status "Building project..."

# Clear status
CADE notify clear
```

### Terminal Integration

```bash
# Focus terminal pane
CADE focus terminal

# Focus viewer pane
CADE focus viewer

# Focus file tree
CADE focus tree
```

### File Tree

```bash
# Expand to and highlight a file
CADE tree reveal <path>

# Collapse all folders
CADE tree collapse
```

## Hook Configuration Examples

### Auto-View Written Files

When Claude writes or edits a file, automatically show it in the viewer:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "CADE view \"$CLAUDE_FILE_PATH\""
      }
    ]
  }
}
```

### Show Build Output

After running build commands, notify CADE:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "command": "CADE notify status \"Command completed\""
      }
    ]
  }
}
```

### Reveal in Tree

When Claude reads a file, reveal it in the file tree:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read",
        "command": "CADE tree reveal \"$CLAUDE_FILE_PATH\""
      }
    ]
  }
}
```

## Implementation Approach

### CLI Architecture

```
CADE (main binary)
├── serve          # Start the web server (existing)
├── view <path>    # Send view command to running server
├── notify <type>  # Send notification to running server
├── focus <pane>   # Send focus command
└── tree <action>  # File tree commands
```

### Communication

CLI commands communicate with the running CADE server via:

1. **HTTP POST** to localhost endpoint (simplest)
2. **WebSocket message** (reuse existing connection)
3. **Unix socket / Named pipe** (lowest latency)

Example HTTP approach:

```bash
# CADE view docs/README.md internally does:
curl -X POST http://localhost:3000/api/view \
  -H "Content-Type: application/json" \
  -d '{"path": "docs/README.md"}'
```

### Server Endpoints

New REST endpoints for CLI commands:

```
POST /api/view          {"path": "...", "line": N}
POST /api/notify        {"type": "...", "message": "..."}
POST /api/focus         {"pane": "terminal|viewer|tree"}
POST /api/tree/reveal   {"path": "..."}
```

These translate to WebSocket messages broadcast to all connected clients.

## Environment Variables

Claude Code hooks receive context via environment variables:

| Variable | Description |
|----------|-------------|
| `CLAUDE_FILE_PATH` | Path of file being operated on |
| `CLAUDE_TOOL_NAME` | Name of the tool being used |
| `CLAUDE_WORKING_DIR` | Current working directory |

## Security Considerations

- CLI only connects to localhost
- No authentication needed for local-only access
- Commands are fire-and-forget (no sensitive data returned)

## Future Enhancements

- **Bidirectional** - CADE could trigger Claude Code actions
- **Custom panels** - Show Claude-specific UI in CADE
- **Session sync** - Share context between Claude Code and CADE

## Open Questions

1. Should the CLI be a separate binary or subcommand of main CADE?
2. HTTP vs WebSocket vs IPC for CLI-to-server communication?
3. What other hook events would be useful?

## See Also

- [[multi-project-tabs]] - Tab management
- [[README]] - Roadmap overview
