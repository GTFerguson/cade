# Multi-Provider Agent Architecture

CADE currently treats Claude Code CLI as a black-box terminal process (PTY-based, raw stdin/stdout, no structured data). This plan makes CADE modular so it can accept any API model as its agent backbone while keeping CC CLI as a cost-effective option.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend                                                        │
│ ┌─────────────┬────────────────────────┬───────────────────────┐│
│ │ File Tree   │ Center Pane            │ Right Pane            ││
│ │             │ ┌────────────────────┐ │ ┌──────────────────┐ ││
│ │             │ │ xterm.js (CC CLI)  │ │ │ Markdown Viewer  │ ││
│ │             │ │ -- OR --           │ │ │ Agent Overview   │ ││
│ │             │ │ Chat Pane          │ │ │                  │ ││
│ │             │ │ (API providers,    │ │ │                  │ ││
│ │             │ │  mertex.md render) │ │ │                  │ ││
│ │             │ └────────────────────┘ │ └──────────────────┘ ││
│ │             │ ┌────────────────────┐ │                       ││
│ │             │ │ Manual Shell       │ │                       ││
│ │             │ │ (always available) │ │                       ││
│ │             │ └────────────────────┘ │                       ││
│ └─────────────┴────────────────────────┴───────────────────────┘│
│                     ↕ WebSocket (JSON)                          │
├─────────────────────────────────────────────────────────────────┤
│ Backend                                                         │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │                                                           │   │
│ │  CC CLI Mode           API Mode (LangChain Agent)         │   │
│ │  ┌───────────────┐     ┌──────────────────────────────┐   │   │
│ │  │ PTY Session   │     │ ┌──────────┐ ┌────────────┐  │   │   │
│ │  │ (existing)    │     │ │ LiteLLM  │ │ Memory     │  │   │   │
│ │  │               │     │ │ (models) │ │ (LangChain)│  │   │   │
│ │  │               │     │ ├──────────┤ ├────────────┤  │   │   │
│ │  │               │     │ │ Tool     │ │ Chat       │  │   │   │
│ │  │               │     │ │ Registry │ │ Session    │  │   │   │
│ │  └───────┬───────┘     │ └──────────┘ └────────────┘  │   │   │
│ │          │              └──────────────┬───────────────┘   │   │
│ │          │                             │                   │   │
│ │          ↓                             ↓                   │   │
│ │  ┌─────────────────────────────────────────────────┐       │   │
│ │  │ CADE Event Bus                                  │       │   │
│ │  │ on_file_edit | on_file_write | on_tool_use      │       │   │
│ │  │ (hooks for CC CLI, built-in for API providers)  │       │   │
│ │  └─────────────────────┬───────────────────────────┘       │   │
│ │                        ↓                                   │   │
│ │  ┌─────────────────────────────────────────────────┐       │   │
│ │  │ CADE Tool Layer                                 │       │   │
│ │  │ FileOps | Shell | Search | Tree                 │       │   │
│ │  │ (reusing existing services)                     │       │   │
│ │  └─────────────────────────────────────────────────┘       │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| LiteLLM for provider normalization | Avoids writing 10+ provider adapters. Handles auth, streaming, retries, fallbacks. 100+ providers supported (Bedrock, Vertex, Anthropic, OpenAI, etc.). |
| LangChain for agent runtime | Provides conversation memory, tool orchestration, and agent loop patterns. Complements LiteLLM -- different layer. |
| CC CLI stays as terminal mode, not wrapped | CC CLI produces raw escape sequences incompatible with structured `ChatEvent` streams. Keep it as a separate mode rather than forcing it through the provider abstraction. The shared contract lives at the event layer, not the provider layer. |
| Chat pane replaces claude terminal in center pane | API responses are structured text, not terminal escape sequences. Chat pane renders in the center where xterm.js normally lives. mertex.md's `StreamRenderer` handles streaming markdown. Manual shell remains accessible via the existing toggle. |
| Unified event bus for both modes | CC CLI triggers side-effects via PostToolUse hook scripts; API mode fires events directly from the agent loop. Both feed into the same CADE event bus (`on_file_edit`, `on_file_write`, `on_tool_use`) so viewer updates, tree refreshes, and agent orchestration work identically regardless of mode. |
| Tools built on existing CADE services | Backend already has file ops (`backend/files/`), PTY (`backend/terminal/`), file watching (`backend/files/watcher.py`). We wrap them, not replace them. |
| WebSocket protocol extended, not replaced | New message types coexist with existing terminal I/O messages. Same connection handles both provider types. |

## Current Integration Points (What Exists Today)

For context on what we're building on top of:

- **PTY-based CC CLI**: Shell spawned via `PTYManager`, `claude\n` auto-typed into stdin
- **Startup detection**: Hardcoded escape sequence matching (`\x1b[?1049h`, Claude logo chars)
- **PostToolUse hook**: Installed into `~/.claude/settings.json`, fires on `Edit|Write`, sends file path to `/api/view`
- **Plan file routing**: `cc_session_resolver.py` reads CC's `~/.claude/history.jsonl` to map session slugs to projects
- **Dual terminal**: Each tab has `claude` terminal + `manual` shell terminal
- **Session persistence**: Sessions survive WebSocket disconnects (24hr TTL, 512KB scrollback)
- **No structured output parsing**: Everything is raw terminal escape sequences passed through to xterm.js

---

## Phase 1: Provider Abstraction + Chat UI Foundation

**Goal:** Establish the provider interface, wire up LiteLLM for model calls, build a basic chat rendering pane using mertex.md. No tools yet -- just conversation with streaming.

### Backend: `backend/providers/` Module

API provider abstraction (CC CLI stays as existing PTY mode, not wrapped):

- `base.py` -- `BaseProvider` ABC defining the contract:
  - `stream_chat(messages, tools?, system_prompt?) -> AsyncIterator[ChatEvent]`
  - `get_capabilities() -> ProviderCapabilities` (supports tools, vision, etc.)
  - Provider metadata (name, model, cost info)
- `api_provider.py` -- `APIProvider` using LiteLLM for direct API calls (Bedrock, Vertex, Anthropic, OpenAI, etc.)
- `registry.py` -- `ProviderRegistry` for discovering and selecting providers
- `config.py` -- Provider configuration (API keys, endpoints, model IDs, region)

### Backend: `backend/events/` Module

Unified event bus so both modes trigger the same side-effects:

- `bus.py` -- `EventBus` with typed events (`on_file_edit`, `on_file_write`, `on_tool_use`)
- CC CLI path: PostToolUse hook script → HTTP `/api/view` → event bus
- API path: agent loop tool execution → event bus (directly, no hook scripts)
- Subscribers: file viewer updates, file tree refresh, agent orchestration

### Backend: `backend/chat/` Module

Conversation management:

- `session.py` -- `ChatSession` managing message history, streaming state
- `events.py` -- `ChatEvent` types: `TextDelta`, `ToolUse`, `ToolResult`, `Error`, `Done`
- LangChain `ConversationBufferMemory` / `ConversationSummaryMemory` for context management

### WebSocket Protocol Extensions

New message types (coexist with existing terminal I/O):

| Message | Direction | Purpose |
|---------|-----------|---------|
| `chat-message` | client -> server | User sends message to API provider |
| `chat-stream` | server -> client | Streaming response chunks (text, tool calls, status) |
| `chat-history` | server -> client | Replay conversation on reconnect |
| `provider-switch` | client -> server | Switch active provider for a tab |
| `provider-list` | server -> client | Available providers and capabilities |

### Provider Configuration

`~/.cade/providers.toml` (consistent with existing `~/.cade/` config location):

```toml
[providers.bedrock]
type = "api"
model = "bedrock/anthropic.claude-sonnet-4-20250514"
region = "us-east-1"

[providers.anthropic]
type = "api"
model = "anthropic/claude-sonnet-4-20250514"
api_key = "${ANTHROPIC_API_KEY}"   # env var references for secrets

[providers.gemini]
type = "api"
model = "vertex_ai/gemini-pro"
project = "my-gcp-project"

[providers.claude-code]
type = "cli"
auto_start = true

[defaults]
provider = "bedrock"
```

### Frontend: `frontend/src/chat/` Module

Chat UI (new module):

- `chat-pane.ts` -- Main chat container, replaces terminal pane when using API providers
- `message-renderer.ts` -- Renders messages using mertex.md (markdown to HTML)
- `chat-input.ts` -- User input area (textarea with keybindings, shift+enter for newlines)
- `stream-handler.ts` -- Handles `chat-stream` events, appends to active message, triggers re-render
- `tool-call-renderer.ts` -- Renders tool calls inline (collapsible, shows input/output)

### Frontend: Provider Selector

- Provider indicator in tab bar or status area
- Quick-switch keybinding (e.g. `Ctrl-a + p`)
- Per-tab provider selection

### Frontend: TerminalManager Update

- When provider type is `cli`: show xterm.js as today
- When provider type is `api`: show the chat pane instead
- Manual shell terminal remains accessible via existing `[claude]/[shell]` toggle

### Dependencies Added

- **Python:** `litellm`, `langchain-core`, `langchain-community`
- **Frontend:** None new -- mertex.md and existing rendering infra is sufficient

---

## Phase 2: Tool System

**Goal:** Enable the API provider to perform agentic actions -- read/write files, run commands, search code. Built on CADE's existing backend services.

### Backend: `backend/tools/` Module

Tool definitions wrapping existing CADE services:

- `base.py` -- `BaseTool` ABC: `name`, `description`, `parameters_schema`, `execute(params) -> ToolResult`
- `file_read.py` -- Read file contents (wraps `backend/files/operations.py`)
- `file_write.py` -- Write/create files (wraps existing file ops)
- `file_edit.py` -- String replacement editing (similar to Claude Code's Edit tool)
- `shell_exec.py` -- Run shell commands via PTY (wraps `backend/terminal/`)
- `file_search.py` -- Glob and grep (wraps existing file tree + subprocess ripgrep)
- `list_directory.py` -- List directory contents (wraps `backend/files/tree.py`)
- `registry.py` -- `ToolRegistry` for tool discovery, schema generation for LLM tool-use format

### LangChain Tool Integration

- CADE tools wrapped as LangChain `Tool` objects
- Tool schemas auto-converted to provider-expected format
- Tool execution results streamed back through chat event system
- Tool call/result pairs included in conversation history

### Agent Loop: `backend/chat/agent.py`

The core agentic loop:

1. Receive user message
2. Call LLM with tools via LiteLLM
3. If LLM returns tool calls, execute them, feed results back
4. Continue until LLM produces a final text response
5. Stream everything to frontend via `chat-stream` events

### Frontend: Tool Call Rendering

Expand `tool-call-renderer.ts`:

- Show tool name + params inline in the conversation
- Collapsible tool results (file contents, command output)
- Syntax-highlighted code in tool results (reuse `code-highlight.ts`)
- Visual indicators for running/completed/failed tool calls
- File edit diffs rendered visually

### Frontend: Viewer Integration

When the agent edits/writes a file, push it to the right-pane viewer. Same behavior as the current hook system does for CC CLI, but now built-in rather than requiring an external hook script.

---

## Phase 3: Deep CADE Integration

**Goal:** Features that leverage our direct control over the agent runtime -- things we can do better than CC CLI because we own the full stack.

### Built-in Hook System

Since we own the agent loop, fire events directly (no external hook scripts needed for API providers):

- `on_tool_use(tool_name, params, result)` -- triggers viewer updates, file tree refresh
- `on_message_complete(message)` -- triggers plan file updates
- `on_error(error)` -- centralized error handling

### System Prompt Management

Per-project system prompts:

- Auto-include `CLAUDE.md` / project rules as system context
- Custom instructions per provider in `providers.toml`
- Project-aware context injection (file tree summary, recent changes)

### Conversation Persistence & Agent Memory

Save/restore conversations, building toward the broader agent memory system described in [[agent-memory]]:

- Conversations stored per-project (like CC CLI's `~/.claude/` history)
- Resume previous conversations across sessions
- Conversation branching (fork from a point in history)
- Session continuity -- agent retains awareness of prior sessions and decisions
- Knowledge extraction -- insights from conversations feed into project docs (see [[agent-memory#Knowledge Base]])

### Cost Tracking

LiteLLM provides token usage, so we can:

- Real-time cost display per conversation
- Per-provider cost tracking
- Budget alerts / limits

### Agent Orchestration

Multi-agent with any provider (detailed design in [[agent-orchestration]]):

- Extend existing `AgentManager` to spawn API-based agents (not just CC CLI terminals)
- CC CLI agents communicate via terminal I/O; API agents via structured `ChatEvent` messages
- The orchestrator pattern from [[agent-orchestration]] adapts to both -- the event bus normalizes side-effects so a CC CLI worker and an API worker can coexist in the same orchestration
- Agent-to-agent communication through structured messages
- UI: stacked agent panes (see [[agent-orchestration#UI Design]])

---

## Phase 4: Advanced Features (Future)

- **Model routing** -- Automatic model selection based on task complexity
- **Hybrid mode** -- CC CLI for some tasks, API for others, in the same project
- **Custom tool plugins** -- Users define tools in project config
- **MCP server support** -- For API providers (CC CLI has its own MCP support)
- **Vision support** -- Image input for providers that support it (screenshots, diagrams)

---

## Risk Areas

### LangChain Scope Creep

`langchain-core` is lightweight and gives us tool abstractions, memory, and the agent loop without overhead. The risk is pulling in `langchain-community` or the full ecosystem for convenience and ending up with heavy transitive dependencies. Stick to `langchain-core` + `langchain-community` only for specific provider integrations we actually need.

### Tool Parity With CC CLI

Claude Code's tool implementations are mature (especially file editing with fuzzy matching). Our tools will be simpler initially. Document the gaps and iterate.

### Streaming Complexity

The agent loop (LLM -> tool call -> execute -> LLM -> ...) needs to stream each stage to the frontend in real-time. Requires careful async event design.

### Context Window Management

Long conversations with large file contents can exceed context limits. LangChain's memory abstractions help, but we'll need to tune summarization strategies per model.

---

## Existing Infrastructure to Leverage

Key components already in the codebase that the chat UI builds on:

| Component | Location | Use |
|-----------|----------|-----|
| `StreamRenderer` | mertex.md | Streaming markdown render with cursor — handles chunk-by-chunk append, incremental re-render |
| `IncrementalContentRenderer` | mertex.md | Efficient full-replace HTML strategy, avoids DOM mutation fragility |
| `StreamingMathRenderer` | mertex.md | KaTeX formula hashing, only re-renders new math — critical for streaming |
| `MarkdownViewer` | `frontend/src/markdown/markdown.ts` | Reference implementation for mertex.md integration, wiki-links, frontmatter |
| `AgentManager` | `frontend/src/agents/agent-manager.ts` | Message routing by session key, adaptive flush buffering, pending output queuing |
| `Component` / `PaneKeyHandler` | `frontend/src/types.ts` | Interface contracts for pluggable pane components |
| `RightPaneManager` | `frontend/src/right-pane/` | Pane mode switching pattern (markdown/neovim/agents) |
| `WebSocketClient` events | `frontend/src/platform/websocket.ts` | Type-safe event emitter, extensible for new message types |
| Wiki-link extension | `frontend/src/markdown/wiki-links.ts` | Pattern for custom marked.js syntax — adaptable for @mentions, tool-call blocks |

No new frontend dependencies needed. The chat pane is essentially a `MarkdownViewer` variant with an input area and streaming message handling.

---

## Related Plans

- [[agent-orchestration]] -- Multi-agent coordination, stacked panes, orchestrator pattern. Phase 3 agent orchestration builds on this.
- [[agent-memory]] -- Session continuity, knowledge base, project-aware context. Phase 3 conversation persistence is a component of this broader system.
- [[state-management-refactor]] -- Frontend state machine extraction. Chat pane state (idle/streaming/tool-executing/error) follows the same pattern.
- [[hook-improvements]] -- Dynamic port configuration for hooks. The unified event bus in this plan supersedes hook scripts for API providers.
