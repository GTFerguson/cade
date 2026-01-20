---
title: Configuration Guide
created: 2026-01-17
updated: 2026-01-17
status: active
tags: [user, configuration, customization]
---

# Configuration Guide

CADE uses TOML configuration files for customizing appearance, keybindings, and behavior. Configuration is split across three files for clarity and modularity.

## Configuration Files

| File | Purpose |
|------|---------|
| `appearance.toml` | Colors, fonts, terminal settings |
| `keybindings.toml` | Keyboard shortcuts and prefix key |
| `behavior.toml` | Session, file tree, and layout defaults |

## Configuration Locations

Configuration files are loaded in order, with later sources overriding earlier ones:

1. **Hardcoded defaults** - Built into CADE
2. **User config** - Personal settings that apply everywhere
3. **Project config** - Project-specific overrides

### User Config Directory

| Platform | Location |
|----------|----------|
| Linux/macOS | `~/.config/cade/` |
| Windows | `%APPDATA%\cade\` |

### Project Config Directory

Place a `.cade/` folder in your project root for project-specific settings. These override your user config.

```
my-project/
├── .cade/
│   ├── appearance.toml
│   ├── keybindings.toml
│   └── behavior.toml
└── src/
```

## appearance.toml

Customize the visual appearance of CADE.

### Colors

Override any CSS color variable. Uses the badwolf color scheme by default.

```toml
[colors]
# Background colors
bg-primary = "#1c1b1a"
bg-secondary = "#242321"
bg-tertiary = "#35322d"
bg-hover = "#45413b"
bg-selected = "#45413b"

# Text colors
text-primary = "#f8f6f2"
text-secondary = "#d9cec3"
text-muted = "#857f78"

# Accent colors
accent-blue = "#0a9dff"
accent-green = "#aeee00"
accent-orange = "#ffa724"
accent-yellow = "#fade3e"
accent-purple = "#ff9eb8"
accent-red = "#ff2c4b"
accent-cyan = "#8cffba"

# Border colors
border-color = "#45413b"
border-focus = "#aeee00"

# Scrollbar
scrollbar-bg = "#1c1b1a"
scrollbar-thumb = "#45413b"
scrollbar-thumb-hover = "#857f78"
```

### Fonts

```toml
[fonts]
mono = "JetBrains Mono"
mono-size = "14px"
sans = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
```

### Terminal

```toml
[terminal]
font-size = "14px"
scrollback = 10000
```

## keybindings.toml

Customize keyboard shortcuts. Uses a tmux-style prefix key system.

### Keybinding Format

Keybindings use a simple format:
- `a` - Just the "a" key
- `C-a` - Ctrl+a
- `A-a` - Alt+a
- `S-a` - Shift+a
- `M-a` - Meta/Cmd+a
- `C-S-a` - Ctrl+Shift+a

### Global Settings

```toml
[global]
prefix = "C-a"          # Ctrl+a activates prefix mode
prefix-timeout = 1500   # Milliseconds before prefix mode times out
```

### Pane Navigation

All pane shortcuts require the prefix key first.

```toml
[pane]
focus-left = "h"        # prefix + h - Focus pane to the left
focus-right = "l"       # prefix + l - Focus pane to the right
resize-left = "C-h"     # prefix + Ctrl+h - Resize pane boundary left
resize-right = "C-l"    # prefix + Ctrl+l - Resize pane boundary right
```

### Tab Navigation

```toml
[tab]
next = "f"              # prefix + f - Next tab
previous = "d"          # prefix + d - Previous tab
create = "c"            # prefix + c - Create new tab
close = "x"             # prefix + x - Close current tab
```

> [!NOTE]
> Numeric keys 1-9 always jump directly to tabs (1-indexed: prefix + 1 goes to first tab).

### Miscellaneous

```toml
[misc]
help = "?"              # prefix + ? - Show help overlay
toggle-terminal = "s"   # prefix + s - Toggle between Claude and shell terminal
```

## behavior.toml

Customize application behavior.

### Session Settings

```toml
[session]
auto-start-claude = true    # Automatically start Claude Code on new sessions
auto-save = true            # Auto-save session state
save-interval = 300         # Seconds between auto-saves
```

### File Tree

```toml
[file-tree]
show-hidden = false         # Show hidden files (starting with .)
default-expand-depth = 1    # How many levels to expand by default
```

### Layout Defaults

Default pane proportions (must sum to 1.0):

```toml
[layout]
default-file-tree = 0.20    # 20% for file tree
default-terminal = 0.50     # 50% for terminal
default-viewer = 0.30       # 30% for viewer
```

## Environment Variables

Some settings can be overridden via environment variables:

| Variable | Description |
|----------|-------------|
| `CADE_AUTO_START_CLAUDE` | `true` or `false` - Override auto-start setting |

## Example: Custom Theme

Create `~/.config/cade/appearance.toml`:

```toml
# Solarized Dark-inspired theme
[colors]
bg-primary = "#002b36"
bg-secondary = "#073642"
bg-tertiary = "#586e75"
text-primary = "#839496"
text-secondary = "#93a1a1"
accent-blue = "#268bd2"
accent-green = "#859900"
accent-orange = "#cb4b16"
```

## Example: Vim-style Keybindings

Create `~/.config/cade/keybindings.toml`:

```toml
[global]
prefix = "C-b"          # Use Ctrl+b like tmux default

[tab]
next = "n"              # prefix + n for next tab
previous = "p"          # prefix + p for previous tab
```

## Troubleshooting

### Config Not Loading

- Check file location matches your OS (see [[#Configuration Locations]])
- Verify TOML syntax is valid
- Check the browser console for warnings about invalid config values

### Invalid Values

Invalid configuration values are logged as warnings and replaced with defaults. Check the browser console (F12 → Console) for messages like:

```
[user-config] Warning: Invalid value for colors.bg-primary, using default
```

## See Also

- [[README|User Guide]]
- [[../technical/README|Technical Documentation]]
