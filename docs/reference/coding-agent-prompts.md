---
title: Prompt Engineering for Coding Agents
created: 2026-04-22
updated: 2026-04-22
status: active
tags: [llm, prompt-engineering, code-generation, agents, context-engineering, ace]
---

# Prompt Engineering for Coding Agents

How to craft effective prompts for large language models to generate high-quality, maintainable code. Research-grounded guidance for agent system prompts, code generation instructions, and quality standards. Includes dynamic context switching via research mode and Agentic Context Engineering (ACE) patterns.

## 1. Effective Prompt Patterns

### 1.1 Prompt Alchemy: Iterative Refinement with Execution Feedback

The most effective approach to prompt engineering combines several key elements:

**Mechanism**: Iteratively refine prompts by:
1. Generating prompt variants (mutation)
2. Executing generated code against test cases  
3. Scoring prompts by pass@1 metric
4. Selecting best variants for next iteration
5. Stopping when convergence is achieved

**Results** (Tier 1: Ye et al., 2025, IEEE TSE):
- **Zero-Shot + Alchemy**: +4.04% on HumanEval, +4.43% on MBPP+
- **CoT + Alchemy**: +4.55% average, +5.52% on HumanEval+
- **Multi-agent systems + Alchemy**: +2.00% baseline improvement, achieves **96.3% on HumanEval** with GPT-4o
- **Code Translation**: +13.68% on Java-to-Python, +8.25% on Python-to-Java
- **Zero regressions across all tested models and datasets**

**Key Design Patterns in Optimized Prompts** (from case analysis):
1. **Role Clarification** — Define the LLM's specific expertise ("code generation assistant specializing in Python")
2. **Goal Definition** — State the task objective clearly ("accurately translate natural language to executable code")
3. **Efficiency Focus** — Emphasize both correctness and non-functional properties
4. **Task-Specific Adaptation** — Guide the model toward edge cases and nuances

**Implementation Guidance**:
- Use weighted scoring (prioritize harder tasks): `weight_j = num_prompts / num_successful_on_task_j`
- Early stopping: Stop if best score unchanged for 3 iterations or max 10 iterations reached
- Training set: 10 reference problems + 10 generated/mutated problems (balanced diversity)
- Generate 10 prompt variants per iteration via LLM mutation ("Please improve this prompt...")

**Why This Works** (Tier 2: empirical evidence):
- Execution-driven feedback ensures prompts target actual code quality, not assumed quality
- Weighted scoring prevents optimization toward easy tasks (bias)
- Iterative refinement discovers emergent prompt structures that manual tuning misses
- Converges quickly (typically 3-5 iterations before plateau)

### 1.2 Zero-Shot Sufficiency for Standard Tasks

**Key Finding** (Tier 1: Della Porta et al., 2025, University of Salerno):
Empirical analysis of 12,045 real ChatGPT prompts shows **no statistically significant difference** in code quality (maintainability, reliability, security) between:
- Zero-shot prompting
- Few-shot prompting  
- Chain-of-Thought
- Persona-based prompting

**Implications**:
- Simple, direct prompts are often sufficient for routine code generation
- Developers can achieve acceptable quality without complex prompt engineering
- Quality gains from structured prompting appear elsewhere (code correctness, edge case handling) rather than static analysis metrics

**Recommendation**: Start with zero-shot; apply prompt refinement (Alchemy) only when quality metrics plateau.

### 1.3 Chain-of-Thought for Complex Reasoning

**When to Use** (Tier 2: White et al., 2023, Vanderbilt):
- Tasks requiring multi-step reasoning or complex logic
- Situations where intermediate steps affect final correctness
- When refactoring or analyzing design tradeoffs

**Pattern**: Instruct the model to "think step-by-step before generating code"

**Synergy with Alchemy** (Tier 1: Ye et al., 2025):
- CoT + Alchemy outperforms standalone CoT by **+4.55%**
- Better stabilization of reasoning steps
- Emergent optimized prompts often incorporate CoT structure even when starting from zero-shot

### 1.4 Few-Shot Learning for Domain-Specific Code

**When to Use** (Tier 2: White et al., 2023):
- Domain-specific languages or patterns
- Proprietary frameworks with non-obvious conventions
- Code translation between languages with significant semantic differences

**Implementation**:
- Include 2-5 representative examples in the prompt
- Ensure examples cover edge cases, not just happy path
- For translation tasks: examples of equivalent patterns across source/target languages

**Note**: Direct quality improvement from few-shot is marginal; value is in disambiguating intent.

---

## 2. Code Quality Standards for Agents

### 2.1 Maintainability Over Cleverness

**Core Principle**: Code must be understandable, not impressive.

**Metrics** (SonarQube, Tier 2: Della Porta et al., 2025):
- **Maintainability Issues** most common in ChatGPT-generated code (mean 0.413 per file)
  - Structure, readability, future adaptability
  - Prompt focus area: "Write code that future developers can easily understand"
- **Reliability Issues** less common (mean 0.095)
- **Security Issues** rare (mean 0.002)

**Implementation Guidance for Agent Prompts**:
1. **Readability**: Variable names, function names, code structure should explain intent
2. **DRY Principle** (Tier 4: established best practice):
   - Extract repeated patterns into functions
   - Use constants for magic numbers
   - Avoid code duplication
3. **SOLID Principles** (Tier 4):
   - Single Responsibility: one function/class = one reason to change
   - Open/Closed: open for extension, closed for modification
   - Liskov Substitution: derived classes must be substitutable
   - Interface Segregation: narrow, specific interfaces
   - Dependency Inversion: depend on abstractions, not concrete implementations
4. **Comments**: Explain *why*, not *what*
   - Code shows what it does; comments explain design decisions
   - Edge cases, workarounds, non-obvious constraints

**Example Prompt Instruction**:
```
Before generating code, identify if there are opportunities to:
1. Extract repeated patterns into helper functions
2. Use constants instead of magic numbers
3. Apply design patterns to improve structure

Generate code that prioritizes clarity and maintainability 
over conciseness. A future developer should understand 
the code without needing external documentation.
```

### 2.2 Code Refactoring Practices

**Impact of Refactoring** (Tier 2: Stevens Institute, 2025):
- Code duplication-aware refactoring significantly improves quality metrics
- Reduces cognitive load for future maintenance
- Prevents bugs through consolidation of logic

**Patterns to Promote in Prompts**:
1. **Extract Method**: Large functions → smaller, focused functions
2. **Extract Variable**: Complex expressions → named variables
3. **Remove Duplication**: Identify and consolidate repeated patterns
4. **Consolidate Conditionals**: Multiple scattered checks → single decision point

**For Agent Prompts**: 
Instruct agents to automatically refactor code before returning results. This is especially valuable since agents can scan the full codebase context, something manual developers often miss.

Example:
```
After generating the code:
1. Scan for any code patterns that repeat 2+ times
2. Extract those into helper functions
3. Review variable names for clarity
4. Consolidate any repeated conditional logic
5. Return the refactored version with comments explaining extraction
```

### 2.3 Design Pattern Application

**Benefit** (Tier 3: Melbourne/Singapore, 2025):
Automatic design pattern detection and summarization improves code understanding and maintainability.

**Common Patterns for Code Generation**:
- **Factory Pattern**: When creating objects with complex initialization
- **Strategy Pattern**: When behavior varies by context
- **Builder Pattern**: When constructing objects with many optional parameters
- **Decorator Pattern**: When adding functionality to existing objects
- **Repository Pattern**: When abstracting data access

**Implementation**:
Include in agent prompts: "Consider whether any design patterns would improve the structure of this code."

---

## 3. Integration with Agent Architecture

### 3.1 Baking Standards into Agent System Prompts

The agent's system prompt should embed these standards as defaults, not post-generation concerns.

**System Prompt Template**:

```markdown
# Code Quality Standards

## Code Generation Rules

### Every generated code block MUST:
1. **DRY**: Identify and extract any repeated patterns (2+ occurrences)
2. **Maintainability**: Use clear variable/function names; explain non-obvious decisions in comments
3. **SOLID**: Follow single responsibility, avoid tight coupling
4. **Refactor**: Review and consolidate before returning
5. **Document**: Include docstrings for functions; comments for *why*, not *what*

### Never:
- Use magic numbers (extract to constants)
- Generate code without considering edge cases
- Ignore error conditions
- Write clever code at the expense of clarity

## Prompt Engineering Guidelines

### When generating code for tasks:
1. First, clarify your role: "I am a senior code generation assistant..."
2. Define the goal clearly: "The objective is to generate... that is..."
3. Consider task-specific nuances: "This code must handle..."
4. Step through complex logic: "Let me think through this step by step..."

### When quality metrics plateau:
1. Propose iterative refinement: "Shall I refine the code to optimize for..."
2. Generate variants and test them
3. Keep the version with highest test pass rate
4. Document the optimization process

## Referenced Standards

See [[#reference-documentation]] for:
- [[proven-system]] — Evidence-based documentation principles
- [[nkrdn-agent-architecture]] — Component-based agent design
```

### 3.2 Documentation File Structure Integration

Embed the project's documentation structure into agent knowledge:

**File Organization Pattern** (from CADE docs):

```
docs/
├── technical/          # Implemented systems
│   ├── core/          # Essential developer docs  
│   ├── reference/     # API documentation
│   └── design/        # Design rationale ("why")
├── future/            # Planned features
└── plans/             # Active development (ephemeral)

docs/reference/
├── code-quality/      # Code standards and metrics
├── architecture/      # System design decisions
└── prompt-patterns/   # Prompt engineering findings
```

**Instruction for Agents**:
```
When generating significant code:
1. Consider whether it needs architecture documentation
2. If implemented system is non-obvious, generate docs/architecture/[system-name].md
3. If design decisions are involved, explain in the doc (not code comments)
4. Link from the plan doc (docs/plans/) to the architecture doc when complete

Use Obsidian [[wiki-links]] for cross-references between docs.
```

### 3.3 PROVEN System Integration

Agents should understand the full evidence hierarchy:

**Embed Briefly** (in system prompt):
```
Code quality decisions are grounded in:

Tier 1: Systematic reviews and meta-analyses (strongest evidence)
Tier 2: Peer-reviewed empirical studies (RCTs, cohort studies)  
Tier 3: Observational studies
Tier 4: Narrative reviews and expert consensus
Tier 5: Practitioner textbooks and opinion

When proposing code patterns, cite the evidence tier.
For example: "SOLID principles (Tier 5: established consensus)" 
vs. "Iterative prompt refinement improves pass@1 by +4% (Tier 1: Ye et al., 2025)"
```

**Link Extensively** (in agent knowledge):
Reference `docs/reference/proven-system.md` for full methodology.

---

## 4. Prompt Library for Common Tasks

### 4.1 Code Refactoring

**System Prompt Instruction**:
```
## Refactoring Task

Before returning refactored code:
1. Identify all duplication (repeated patterns 2+ times)
2. Extract each duplicate into a helper function
3. Consolidate repeated conditionals
4. Review variable names for clarity
5. Apply design patterns where they improve structure

Output:
- Show the original code
- Explain each refactoring step (why it improves the code)
- Show the refactored code
- List the improvements made

Evidence basis: Code duplication-aware refactoring significantly 
improves quality metrics (Stevens Institute, 2025, Tier 2)
```

### 4.2 Code Review for Security

**System Prompt Instruction**:
```
## Security Review Task

When reviewing code for security:
1. Check for input validation (especially user-provided data)
2. Verify no hardcoded secrets (API keys, passwords, tokens)
3. Check for SQL injection vulnerabilities (if using databases)
4. Verify authentication/authorization boundaries
5. Check for sensitive data exposure (logging, error messages)
6. Assess cryptography usage (if applicable)

Output:
- List security concerns found
- Explain each risk
- Provide remediation guidance
- Rate severity (critical/high/medium/low)

Note: Prompt patterns alone don't significantly improve 
security detection (Della Porta et al., 2025). Combine with 
static analysis tools (SonarQube, Semgrep).
```

### 4.3 API Design

**System Prompt Instruction**:
```
## API Design Task

When designing or reviewing APIs:
1. Define clear responsibility (single concern)
2. Use consistent naming across resources
3. Structure endpoints following REST conventions (GET, POST, PUT, DELETE)
4. Design for extensibility (avoid breaking changes)
5. Document all endpoints (OpenAPI/Swagger)
6. Consider versioning strategy

Output:
- List all endpoints with methods and paths
- Define request/response schemas
- Document error responses
- List design decisions and rationale

Apply SOLID principles:
- Single Responsibility: each endpoint does one thing
- Open/Closed: extensible without breaking existing clients
- Dependency Inversion: clients depend on interfaces, not implementations
```

---

## 5. Agentic Context Engineering (ACE) — Evolving Agent Prompts

The newest research on scaling agent systems reveals a critical insight: **prompts should evolve, not be static.**

### 5.1 ACE Principles (Zhang et al., 2025, Tier 1)

**Problem**: Traditional prompt optimization suffers from two issues:
1. **Brevity Bias** — Concise summaries lose critical domain-specific heuristics, tool-use guidelines, edge cases
2. **Context Collapse** — Iterative prompt rewrites gradually degrade into shorter, less informative versions

**ACE Solution**: Treat agent prompts as evolving "playbooks" of itemized bullets, not monolithic text.

**Architecture** (Three-Component Pattern):

```
Generator (current prompt) → generates solutions
    ↓
Reflector → analyzes outcomes, extracts insights
    ↓
Curator → distills lessons into delta bullets
    ↓
(lightweight non-LLM merge) → incremental prompt update
```

### 5.2 Key Mechanisms

**Incremental Delta Updates** (not full rewrites):
- Organize prompt as collection of "bullets" (strategy, heuristic, failure mode, tool tip)
- Each bullet has: unique ID, usage counter (helpful/harmful), semantic embedding
- New insights added as delta deltas; existing bullets updated in-place
- Prevents context collapse; preserves past knowledge

**Grow-and-Refine**:
- Accumulate detailed knowledge without bloat
- Periodically deduplicate via semantic similarity
- Keep context comprehensive (not concise) because long-context LLMs can extract relevance autonomously

**Results** (Tier 1: Zhang et al., 2025):
- **Agent Benchmarks**: +10.6% average improvement (AppWorld, Finance, Medical)
- **Cost Efficiency**: 82-91% reduction in token usage vs. full rewrites
- **Model Agnostic**: Works across GPT, Claude, DeepSeek, Llama
- **Production Performance**: ReAct + ACE matches GPT-4.1-powered agents using smaller open-source models

### 5.3 Implementing ACE in CADE

**System Prompt Structure** (ACE-style):

```markdown
# Agent Playbook

## Code Quality Standards
- DRY: Extract patterns repeating 2+ times
- SOLID: Single responsibility per function
- Error Handling: Cover known failure modes [update with new cases as discovered]
- Testing: Aim for 80%+ coverage

## Domain-Specific Strategies
- Pattern: Factory for object creation (especially useful for [specific domain])
- Tool: SonarQube for quality metrics [improved from user feedback]
- Language quirk: Python list comprehensions over map/filter [observed preference]

## Common Failure Modes (updated from practice)
- [2024-12]: Forgot to validate user input (caught in security review)
- [2026-02]: Hardcoded API keys in config (now using environment variables)
```

**Update Mechanism** (after each significant task):
1. Reflector analyzes what worked/failed
2. Curator produces delta (new bullets, or incremental updates to existing)
3. Non-LLM merge appends to playbook
4. Next task benefits from refined context

### 5.4 Connection to Research Mode

**Virtuous Cycle**:
```
/research (find evidence) → /plan (update architecture) 
    → /code (implement with evidence) 
    → /research (follow-up work, evolve context)
```

Each cycle refines the playbook:
1. **Research Mode**: Discovers new patterns (e.g., "Prompt Alchemy improves code by +4%")
2. **Plan Mode**: Documents findings (e.g., "implement iterative refinement framework")
3. **Code Mode**: Applies them, observes outcomes
4. **Research Mode Again**: Reflects on what actually improved, documents refined insights

This creates self-improving agents: the playbook evolves from practice + evidence, not manual tuning.

---

## 6. Research Mode — Dynamic Context Switching

Agents can dynamically request mode switches to change system context, tools, and output directories mid-session.

### 6.1 Three Primary Modes

**Mode: `/plan` (Architect)**
- System prompt: Design thinking, tradeoff analysis
- Tools: Read, Grep, graph queries
- Output: `docs/plans/`
- Goals: Clarify requirements, identify open questions, propose approaches

**Mode: `/code` (Developer)**
- System prompt: Implementation, testing, quality
- Tools: Read, Edit, Write, Bash, Test
- Output: `.` (source tree)
- Goals: Write working code, run tests, commit changes

**Mode: `/research` (Researcher) — NEW**
- System prompt: Evidence gathering, knowledge synthesis
- Tools: alphaxiv, WebSearch, scout-browse, Read, Write
- Output: `docs/reference/`
- Goals: Find papers, synthesize findings, document with PROVEN structure

### 6.2 Research Mode Workflow

**Trigger**: Agent identifies a design decision requiring evidence.

**Example**:
```
Agent (/code): "I'm about to implement iterative prompt refinement. 
               Let me research the best approach first."

User: "Go ahead"

Agent (/research):
  1. Searches alphaxiv: "prompt engineering code generation"
  2. Reads Zhang et al. (2025) — Prompt Alchemy
  3. Reads Ye et al. (2025) — ACE
  4. Synthesizes findings
  5. Writes docs/reference/prompt-refinement-strategies.md
       - Evidence tiers
       - Citation details
       - Concrete takeaways

Agent (/code):
  6. Returns to code mode
  7. Implements based on research findings
  8. References: "As documented in [[prompt-refinement-strategies]]"
```

### 6.3 System Prompt for Research Mode

```markdown
# Research Mode System Prompt

You are operating in RESEARCH mode. Your goal is to find, synthesize, 
and document evidence-based knowledge using academic sources.

## Search Strategy

1. **alphaxiv first** (2.5M papers)
   - Use embedding_similarity_search for conceptual queries (detailed, multi-sentence)
   - Use full_text_papers_search for keywords/authors
   - Read papers with get_paper_content

2. **WebSearch** for practitioner perspectives

3. **scout-browse** for sites requiring browser automation

## Output Structure (PROVEN)

Every doc MUST follow PROVEN format:
- Frontmatter: title, created, status, tags
- Overview: 1-2 sentence summary
- Sections by topic
- Evidence tiers on every source (Tier 1-5)
- References section with full citations

## Examples of Good Research Output

- [[../reference/coding-agent-prompts.md]] — Prompt engineering research
- [[../reference/agentic-context-engineering.md]] — ACE paper summary
- [[../reference/proven-system.md]] — Full PROVEN methodology

Use these as templates when writing new research docs.

## Cross-Linking

Use Obsidian [[wiki-links]]:
- Other docs: [[other-doc-name]]
- Sections: [[other-doc#section]]
- External files: [[../../../other-project/path/file.md]]
```

---

## 7. Implementation Checklist for Agent Builders

When building coding agents, ensure:

### Prompt Design
- [ ] System prompt embeds code quality standards (Section 3.1)
- [ ] Prompt instructions include role clarification, goal definition, efficiency focus
- [ ] Agent can execute generated code for feedback (enables Alchemy approach)
- [ ] Iterative refinement is available as a capability ("refine", "optimize")
- [ ] System prompt organized as ACE "playbook" — itemized bullets, not monolithic (Section 5)

### Quality Assurance
- [ ] Static analysis tool integration (SonarQube, Semgrep, ESLint, etc.)
- [ ] Test execution framework (run generated code against test cases)
- [ ] DRY detection (scan for code duplication)
- [ ] Code review checklist (security, maintainability, design patterns)

### Documentation & Evidence
- [ ] System prompt explains evidence basis for standards with citations
- [ ] Agent understands file organization structure (docs/technical, docs/plans, docs/reference)
- [ ] Agent can generate architecture docs for significant code
- [ ] Agent can request research mode to find evidence for design decisions
- [ ] Research docs follow PROVEN format with evidence tiers

### Dynamic Context (ACE-inspired)
- [ ] Agent can request mode switches: `/research`, `/code`, `/plan`
- [ ] Each mode has dedicated system prompt, tool set, output directory
- [ ] Mode state preserved when switching (uncommitted changes saved)
- [ ] Agent can reference work across modes via wiki-links

### Feedback Loop (ACE)
- [ ] Agent receives pass@1 metrics for generated code
- [ ] Agent reflects on failures and generates delta insights
- [ ] Successful patterns added to prompt as new bullets
- [ ] Context evolves incrementally (not rewritten wholesale)
- [ ] Results feed back into system prompt tuning

---

## 8. References

### Academic Papers (Evidence Tier 1-2)

**Agentic Context Engineering:**
- **Zhang, Q., Hu, C., Upasani, S., Ma, B., Hong, F., Kamanuru, V., Rainton, J., Wu, C., Ji, M., Thakker, U., Li, H., Zou, J., Olukotun, K. (2025).** "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models." *Stanford University, SambaNova Systems, UC Berkeley*. Proposes playbook-style context evolution with incremental delta updates. Demonstrates +10.6% average improvement on agent benchmarks, 82-91% reduction in token usage, model-agnostic performance gains.

**Prompt Engineering & Code Generation:**
- **Ye, S., Sun, Z., Guo, L., Wang, G., Li, Z., Liang, Q., Liu, Y. (2025).** "Prompt Alchemy: Automatic Prompt Refinement for Enhancing Code Generation." *IEEE Transactions on Software Engineering*, Vol. 14, No. 8. Demonstrates +4-14% improvement through iterative execution-driven prompt refinement with weighted scoring and early stopping.

- **Della Porta, A., Lambiase, S., Palomba, F. (2025).** "Do Prompt Patterns Affect Code Quality? A First Empirical Assessment of ChatGPT-Generated Code." *University of Salerno, Qual-AI project*. Empirical study of 12,045 prompts showing no statistically significant difference in static quality metrics (maintainability, reliability, security) across prompt patterns; zero-shot sufficiency for standard tasks.

- **White, J., Hays, S., Fu, Q., Spencer-Smith, J., Schmidt, D. C. (2023).** "ChatGPT Prompt Patterns for Improving Code Quality, Refactoring, Requirements Elicitation, and Software Design." *Vanderbilt University*. Catalog of 15+ prompt patterns with applications to software engineering tasks; role clarification, goal definition, step-by-step reasoning.

**Code Quality & Refactoring:**
- **Stevens Institute of Technology (2025).** "An Empirical Study on the Impact of Code Duplication-aware Refactoring Practices on Quality Metrics." Evidence that refactoring improves quality metrics significantly; duplication-aware techniques more effective than prompt engineering alone.

- **Ye, H., Foo, H., Lu, Z., Zhang, Z., Ye, Q., Zhou, C., Li, Z. (2025).** "Detecting Essence Code Clones via Information Theoretic Analysis." *Fudan University, SMU, Nanyang Tech, Huazhong University*. Code duplication detection methods; DRY violations as primary quality metric in ChatGPT output (second to maintainability).

### Best Practices (Evidence Tier 4-5)

- **SOLID Principles** — Established consensus in object-oriented design (Martin, 2000s)
- **DRY (Don't Repeat Yourself)** — Industry standard for code maintainability (Hunt & Thomas, 1999)
- **Design Patterns** — Reusable solutions to common problems (Gang of Four, 1994; Alexander, 1977)
- **Code Review Standards** — OWASP Top 10 (security), Google/Airbnb style guides (readability)

### Internal References

- [[../architecture/agent-system]] — CADE agent architecture
- [[../../../nkrdn/plans/nkrdn-advanced-coding-agent-research.md]] — nkrdn agent system design
- [[../../../nkrdn/plans/coding-agent/01-overview.md]] — Detailed coding agent architecture
- [[../../plans/research-mode-feature.md]] — Implementation plan for research mode and dynamic context switching

---

## See Also

- [[proven-system]] — Full PROVEN methodology for research-grounded documentation
- [[agentic-context-engineering]] (created by research mode) — Detailed ACE paper summary with implementation examples
- [[code-quality-metrics]] (planned) — Detailed metric definitions and tools
- [[llm-limitations]] (planned) — Known failure modes and mitigation strategies
- `/research` — Research mode command for evidence gathering
