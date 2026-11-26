---
title: Failover Never Triggers With API Providers
created: 2026-11-26
updated: 2026-11-26
status: active
priority: high
tags: [quick-fix, providers, failover]
---

# Failover Never Triggers With API Providers

Not fixed. How failover is meant to work is in [[../../technical/core/provider-stack#Failover]].

## Problem

A `failover` provider is supposed to move to the next provider when the current one fails before producing output. With `APIProvider` sub-providers, which is the only kind `ProviderRegistry.from_config()` puts in a failover chain, it does not. A failed call is shown to the user as an error, no fallback is tried, and the failed provider is recorded as healthy.

The cause is an ordering clash between two pieces of code:

- `FailoverProvider` fails over only on a `ChatError` that arrives before any other event.
- `APIProvider` always yields `SystemInfo` as its first event, before it calls the model.

So an `APIProvider` error is never "before any other event". The exception path does not help either, because `APIProvider` catches its own LiteLLM exceptions and yields them as `ChatError`.

## Evidence

- `core/backend/providers/failover_provider.py:92` fails over only when `isinstance(event, ChatError) and not yielded_any`.
- `core/backend/providers/failover_provider.py:98` sets `yielded_any = True` after any event is passed on.
- `core/backend/providers/failover_provider.py:100-101` marks the provider healthy when the loop ends without `had_error`, which is the case here.
- `core/backend/providers/api_provider.py:190` yields `SystemInfo` before the LiteLLM call.
- `core/backend/providers/api_provider.py:235-247` catches the LiteLLM exception and yields `ChatError`, so `failover_provider.py:108` never sees an exception from it.
- `backend/tests/test_failover_provider.py:19-44`: the tests use a `MockProvider` that yields only the events it is given. None of them puts a `SystemInfo` in front of the error, so they pass.

What was run: an in-memory script, no files written. Two stub providers subclassing `BaseProvider`. Each yields `SystemInfo` first, as `APIProvider` does. The first then yields `ChatError(code="429")`. The second then yields a `TextDelta` and `ChatDone`. Both were wrapped in `FailoverProvider("adaptive", [primary, fallback])` and the stream was collected. Result:

```text
['SystemInfo:primary', 'ChatError:429']
cooldowns: {}
```

The fallback was never called and no cooldown was set.

What was not run: a real `APIProvider`, a real LiteLLM call, the WebSocket chat path, or the existing test suite. The claim about the real provider rests on reading `api_provider.py`.

## Why it matters

Failover is documented and configurable, and a chain is the natural default for anyone on rate-limited free tiers. It silently does nothing. The failure it is meant to absorb (a 429 or an outage on the primary) reaches the user as a dead chat turn. Because the failed provider is marked healthy, cooldown and backoff never engage either.

On the development machine the default provider is a plain `api` provider and the failover chain is defined but not the default, which is probably why this has gone unnoticed.

## Suggested fix direction

Make the failover decision on output that cannot be withdrawn, not on any event. `SystemInfo` carries only the model name, so it is safe to hold back or to send again.

- In `FailoverProvider.stream_chat`, buffer leading `SystemInfo` events and release them when the first content event (`TextDelta`, `ThinkingDelta`, `ToolUseStart`) arrives. A `ChatError` before that point triggers failover and drops the buffer.
- Add a test whose mock yields `SystemInfo` then `ChatError`, and assert the fallback runs and the primary gets a cooldown. Write it first and watch it fail.
- Decide what counts as retryable. Today every pre-output error would trigger failover, including a 400 or 401 that will fail on every provider for the same reason. [[../../reference/multi-provider-failover]] discusses error classes.
- Check the model name shown in the chat header after a failover. It is set from `SystemInfo`, so the fallback's `SystemInfo` must be the one released.

Related, read from the code and not run: `FailoverProvider` has no `set_mode()` or `set_orchestrator()`, and `backend/websocket.py:1887` and `:1907` call them only when present. A mode switch or `/orch` therefore does not reach the sub-providers of a failover chain.
