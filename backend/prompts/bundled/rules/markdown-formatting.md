---
description: Obsidian.md-compatible markdown — blank lines before tables, fenced code blocks
---

# Markdown Formatting

Documentation is viewed in Obsidian.md. Follow these rules for correct rendering.

## Blank line before tables

Always add a blank line before a markdown table:

```markdown
**Available options:**

| Option | Description |
|--------|-------------|
| A      | First choice |
```

This applies after headers, bold text, paragraphs, lists — any non-blank content.

## Code blocks

Always use triple backticks with a language identifier:

```python
def example():
    pass
```

## Callouts

Use Obsidian callouts for important notes:

```markdown
> [!NOTE]
> General information.

> [!WARNING]
> Important warning.

> [!TIP]
> Helpful suggestion.
```

## Internal links

Use wiki-style links for cross-referencing within the vault:

```markdown
See [[architecture]] or [[architecture#Core Components]]
```
