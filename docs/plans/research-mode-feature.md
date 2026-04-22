---
title: Research Mode Feature — Dynamic Context Switching for LLM Agents
created: 2026-04-22
updated: 2026-04-22
status: planning
---

# Research Mode Feature

Enable agents to dynamically switch execution contexts mid-session, shifting from code generation to literature research to implementation, with each mode providing specialized system prompts, tool access, and documentation workflows.

## Problem

Current CADE modes (plan/code) require fixed context throughout a session. When an agent encounters a design decision requiring evidence (e.g., "What's the best pattern for caching?"), it must:
1. Break context to manually search papers
2. Synthesize findings without proper documentation structure
3. Return to code mode without grounding decisions in research

This creates friction and loses the research-to-implementation pipeline.

## Vision

**Three Primary Modes** (inspired by roocode architecture):

### Mode: `plan`
**System Prompt Focus**: Architecture and design decisions
- Read/write to `docs/plans/` directory
- Tools: Grep, Read, graph queries
- Output: Structured plans with open questions

### Mode: `code`  
**System Prompt Focus**: Implementation and testing
- Read/write source files, run tests
- Tools: Read, Edit, Write, Bash, Bash test
- Output: Working code with commits

### Mode: `research` (NEW)
**System Prompt Focus**: Evidence gathering and knowledge synthesis
- Search and read academic papers (alphaxiv)
- Conduct web research (WebSearch, scout-browse)
- Write findings to `docs/reference/` with citations
- Tools: alphaxiv, WebSearch, Read, Write
- Output: Research docs with PROVEN structure, evidence tiers, citations

## Implementation

### 4.1 Mode Registry

Add to system prompt initialization:

```yaml
modes:
  plan:
    name: "Architect"
    description: "Design and planning mode"
    system_prompt_file: "prompts/mode-plan.md"
    allowed_tools: [Read, Grep, GraphQuery, Write]
    output_directory: "docs/plans/"
    color: "orange"
  
  code:
    name: "Code"
    description: "Implementation and testing mode"
    system_prompt_file: "prompts/mode-code.md"
    allowed_tools: [Read, Edit, Write, Bash, Test]
    output_directory: "."
    color: "green"
  
  research:
    name: "Research"
    description: "Evidence gathering and knowledge synthesis"
    system_prompt_file: "prompts/mode-research.md"
    allowed_tools: [alphaxiv, WebSearch, scout-browse, Read, Write]
    output_directory: "docs/reference/"
    color: "blue"
```

### 4.2 Mode Switching Command

**Syntax**: `/research <topic>` or `/code` or `/plan`

**Behavior**:
1. Agent requests mode switch: "I need to research prompt engineering patterns before implementing the agent."
2. System saves current context (uncommitted work, conversation state)
3. Switches system prompt, available tools, output directory
4. Agent continues with fresh context in new mode
5. Agent can request mode switch back when ready

**Example Workflow**:
```
User: "Add a research mode to CADE agents"
Agent (/plan): Creates docs/plans/research-mode-feature.md with design

User: "Start implementing it"
Agent (/code): Implements mode switching logic, runs tests

Agent: "I need to verify this is using the latest ACE research..."
Agent (/research): Searches for ACE papers, reads Zhang et al. 2025
Agent: Creates docs/reference/agentic-context-engineering.md with findings

Agent (/code): Returns to code mode, implements ACE-inspired context evolution

User: "Ship it"
Agent (/code): Commits, creates PR
```

### 4.3 System Prompt per Mode

**research-mode.md** (new file):
```markdown
# Research Mode System Prompt

You are operating in RESEARCH mode. Your goal is to find, synthesize,
and document evidence-based knowledge using academic sources.

## Available Tools
- alphaxiv embedding/keyword search, paper content retrieval
- WebSearch for practitioner sources and current information
- scout-browse for sites requiring browser automation
- Read/Write for documentation

## Output Structure (PROVEN)

Every research doc you create MUST follow this structure:

1. **Frontmatter**: title, created date, status, tags
2. **Overview**: 1-2 sentence summary of what this doc covers and why
3. **Sections by Topic**: Each major topic gets its own section
4. **Evidence Tiers**: Label every source with its tier:
   - Tier 1: Systematic review / meta-analysis
   - Tier 2: Peer-reviewed empirical study (RCT, cohort)
   - Tier 3: Observational / cohort study
   - Tier 4: Narrative review
   - Tier 5: Practitioner opinion / textbook
5. **References**: Full citation list at end

## Search Strategy

1. **alphaxiv first** (2.5M papers, highest quality)
   - Use embedding_similarity_search for conceptual queries
   - Use full_text_papers_search for keywords/authors
   - Read papers with get_paper_content

2. **WebSearch** for practitioner perspectives and current events

3. **scout-browse** for sites that block bots (Google Scholar, some journals)

## Cross-Linking

Use Obsidian [[wiki-links]] to reference:
- Other docs: [[coding-agent-prompts]]
- Sections: [[coding-agent-prompts#prompt-alchemy]]
- External files: [[../../nkrdn/plans/coding-agent/01-overview.md]]

## When Done

- Save to docs/reference/[topic-name].md
- Update docs/reference/README.md with new entry
- Link from relevant architecture/plan docs
```

### 4.4 Mode Context Preservation

When switching modes:
- **Save**: Current mode's working context (uncommitted changes, conversation state)
- **Load**: Target mode's system prompt, tool set, output directory
- **Link**: Allow agent to reference work across modes ("as I documented in the research phase...")

Implementation: Store mode state in session metadata:
```json
{
  "current_mode": "code",
  "mode_history": [
    {
      "mode": "plan",
      "files_created": ["docs/plans/research-mode-feature.md"],
      "timestamp": "2026-04-22T10:30:00Z"
    },
    {
      "mode": "research", 
      "files_created": ["docs/reference/agentic-context-engineering.md"],
      "timestamp": "2026-04-22T11:00:00Z"
    }
  ],
  "uncommitted_changes": { /* per-mode diffs */ }
}
```

## Connection to ACE (Agentic Context Engineering)

**ACE Principle**: Contexts evolve through incremental updates, not full rewrites.

This maps to mode-based context switching:
- Each mode is a "playbook" (system prompt + tools + output constraints)
- Reflector role: Research mode surfaces evidence
- Curator role: Code mode integrates findings into implementation
- Generator role: Plan mode designs using both

**Evolving Contexts**: When research discovers a better pattern, the agent can:
1. Document in research mode: `docs/reference/pattern-name.md`
2. Reference in plan mode: Update architecture decisions
3. Implement in code mode: Use the pattern
4. Refine in research mode: Follow up on emerging work

This creates a virtuous cycle: research → plan → code → research (refined).

## Success Criteria

- [ ] `/research` command switches mode dynamically
- [ ] Research mode has access to alphaxiv, WebSearch, scout-browse
- [ ] Generated docs follow PROVEN structure with evidence tiers
- [ ] Agent can reference research docs from code mode
- [ ] Mode switching preserves conversation context
- [ ] Example: Agent researches ACE, documents findings, implements ACE-inspired agent
- [ ] No regression in existing plan/code modes

## Related Work

- [[../../../nkrdn/plans/nkrdn-advanced-coding-agent-research.md]] — Agent architecture patterns
- [[../reference/agentic-context-engineering.md]] (created by research mode) — ACE paper summary
- [[../reference/coding-agent-prompts.md#research-mode]] — Prompt engineering for research

## Next Steps

1. **Research Phase** (/research): Study ACE, document findings
2. **Plan Phase** (/plan): Design mode-switching architecture
3. **Code Phase** (/code): Implement `/research` command, mode registry
4. **Validation**: Test mode switching with real research task
