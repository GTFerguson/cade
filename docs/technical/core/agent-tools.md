---
title: Agent Tool System
created: 2026-04-24
updated: 2026-04-24
status: implemented
tags: [agents, tools, litellm, permissions, bash, file-tools]
---

# Agent Tool System

File, discovery, and shell tools available to LiteLLM-backed agents in CADE.
Tools are registered per-session in a `ToolRegistry` and dispatched through
`APIProvider`'s async tool loop. The `ClaudeCodeProvider` path does not use
these — Claude Code handles tool access natively via CLI flags.

## What Was Built

### File Tools (`backend/tools/file_tools.py`)

| Tool | Purpose |
|---|---|
| `read_file` | Single file read with optional line range |
| `read_files` | Batch read — multiple files in one call, 256KB output cap |
| `list_directory` | Flat directory listing |
| `write_file` | Full overwrite or create |
| `edit_file` | Single exact-string replacement (must be unique) |
| `multi_edit` | Ordered list of replacements on one file, applied atomically |
| `delete_file` | Remove a file from disk |
| `move_file` | Rename or relocate a file; creates parent dirs |

`read_file`, `read_files`, and `list_directory` are read-only and available in
all modes. Write tools are hidden in architect/review modes via
`FileToolExecutor.tool_definitions()`, which checks `can_write(mode)` at call
time.

### Discovery Tools (`backend/tools/discovery_tools.py`)

| Tool | Purpose |
|---|---|
| `glob` | File discovery by pattern (`**/*.py`), results sorted by mtime |
| `grep` | Regex content search; uses `rg` when available, falls back to Python `re` |

Both are read-only and always exposed regardless of mode. Results capped at 200
(glob) and 100 matches (grep) with truncation markers.

### Bash Tool (`backend/tools/bash_tool.py`)

Single `bash(command, timeout_ms?, cwd?)` tool. Every invocation is classified
before execution:

| Bucket | Behaviour |
|---|---|
| `compound` | Shell operators detected (`&&`, `\|\|`, `;`, `\|`, backticks, `$(`) — rejected; agent must split into separate calls |
| `hard_deny` | Catastrophic commands (`sudo`, `rm -rf`, `mkfs*`, `reboot`, SSH/AWS paths, download-and-exec) — refused without prompting |
| `auto` | Known read-only commands — runs immediately |
| `prompt` | Everything else — goes through `request_permission` |

Auto-approve list includes: `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat`,
`find`, `rg`, `grep`, `awk`, `sed` (without `-i`), `sort`, `uniq`, `cut`,
`tr`, `diff`, `tree`, `du`, `df`, `pwd`, `which`, `echo`, `env`, `date`,
`uname`, `hostname`, `jq`, `yq`, `python3 --version` / `-V`,
`git status|log|diff|show|branch|tag|remote|rev-parse|ls-files|blame|describe|stash|reflog`.

Compound detection strips quoted regions before scanning, reducing false
positives from operators inside string arguments. Output is capped at 64KB per
stream; timeout defaults to 30s, max 5 min.

### Session-Level Command Approval

When a `prompt`-bucket bash command is approved via the permission flyout, the
user can choose "Allow `<token>` for session". This caches the first token
(e.g. `pytest`) in `ConnectionState.approved_commands` so future calls with
that command skip the prompt for the rest of the session.

The permission request payload carries a `_session_key` field (set by
`BashToolExecutor`) so `PermissionManager.approve(approve_for_session=True)`
knows what to cache without parsing the command again.

## Permission Architecture

All write tools share a common gating path in `_check_write_permission()`:

1. **Mode check** — `can_write(mode)` blocks writes in architect/review modes
2. **Scope check** — paths outside the project root require `request_permission`
   unless already in `ConnectionState.approved_paths`
3. **Accept-edits toggle** — when `allow_write` is off, every write prompts
   regardless of scope

`ConnectionState.approved_paths` is pre-seeded with `/tmp` and `$TMPDIR` so
agents can use scratch files without prompting. Each connection gets its own
independent state — no cross-tab bleed.

## Registration

All tools are wired in `_create_tool_registry()` in `backend/providers/registry.py`:

```
FileToolExecutor     → read_file, read_files, list_directory, write_file,
                       edit_file, multi_edit, delete_file, move_file
DiscoveryToolExecutor → glob, grep
BashToolExecutor     → bash
```

Registration only happens when a `working_dir` is provided (i.e. a project is
open). Agents without a project get no file/shell tools.

## Frontend: "Allow for Session" Button

Permission prompts for `bash` show a third button between Allow and Deny:
**"Allow `<token>` for session"**. Clicking it sends
`PERMISSION_APPROVE` with `approveForSession: true`. The backend `approve()`
handler reads `_session_key` from the pending request and calls
`approve_command()`.

Non-bash permission prompts retain the original two-button layout.

## Design Decisions

**Compound commands rejected rather than parsed.** A full shell parser would
handle `&&` inside quoted strings correctly, but adds significant complexity
and attack surface. Rejecting compounds keeps the allowlist classification
simple and auditable — the agent issues each step as a separate `bash()` call,
which is also cleaner for turn-by-turn logging.

**`multi_edit` is atomic; `edit_file` is not.** A partial multi-edit that
fails halfway would leave the file in an inconsistent state. The implementation
applies all edits to a working copy in memory and only writes to disk if every
edit succeeds.

**`read_files` keeps individual file errors non-fatal.** Missing or unreadable
files are collected in a trailing `=== missing ===` section rather than
aborting the whole call. Agents can process the files that did load and decide
what to do about the missing ones.

**Discovery tools are always visible in all modes.** `glob` and `grep` are
purely read-only — hiding them in architect mode would only make agents less
capable of understanding the codebase without any safety benefit.

**`/tmp` pre-approved at session start.** Agents routinely need scratch space.
Requiring an explicit approval for every `/tmp` write added noise without
meaningful protection, since the agent already has write access to the project.

## Key Files

| File | Role |
|---|---|
| `backend/tools/file_tools.py` | File read/write/edit/move/delete |
| `backend/tools/discovery_tools.py` | glob + grep |
| `backend/tools/bash_tool.py` | Bash tool with classification + gating |
| `backend/permissions/manager.py` | `ConnectionState`, `approved_paths`, `approved_commands` |
| `backend/providers/registry.py` | `_create_tool_registry()` wiring |
| `frontend/src/chat/chat-pane.ts` | Permission prompt UI + "Allow for session" button |

## See Also

- [[tool-support-and-failover]] — how `ToolRegistry` and `APIProvider`'s async
  tool loop work
- [[agent-orchestration]] — orchestrator mode and agent spawning
- [[../reference/websocket-protocol]] — `permission-request` / `permission-resolved`
  message shapes
