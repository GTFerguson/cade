---
title: Dynamic Permission Management
created: 2026-04-22
updated: 2026-11-26
status: planning
verified: 2026-11-26
tags: [permissions, chat, settings]
---

# Dynamic Permission Management

Let chat agents reuse the permission rules the user has already granted to Claude Code, and let a chat approval be saved as such a rule, so the same command does not prompt in every session.

Nothing in this plan is built. No CADE code reads or writes the `permissions` block of any Claude Code settings file.

## Scope

CADE shows permission prompts on its own account in one place: the LiteLLM chat path. A chat agent prompts when its `bash` tool runs a command outside the auto-approve list, and when a file write is outside the project or accept-edits is off. See [[../../technical/core/agent-tools]].

Claude Code in a terminal tab applies its own settings and shows its own prompts. This plan does not change that.

So the work is: make the chat path's two gates consult the Claude Code rules, and optionally write new rules back.

## What exists

- `PermissionManager` (`backend/permissions/manager.py`): per-connection mode, toggles and pending prompts.
- Session-scoped approval: "Allow for session" on a bash prompt caches the command's first word for that connection, and an approved out-of-project write caches its folder. Both are lost when the tab disconnects. Documented in [[../../technical/core/agent-tools#Session-Level Command Approval]].
- A fixed classifier in `backend/tools/bash_tool.py` that auto-approves known read-only commands, refuses dangerous ones and rejects compound commands.
- `ClaudeSettings` (`backend/hooks/settings.py`): loads and saves a settings file and keeps a backup on save. It only has accessors for hooks. It has none for permissions.

## The settings format

Claude Code keeps rules as flat strings under `permissions`. These are the shapes found in the settings files on the development machine (`~/.claude/settings.json`, `~/.claude/settings.local.json`, and this repo's `.claude/settings.local.json`):

```json
{
  "permissions": {
    "allow": [
      "Bash(grep:*)",
      "Bash(netstat -tlnp)",
      "Bash(npm i *)",
      "Read(//tmp/**)",
      "WebFetch(domain:github.com)",
      "WebSearch",
      "mcp__plugin_playwright_playwright__browser_click"
    ],
    "deny": [
      "Bash(nkrdn workspace rebuild)"
    ],
    "defaultMode": "auto"
  }
}
```

A rule is a tool name, optionally followed by a pattern in brackets. The entries above are real ones. The exact matching rules for `:*`, `*` and `**`, and whether there is an `ask` list, have not been checked against Claude Code's documentation. Do that before writing a matcher.

Files and precedence, as Claude Code defines them, also need confirming from its documentation. The files seen are a user file, a user local file and a project local file. This repo has no project `.claude/settings.json`.

## Design

### Reading rules

1. Load the user and project settings files when a chat session starts.
2. Parse `allow` and `deny` into rules per tool.
3. Before prompting, match the requested action against the rules.
4. Allowed: run without a prompt. Denied: refuse. No match: prompt as today.

Two mismatches to design for:

- The chat `bash` tool rejects compound commands. Many saved Claude Code rules are compound (`Bash(cd … && npm test)`), so they can never match a chat command. Only single-command rules carry over.
- Chat tool names differ from Claude Code's (`bash`, `write_file`, `edit_file` against `Bash`, `Write`, `Edit`). The matcher needs a name mapping.

The hard-deny list in the bash classifier stays above any allow rule. A saved rule must not be able to permit `sudo` or `rm -rf`.

### Writing rules

When the user approves a prompt, offer a third choice beyond "once" and "for session": save as a rule. Write it in Claude Code's format so both programs read the same list.

### Generalising

When saving, offer a wider form of the rule and let the user pick:

- `git push` → `Bash(git push)` or `Bash(git:*)`
- one file → that file or its folder

### MCP tools

MCP tool calls from chat agents are not permission-gated today. Only `spawn_agent` has an approval step, in the orchestrator. Whether saved `mcp__…` rules should start to gate MCP calls is an open question, not a given.

## Phases

1. **Read.** Load rules at session start, check them in the bash gate and the write gate, skip the prompt on an allow match, refuse on a deny match.
2. **Write.** "Always allow" on a prompt saves a rule. Choose user or project file.
3. **Generalise.** Offer the wider forms above when saving.

## Error handling

- Missing settings file: treat as no rules. Create it only when the first rule is saved.
- Unparseable JSON: log a warning and treat as no rules. Never overwrite a file that failed to parse.
- Concurrent writes: Claude Code edits the same files. Re-read immediately before writing and change only the `permissions` lists.
- Write refused by the filesystem: log it and keep the approval for the session.

## Open questions

- Where CADE's own switches live (auto-approve on match, save on approve, how far to generalise). Claude Code's `permissions` block is another program's schema, so CADE-only keys do not belong in it. CADE's own config lives under `~/.cade/`.
- Whether CADE should write to the user's Claude Code files at all, or keep its own rule file in the same format and only read Claude Code's.
- Which file a saved rule goes to by default: user or project local.
- Whether the write gate honours `Read(...)` and edit rules for out-of-project paths, or only bash rules carry over at first.

## Later

- An audit log of what was approved and saved.
- A command to list and prune saved rules.
- Dropping a saved rule after it leads to repeated failures.

## See Also

- [[../../technical/core/agent-tools]]: the gates this plan changes
- [[../../reference/permission-allowance-models]]: research on permission models for agents
