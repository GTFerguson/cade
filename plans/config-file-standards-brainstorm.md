---
title: Config File Standards Brainstorm
created: 2026-01-16
updated: 2026-01-16
status: brainstorm
tags: [config, conventions, brainstorm]
---

# Config File Standards Brainstorm

Exploring configuration file standards for ccplus. This document captures ideas before formalizing into rules.

## Format Choice

### TOML

Pros:
- Human readable and writable
- Clear section structure
- Good for configuration files
- Rust ecosystem standard

Example:
```toml
[general]
theme = "dark"

[session]
default_name = "main"
auto_save = true

[keybindings]
prefix = "C-a"
```

### YAML

Pros:
- Widely used
- Supports complex nested structures
- Comments allowed

Cons:
- Whitespace sensitivity
- Surprising edge cases (norway problem)
- Multiple ways to represent same data

Example:
```yaml
general:
  theme: dark

session:
  default_name: main
  auto_save: true
```

### JSON

Pros:
- Universal support
- Strict parsing
- Easy programmatic generation

Cons:
- No comments
- Verbose for humans
- Trailing comma issues

### Recommendation

TOML seems best for CLI tool configuration:
- Human-friendly editing
- Clear, predictable syntax
- Good tooling support

## Config File Locations

### XDG Base Directory Spec

Standard locations:
```
$XDG_CONFIG_HOME/ccplus/config.toml  # User config
$XDG_DATA_HOME/ccplus/               # User data
$XDG_CACHE_HOME/ccplus/              # Cache files
```

Defaults (when XDG vars not set):
```
~/.config/ccplus/config.toml
~/.local/share/ccplus/
~/.cache/ccplus/
```

### Alternative: Dotfile

```
~/.ccplus.toml        # Single file
~/.ccplus/config.toml # Directory
```

### Project-Local Config

```
.ccplus.toml          # In project root
.ccplus/config.toml   # Directory version
```

### Windows Considerations

```
%APPDATA%\ccplus\config.toml
%LOCALAPPDATA%\ccplus\
```

## Config Inheritance/Layering

### Load Order

1. Built-in defaults (in binary)
2. System-wide config (`/etc/ccplus/config.toml`)
3. User config (`~/.config/ccplus/config.toml`)
4. Project config (`.ccplus.toml`)
5. Environment variables (`CCPLUS_*`)
6. Command-line flags

### Merge Strategy

Options:
- Deep merge (nested values merge)
- Shallow merge (later config replaces section)
- Explicit override markers

Example with deep merge:
```toml
# ~/.config/ccplus/config.toml
[keybindings]
prefix = "C-a"
split_h = "C-a |"

# .ccplus.toml (project)
[keybindings]
prefix = "C-b"  # Overrides user config
# split_h inherited from user config
```

## Schema Validation

### Approaches

1. **JSON Schema**
   - Well-supported
   - Can generate from schema
   - IDE integration possible

2. **Runtime Validation**
   - Validate on load
   - Clear error messages
   - Type checking

3. **Strict Mode**
   - Warn on unknown keys
   - Prevent typos
   - Optional strictness levels

### Error Messages

Good error reporting:
```
Error: Invalid configuration in ~/.config/ccplus/config.toml
  Line 15: Unknown key "sesion" in [general]
  Hint: Did you mean "session"?
```

## Environment Variables

### Naming Convention

```bash
CCPLUS_THEME=dark
CCPLUS_SESSION_DEFAULT_NAME=main
CCPLUS_KEYBINDINGS_PREFIX="C-a"
```

Pattern: `CCPLUS_` + section + key in SCREAMING_SNAKE_CASE

### Special Variables

```bash
CCPLUS_CONFIG=/path/to/config.toml  # Override config path
CCPLUS_NO_CONFIG=1                   # Skip config loading
CCPLUS_DEBUG=1                       # Enable debug mode
```

## Questions to Resolve

1. Should we support multiple formats or pick one?
2. How important is Windows support initially?
3. Should project config be hidden (`.ccplus.toml`) or visible (`ccplus.toml`)?
4. How strict should validation be by default?

## Example Config Structure

```toml
# ccplus configuration

[general]
theme = "dark"          # "dark" | "light" | "auto"
log_level = "info"      # "debug" | "info" | "warn" | "error"

[session]
default_name = "main"
auto_save = true
save_interval = 300     # seconds

[tmux]
socket_path = ""        # Empty = default
prefix = "C-a"

[vim]
config_path = ""        # Empty = default ~/.vimrc

[claude]
# Claude Code integration settings
auto_context = true

[keybindings]
# Custom keybindings
# Format: action = "key sequence"
```

## Next Steps

- [ ] Decide on format (recommend TOML)
- [ ] Define initial config schema
- [ ] Implement config loading with layering
- [ ] Add schema validation
- [ ] Document in rules

## References

- [XDG Base Directory Spec](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html)
- [TOML Specification](https://toml.io/)
- [12 Factor App - Config](https://12factor.net/config)
