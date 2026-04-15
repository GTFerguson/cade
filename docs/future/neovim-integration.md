---
title: Neovim Integration
created: 2026-01-31
updated: 2026-02-01
status: design
tags: [neovim, vim, editor, integration]
---

# Neovim Integration

Integrate Neovim into CADE's right pane for collaborative editing workflows with Claude Code.

## Motivation

While Claude Code can already read, write, and edit files, Neovim integration adds:

**Visual confirmation** - See Claude's proposed changes in your familiar editor before they're applied

**Jump to context** - Claude says "bug at auth.rs:142" → Neovim jumps there automatically

**Hybrid workflow** - Claude suggests edits, you refine in Neovim, Claude continues based on your changes

**Staying in flow** - Review and edit code without leaving CADE, in your configured Neovim environment

**Trust layer** - Approve edits visually in your editor rather than just seeing diffs in conversation

## Architecture: Three-Layer Model

Clear separation of concerns prevents architectural confusion:

### Layer 1: Hooks = Observation (Read-Only)

Events that bubble up from the system:

| Event | Trigger |
|-------|---------|
| `file_changed` | File modified on disk |
| `plan_updated` | Claude updates its task plan |
| `command_executed` | Shell command completes |
| `error_thrown` | Error occurs in terminal or Claude |
| `agent_state_change` | Agent transitions (running → idle, etc.) |

**Properties:**
- Passive observation only
- No side effects
- Just notifications that "something happened"

### Layer 2: Neovim RPC = Action (Write)

Commands that flow down to Neovim:

| Action | Purpose |
|--------|---------|
| `open_buffer` | Open file at specific location |
| `apply_edit` | Apply targeted code change |
| `request_confirmation` | Show diff and ask user to approve |
| `jump_to_context` | Navigate to file:line:column |
| `highlight_region` | Highlight relevant code section |

**Properties:**
- Active manipulation of editor state
- Direct commands to Neovim via RPC
- Can modify buffers, cursor position, windows

### Layer 3: CADE UI = Arbitration (Control Plane)

User controls and policy enforcement:

| Control | Purpose |
|---------|---------|
| Approve / Deny | Gate edits before they're applied |
| Pause / Resume | Control agent execution |
| Adjust constraints | Change what agents can do |
| Kill session | Emergency stop (especially useful on mobile) |

**Properties:**
- User is the authority
- Policy enforcement layer
- Controls flow between observation and action

**Why this separation matters:**
- Prevents hooks from accidentally becoming actors
- Prevents actions from bypassing user control
- Clear responsibility boundaries

## UI Design

### Right Pane Modes

The right pane toggles between three distinct modes:

| Mode | Purpose | When Active |
|------|---------|-------------|
| **Markdown Viewer** | Render .md files (mertex) | Default for documentation viewing |
| **Neovim Pane** | Code editing/viewing | When user enables Neovim mode or Claude requests jump-to-context |
| **Stacked Sub-Agents** | Orchestrator oversight | When orchestrator mode is active |

**Design decision:** Keep Markdown Viewer and Neovim Pane separate (not unified).

**Rationale:**
- Markdown viewing and code editing are distinct workflows
- Can iterate on mertex viewer independently
- No Neovim plugin dependencies for markdown viewing
- Clear mental model for each pane's purpose

### Layout

```
┌──────────┬─────────────────────┬──────────────┐
│          │                     │              │
│   File   │   Claude Code       │   Neovim     │
│   Tree   │   Terminal          │   Pane       │
│          │                     │              │
└──────────┴─────────────────────┴──────────────┘
```

**Toggle behavior:**
- Keyboard shortcut to switch right pane mode (e.g., `Ctrl+Shift+N` for Neovim)
- Command palette: "Toggle Neovim Pane", "Toggle Markdown Viewer", "Toggle Orchestrator View"
- Auto-switch: When Claude requests jump-to-context, right pane switches to Neovim automatically

## Neovim RPC Communication

### Connection Options

**Option A: Spawn managed instance**
- CADE spawns Neovim with `--headless` or `--embed`
- Full control over Neovim process
- User's `init.vim`/`init.lua` is loaded

**Option B: Connect to existing instance**
- User runs Neovim separately with `--listen` flag
- CADE connects via RPC socket
- Shares session with user's terminal Neovim

**Option C: Hybrid**
- Spawn managed instance by default
- Allow connection to existing instance if user prefers

### RPC Protocol

Neovim supports msgpack-RPC over:
- Unix socket (`nvim --listen /tmp/nvim.sock`)
- TCP socket (`nvim --listen 127.0.0.1:6666`)
- Stdio (embedded mode)

**Recommended:** Unix socket for spawned instance, TCP for remote connection.

### Required RPC Commands

**File navigation:**
```vim
:edit /path/to/file.rs
:call cursor(line, column)
```

**Apply edits:**
```vim
:call nvim_buf_set_lines(bufnr, start_line, end_line, false, new_lines)
```

**Visual highlighting:**
```vim
:call nvim_buf_add_highlight(bufnr, ns_id, hl_group, line, col_start, col_end)
```

**Window management:**
```vim
:split / :vsplit
:only (close other windows)
```

## Workflows

### Workflow 1: Claude Suggests, User Reviews in Neovim

1. Claude analyzes code and identifies needed change
2. Claude: "I found the issue in `auth.rs:142`. Would you like me to open it in Neovim?"
3. User approves (or auto-opens if configured)
4. Right pane switches to Neovim mode
5. Neovim opens `auth.rs` and jumps to line 142
6. User reviews the context visually
7. Claude: "Should I apply this fix?" (shows diff)
8. User approves in UI
9. Claude applies edit via Neovim RPC → buffer updates live
10. User sees change appear in real-time

### Workflow 2: Jump to Context During Debugging

1. Claude runs tests, sees failure
2. Claude: "Test failed at `parser.rs:89`"
3. Right pane auto-switches to Neovim
4. Neovim opens file and jumps to failure line
5. Highlights surrounding context
6. User can manually edit or let Claude suggest fix

### Workflow 3: Hybrid Editing

1. Claude makes automated edits to files A, B, C
2. User manually edits file D in Neovim pane
3. Hook system detects `file_changed` event for file D
4. Claude is notified and re-analyzes if needed
5. Both work in parallel without conflicts

### Workflow 4: Mobile Oversight

1. User on phone, Claude working on desktop CADE instance
2. Neovim pane shows live buffer updates as Claude edits
3. User sees changes appear in real-time
4. If something looks wrong, user taps "Pause" in CADE UI
5. Claude stops, waits for user input

## Configuration

### User Settings

```json
{
  "neovim": {
    "enabled": true,
    "mode": "spawn",  // "spawn" | "connect"
    "socket_path": "/tmp/nvim.sock",
    "auto_jump": true,  // Auto-open files when Claude suggests
    "confirm_edits": true,  // Require approval before applying edits
    "init_script": "~/.config/nvim/init.lua"
  }
}
```

### Neovim Plugin (Optional)

Optional companion Neovim plugin for enhanced integration:

**Features:**
- Highlight regions Claude is analyzing
- Show Claude's proposed edits as virtual text
- Quick approve/deny keybindings
- Status line showing Claude's current state

**Not required** - Basic integration works with vanilla Neovim via RPC.

## Implementation Considerations

### Neovim Rendering

**Option 1: Terminal in browser**
- Render Neovim TUI in right pane using xterm.js (like Claude terminal)
- True Neovim experience with full color, statusline, etc.

**Option 2: Custom renderer**
- Parse Neovim buffer state via RPC
- Render with custom syntax highlighting (like Monaco editor)
- More control but loses Neovim look-and-feel

**Recommended:** Option 1 (terminal renderer) for authentic experience.

### Performance

**Concerns:**
- Neovim startup time when spawning instance
- RPC latency for frequent updates
- Browser rendering performance for large files

**Mitigations:**
- Keep Neovim instance alive (don't spawn per-file)
- Batch RPC commands when possible
- Use Neovim's async API to avoid blocking

### Security

**Risks:**
- Neovim has full file system access
- RPC commands could be exploited if socket is exposed

**Mitigations:**
- Unix socket permissions (user-only access)
- Validate RPC commands before sending
- Sandbox Neovim instance (restrict to project directory)

## Resolved Design Decisions

> [!NOTE]
> Detailed rationale for each decision is captured in the sections below.

### 1. Instance Management

**One Neovim instance per project tab, persistent across reconnections.** Matches the existing per-tab isolation pattern. On Neovim crash: show error state with "Restart Neovim" button (no auto-restart to avoid crash loops). Buffer list is preserved in session state for restart recovery.

### 2. Configuration Loading

**Load user's full Neovim config by default.** Users expect their keybindings, colorscheme, and plugins. Escape hatch: `neovim.clean_mode: true` launches with `--clean` flag for debugging or minimal configs.

### 3. Diff Preview

**Use Neovim's built-in diff mode.** Claude's proposed edits are written to a temp file, then shown as a vertical diff split. Users can use standard diff commands (`]c`, `[c`, `do`, `dp`) or approve/deny through CADE UI.

### 4. Multiple Files

**Use Neovim's buffer list with CADE-controlled navigation.** All changed files are opened as buffers (`:badd`). User navigates with standard commands (`:bnext`, `:bprev`). No forced splits or tabs.

### 5. Mobile Experience

**Read-only syntax-highlighted view on mobile. No Neovim TUI.** Touch input is incompatible with Neovim's modal editing. Mobile right pane shows syntax-highlighted code with line numbers and jump-to-context support.

### 6. Conflict Resolution

**No file locking. Warn-and-queue approach.** If the Neovim buffer has unsaved changes when Claude wants to edit, Claude's edit is queued with a user notification. When user saves in Neovim, file watcher notifies Claude to re-read.

## Dependencies

**Backend:**
- Neovim RPC client library (e.g., `pynvim` for Python, `node-msgpack` for JS)
- Process management for spawning Neovim instances

**Frontend:**
- Terminal renderer (already have xterm.js for Claude terminal)
- RPC message handling via WebSocket to backend

**External:**
- Neovim binary installed on system
- Optional: User's Neovim configuration

## Migration Path

**Phase 1: Basic RPC connection**
- Spawn Neovim instance
- Establish RPC connection
- Render Neovim TUI in right pane

**Phase 2: File navigation**
- Implement `open_buffer` and `jump_to_context`
- Allow Claude to request file opens
- User approval flow

**Phase 3: Edit application**
- Implement `apply_edit` via RPC
- Show diffs before applying
- Real-time buffer updates

**Phase 4: Hooks integration**
- Connect `file_changed` hooks to Claude notifications
- Bidirectional awareness (user edits → Claude, Claude edits → buffer)

**Phase 5: Polish**
- Configuration UI
- Neovim plugin (optional)
- Performance optimization

## See Also

- [[../technical/core/agent-orchestration|Agent Orchestration]] - Hooks system that feeds observation layer
- [[../technical/core/frontend-architecture|Frontend Architecture]]
- [[mobile-interface|Mobile Interface]] - How Neovim pane works on mobile
