---
title: CADE Data Flow
created: 2026-04-24
updated: 2026-04-24
status: active
tags: [architecture, data-flow, sequences]
---

# Data Flow

Major data flows through CADE, from user input to system response.

## 1. WebSocket Connection & Authentication

When the frontend opens, it establishes a WebSocket connection to the backend and negotiates a project session.

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as WebSocket Handler
    participant AUTH as Auth Module
    participant PTY as PTY Manager
    participant FS as File System

    B->>WS: GET /ws?token=...&project=...
    WS->>AUTH: validate token
    AUTH-->>WS: ok / 401

    WS->>PTY: spawn_session(project_dir)
    PTY-->>WS: session_id, scrollback

    WS->>FS: scan file tree
    FS-->>WS: FileNode[]

    WS-->>B: CONNECTED {workingDir, config, providers, sessionId}
    WS-->>B: SESSION_RESTORED {scrollback} (if resumed)
    WS-->>B: FILE_TREE {data}
```

If the session ID matches an existing PTY session, scrollback is replayed and the Claude Code process continues without interruption. A new project path triggers a fresh PTY spawn.

---

## 2. Terminal I/O

The primary Claude terminal is a PTY running `claude` (or a user-configured shell). Input and output flow as raw bytes.

```mermaid
sequenceDiagram
    participant B as Browser (xterm.js)
    participant WS as WebSocket Handler
    participant PTY as PTY Manager
    participant CC as Claude Code CLI

    B->>WS: INPUT {data: "\r", sessionKey: "claude"}
    WS->>PTY: write(data)
    PTY->>CC: stdin bytes

    loop PTY output loop
        CC->>PTY: stdout bytes
        PTY->>WS: read()
        WS->>B: OUTPUT {data: "...", sessionKey: "claude"}
        B->>B: xterm.write(data)
    end
```

The output loop runs as a long-lived async task for each session key (claude / manual). Resize messages (cols, rows) are forwarded as PTY window size changes.

---

## 3. Chat Message → LLM Streaming

Sending a chat message opens a provider stream and fans chat events to the client in real time.

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as ConnectionHandler
    participant PROV as Provider (e.g. ClaudeCodeProvider)
    participant CC as Claude CLI

    B->>WS: CHAT_MESSAGE {content: "refactor X"}

    WS->>WS: compose_prompt(mode)
    WS->>PROV: stream_chat(messages, system_prompt)

    PROV->>CC: spawn subprocess with --output-format stream-json

    loop Streaming
        CC-->>PROV: NDJSON event line
        PROV-->>WS: TextDelta / ThinkingDelta / ToolUseStart / ToolResult / ChatDone
        WS-->>B: CHAT_STREAM {event: "text-delta", content: "..."}
    end

    WS-->>B: CHAT_STREAM {event: "done"}
    WS->>WS: append to ChatSession history
```

`ThinkingDelta` events (extended thinking / reasoning tokens) are forwarded as a separate stream type and rendered in a collapsible block by the chat pane.

---

## 4. Tool Use with Permission Gate

When the LLM calls a file-editing tool, the request passes through permission checks before execution.

```mermaid
sequenceDiagram
    participant CC as Claude Code CLI
    participant HOOK as Permission Hook (HTTP)
    participant PERM as PermissionManager
    participant B as Browser
    participant FS as File System

    CC->>HOOK: POST /api/permissions/prompt-and-wait {tool, path}

    HOOK->>PERM: request_approval(tool, path)

    alt Category toggle ON (auto-allow)
        PERM-->>HOOK: approved
    else Path already cached
        PERM-->>HOOK: approved (from cache)
    else Requires interactive approval
        PERM->>B: PERMISSION_REQUEST {requestId, tool, path}
        B->>B: Show approval modal
        B->>HOOK: POST /api/permissions/approve/{requestId}
        HOOK->>PERM: resolve(approved)
        PERM->>PERM: cache path directory
        PERM-->>HOOK: approved
    end

    HOOK-->>CC: {approved: true}
    CC->>FS: edit file
    CC-->>PERM: tool result (via stream)
```

If the user denies, `ClaudeCodeProvider` receives `{approved: false}` and the tool call fails gracefully, which Claude Code handles by reporting the denial in its response.

---

## 5. File Change → Hook → Viewer

When Claude Code edits a file, a `PostToolUse` hook fires and CADE displays the result in the viewer pane.

```mermaid
sequenceDiagram
    participant CC as Claude Code CLI
    participant HOOK as Hook Script (~/.cade/hooks/)
    participant API as /api/view
    participant WS as ConnectionHandler
    participant B as Browser

    CC->>CC: edit file (e.g. docs/plans/foo.md)
    CC->>HOOK: PostToolUse hook stdin (JSON with file path)

    HOOK->>HOOK: read ~/.cade/port
    HOOK->>API: POST /api/view {path: "docs/plans/foo.md"}

    API->>WS: broadcast VIEW_FILE
    WS->>B: VIEW_FILE {path, content, fileType, isPlan}
    B->>B: render in markdown viewer overlay
```

The hook filter (configurable via `.cade/hook-filters.json`) controls which file paths trigger the viewer — either plan files only (`plans/**/*.md`) or all edits.

---

## 6. Agent Orchestration

Spawning an AI sub-agent follows a two-gate approval flow before the agent runs.

```mermaid
sequenceDiagram
    participant ORCH_CC as Orchestrator (ClaudeCodeProvider)
    participant ORCH_M as OrchestratorManager
    participant B as Browser
    participant AGENT as Agent (ClaudeCodeProvider)
    participant FS as File System

    ORCH_CC->>ORCH_M: spawn_agent(name, task, mode)
    ORCH_M->>ORCH_M: create AgentRecord (PENDING)
    ORCH_M->>B: AGENT_SPAWNED {agentId, name, task, mode}

    B->>B: Show approval card
    B->>ORCH_M: POST /api/orchestrator/approve/{agentId}

    ORCH_M->>AGENT: start ClaudeCodeProvider subprocess
    ORCH_M->>ORCH_M: AgentRecord → RUNNING
    ORCH_M->>B: AGENT_STATE_CHANGED {state: "running"}

    loop Agent streaming
        AGENT-->>ORCH_M: ChatEvent (TextDelta, ToolUseStart, etc.)
        ORCH_M-->>B: CHAT_STREAM (forwarded to owner connection only)
    end

    AGENT-->>ORCH_M: ChatDone with report
    ORCH_M->>ORCH_M: AgentRecord → REVIEW
    ORCH_M->>B: AGENT_STATE_CHANGED {state: "review", report: "..."}

    B->>B: Show report approval card
    B->>ORCH_M: POST /api/orchestrator/approve-report/{agentId}
    ORCH_M->>ORCH_M: AgentRecord → COMPLETED
    ORCH_M->>ORCH_CC: unblock await_completion()
    ORCH_CC->>ORCH_CC: continue orchestrator task
```

Output from the agent is sent **only** to the connection that spawned the orchestrator. This prevents cross-project leakage when multiple browser tabs are open to different projects.

---

## 7. Dashboard Data Polling

The dashboard hot-reloads from YAML config and polls data sources on configurable intervals.

```mermaid
sequenceDiagram
    participant FS as File System
    participant DH as DashboardHandler
    participant REST as REST Endpoint
    participant WS as ConnectionHandler
    participant B as Browser

    B->>WS: DASHBOARD_GET_CONFIG
    WS->>DH: get_config()
    DH->>FS: read .cade/dashboard.yml
    DH-->>WS: DashboardConfig
    WS-->>B: DASHBOARD_CONFIG

    loop Per data source refresh interval
        DH->>FS: scan directory (parse frontmatter)
        DH->>REST: GET endpoint (JSON array)
        DH->>WS: broadcast updated data
        WS-->>B: DASHBOARD_DATA {sources: {...}}
    end

    FS->>DH: .cade/dashboard.yml changed (watchfiles)
    DH->>DH: reload config
    DH->>WS: broadcast new config
    WS-->>B: DASHBOARD_CONFIG (hot reload)
```

---

## 8. Session Restore on Reconnect

When a browser tab reconnects (e.g. after a network blip), CADE restores the existing PTY session without restarting Claude Code.

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as New ConnectionHandler
    participant SESS as Session Registry
    participant PTY as PTY Manager
    participant CHAT as ChatSession

    B->>WS: WebSocket connect
    WS->>WS: authenticate

    B->>WS: SET_PROJECT {path, sessionId}
    WS->>SESS: lookup(sessionId)
    SESS-->>WS: existing PTY session

    WS->>PTY: attach(session)
    PTY-->>WS: scrollback buffer

    WS-->>B: SESSION_RESTORED {scrollback}

    WS->>CHAT: get_history(sessionId)
    CHAT-->>WS: messages[]
    WS-->>B: CHAT_HISTORY {messages}

    Note over WS,PTY: PTY output loop resumes, Claude Code unaffected
```

## See Also

- [[overview|Architecture Overview]]
- [[components|Component Inventory]]
- [[../technical/reference/websocket-protocol|WebSocket Protocol Reference]]
- [[../technical/core/agent-orchestration|Agent Orchestration]]
