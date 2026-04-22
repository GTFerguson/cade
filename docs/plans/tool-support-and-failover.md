---
title: APIProvider Tool Support + FailoverProvider
created: 2026-04-22
status: approved
tags: [cade, providers, tools, litellm]
---

# Tool Support for APIProvider + FailoverProvider

## Context

CADE's `APIProvider` (LiteLLM-based) has no tool support — `tool_use=False`, no tool schema passing, no tool call parsing. The goal is to make it a viable alternative to `ClaudeCodeProvider` for non-CC sessions (Groq, Mistral, etc.) using nkrdn for code intelligence. We also need a `FailoverProvider` to replicate padarax's model-routing pattern. These two together let CADE route across free-tier LLMs with graceful failover.

## Architecture

Five focused components, each with one responsibility:

```
types.py               ← add ToolDefinition (pure data)
tool_executor.py       ← ToolExecutor protocol + ToolRegistry + NkrdnExecutor
api_provider.py        ← tool loop, inject ToolRegistry, extract helpers
failover_provider.py   ← cooldown/backoff wrapper
registry.py            ← wire "failover" provider type, two-pass config
```

The consumer (`ConnectionHandler._stream_chat_response`) already handles `ToolUseStart`/`ToolResult` events — zero changes needed there.

## Files

| File | Action |
|---|---|
| `core/backend/providers/types.py` | Edit — add `ToolDefinition` |
| `core/backend/providers/tool_executor.py` | Create |
| `core/backend/providers/api_provider.py` | Edit — tool loop + helpers |
| `core/backend/providers/failover_provider.py` | Create |
| `backend/providers/registry.py` | Edit — "failover" type, two-pass |
| `backend/tests/test_api_provider.py` | Edit — add tool tests |
| `backend/tests/test_tool_executor.py` | Create |
| `backend/tests/test_failover_provider.py` | Create |

## 1. `types.py` — Add `ToolDefinition`

Add after `ProviderCapabilities`, before streaming events:

```python
@dataclass
class ToolDefinition:
    """Describes a callable tool for an LLM provider."""
    name: str
    description: str
    parameters_schema: dict  # JSON Schema object
```

## 2. `tool_executor.py` — NEW

```python
class ToolExecutor(Protocol):
    def execute(self, name: str, arguments: dict) -> str: ...

class ToolRegistry:
    def register(self, executor: ToolExecutor, *tool_names: str) -> None
    def definitions(self) -> list[ToolDefinition]   # via executor.tool_definitions()
    def execute(self, name: str, arguments: dict) -> str  # dispatches by name; returns error string on unknown/exception

class NkrdnExecutor:
    # Single "nkrdn" tool with operation enum: search|lookup|details|context|usages
    # Runs nkrdn CLI as subprocess, timeout=15s
    def tool_definitions(self) -> list[ToolDefinition]
    def execute(self, name: str, arguments: dict) -> str

def make_nkrdn_registry() -> ToolRegistry:
    # Convenience: NkrdnExecutor pre-registered
```

**NkrdnExecutor schema** — single tool, operation enum:
```json
{
  "type": "object",
  "properties": {
    "operation": {"type": "string", "enum": ["search","lookup","details","context","usages"]},
    "arg":       {"type": "string", "description": "query, symbol name, URI, or file path"}
  },
  "required": ["operation", "arg"]
}
```

One tool vs many: fewer tokens, simpler LLM decision ("use nkrdn"), operation explained in description.

## 3. `api_provider.py` — Tool loop

### Constructor
```python
def __init__(self, config: ProviderConfig, tool_registry: ToolRegistry | None = None)
```

### Module-level helpers (DRY, testable)
```python
def _build_litellm_messages(messages, system_prompt) -> list[dict]
def _tool_def_to_litellm(defn: ToolDefinition) -> dict
def _extract_usage(last_chunk) -> dict
```

### `_build_kwargs()` private method
Builds litellm kwargs including `tools`/`tool_choice` when registry is set.

### `stream_chat()` — tool loop
```
while True:
    acompletion(...)
    stream chunks:
        - yield TextDelta on delta.content
        - accumulate tool_call fragments by index into pending_tool_calls dict
        - track finish_reason
    
    if finish_reason == "tool_calls" and registry and pending_tool_calls:
        append assistant turn to kwargs["messages"] (content=None, tool_calls=[...])
        for each call:
            yield ToolUseStart
            result = registry.execute(name, args)
            yield ToolResult
            append {"role":"tool","tool_call_id":...,"content":...} to kwargs["messages"]
        continue (next loop iteration calls acompletion again)
    else:
        yield ChatDone
        return
```

**Tool call delta accumulation** — keyed by `tc.index`:
```python
pending: dict[int, dict] = {}  # {"id": str, "name": str, "arguments": str}
# id only non-None on first chunk for that index — capture then, don't overwrite
# arguments: concatenate across chunks
```

**Infinite loop guard:** `_MAX_TOOL_TURNS = 10` — yield `ChatError` and return if exceeded.

**`content: None`** (not `""`) in assistant tool-call turn — required by OpenAI-compatible providers.

**Failover-safe:** `MockChunk` in existing tests uses `MagicMock()` for delta; update `MockChunk` to set `delta.tool_calls = None` explicitly so the accumulation check `if delta.tool_calls:` stays clean.

### `get_capabilities()`
```python
return ProviderCapabilities(streaming=True, tool_use=self._tool_registry is not None, vision=False)
```

## 4. `failover_provider.py` — NEW

```python
_INITIAL_COOLDOWN = 60.0    # seconds
_MAX_COOLDOWN    = 600.0    # 10 minutes
_BACKOFF_FACTOR  = 2.0

class FailoverProvider(BaseProvider):
    def __init__(self, name: str, providers: list[BaseProvider])
    
    # Cooldown state: {provider_name: (expiry_timestamp, next_cooldown_secs)}
    # Uses time.monotonic()
    
    def _is_healthy(provider) -> bool
    def _mark_failed(provider) -> None   # exponential backoff, cap at MAX
    def _mark_healthy(provider) -> None  # removes entry
    
    async def stream_chat(messages, system_prompt=None):
        candidates = healthy providers (or [primary] if all in cooldown)
        for provider in candidates:
            yielded_any = False
            try:
                async for event in provider.stream_chat(...):
                    if isinstance(event, ChatError) and not yielded_any:
                        mark_failed; break   # try next
                    yield event
                    yielded_any = True
                if not had_error:
                    mark_healthy; return
            except Exception:
                mark_failed; continue
        
        yield ChatError("All providers failed", code="failover-exhausted")
    
    def get_capabilities() -> delegates to primary
```

**Mid-stream failover policy:** Only failover if `ChatError` arrives before any output. Post-output errors propagate as-is — can't un-yield.

## 5. `registry.py` — Two-pass config

```python
@classmethod
def from_config(cls, config: ProvidersConfig) -> ProviderRegistry:
    registry = cls()
    registry._default = config.default_provider

    # Pass 1: register all non-failover providers
    for name, pconf in config.providers.items():
        if pconf.type in ("api", "claude-code", "cli"):
            ...  # existing logic

    # Pass 2: build failover providers (sub-providers now registered)
    for name, pconf in config.providers.items():
        if pconf.type == "failover":
            primary_name   = pconf.extra.get("primary", "")
            fallback_names = pconf.extra.get("fallbacks", [])
            sub_providers  = [registry.get(n) for n in [primary_name, *fallback_names] if registry.get(n)]
            if sub_providers:
                registry.register(name, FailoverProvider(name=name, providers=sub_providers))
            else:
                logger.error("Failover '%s': no valid sub-providers", name)
```

**Example providers.toml:**
```toml
[provider.groq]
type = "api"
model = "llama-3.3-70b-versatile"
api-key = "${GROQ_API_KEY}"

[provider.mistral]
type = "api"
model = "mistral-small-2603"
api-key = "${MISTRAL_API_KEY}"

[provider.chat]
type = "failover"
primary = "mistral"
fallbacks = ["groq"]

[default]
provider = "chat"
```

## Tests

### `test_api_provider.py` — add to existing

Update `MockChunk` to set `delta.tool_calls = None` (prevents MagicMock truthy false-positive).

Add `MockToolChunk(index, tool_id, name, arguments, finish_reason)` helper.

New tests (no `@pytest.mark.asyncio` — `asyncio_mode = "auto"`):

1. `test_no_tools_when_registry_is_none` — no `"tools"` key in kwargs, `tool_use=False`
2. `test_tool_definitions_passed_to_litellm` — registry with one def → `kwargs["tools"]` correct shape
3. `test_tool_call_single_turn` — id chunk → name+arg chunk → finish chunk → `ToolUseStart` + `ToolResult`
4. `test_tool_call_accumulates_arguments` — args across 3 chunks → correct parsed dict
5. `test_tool_call_continues_to_text` — after tool, second acompletion → text + `ChatDone`
6. `test_tool_execution_error_propagated` — registry returns `"Error: ..."` → `ToolResult.status == "error"`
7. `test_invalid_json_arguments_handled` — malformed JSON → `tool_input == {}`
8. `test_max_tool_turns_guard` — 11 consecutive tool_calls → `ChatError` with infloop guard message

### `test_tool_executor.py` — NEW

1. `test_registry_definitions` — stub executor → correct `ToolDefinition` returned
2. `test_registry_dispatch` — `execute()` routes to correct executor
3. `test_registry_unknown_tool` — returns error string (no raise)
4. `test_registry_executor_exception` — executor raises → returns error string (no raise)
5. `test_nkrdn_success` — `subprocess.run` returns stdout
6. `test_nkrdn_not_found` — `shutil.which` returns `None` → error string
7. `test_nkrdn_timeout` — `TimeoutExpired` → timeout error string
8. `test_nkrdn_nonzero_exit` — returncode != 0 → includes stderr

### `test_failover_provider.py` — NEW

1. `test_primary_success` — primary yields text + Done → only primary called
2. `test_failover_on_pre_output_chat_error` — primary yields ChatError first → fallback used
3. `test_no_failover_on_post_output_chat_error` — primary yields text then ChatError → propagated as-is
4. `test_all_exhausted` → `ChatError("failover-exhausted")`
5. `test_cooldown_skips_failed_provider` — failed provider in cooldown → skipped
6. `test_cooldown_expiry_allows_retry` — monotonic time patched past expiry → tried again
7. `test_exponential_backoff` — 3 failures → cooldown doubles each time, caps at MAX
8. `test_capabilities_delegate_to_primary`

## Verification

```bash
# Run new + existing provider tests
cd /home/gary/projects/cade
python -m pytest backend/tests/test_api_provider.py backend/tests/test_tool_executor.py backend/tests/test_failover_provider.py -v

# Quick smoke: nkrdn search via executor
python -c "
from core.backend.providers.tool_executor import make_nkrdn_registry
r = make_nkrdn_registry()
print(r.execute('nkrdn', {'operation': 'search', 'arg': 'BaseProvider'}))
"

# Lint
ruff check core/backend/providers/ backend/providers/
```

---

# Phase 2: Skills, Agent Spawning, Handoff Compaction

## Context

The tool loop is now in place. Next: expose MCP tools to non-CC providers, add agent spawning, and integrate `/handoff` as a compression mechanism for tight agent context control.

## Architecture

### 1. MCP → Tools Adapter (`core/backend/providers/mcp_tools.py`)

Bridge MCP server definitions to `ToolDefinition` for use in APIProvider:

```python
class MCPToolAdapter:
    def __init__(self, mcp_server_config: dict):
        # Discover tools from MCP server
        # Convert MCP tool schema (JSON-RPC) → ToolDefinition
    
    def tool_definitions(self) -> list[ToolDefinition]:
        # Return ToolDefinition list ready for APIProvider
    
    def execute(self, name: str, arguments: dict) -> str:
        # Call MCP server via JSON-RPC, return result as string
```

**Design:**
- Lazy-load MCP servers at first tool use (don't spin them up unless needed)
- Handle MCP server process lifecycle (start/stop/restart on error)
- Timeout tool calls (e.g., 30s cap)
- Return JSON results as stringified output

### 2. Agent Spawning Tool (`core/backend/providers/agent_spawner.py`)

Executor that spawns new agents via the orchestrator MCP:

```python
class AgentSpawnerTool(ToolExecutor):
    def tool_definitions(self) -> list[ToolDefinition]:
        return [ToolDefinition(
            name="spawn_agent",
            description="Spawn a new worker agent with specified role and prompt",
            parameters_schema={
                "type": "object",
                "properties": {
                    "role": {"enum": ["architect", "code", "review"]},
                    "prompt": {"type": "string"},
                    "context_handoff": {"type": "string", "description": "Optional handoff brief from /handoff"},
                },
                "required": ["role", "prompt"]
            }
        )]
    
    def execute(self, name: str, arguments: dict) -> str:
        # Call orchestrator MCP to spawn agent
        # Wait for agent completion (or stream status back)
        # Return agent result
```

### 3. Handoff Compaction (`backend/providers/handoff_compactor.py`)

Integrate `/handoff` skill as an async compaction mechanism:

```python
async def generate_and_approve_handoff(
    chat_session: ChatSession,
    context_window_pct: float = 0.8,
) -> str:
    """Generate handoff brief, wait for user approval, return brief.
    
    Triggers when:
    - Chat grows beyond context_window_pct of model's token budget
    - User explicitly requests via /handoff command
    - Agent detects it needs a fresh context window
    """
    # Call /handoff skill to generate brief from current session
    # Send approval prompt to user (or approve automatically for internal handoffs)
    # Wait for approval event
    # Return handoff brief (ready to inject into new agent)
```

**Integration in APIProvider/ClaudeCodeProvider:**
- Check context size before each turn
- Auto-trigger handoff if approaching limit (configurable threshold)
- New agent spawned with `context_handoff` injected into system prompt

### 4. System Prompt Templates per Provider

Extend `ProviderConfig` to support provider-specific system prompts:

```toml
[provider.groq]
type = "api"
model = "llama-3.3-70b-versatile"
system-prompt = """You are a code assistant. You have access to:
- nkrdn: code intelligence and symbol lookup
- spawn_agent: create worker agents for parallel tasks

Your role: architecting solutions and coordinating agents."""

[provider.orchestrator-agent]
type = "cli"
model = "claude-opus-4-7"
system-prompt = """You coordinate multiple worker agents. 
Use spawn_agent to parallelize, aggregate results.
Your decisions are binding; workers execute your plans."""
```

In APIProvider:
```python
system_prompt = self._config.extra.get("system-prompt") or system_prompt
```

### 5. Tight Agent Context Control Workflow

**Scenario: Long-running task, context approaching limit**

```
1. APIProvider detects ~80% context used
2. Calls generate_and_approve_handoff(chat_session)
3. /handoff skill generates brief of progress + key decisions
4. User sees: "Context approaching limit. Handoff brief ready. Approve? [Y/n]"
5. On approval:
   - Handoff brief saved to `docs/plans/handoff/<task-id>.md`
   - New agent spawned with role + original task goal + handoff injected
   - Old agent terminates gracefully
   - New agent has full context in a fresh window — no token waste
```

**For orchestration:**

```
1. Main orchestrator agent (CC) spawns code agents (Groq/Mistral via APIProvider)
2. Code agent's context fills up mid-task
3. Code agent calls spawn_agent("code", "continue from here", context_handoff=...)
4. New code agent takes over with fresh window + full context
5. Result flows back to orchestrator
```

## Files to Create

| File | Purpose |
|---|---|
| `core/backend/providers/mcp_tools.py` | MCP tool discovery + execution |
| `core/backend/providers/agent_spawner.py` | Agent spawning executor |
| `backend/providers/handoff_compactor.py` | Handoff generation + approval flow |
| `backend/tests/test_mcp_tools.py` | MCP adapter tests |
| `backend/tests/test_agent_spawner.py` | Agent spawning tests |

## Files to Modify

| File | Change |
|---|---|
| `backend/providers/registry.py` | Auto-register MCP tools + agent spawner from config |
| `core/backend/providers/api_provider.py` | Context budgeting + auto-handoff trigger |
| `core/backend/providers/config.py` | Add `system-prompt` field to ProviderConfig |

## Subagent Reporting Integration

When a subagent completes work, it yields a **completion report** to the parent agent. The handoff mechanism integrates with this pattern:

```
Parent Agent (APIProvider/CC)
    ↓ calls spawn_agent("code", "build feature X")
    ↓
Child Agent 1 (APIProvider)
    ... does work ...
    ↓ context fills, calls spawn_agent(role, prompt, context_handoff=brief)
    ↓
Child Agent 2 (APIProvider, fresh window)
    ... continues work ...
    ↓ completes, yields ChatDone with completion report
    ↓
Child Agent 1 aggregates result, yields ChatDone with combined report
    ↓
Parent Agent receives report, integrates into its context
```

**Key insight:** The **handoff brief** passed between agents becomes part of the **completion report** returned to the parent. Both use the same format (context summary + key decisions + artifacts), making reporting lossless and dense.

Design: `/handoff` skill generates briefs compatible with completion report schema — they're the same abstraction. Parent agents receive clean summaries without raw conversation noise, enabling tight multi-agent orchestration.

## Key Design Decisions

- **Handoff is blocking** — agent waits for user approval before spawning replacement. Prevents unintended context resets.
- **Handoff is skill-based** — `/handoff` logic lives in `skills/` layer, not in core providers. Providers just call it.
- **Handoff + reporting are unified** — completion reports from subagents use handoff format, making multi-agent orchestration dense and lossless.
- **MCP servers lazy-loaded** — don't start them until a tool is first invoked. Reduces startup overhead.
- **Agent spawning is a tool** — not a special case. Any provider can call `spawn_agent`, keeps orchestration decoupled.
- **System prompts are config** — providers get role clarity via config, not hardcoded. Clean for multi-provider scenarios.
