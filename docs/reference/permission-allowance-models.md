---
title: Permission Allowance Models for LLM Agents
created: 2026-04-28
tags: [research, security, permissions]
---

# Permission Allowance Models for LLM Agents

## Overview

LLM agents combine large language models with external tools, APIs, and autonomous planning capabilities. Unlike traditional software that executes predetermined instructions, agents can dynamically decide actions based on context, making traditional security assumptions insufficient. This document surveys capability-based and mode-based permission models for securing LLM agentic systems, with implementation notes for CADE's PermissionManager.

## Threat Model: What Are We Protecting Against?

### Attacker Classes

The agentic AI security literature identifies several adversary classes (Dehghantanha et al., 2026, *SoK: Attack Surface of Agentic AI*):

| Class | Capability | Example |
|-------|------------|---------|
| **External Attacker** | No special access; issues prompts or provides malicious links | Direct prompt injection, jailbreaks |
| **Malicious Content Provider** | Controls data the agent retrieves | Indirect prompt injection via web pages, PDFs |
| **Supply-Chain Attacker** | Compromises dependencies, plugins, or model weights | Trojaned packages, poisoned RAG indices |
| **Compromised API/Service** | Controls third-party services the agent uses | Abusing trust the agent places in connected services |

### Attack Surfaces

Building on the taxonomy from (Dehghantanha et al., 2026), agentic systems expose these attack surfaces:

1. **AS1: User input** — direct prompts containing malicious instructions
2. **AS2: Retrieved content** — indirect prompt injection from external sources
3. **AS3: Tool call serialization** — parameter smuggling through tool schemas
4. **AS4: Sandbox boundary** — escape attempts from execution isolation
5. **AS5: File I/O** — path traversal, polyglot file abuse
6. **AS6: API token scope** — over-privileged tokens enabling lateral movement
7. **AS7: Indexer** — RAG corpus poisoning during ingestion
8. **AS8: Retriever** — adversarial embeddings, IDOR-like retrieval
9. **AS9: Long-term memory** — poisoning via reflection loops
10. **AS10: Audit/telemetry** — tampering with logging infrastructure

### Attack Goals (G1–G7)

From (Dehghantanha et al., 2026):

- **G1: Data Exfiltration** — Extract sensitive information the agent can access
- **G2: Integrity Subversion** — Induce policy-violating outputs or actions
- **G3: Privilege Escalation** — Leverage agent privileges for unauthorized access
- **G4: Resource Abuse/DoS** — Exhaust quotas, run up bills ("Denial of Cash")
- **G5: Fraud/Financial Harm** — Unauthorized transactions or phishing generation
- **G6: Persistence/Backdoor** — Establish durable control via memory poisoning
- **G7: Supply-Chain Compromise** — Tamper with model weights or dependencies

### Privilege Escalation Paths

Key attack paths (Dehghantanha et al., 2026):

- **P1: Direct prompt → tool misuse** — Crafted input induces harmful tool command
- **P2: Indirect content → LLM → tool** — Malicious instructions in retrieved content cause policy-violating tool calls
- **P3: Cross-tool pivot** — One tool prepares conditions for another (e.g., code exec → staged payload)
- **P4: Index poisoning → query → response** — Poisoned corpus yields misgrounding or leakage
- **P5: Multi-agent hop** — Compromised agent propagates malicious messages to peers

### Critical Insight: The LLM is Untrusted

(Lu et al., 2026, *ClawLess*) establishes two fundamental assumptions:

> **Assumption of Capabilities**: AI agents are capable of conducting sophisticated attacks against any security mechanisms.

> **Assumption of Maliciousness**: AI agents will eventually be lured to become malicious due to exposure to unsanitized information.

This means permission systems must **not rely on the agent's cooperation**. Security enforcement must be external to the agent's decision-making.

## Capability Model Design Patterns

### CapTables and Capability Objects

Capability-based security (Dennis & Chang, 1976; Levy, 1984) provides the theoretical foundation. A **capability** is an opaque, tamper-proof token that grants access to a specific object with specific permissions. The holder of a capability can only exercise the permissions it encodes — no ambient authority.

For LLM agents, this maps directly:

| Traditional Capability | LLM Agent Analog |
|------------------------|------------------|
| File descriptor | Tool handle |
| Capability token | Scoped API token |
| Object | External service (Gmail, calendar, etc.) |
| Right set | Permission scope (read, write, execute) |

### MiniScope: ILP-Based Least Privilege

(MiniScope, Zhu et al., 2025, UC Berkeley) provides the most concrete implementation pattern for agentic systems:

**Permission Hierarchy Construction**
- Leverage existing OAuth 2.0 scope hierarchies
- If scope `s2` supports all API methods of `s1` plus more, then `s2` is the parent of `s1`
- Results in a tree structure (e.g., Google Calendar forms a tree of height 5)

**ILP Solver for Least Privilege**
- Formulate as Integer Linear Program: minimize total "cost" of selected scopes
- Binary variables `x_v` indicate whether scope node `v` is selected
- Constraints: for every API call in the execution plan, at least one covering scope must be selected
- Dynamically adapts: re-run solver when new permissions are needed, fixing previously granted permissions

**Performance** (MiniScope, Zhu et al., 2025):
- 1–6% runtime overhead vs. unconstrained agent
- 4× fewer user confirmations vs. per-method enforcement
- Identified over-privileged configurations in real ChatGPT and Claude connectors

### AC4A: Resource-Centric Access Control

(AC4A, Sharma & Grossman, 2026, University of Washington) models permissions over *resources* rather than tool calls:

**Core Components**
- **Resource type trees**: Hierarchical structure (`Year::Month::Day::Event`)
- **Resource value specifications**: Concrete values or wildcards (`Year(2026)::Month(?)::Day(15)`)
- **Actions**: Application-defined (`read`, `write`, `create`)
- **Permission checking**: `resource_difference(Need, Have) ⇒ Remaining`

**Key Features**
- Unified enforcement for both API-based and browser-based agents
- Visual blocking at UI level when permissions insufficient
- LLM-assisted permission generation from natural language

**Configuration**
```python
# Example: calendar permissions
resource_type_tree = "Year::Month::Day::Event"
permission = ("Year(2026)::Month(June)::Day(15)", "read")
```

### ClawLess: Formal Security Model with BPF Enforcement

(Lu et al., 2026, *ClawLess*) bridges formal security models with runtime syscall interception:

**Formal Model**
- **Entities**: Files, processes, sockets, devices
- **Scopes**: `Sandbox` (external scripts), `Agent` (the agent itself), `Monitor` (enforcement)
- **Permissions**: `Read`, `write_to_file`, `Append`, `NoExecute`, `Visible`

**Temporal Logic for Dynamic Policies**
- Static policies can be too restrictive (e.g., blocking outbound sockets even when sensitive files were never read)
- Uses Linear Temporal Logic: `Read(ef, Agent, t) ⇒ □¬write_to_file(es, Agent)`
- Meaning: if agent reads sensitive file `ef` at time `t`, it is forever blocked from writing to external socket `es`

**BPF-Based Enforcement**
- User-space kernel (gVisor-based) intercepts syscalls
- Policy compiler translates formal model to concrete syscall rules
- Dynamic policy updates without recompilation

### LangChain Security Patterns

LangChain (2025) provides practical security abstractions:

**Allowed Tool Lists**
- Restrict which tools an agent may invoke
- Per-session or per-task scoping

**Moderation**
- Built-in content moderation hooks
- Output validation before returning results

**Human-in-the-Loop**
- Optional approval gates for sensitive actions
- Configurable per tool or per operation type

### MCP (Model Context Protocol) Authorization

(MCP Specification, 2025) defines a protocol for tool discovery and invocation:

**Security Considerations in MCP**
- Servers expose capabilities; clients select which to enable
- No built-in authorization — delegated to host application
- Tool schemas provide structured interfaces for validation
- Elicitation mechanism allows agents to request user input before executing

## Mode-Based vs Capability-Based: Tradeoffs

### Mode-Based Systems

**Definition**: A small set of discrete operating modes (e.g., `read-only`, `code`, `architect`). The active mode determines which tools are available.

**Advantages**:
- Simple mental model for users
- Easy to audit (mode is a single scalar)
- Low overhead — no per-resource policy evaluation
- Clear defaults

**Disadvantages**:
- Coarse-grained — mode switch is all-or-nothing
- Modes must anticipate all permission combinations users might need
- Difficult to express fine-grained constraints (e.g., "read calendar in June only")

**CADE's current approach**: Mode-based (`architect`, `code`, `review`) with tool-level filtering per mode.

### Capability-Based Systems

**Definition**: Granular, per-resource permissions. A capability grants a specific right (read, write, execute) on a specific resource (file, API, service).

**Advantages**:
- Fine-grained — can express precise constraints
- Principle of least privilege natively enforced
- Composable — capabilities can be combined dynamically
- Supports temporal constraints (e.g., capability expires after N hours)

**Disadvantages**:
- Higher complexity for users and developers
- Policy explosion — N tools × M actions × O resources can be large
- Requires infrastructure to issue, store, and revoke capabilities
- Harder to audit — many capabilities, not one mode

### Comparative Analysis

| Criterion | Mode-Based | Capability-Based |
|-----------|------------|-----------------|
| Granularity | Coarse | Fine |
| User complexity | Low | High |
| Enforcement overhead | Low | Medium-High |
| Least privilege fit | Partial | Native |
| Temporal constraints | No | Yes |
| Audit clarity | High | Medium |
| Implementation cost | Low | High |

### Hybrid Approach

The research suggests a hybrid is optimal for practical systems:

1. **Modes as capability bundles**: Each mode pre-packages a set of commonly-needed capabilities
2. **Capability escalation within modes**: Within a mode, users can grant specific sub-capabilities
3. **Session-based capability grants**: Temporary capabilities scoped to a task or session

MiniScope exemplifies this: it automatically determines minimal required scopes from execution plans, then presents them to users for approval.

## Implementation Notes for CADE's PermissionManager

### Current Architecture

CADE's PermissionManager currently implements:
- Mode-based tool filtering (`architect`, `code`, `review`, `orchestrator`)
- `allow_write` flag driving `--permission-mode` for Claude Code subagents
- Permission gates at file tool boundaries

### Recommended Extensions

Based on the research, the following extensions would strengthen CADE's permission model:

**1. Scoped Tool Capabilities**

Add per-tool capability flags rather than all-or-nothing mode access:

```python
@dataclass
class ToolCapability:
    tool_id: str
    permission: Literal["read", "write", "execute"]
    resource_pattern: str | None  # e.g., "*.py", "/tmp/*"
    expires_at: datetime | None
    session_id: str | None
```

**2. Capability Hierarchy**

Organize tools into a hierarchy similar to MiniScope:

- Base level: atomic tools (`read_file`, `write_file`)
- Aggregate level: capability bundles (`code.write`, `code.read`)
- Policy evaluation traverses hierarchy from specific to general

**3. Dynamic Capability Acquisition**

Follow MiniScope's pattern:
- Agent proposes execution plan
- PermissionManager computes required capabilities
- If new capabilities needed, prompt user for approval
- Session token associates granted capabilities

**4. External Script Sandbox**

Following ClawLess:
- External scripts (e.g., from code execution) should run in a sandboxed subprocess
- Sandboxed subprocess has reduced permission set
- BPF or seccomp-based syscall filtering

**5. Temporal Constraints**

For high-sensitivity operations:
```python
# After reading sensitive file, block network access for this session
Read(file, agent, t) ⇒ □¬write_to_file(network_socket, agent)
```

**6. Audit Logging**

Implement tamper-evident logging:
- Tool calls with argument hashes
- Permission grants/revocations
- Session lifecycle events
- Timestamps with synchronized clock

### Key Files for Reference

| Component | Location | Notes |
|-----------|----------|-------|
| `PermissionManager` | `core/backend/providers/permission_manager.py` | Central authority |
| `ToolRegistry` | `core/backend/providers/types.py` | Tool definitions |
| `APIProvider` | `core/backend/providers/api_provider.py` | Tool filtering loop |
| Orchestrator MCP | `backend/orchestrator/mcp_server.py` | Subagent permission wiring |

### Threat Model Alignment

For CADE's deployment context, the relevant threats from (Dehghantanha et al., 2026):

- **P1 (Direct prompt → tool misuse)**: User could inject malicious instructions via prompts
- **P2 (Indirect content → LLM → tool)**: Files read by agent may contain embedded instructions
- **P5 (Multi-agent hop)**: Orchestrator spawning subagents introduces multi-agent risk

CADE's TCB (Trusted Computing Base) should include:
1. Core model weights and system prompt
2. Tool execution substrate (sandbox, schemas)
3. Credential storage and permission state
4. Audit logging infrastructure

## Key Sources

| Source | Relevance | Evidence Tier |
|--------|----------|--------------|
| Zhu et al., 2025, *MiniScope: A Least Privilege Framework for Authorizing Tool Calling Agents*, UC Berkeley | ILP solver, permission hierarchy construction, mobile-style permission model | A (peer-reviewed, arXiv) |
| Sharma & Grossman, 2026, *AC4A: Access Control for Agents*, U Washington | Resource-centric model, unified API/browser enforcement | A (peer-reviewed, arXiv) |
| He et al., 2024, *Security of AI Agents*, UC Davis | CIA taxonomy for agents, sandbox effectiveness, encryption for privacy | A (peer-reviewed) |
| Dehghantanha et al., 2026, *SoK: The Attack Surface of Agentic AI*, U Guelph | Threat model, attack surfaces, OWASP/ATLAS mapping, defense playbook | A (peer-reviewed, arXiv) |
| Lu et al., 2026, *ClawLess: A Security Model of AI Agents*, SUSTech/HKUST | Formal model, BPF enforcement, temporal logic for dynamic policies | A (peer-reviewed, arXiv) |
| OWASP, 2025, *LLM Top 10* | Industry taxonomy of LLM vulnerabilities | C (industry standard) |
| MITRE ATLAS | AI-specific attack techniques | C (industry standard) |
| MCP Specification, 2025, Linux Foundation | Tool protocol authorization model | C (industry standard) |

## See Also

- [[docs/plans/dynamic-permission-management|Dynamic Permission Management Plan]] — Implementation planning for capability-based extensions
- [[docs/technical/core/provider-architecture|Provider Architecture]] — Tool execution and filtering infrastructure
- [[docs/technical/design/visual-design-philosophy|Visual Design Philosophy]] — UI patterns for permission toggles
- [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — Vulnerability taxonomy
- [MITRE ATLAS Matrix](https://atlas.mitre.org/matrices/ATLAS) — AI attack techniques
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — Tool protocol
