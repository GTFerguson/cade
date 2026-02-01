---
title: Agent Memory & Knowledge Base
created: 2026-01-31
updated: 2026-01-31
status: exploratory
tags: [agents, memory, knowledge-base, concept]
---

# Agent Memory & Knowledge Base

> [!NOTE]
> This is an exploratory concept that needs further development and clarification, especially around how it relates to existing project documentation practices.

## Concept

Enable agents to build and maintain persistent memory across sessions, creating continuity and avoiding repeated context-building.

## Motivation

**Current behavior:**
- Each Claude session starts fresh with no memory of previous sessions
- Users must re-explain project context, past decisions, and conventions
- No continuity between sessions or across agents

**Proposed behavior:**
- Agents build persistent knowledge of your project over time
- Agent remembers: "we decided to use X library because Y", "this component is deprecated", etc.
- Searchable knowledge base accessible across sessions
- Reduces context-building overhead

## Relationship to `docs/` Folder

**Overlap with existing practice:**

Projects already maintain documentation in `docs/` folders:
- Curated, formal documentation
- Requires user approval for changes
- Permanent, authoritative knowledge
- Versioned in git

**How agent memory differs (potentially):**

| `docs/` (current) | Agent memory (proposed) |
|-------------------|-------------------------|
| Human-curated | Agent-generated |
| Formal documentation | Working memory, scratchpad |
| Requires approval | Auto-generated |
| Permanent | Potentially ephemeral |
| Committed to git | Not in git (`.cade/` gitignored) |
| "How the system works" | "What we discussed", "Decisions made during development" |

**Open question:** Do these serve different enough purposes to warrant separate systems, or should we integrate them?

## Potential Approaches

### Approach 1: Separate Agent Memory

Agent maintains its own knowledge base separate from `docs/`:

**Location:** `.cade/memory/` or `.cade/knowledge/`

**Content:**
- Session notes (what was discussed)
- Quick decisions (not worth formal documentation)
- Context snippets (code patterns agent noticed)
- Failed attempts ("tried X, didn't work because Y")

**Example:**
```yaml
---
topic: error-handling
session: 2026-01-31
type: decision
---

Decided to use Result<T, E> pattern for error handling in auth module.
Reasoning: Explicit error types, better than throwing exceptions.
Considered panic! but rejected (too aggressive for auth errors).
```

**Benefits:**
- Doesn't pollute formal documentation
- Fast, no approval needed
- Agent scratchpad for working memory

**Challenges:**
- Duplication with `docs/`?
- When does agent memory graduate to formal docs?
- How to prevent stale/incorrect agent memory?

### Approach 2: Enhanced `docs/` Integration

Agents become better at working with existing `docs/` folder:

**Capabilities:**
- Build search index over `docs/` for quick lookup
- Auto-tag and categorize documentation
- Suggest what should be documented formally
- Read `docs/` to understand project context

**Benefits:**
- Single source of truth (`docs/`)
- No duplication
- Encourages formal documentation

**Challenges:**
- Still requires approval for changes
- Doesn't solve "session continuity" problem (agent remembering what you discussed)

### Approach 3: Hybrid

- Agent uses `docs/` as primary knowledge source
- Agent maintains session logs in `.cade/sessions/` (what was discussed, not formal docs)
- UI to promote session notes → formal `docs/` when valuable

**Example workflow:**
1. Agent helps you implement feature, logs decisions in `.cade/sessions/2026-01-31.md`
2. At end of session, CADE suggests: "Document the new auth pattern in `docs/technical/`?"
3. User approves, agent drafts formal documentation
4. Session log remains for continuity, formal doc becomes authoritative

## Use Cases

**Session continuity:**
```
Day 1: "Let's use JWT for auth"
Day 2: Agent remembers: "We decided on JWT yesterday. Should I implement token refresh?"
```

**Avoiding repeated explanations:**
```
Agent: "I see you're using a custom error type. Based on previous discussion, should I follow the Result<T, AuthError> pattern?"
```

**Failed attempt history:**
```
Agent: "I see we tried async processing for this before (2026-01-15) but it caused race conditions. Should we try a different approach?"
```

**Team knowledge sharing:**
```
New team member's agent reads project memory: "This codebase uses X pattern for Y, deprecated Z approach."
```

## Storage Format

**Obsidian-style markdown with YAML frontmatter** (consistent with agent orchestration proposal):

```yaml
---
topic: database-migration
type: decision
date: 2026-01-31T14:30:00Z
tags: [database, migration, postgres]
status: implemented
---

# Database Migration Strategy

Decided to use raw SQL migrations instead of ORM migrations.

## Reasoning
- More control over migration steps
- Easier to review in PRs
- ORM abstraction caused issues in production

## Rejected alternatives
- Prisma migrations - too opaque
- Manual ALTER statements - error-prone

## Implementation
Created `migrations/` directory with numbered SQL files.
```

**Searchable via frontmatter tags, topics, dates.**

## Open Questions

1. **Scope:** Should agent memory be per-project, per-agent, or global?

2. **Lifecycle:** When does agent memory expire? How to prevent stale information?

3. **Trust:** How to handle incorrect agent memory? User correction mechanism?

4. **Duplication:** How to avoid duplicating what's already in `docs/`? Auto-detect overlap?

5. **Migration path:** When does agent memory get promoted to formal `docs/`? Manual or automatic?

6. **Multi-agent:** Do all agents share the same memory, or each maintain their own?

7. **Privacy:** Should session logs be committed to git or stay local? Team sharing vs personal notes?

8. **Search/retrieval:** How does agent efficiently search its memory? Embeddings? Full-text search?

9. **UI:** How does user browse/edit agent memory? Dedicated pane? File tree integration?

## Implementation Considerations

**Storage:**
- `.cade/memory/` directory structure
- Markdown files with frontmatter
- Not committed to git by default

**Search:**
- Full-text search via ripgrep
- Tag-based filtering via frontmatter
- Possible: Embeddings for semantic search

**Integration:**
- Agent reads memory on session start
- Agent appends to memory during session
- UI to review/edit/delete memory entries

**Cleanup:**
- Archive old session logs periodically
- Detect and remove contradictory entries
- User can manually prune memory

## See Also

- [[agent-orchestration|Agent Orchestration]] - Uses similar Obsidian MD format for task/knowledge sharing
- [[../technical/README|Technical Documentation]] - Existing formal documentation system
- Project `CLAUDE.md` and `.claude/rules/` - Current context system
