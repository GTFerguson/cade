---
title: CLI Conventions Brainstorm
created: 2026-01-16
updated: 2026-01-16
status: brainstorm
tags: [cli, conventions, brainstorm]
---

# CLI Conventions Brainstorm

Exploring conventions for command-line interface design in cade. This document captures ideas before formalizing into `.roo/rules/cli-conventions.md`.

## Command-Line Flag Patterns

### Long vs Short Flags

Questions to consider:
- Always provide both? (`--verbose` / `-v`)
- When is short-only acceptable?
- Naming conventions for long flags (kebab-case vs snake_case)

Common patterns:
```bash
# GNU style
cade --config ~/.cade.toml
cade -c ~/.cade.toml

# Subcommands
cade session new
cade session list
```

### Flag Value Syntax

Options to explore:
```bash
# Space separated
cade --config config.toml

# Equals sign
cade --config=config.toml

# Support both?
```

## Output Formatting

### Color Usage

Questions:
- When to use colors?
- How to handle NO_COLOR / TERM=dumb?
- Color scheme consistency

Considerations:
- Errors: red
- Warnings: yellow
- Success: green
- Info: default/cyan
- Respect terminal capabilities

### Progress Indicators

Options:
- Spinners for indeterminate progress
- Progress bars for known-length operations
- Simple dots or status lines
- Silent mode for scripting

### Error Formatting

Ideas:
```
Error: Could not connect to session "main"
  Reason: Session does not exist
  Hint: Use `cade session list` to see available sessions
```

vs minimal:
```
error: session "main" not found
```

## Keybinding Philosophy

### Approach Options

1. **Vim-style** - Modal, command-based
2. **Emacs-style** - Chord-based (Ctrl+X, Ctrl+C)
3. **Custom** - Project-specific scheme
4. **Configurable** - Let users choose

### Key Considerations

- Conflict with tmux prefix key
- Conflict with vim keybindings
- Discoverability vs efficiency
- Learning curve

## TUI Component Patterns

### Layout

- How to handle terminal resize?
- Minimum terminal dimensions?
- Responsive vs fixed layouts

### Navigation

- Tab between panes?
- vim-style hjkl movement?
- Mouse support?

### Input Handling

- How to capture input in TUI vs pass to underlying tools?
- Modal vs always-on input

## Questions to Resolve

1. What's the primary interaction model - CLI commands or TUI?
2. How much vim-compatibility is expected?
3. Should this feel like a "new tool" or an extension of existing tools?
4. Target audience - vim experts or general developers?

## Next Steps

- [ ] Prototype basic CLI structure
- [ ] Test different flag patterns
- [ ] Survey existing tools for inspiration (lazygit, tig, etc.)
- [ ] Formalize into `.roo/rules/cli-conventions.md`

## References

- [CLI Guidelines](https://clig.dev/) - General CLI design principles
- [12 Factor CLI Apps](https://medium.com/@jdxcode/12-factor-cli-apps-dd3c227a0e46)
