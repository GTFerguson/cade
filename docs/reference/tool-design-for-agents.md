---
title: "Tool Design for LLM-Powered Coding Agents"
created: 2026-04-28
updated: 2026-04-28
status: draft
tags: [tools, llm, tool-use, mcp, security, permissions]
---

# Tool Design for LLM-Powered Coding Agents

> [!NOTE]
> This document grounds tool design patterns in evidence. See [[coding-agent-prompts]] for prompt patterns and [[self-improving-agent-systems]] for agent self-improvement mechanisms.

## Overview

This document synthesizes research on designing tools for LLM-powered coding agents, covering schema standards, error handling, permission models, and the Model Context Protocol (MCP) ecosystem. Tool design directly impacts agent reliability — TOOLSCAN benchmarks show that even leading LLMs exhibit systematic error patterns when schemas are ambiguous or descriptions are insufficient (Kokane et al., 2024, *Salesforce AI Research*).

## 1. Tool Schema Design

### 1.1 OpenAI vs Anthropic Standards

OpenAI and Anthropic have converged on JSON Schema-based tool definitions, but differ in wrapper structures:

| Aspect | OpenAI | Anthropic |
|--------|--------|-----------|
| Wrapper key | `functions` | `tools` |
| Function wrapper | `{"type": "function", "function": {...}}` | Direct `{"name": ..., "description": ..., "input_schema": ...}` |
| Required params | `parameters.required` array | Inline in JSON Schema |
| Enum support | Native | Native |
| Streaming | `tool_calls` with deltas | `tool_use` with stop sequences |

Both support JSON Schema draft-07 for parameter definitions. Best practice: use consistent `description` fields for each parameter — ToolScan found that models frequently hallucinate argument names when descriptions are vague or missing (Kokane et al., 2024).

### 1.2 Common Failure Modes

TOOLSCAN identified seven systematic error patterns in LLM tool-use (Kokane et al., 2024, *Salesforce AI Research*):

| Error Type | Abbrev | Description | Mitigation |
|------------|--------|-------------|------------|
| Insufficient API Calls | IAC | Model stops before completing task | Multi-step prompting, explicit completion criteria |
| Incorrect Argument Value | IAV | Wrong values or missing required args | Enum constraints, `required` enforcement |
| Incorrect Argument Name | IAN | Hallucinated parameter names | Descriptive names, minimal parameters |
| Incorrect Argument Type | IAT | Type mismatches (string vs int) | Strict JSON Schema typing |
| Repeated API Calls | RAC | Looping on same operation | State tracking, explicit step limits |
| Incorrect Function Name | IFN | Calling non-existent tools | Exact tool name matching, allowlist |
| Invalid Format Error | IFE | Malformed output structure | Strict format templates, examples |

**Key finding**: TOOLSCAN showed GPT-4 achieved 71% success rate on tool tasks, while smaller models like Mixtral-8x7b achieved only 10%. API complexity — structurally similar function names within an environment — correlates with lower accuracy (Kokane et al., 2024).

## 2. Tool Naming and Description

Research on MCP server quality reveals critical patterns:

**Naming conventions affect selection accuracy:**
- Structurally similar tool names (e.g., `get_patent_title`, `get_patent_title_and_date`) cause confusion
- Distinct, descriptive names reduce Incorrect Function Name errors
- AutoMCP found that 77% of REST API endpoints could be auto-converted to MCP servers when OpenAPI specs had complete metadata (Mastouri et al., 2025)

**Description quality directly impacts tool selection:**
- Vague descriptions lead to Incorrect Argument Value errors
- Including valid enum values in descriptions improves accuracy
- Example: `{"description": "Get jokes by category. Valid categories: food, work, animals"}` outperforms `{"description": "Get jokes"}`

**Schema design recommendations:**
1. Use kebab-case or snake_case consistently
2. Group related tools under clear namespaces
3. Provide `description` for every parameter with valid options
4. Use `enum` when values are constrained
5. Mark all truly required parameters — models often skip optional ones

## 3. Permission Models for LLM Agents

### 3.1 Claude Code Permission Modes

Claude Code implements a graduated permission model (Anthropic, 2025):

| Mode | Effect | Use Case |
|------|--------|----------|
| `plan` | Read-only operations, no file writes | Architecture review, exploration |
| `auto` | Claude Code decides permissions per action | Interactive development with guardrails |
| `gentle` | Prompts for sensitive operations | Learning/production hybrid |
| `bypassPermissions` | All operations allowed (dangerous) | Trusted automation scripts |
| `dontAsk` | Skip confirmation prompts | Batch operations |

The `plan` mode enforces a deny-first approach — only explicitly safe operations proceed without confirmation.

### 3.2 Capability-Based Security

Research on securing LLM agents identifies several architectural patterns (Beurer-Kellner et al., 2025, *ETH Zurich, Google, Microsoft, IBM, EPFL*):

| Pattern | Description | Security Guarantee |
|---------|-------------|-------------------|
| Action-Selector | LLM acts as switch to predefined calls | Trivially immune to prompt injection |
| Plan-Then-Execute | Form plan before processing untrusted data | Control flow integrity |
| LLM Map-Reduce | Isolated sub-agents process untrusted data | Localized injection impact |
| Dual LLM | Privileged LLM plans; quarantined LLM processes data | No direct untrusted influence |
| Code-Then-Execute | LLM writes formal program | Executable plan with constraints |
| Context-Minimization | Remove user prompt context after request | Reduced injection surface |

**Least-privilege enforcement**: SMCP (Secure MCP) introduces structured identity codes and capability metadata that enforce minimum required permissions per tool invocation (Hou et al., 2026, *Huazhong University of Science and Technology*).

### 3.3 Comparison Table

| System | Model | Key Mechanism |
|--------|-------|---------------|
| Claude Code | Deny-first + ML classifier | Subprocess isolation, permission modes |
| GitHub Copilot | IDE permissions | Editor integration, trust boundaries |
| Roo Code | JVM boundary | IDE permission prompts, sandboxed execution |
| Aider | Git rollback | Version control safety, auto-commit verification |

## 4. Tool Error Handling

### 4.1 Error Schema Best Practices

TOOLSCAN demonstrated that structured feedback dramatically improves recovery (Kokane et al., 2024):

```
ERROR | Invalid argument name {name} for function {tool}
Valid arguments are: {list_of_valid_args}
```

This format:
1. Indicates error type explicitly
2. Shows the invalid input
3. Provides the correct alternatives
4. Enables the model to self-correct in next iteration

**Ablation study finding**: Models with feedback achieved 73% success rate vs 27% without on complex queries (Kokane et al., 2024).

### 4.2 Recovery Patterns

| Pattern | When to Use | Example |
|---------|-------------|---------|
| Immediate retry with corrected params | Single parameter error | Wrong type, missing required |
| Re-plan from error | Multiple or unclear errors | Tool not found, permission denied |
| Fallback to alternative tool | Primary tool unavailable | Rate limit, timeout |
| Escalate to user | Ambiguous or dangerous | File deletion, credential exposure |

**Error schema requirements:**
- Always include `error_code` for programmatic handling
- Provide `suggestion` field when recoverable
- Include `context` about what went wrong
- Return partial results when safe to do so

## 5. Model Context Protocol (MCP)

### 5.1 Architecture

MCP, launched by Anthropic in late 2024, standardizes tool discovery and invocation (Hou et al., 2025, *Huazhong University of Science and Technology*):

**Core components:**
- **MCP Host**: Environment where LLMs run (IDE, desktop assistant)
- **MCP Client**: Bridges LLMs to external resources within the host
- **MCP Server**: Exposes tools, resources, and prompts to clients

**Communication flow:**
1. Client requests available capabilities from server
2. Server returns structured tool manifest with schemas
3. Client selects appropriate tool based on user intent
4. Tool invocation executed via JSON-RPC
5. Results returned through standardized response format

**Discovery mechanism**: Servers advertise capabilities through manifest; clients dynamically adapt without hardcoded tool lists.

### 5.2 Alternatives

| Protocol | Approach | Ecosystem |
|----------|----------|----------|
| MCP | Server-based discovery, JSON-RPC | Anthropic, Cursor, Cloudflare, growing |
| OpenAI function calling | Direct schema, tool_choice | OpenAI models |
| LangChain tools | Adapter pattern, unified interface | LangChain, LangGraph |
| Anthropic tool_use | Native schema, stop sequences | Claude models |
| Google A2A | Agent-to-agent communication | Enterprise multi-agent systems |

A survey of AI agent protocols identifies MCP as the leading context-oriented protocol for tool access, while A2A handles inter-agent communication (Yang et al., 2025, *Shanghai Jiao Tong University*).

### 5.3 Security Considerations

MCP introduces unique security challenges (Hou et al., 2025; SMCP, 2026):

**Threat taxonomy:**
| Category | Threats |
|----------|--------|
| Malicious developers | Namespace typosquatting, tool poisoning, rug pulls |
| External attackers | Installer spoofing, indirect prompt injection |
| Malicious users | Sandbox escape, tool chaining abuse |
| Security flaws | Vulnerable versions, configuration drift |

**Critical risks:**
- MCP servers operate outside traditional permission models
- Tool descriptions can contain hidden malicious instructions (tool poisoning)
- Server allowlists required — untrusted servers can exfiltrate data
- Credential storage in plaintext configuration files

**SMCP enhancements** (Hou et al., 2026):
- Unified digital identity for all protocol participants
- Mutual authentication between client and server
- Continuous security context propagation
- Fine-grained policy enforcement
- Comprehensive audit logging

## 6. Tool Batching and Streaming

### 6.1 Batching Strategies

For large data returns (file reads, search results):

| Strategy | When to Use | Tradeoff |
|----------|-------------|----------|
| Chunked pagination | Known large result sets | More round trips, simpler processing |
| Streaming JSON | Unbounded results | Complex parsing, better UX |
| Summarized preview | Results for LLM consumption | Token savings, potential info loss |
| Cursor-based pagination | Dynamic result sets | State-dependent, scalable |

AutoMCP found that complete OpenAPI contracts could be auto-converted with proper pagination metadata in schemas (Mastouri et al., 2025).

### 6.2 Streaming for Large Responses

| Approach | Latency | Quality | Implementation |
|----------|---------|--------|----------------|
| Full response | High | Complete | Blocking wait |
| Server-sent events | Low initial | Progressive | Streaming API |
| Delta updates | Minimal | Incremental | WebSocket/SSE |

**Recommendation**: Use streaming for user-facing long operations; batch for LLM consumption to avoid token inflation from incremental updates.

## 7. Evidence Summary

| Pattern | Tier | Source |
|---------|------|--------|
| Structured feedback improves recovery by 46 percentage points | Strong (Ablation) | Kokane et al., 2024 |
| API complexity (similar names) correlates with lower accuracy | Strong (Empirical) | Kokane et al., 2024 |
| GPT-4 achieves 71% success vs 10% for Mixtral-8x7b | Strong (Benchmark) | Kokane et al., 2024 |
| 77% of OpenAPI specs auto-convert to MCP with correct metadata | Strong (Empirical) | Mastouri et al., 2025 |
| Deny-first permission model reduces unintended operations | Moderate | Anthropic, 2025 |
| Action-Selector pattern immune to prompt injection | Strong (Formal) | Beurer-Kellner et al., 2025 |
| SMCP reduces 16 threat categories through unified identity | Strong (Design) | Hou et al., 2026 |
| Feedback mechanism critical for error recovery | Strong (Ablation) | Kokane et al., 2024 |

## References

- Beurer-Kellner, L. et al. (2025). *Design Patterns for Securing LLM Agents against Prompt Injections*. ETH Zurich, Google, Microsoft, IBM, EPFL. arXiv:2506.08837
- Hou, X. et al. (2025). *Model Context Protocol (MCP): Landscape, Security Threats, and Future Research Directions*. Huazhong University of Science and Technology. arXiv:2503.23278
- Hou, X. et al. (2026). *SMCP: Secure Model Context Protocol*. Huazhong University of Science and Technology. arXiv:2602.01129
- Kokane, S. et al. (2024/2025). *TOOLSCAN: A Benchmark for Characterizing Errors in Tool-Use LLMs*. Salesforce AI Research. arXiv:2411.13547
- Mastouri, M. et al. (2025). *Making REST APIs Agent-Ready: From OpenAPI to MCP Servers*. University of Michigan-Flint, UNC Wilmington, DePaul University. arXiv:2507.16044
- Yang, Y. et al. (2025). *A Survey of AI Agent Protocols*. Shanghai Jiao Tong University. arXiv:2504.16736

## See Also
- [[coding-agent-prompts]]
- [[self-improving-agent-systems]]
- [[provider-architecture]]
