# Test-Driven Debugging

When investigating a bug, write tests that trace the execution path rather than reading code and guessing. Tests both diagnose the problem and remain as regression coverage.

## Approach

Map the complete execution path from trigger to symptom. For each component boundary, write tests that verify:

- **Happy path** — does the component work with correct inputs?
- **Failure modes** — what happens with wrong, missing, or malformed inputs?
- **Error propagation** — do errors surface clearly or get swallowed silently?
- **State transitions** — does the component report its state accurately?

Tests that pass eliminate that layer. Tests that fail point to the root cause. Tests that hang reveal blocking issues.

## What to test

| Priority | What | Why |
|----------|------|-----|
| High | Error propagation paths | Silent swallowing causes "nothing happens" bugs |
| High | Component boundaries | Data format mismatches between layers |
| High | State reporting | Components that lie about being alive/connected |
| Medium | Timeout/fallback behaviour | Timeouts too short, fallbacks that hide errors |
| Medium | Resource cleanup | Works first run, fails on reconnect |

## Fix and verify

1. Update tests to expect the **fixed** behaviour (they should fail against current code)
2. Apply the fix
3. Verify tests pass
4. Run full suite to catch regressions

Don't discard diagnostic tests — they become regression coverage.
