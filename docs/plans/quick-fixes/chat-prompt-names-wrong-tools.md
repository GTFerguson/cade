---
title: Chat Prompt Misdescribes Tools and Behaviour
created: 2026-11-26
updated: 2026-11-26
status: active
priority: medium
tags: [quick-fix, prompts, chat]
---

# Chat Prompt Misdescribes Tools and Behaviour

Not fixed. Each item was found by reading the prompt modules against the code. How the prompt is assembled is in [[../../technical/core/prompt-composition]].

The file tool names in `base.md` are correct as of commit `be3b062c` (`write_file`, `edit_file`). They are not part of this record. Three other items are.

## Problem

1. **The prompt promises that plan docs open by themselves.** `base.md` tells every chat agent to write long-form output to `docs/plans/` because it "auto-opens for the user". For a chat agent it does not. The auto-open is a Claude Code hook that runs in terminal tabs. A chat agent's `write_file` passes the edit to the Neovim manager and does not open the viewer.
2. **No module mentions `view_file` or `show_html`.** These are the tools a chat agent has for putting something in front of the user. The model sees them only as tool definitions. Nothing in the prompt says when to use them, and the output-channel decision tree does not include them.
3. **CADE is expanded two ways.** The prompt says "Context-Aware Development Environment". The rest of the project says "Claude Agentic Development Environment".

## Evidence

Item 1:

- `backend/prompts/modules/base.md:17`: "Write to docs/plans/ (auto-opens for the user)".
- `backend/hooks/commands.py:166-196` (`matches_filter`): the hook's rule for which edited files go to the viewer. It runs from Claude Code's hook system and posts to `/api/view` (`backend/main.py:608`).
- `backend/tools/file_tools.py:257-260`: `_nvim_record_edit` is the only notification the file tools send. The write, edit and multi-edit paths call it (`:418`, `:451`, `:490`) and make no viewer call.

Item 2:

- `backend/orchestrator/mcp_server.py:106` (`view_file`) and `:123` (`show_html`).
- `core/backend/providers/api_provider.py:119`: only `spawn_agent` and `list_agents` are hidden outside orchestrator, so both tools are offered to every chat agent.
- A search of `backend/prompts/modules/` for `view_file` and `show_html` finds nothing.

Item 3:

- `backend/prompts/modules/base.md:3`: "Context-Aware Development Environment".
- `CLAUDE.md:7`, `README.md:3`, `docs/README.md:15`, `desktop/src-tauri/Cargo.toml:4`: "Claude Agentic Development Environment".

## Why it matters

- Item 1 makes the agent tell the user a document has opened when it has not. The user then has to find the file.
- Item 2 leaves the viewer and the HTML canvas mostly unused by chat agents. The prompt steers everything to chat, the dashboard file or a document.
- Item 3 is small, but the prompt is where the model learns what it is running in.

## Suggested fix direction

- Items 1 and 2 together: in `base.md`, change the plan-doc line to say the agent should write the file and then call `view_file` on it. Add `show_html` to the decision tree for visual output that is not tabular. This is a prompt-only change.
- The other route for item 1 is to make the chat write tools open plan docs in the viewer, using the same path filter as the hook. That is the unbuilt item in [[../system-prompt/cade-agent-context]]. If that is built, the prompt line can stay as it is.
- Item 3: use "Claude Agentic Development Environment" in `base.md`.
- After any prompt change, read the composed prompt for one mode end to end (`compose_prompt("code", <project>)`) to check the modules do not contradict each other. `neovim.md` and the Neovim section of `base.md` currently say the same thing twice.
