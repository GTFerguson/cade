---
title: Hook Infrastructure Improvements
created: 2026-01-20
updated: 2026-01-20
status: planned
tags: [hooks, infrastructure, improvements]
---

# Hook Infrastructure Improvements

Future improvements for the Claude Code hook system.

## Dynamic Port Configuration

**Current state:** The hook command requires a port to be specified at setup time (`setup-hook --port 3001`). A multi-port fallback tries both 3000 and 3001.

**Problem:** The hook doesn't automatically know which port CADE is running on.

**Potential solutions:**

1. **Server writes port on startup** - Backend writes its port to `~/.cade/port` when starting. Hook reads this file to determine the correct endpoint.

2. **Server updates hook on start** - Backend modifies `~/.claude/settings.json` when starting to point the hook at its port. Downside: modifying user config on every start feels intrusive.

3. **Unix socket instead of HTTP** - Use a well-known socket path instead of a port. Eliminates port coordination entirely.

4. **Service discovery** - Hook queries a well-known endpoint to find CADE, or uses mDNS/Bonjour.

**Current workaround:** Multi-port fallback tries port 3001 (dev) first, then 3000 (stable). Works for typical development but not custom ports.

## See Also

- [[../technical/design/hook-architecture|Hook Architecture]] (if exists)
