---
description: Comments explain WHY, not WHAT — no marker comments, no internal references
---

# Code Comments

Comments explain **why** code exists or why a non-obvious approach was taken. The code itself shows what it does.

Write no comments by default. Add one only when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behaviour that would surprise a reader.

**Don't:**
- Describe what the code does (`# increment counter`)
- Reference internal tracking (`# Phase 2`, `# fix issue #123`, `# per refactor-plan.md`)
- Restate what well-named identifiers already say

**Do:**
- Explain a non-obvious algorithm or constraint
- Note a workaround for a subtle bug or external limitation
- Document why a simpler approach was rejected

`@todo` is acceptable for genuine future work — keep it self-explanatory without referencing external systems.
