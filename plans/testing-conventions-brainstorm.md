---
title: Testing Conventions Brainstorm
created: 2026-01-16
updated: 2026-01-16
status: brainstorm
tags: [testing, conventions, brainstorm]
---

# Testing Conventions Brainstorm

Exploring testing approaches for CLI/TUI applications. This document captures ideas before formalizing into rules.

## Testing CLI Interactions

### Unit Testing

What can be unit tested:
- Argument parsing
- Configuration loading
- Business logic separate from I/O
- Data transformations

Challenges:
- Isolating terminal I/O
- Testing colored output
- Testing interactive prompts

### Integration Testing

Testing complete command flows:
```bash
# Example test structure
cade session new test-session
cade session list | grep test-session
cade session delete test-session
```

Tools to consider:
- Shell script test harnesses
- expect/pexpect for interactive testing
- Custom test framework

## Testing TUI Components

### Approaches

1. **Screenshot/Snapshot Testing**
   - Capture terminal output as text
   - Compare against expected snapshots
   - Handle terminal size variations

2. **Behavioral Testing**
   - Simulate keystrokes
   - Verify state changes
   - Test navigation flows

3. **Component Isolation**
   - Test individual UI components
   - Mock terminal capabilities
   - Test rendering logic separately

### Mocking Terminal I/O

Ideas:
- Virtual terminal implementation
- Capture stdout/stderr buffers
- Inject test terminal dimensions

## Test Organization

### Directory Structure Options

```
tests/
├── unit/           # Fast, isolated tests
├── integration/    # Full command tests
├── e2e/            # End-to-end scenarios
└── fixtures/       # Test data and snapshots
```

vs flat:
```
tests/
├── test_cli.py
├── test_session.py
└── test_config.py
```

### Naming Conventions

Options:
- `test_*.py` / `*_test.py`
- `*_spec.py`
- Descriptive: `test_session_new_creates_session.py`

## Snapshot Testing for TUI

### Approach

1. Render TUI component to string buffer
2. Save as expected snapshot
3. On test run, compare output to snapshot
4. Update snapshots when behavior intentionally changes

### Challenges

- Terminal escape codes in snapshots
- Different terminal emulators
- Cross-platform differences

### Solutions

- Strip ANSI codes for comparison
- Normalize output format
- Platform-specific expected outputs

## Questions to Resolve

1. What language/framework will cade use? (determines test tooling)
2. How important is test coverage?
3. CI/CD pipeline - what tests run when?
4. Performance testing needs?

## Testing Tools to Evaluate

### Python
- pytest + pytest-console-scripts
- pexpect for interactive testing
- rich's console capture

### Rust
- cargo test
- assert_cmd for CLI testing
- insta for snapshot testing

### Go
- go test
- testify assertions
- tcell testing utilities

### General
- bats (Bash Automated Testing System)
- shellspec
- expect/autoexpect

## Next Steps

- [ ] Decide on implementation language
- [ ] Prototype test structure
- [ ] Evaluate snapshot testing tools
- [ ] Document testing requirements in rules

## References

- [Testing CLI Applications](https://blog.kellybrazil.com/2022/10/10/testing-your-cli-apps/)
- [Snapshot Testing](https://jestjs.io/docs/snapshot-testing)
