---
title: HTTP MCP handshake timeout documented as 10s, implemented as 8s
created: 2026-05-05
status: active
priority: low
---

## Problem

The tool-support plan and inline comments refer to a 10s timeout on MCP tool discovery, but the HTTP MCP transport handshake timeout is actually 8s.

## Evidence

- `core/backend/providers/http_mcp_tools.py` line ~147–151 — `asyncio.wait_for(..., timeout=8.0)` on transport handshake
- `core/backend/providers/tool_executor.py` — `definitions_async()` wraps `_list_tools()` with a 10s timeout
- The two timeouts guard different things: tool discovery (10s) vs transport handshake (8s)

## Why it matters

Low severity — both timeouts are reasonable and the system works. But a stalled HTTP MCP server could still block for up to 8s on connect before the 10s tool-discovery timeout fires, creating an 18s worst-case block on chat start. Documentation is also misleading.

## Suggested fix direction

Either align both to the same value (10s), or document clearly that the 8s is the transport/handshake timeout and 10s is the tool-list discovery timeout, and they stack in the worst case. Also consider making both configurable via `providers.toml`.
