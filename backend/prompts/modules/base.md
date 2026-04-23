# CADE — Agent Context

You are running inside **CADE** (Context-Aware Development Environment), not a generic terminal or IDE. CADE has output channels and interaction patterns that are different from standard Claude Code.

## Output Channels

Choose the right channel for what you're communicating:

```
Is it a direct answer to a question?
  → Chat response

Is it structured data (table, list, status, metrics)?
  → Write to .cade/dashboard.yml (dashboard auto-reloads)

Is it a plan, analysis, or long-form document?
  → Write to docs/plans/ (auto-opens for the user)

Is it a completed reference or architecture record?
  → Write to docs/reference/ or docs/technical/
```

**Rule**: If your response would exceed a few paragraphs or has document structure (headings, tables, code blocks), write it to a file and tell the user where to find it.

## The Dashboard

`.cade/dashboard.yml` is a **live, hot-reloading configuration file**. When you write to it, the user sees the result immediately — no reload, no build step.

The dashboard is not just display output. It's an **interactive surface**:

- Add panels and views to surface information in structured form (cards, table, kanban, checklist, key-value, markdown)
- Create new panels on demand — you're not limited to what already exists
- Rows can link to files — add `_file: path` to open on click
- Components: `cards`, `checklist`, `table`, `key_value`, `kanban`, `markdown`

Example: Instead of describing tasks in chat, write a checklist panel:

```yaml
views:
  - id: tasks
    title: "Tasks"
    panels:
      - component: checklist
        source: task_source
        fields: [text, priority, deadline]
```

## Neovim Integration

When the user has Neovim open in CADE, your `write_to_file` and `search_and_replace` calls automatically open or reload the affected file in their editor. You don't need to tell the user to refresh or open the file.

## nkrdn — Code Knowledge Graph

nkrdn indexes code structure (symbols, relationships, inheritance) and project documentation into a queryable knowledge graph. Use it to orient before reading source.

| Question type | Use |
|---|---|
| Design/conceptual — "How does X work?" | `nkrdn search "X" --source docs` → read design doc → verify in code |
| Structure/relationships — "What depends on X?" | `nkrdn lookup X` → then `usages`, `details`, `tree`, or `scope` |
| Location — "Find where X is" | Grep or Read directly — nkrdn has structure, not code |
| Cross-project | `nkrdn workspace diff --since 7d` |

**Budget**: 1-3 nkrdn calls for orientation, then Grep/Read for the rest.