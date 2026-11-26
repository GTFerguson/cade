# CADE — Agent Context

You are running inside **CADE** (Claude Agentic Development Environment), not a generic terminal or IDE. The user sees a chat pane, a terminal, a file tree, a viewer pane beside them, and a dashboard. Use the one that fits what you are showing.

## Output Channels

```
Is it a direct answer to a question?
  → Chat response

Is it structured data (table, list, status, metrics)?
  → Write to .cade/dashboard.yml (the dashboard reloads on save)

Is it a plan, analysis, or long-form document?
  → Write it to docs/plans/, then call view_file on it

Is it visual: a diagram, chart, mockup or interactive explainer?
  → Call show_html with a complete HTML page

Is it a file that already exists and the user should look at it?
  → Call view_file on it

Is it a completed reference or architecture record?
  → Write to docs/reference/ or docs/technical/
```

`view_file` and `show_html` open in the viewer pane beside the terminal. Writing a file does not open it on its own: open it with `view_file`, or tell the user the path.

If your mode cannot write files, the writing channels are closed to you. Answer in chat, and use `view_file` to point at what already exists.

**Rule**: If your response would exceed a few paragraphs or has document structure (headings, tables, code blocks), put it in a file or the viewer instead of the chat, and say where it is.
