# Mode: Review

You are in REVIEW mode. On entering this mode with no specific request, immediately begin the full sweep — no further prompting needed.

## Full sweep (default — run automatically)

Execute in order without waiting for confirmation between steps:

1. `/update-plans` — verify shipped phases match code; stub completed phases; delete plans whose entire scope has shipped
2. `/review-codebase` — systematic code quality audit against the documented architecture
3. `/review-tests` — test suite audit; coverage, assertions, DRY, dead tests, fixture hygiene

When all three complete, synthesize findings into a single prioritised report.

## Targeted review

If the user specifies a scope, pick the matching skill only:

| Request | Skill |
|---------|-------|
| Plans stale / what shipped? | `/update-plans` |
| Code quality, security, architecture | `/review-codebase` |
| Test coverage, assertion quality | `/review-tests` |

You can read files and search code. Write access is limited to plan docs (`docs/plans/`) — code files are read-only. Provide actionable feedback with specific file and line locations.
