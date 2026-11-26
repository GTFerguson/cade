---
title: Context Gauge Over-Reads on Tool-Using Replies
created: 2026-11-26
updated: 2026-11-26
status: active
priority: medium
tags: [quick-fix, providers, context-budget, chat]
---

# Context Gauge Over-Reads on Tool-Using Replies

Not fixed. Found by reading the code. It has not been measured in the running app. How the gauge is fed is in [[../../technical/core/provider-stack#Context budget gauge]].

## Problem

The gauge is meant to show how full the model's context window is. It is fed a figure that means something else.

One chat reply can take several model calls: the model asks for tools, the results are appended, and the model is called again. Each call reports its own `prompt_tokens`, and each call's prompt already contains the whole conversation so far. `APIProvider` adds these up across the calls and reports the sum. That sum is right for billing. It is not the size of the context.

The indicator takes the sum as the current context size. A reply with five tool turns counts the conversation about five times.

## Evidence

- `core/backend/providers/api_provider.py:273-278` records the `prompt_tokens` of the current model call.
- `core/backend/providers/api_provider.py:309-312` adds that to `total_prompt_tokens` once per tool turn.
- `core/backend/providers/api_provider.py:407-411` puts the totals into `usage`, and `:420` yields them in `ChatDone`.
- `backend/websocket.py` forwards `event.usage` unchanged on the `done` chat event (`_stream_chat_response`).
- `frontend/src/chat/chat-pane.ts:1226-1227` passes `usage.prompt_tokens` to the indicator.
- `frontend/src/components/context-budget-indicator.ts:5-7` states the assumption: the value is "the current context usage, not a cumulative sum".
- `frontend/src/components/context-budget-indicator.ts:93` divides it by the context window.

## Why it matters

- The gauge turns orange and red well before the context is full on any agentic reply, which is most replies in code mode. A gauge that cries wolf gets ignored.
- The plan to compact automatically at a threshold ([[../infrastructure/tool-support-and-failover]]) needs a true context figure. Built on this one it would fire far too early.
- After a reply with no tool calls the figure is correct, so the gauge jumps up and down between replies.

## Suggested fix direction

Report two figures and use each for its own purpose.

- Keep the summed totals in `usage` for cost and the token counter.
- Add the context size of the last model call in the reply. That is the last call's `prompt_tokens` plus its `completion_tokens`, since the reply itself is in the context for the next message. Carry it on `ChatDone` under its own key.
- Have the indicator read the new key and fall back to `prompt_tokens` when it is absent.
- Check the `anthropic/` route before trusting the figure: the code comment at `api_provider.py:271-272` says those providers report prompt tokens in the first chunk, and whether that count includes cached tokens has not been checked.
- Add a provider test with two tool turns that asserts the context figure equals the last call's size, not the sum.
