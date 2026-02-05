---
title: Visual Design Philosophy
created: 2026-02-04
updated: 2026-02-05
status: complete
tags: [design, ui, ux, philosophy]
---

# Visual Design Philosophy

CADE's interface philosophy is rooted in terminal aesthetics and keyboard-first interaction. The UI feels like an extension of tmux/vim rather than a modern web application—intentional, minimal, and deeply respectful of keyboard-driven workflows.

## Core Principles

### 1. Minimalist Terminal Aesthetic

CADE embraces terminal design language, not generic web UI conventions.

**Design DNA:**
- tmux/vim inspired layouts and interactions
- Monospace typography throughout
- ASCII art and bracket notation over rounded corners and gradients
- Screen-based navigation (full-pane replacements, not overlays)
- Zero border-radius, zero box-shadow, minimal transitions

> [!IMPORTANT]
> Avoid modern web UI patterns (modals, cards, shadows, rounded corners). CADE should feel like a powerful TUI (terminal user interface), not a web app.

### 2. Keyboard-First Interaction

Every interaction should be achievable through keyboard alone. Mouse support is secondary.

**Navigation Pattern:**
- `j` / `k` / `↑` / `↓` - Navigate options
- `l` / `space` / `enter` - Select/confirm/forward
- `h` / `backspace` - Back/cancel

**Why vim directional keys:**
- `l` = right arrow = forward/enter
- `h` = left arrow = back/cancel
- Consistent with vim's directional logic
- Builds muscle memory across all screens

> [!NOTE]
> All three selection keys (l/space/enter) should work everywhere. Users have different preferences—some like vim purity (l), others prefer ergonomic ease (space).

### 3. User Agency Over Automation

Give users control; don't assume what they want.

**Examples:**
- Session resume is **opt-in** via splash screen, not auto-restored
- Remote connections require explicit selection
- Saved projects are favorites, not forced history

**Philosophy:**
- Auto-restore can be jarring (stale connections, context switches)
- Explicit choice respects user workflow
- Make common actions easy, but never invisible

### 4. Full-Pane Replacements

CADE uses screen-based navigation, not modal overlays.

**Pattern:**
- Splash screen → Remote selector → File browser
- Each replaces the entire view
- Back navigation (h/backspace) returns to previous screen
- Clean transitions, no stacked layers

**Exception:** Error recovery dialogs (e.g., auth token dialog) may use centered overlays since they interrupt an existing flow that must be preserved.

**Why:**
- Modals feel out of place in terminal aesthetics
- Full-pane replacements match tmux window switching
- Simpler mental model (one screen at a time)
- No z-index management or overlay complexity

### 5. DRY Principle

Reuse existing systems instead of duplicating functionality.

**Example from remote project selector:**
- Don't build new file browser protocol
- Reuse existing WebSocket `file-children` messages
- Connect early for browsing, pass same WebSocket to tab

**Benefits:**
- Less code to maintain
- Consistent behavior across features
- Warm connection ready for tab initialization

## Visual Language

### Bracket Notation

All interactive elements and headers use bracket wrapping: `[LIKE THIS]`

**Usage:**

| Element | Format | Example |
|---------|--------|---------|
| Headers | `[ UPPERCASE ]` | `[ REMOTE CONNECTIONS ]` |
| Options | `[lowercase]` | `[local project]` |
| Actions | `[+ prefix for new]` | `[+ new connection]` |
| Status | `[state]` | `[loading]`, `[enter]` |
| Viewer | `[ FILENAME.EXT ]` | `[ README.MD ]` |
| Mode | `[MODE]` | `[NORMAL]`, `[EDIT]` |

**Why brackets:**
- Terminal/ASCII aesthetic
- Clear visual boundaries without borders
- Consistent with tmux/vim status line conventions
- Easy to distinguish interactive vs informational text

### Theme System

CADE uses a theme system with 5 built-in palettes. All themes share the same accent colors (from the Badwolf palette) and vary only in neutral tones (backgrounds, text, borders).

**Default theme:** True Black

**Built-in themes:**

| Theme | Background | Character |
|-------|-----------|-----------|
| True Black | `#0a0a09` | Near-black, maximum contrast |
| Deep Contrast | `#141312` | Slightly lifted, still very dark |
| Ember | `#110f0d` | Warm brown undertones |
| Ink | `#0e0f10` | Cool blue-grey undertones |
| Badwolf | `#1c1b1a` | Original Badwolf palette |

**Shared accent colors (all themes):**

| Usage | Color | Variable |
|-------|-------|----------|
| Headers / selection bg | `#ff2c4b` | `--accent-red` |
| Prompts / help keys | `#aeee00` | `--accent-green` |
| Paths / types | `#0a9dff` | `--accent-blue` |
| Status mode indicators | `#ffa724` | `--accent-orange` |
| Highlights | `#fade3e` | `--accent-yellow` |
| Language tags | `#8cffba` | `--accent-cyan` |
| Decorative | `#ff9eb8` | `--accent-purple` |

**Theme architecture:**
- Definitions in `frontend/src/config/themes.ts`
- Selector UI in `frontend/src/ui/theme-selector.ts`
- Keybinding: `prefix + t` opens TUI selector with live preview
- Persistence: `localStorage` key `cade-theme`
- Applied on DOMContentLoaded (before UI init) to prevent flash
- Re-applied after server config merges to prevent override
- Propagated to xterm.js terminals via `onThemeChange` listener

> [!TIP]
> Use semantic CSS variables, not raw hex values. Themes work by overriding CSS custom properties on `:root` at runtime. All component styling should reference variables.

### Typography

**Monospace everywhere:**
- Font stack: `'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace`
- Line height: `1.5` for readability (code viewer uses `1.6`)
- Letter spacing: `0.5px` (slightly looser for clarity)

**Hierarchy:**

| Element | Size | Color | Transform |
|---------|------|-------|-----------|
| Headers | `16px` | `--accent-red` | `UPPERCASE` + `letter-spacing: 2px` |
| Options | `13px` | `--text-primary` | As-is |
| Labels | `12px` | `--text-muted` | lowercase |
| Help text | `11px` | `--text-muted` | As-is |

### Terminal Prompt Styling

Input fields should look like terminal prompts, not web forms.

**Pattern:**
```
name: ___________
path: ___________
```

**Implementation:**
- Prompt label: `--accent-green`, inline with input
- Input field: transparent background, bottom border only
- No boxes, no rounded corners, no shadows
- Arrow keys navigate between fields and option buttons

**Example CSS:**
```css
.input-prompt {
  color: var(--accent-green);
  margin-right: 8px;
}

.input-field {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--text-muted);
  color: var(--text-primary);
  outline: none;
}
```

## Component Standards

### Option Lists

**Structure:**
```html
<div class="options-list">
  <div class="option selected">
    <span class="option-label">[first option]</span>
    <span class="option-meta">metadata/path</span>
  </div>
  <div class="option">
    <span class="option-label">[second option]</span>
  </div>
  <div class="divider"></div>
  <div class="option">
    <span class="option-label">[+ new item]</span>
  </div>
</div>
```

**Behavior:**
- Selected state: `--accent-red` background highlight
- Keyboard navigation: j/k to move, l/space/enter to select
- Mouse optional: click to select and activate
- Dividers separate sections (saved vs new actions)
- Options: 13px, padding 6px 16px

### Headers

**Centered with breathing room:**
```css
.pane-header {
  font-size: 16px;
  color: var(--accent-red);
  letter-spacing: 2px;
  text-align: center;
  text-transform: uppercase;
  margin-bottom: 24px;
}
```

**Not:**
- Stuck to viewport top
- Crammed against content
- Left-aligned (unless in a sidebar context)

### Help Text

Always show keyboard shortcuts at bottom of screen:

**Pattern:**
```html
<div class="pane-help">
  <div><span class="help-key">j/k</span> navigate</div>
  <div><span class="help-key">l</span> select</div>
  <div><span class="help-key">h</span> back</div>
</div>
```

**Style:**
- Fixed to bottom of pane
- Muted text (`--text-muted`), 11px
- Key highlights: `--accent-green` color

## Workspace Components

The three-pane workspace has its own design vocabulary within the TUI system.

### Tab Bar

Flat, minimal tabs with pipe separators. No rounded corners, no chrome.

- Active tab merges into content (bottom border removed, background matches content pane)
- Inactive tabs: transparent background, muted text, bottom border visible
- Pipe separators (`border-right`) between tabs
- Remote indicators: text labels (`ssh`, `tcp`) instead of emoji
- Add button: plain `+`, no brackets

### File Tree

Simple chevron indicators with indented hierarchy. No CSS-shape icons.

- `▸` collapsed / `▾` expanded folders (text characters, not CSS triangles)
- File names colored by type:
  - Source files (`.ts`, `.js`, `.py`): `--accent-blue`
  - Markup files (`.md`, `.html`): `--accent-green`
  - Config files (`.json`, `.toml`): `--accent-yellow`
  - Style files (`.css`): `--accent-red`
- Indentation via padding only (no tree-drawing connectors)
- Filter input: terminal prompt style, bottom border only
- No colored dots, no folder icons, no file icons

### Code Viewer (B5 Layout)

Source code files use a two-column flex layout with sticky line numbers.

**Structure:**
```
┌──────────────────────────────────────────┐
│           [ FILENAME.TS ]                │  ← bracket header
├────┬─────────────────────────────────────┤
│  1 │ import { foo } from "./bar";       │  ← line numbers | code
│  2 │                                     │     hairline border
│  3 │ function main(): void {             │     between columns
│  4 │   console.log("hello");             │
│  5 │ }                                   │
├────┴─────────────────────────────────────┤
│ VIEW  src/main.ts     typescript  5 ln   │  ← vim statusline
└──────────────────────────────────────────┘
```

**Key properties:**
- Line numbers: `position: sticky; left: 0` (pinned during horizontal scroll)
- Hairline border: `border-right: 1px solid var(--bg-tertiary)` between columns
- Line numbers: `12px`, muted color, right-aligned, `user-select: none`
- Code: `13px`, `white-space: pre`, `line-height: 1.6`
- Syntax highlighting: highlight.js with `vs2015` theme
- Both columns scroll together vertically; content scrolls horizontally
- Statusline shows: mode (`VIEW`) + filepath + language + line count

### Markdown Viewer

Markdown files render with mertex.md (marked + highlight.js). Embedded code blocks use `bg-tertiary` background. YAML frontmatter renders as key-value pairs.

**Modes:**
- `VIEW` — Read-only, vim scroll keys (j/k/gg/G/Ctrl-d/Ctrl-u)
- `NORMAL` — Milkdown editor in navigation mode (vim motions)
- `EDIT` — Milkdown editor in insert mode

### Viewer Header & Statusline

**Header:** Bracket notation, centered, uppercase.
```css
.viewer-header {
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 12px;
  background: var(--bg-secondary);
  text-align: center;
}
```

**Statusline:** Vim-inspired, bottom-pinned.
- Mode indicator: `--accent-orange`, bold
- Filename: muted, ellipsis overflow
- Language: `--accent-cyan` (code files only)
- Line count: muted (code files only)

### Terminal

- Agent dropdown: bracket notation `[claude]`, `[shell]`
- No border-radius, no box-shadow on dropdown
- Status label (CLAUDE/SHELL) top-right
- xterm.js theme synced with CADE theme via `onThemeChange` listener

### File Creation Dialog

TUI-style inline dialog (not a web modal):
- Bracket header: `[ CREATE FILE ]`
- Terminal prompt input: `path: ___`
- Bracket options: `[create]` / `[cancel]`
- Help text: `enter submit  esc cancel`

## Keyboard Interaction Patterns

### Consistency is Critical

All screens must use the same bindings for the same actions.

**Standard Bindings:**

| Action | Primary Keys | Secondary Keys | Notes |
|--------|-------------|----------------|-------|
| Navigate down | `j`, `↓` | - | Vim down |
| Navigate up | `k`, `↑` | - | Vim up |
| Select/confirm | `l`, `space` | `enter` | l = vim right/forward |
| Back/cancel | `h`, `backspace` | `escape` (context) | h = vim left/back |

**Prefix shortcuts (`Ctrl+a` then key):**

| Key | Action |
|-----|--------|
| `t` | Open theme selector |
| `n` | New tab |
| `w` | Close tab |
| `1-9` | Switch to tab N |
| `?` | Help overlay |

> [!WARNING]
> Never use only one key for selection. Always support l/space/enter. Users have different preferences and muscle memory.

### Screen-Specific Behaviors

**Splash screen (options mode):**
- j/k: navigate options
- l/space/enter: select option and dismiss splash
- No back key (splash is entry point)

**Remote project selector:**
- j/k: navigate lists
- l/space/enter: select item, advance to next screen
- h/backspace: return to previous screen
- Escape: blur input fields
- Arrow keys: navigate between form fields and option buttons

**File browser:**
- j/k: navigate directories + "select current" button
- l/space/enter: enter directory OR confirm selection (context-aware)
- h/backspace: parent directory

**Code/markdown viewer:**
- j/k: scroll vertically
- h/l: scroll horizontally (code blocks)
- gg: scroll to top (double-tap)
- G: scroll to bottom
- Ctrl+d/Ctrl+u: page down/up
- i: enter normal mode (markdown only)

### Event Handling

**Input field exception:**
```typescript
if ((e.target as HTMLElement).tagName === "INPUT") {
  if (e.key === "Escape") {
    (e.target as HTMLInputElement).blur();
  }
  return; // Don't intercept other keys
}
```

Always check if user is typing in an input field before handling navigation keys.

## Anti-Patterns

### Don't: Generic Web UI

**Bad:**
- Rounded corners on anything (`border-radius > 0`)
- Drop shadows and blur effects (`box-shadow`)
- Long transitions (`transition > 0.05s`)
- Gradients and animations
- Material Design / Bootstrap aesthetics

**Why:**
These visual patterns scream "web app" and clash with terminal aesthetics.

### Don't: Modal Overlays

**Bad:**
```html
<div class="modal-overlay">
  <div class="modal-dialog">
    <!-- content -->
  </div>
</div>
```

**Instead:**
Full-pane replacements with back navigation.

### Don't: Emoji/Icon UI Elements

**Bad:**
- 🔒 for SSH connections
- 📁 for folders
- Colored CSS-shape icons for file types

**Instead:**
- Text labels: `ssh`, `tcp`
- Text chevrons: `▸`, `▾`
- Colored filenames by type

### Don't: Inconsistent Keybindings

**Bad:**
- Splash uses only Enter
- Remote selector uses l/space/enter
- File browser uses only space

**Why:**
Users can't build muscle memory. Every screen feels different.

### Don't: Mouse-Required Interactions

**Bad:**
- Drag-and-drop as only option
- Hover-only tooltips with critical info
- Click-only buttons with no keyboard equivalent

**Why:**
CADE is keyboard-first. Mouse support should be convenience, not necessity.

### Don't: Auto-Restore Without Choice

**Bad:**
```typescript
async initialize() {
  await this.restoreSession(); // Forces restore
}
```

**Better:**
```typescript
async initialize() {
  // Show splash with optional "RESUME SESSION" button
}
```

**Why:**
Respects user agency. Stale connections, lost context, or intentional fresh starts should be possible.

## Decision Framework

When designing new features, ask:

### 1. Does this feel like a TUI or a web app?
- **TUI**: Keyboard-driven, monospace, minimal, screen-based
- **Web app**: Mouse-driven, rounded corners, modals, rich controls

Choose TUI.

### 2. Can this be done entirely with keyboard?
If no, redesign. Mouse support is convenience, not requirement.

### 3. Does this reuse an existing pattern?
- Option lists? Use standard `.option` + `.selected` pattern
- Input? Use terminal prompt style
- Navigation? Use j/k/l/h consistently

Don't invent new patterns if existing ones work.

### 4. Does this assume what the user wants?
If yes, make it opt-in instead. Examples:
- Auto-connect → Show connection selector
- Auto-restore → Show "resume session" option
- Auto-save → Ask for confirmation

### 5. Does this duplicate existing functionality?
Check if the backend/frontend already does this. Reuse instead of rebuild.

## Future Considerations

### Mobile/Touch

CADE's desktop-first philosophy may not translate to mobile:
- Touch requires larger targets (conflicts with dense terminal layout)
- Virtual keyboard reduces screen space
- Touch gestures don't map to vim keybindings

**Recommendation:** Keep mobile as "view-only" or simplified interface, not primary target.

### Accessibility

Terminal aesthetics can conflict with accessibility:
- Monospace may be less readable for some users
- Low contrast in some theme combinations
- Keyboard-first is good for screen readers, but needs proper ARIA

**Balance:** Maintain aesthetic while ensuring:
- Sufficient contrast ratios (WCAG AA minimum)
- Proper semantic HTML and ARIA labels
- Configurable font sizes
- Screen reader tested navigation

## See Also

- [[cli-conventions]] - Command-line interface design
- [[tmux-integration-design]] - tmux workflow integration
- `frontend/styles/main.css` - Reference implementation
- `frontend/src/config/themes.ts` - Theme definitions
- `frontend/src/remote/RemoteProjectSelector.ts` - Exemplar component

---

**Summary:** CADE's design is intentionally terminal-first. When in doubt, ask: "Would this feel at home in tmux?" If yes, proceed. If no, rethink.
