---
title: Visual Design Philosophy
created: 2026-02-04
updated: 2026-03-05
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

**CSS directory structure:**

`frontend/styles/main.css` is a thin `@import` index — Vite inlines everything at build time (zero runtime cost). Files are ordered from most foundational to most specific (ITCSS pattern):

```
frontend/styles/
├── main.css              ← @import index only
├── mobile.css            ← Mobile/touch overrides (cross-cutting)
├── base/
│   ├── variables.css     ← :root custom properties
│   └── reset.css         ← Reset, html/body, scrollbar
├── layout/
│   ├── structure.css     ← App wrapper, 3-pane grid, resize handles
│   └── tabs.css          ← Tab bar, tab states
├── workspace/
│   ├── file-tree.css     ← Tree hierarchy, chevrons, type colors
│   ├── viewer.css        ← Code/markdown viewer, frontmatter, tables
│   ├── editor.css        ← Milkdown overrides, cursor styling
│   ├── terminal.css      ← Terminal, neovim, agent multi-terminal
│   └── chat.css          ← Chat pane, tool blocks, thinking blocks
└── screens/
    ├── dialogs.css       ← File creation, auth token, settings
    ├── splash.css        ← Splash screen, scramble effect phases
    ├── overlays.css      ← Help overlay, theme selector, keyboard nav
    └── remote.css        ← Remote profiles, project selector, big-toggle
```

Import order = cascade order. Add new component styles to the appropriate file; add new files to the index in the correct layer.

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

**Form inputs** (dialogs, settings): Prompt label + underline field.

```
name: ___________
path: ___________
```

- Prompt label: `--accent-green`, inline with input
- Input field: transparent background, bottom border only
- No boxes, no rounded corners, no shadows
- Arrow keys navigate between fields and option buttons

**Chat input** (chat pane): Flush line — no visible boundary at all.

```
❯ _
```

- No borders, no background change — the prompt IS the input
- Textarea auto-grows from 1 line to 3 lines max, then scrolls
- Prompt (`❯`) stays top-aligned as textarea grows (`align-items: flex-start`)
- Thin styled scrollbar (`4px`, `--bg-tertiary` thumb, transparent track)
- Matches the terminal's own input feel

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

### Binary Toggle

Use for any two-state mode selection (e.g., direct/ssh-tunnel, on/off). Default/preferred option goes on the left.

**Structure:**
```html
<div class="big-toggle">
  <div class="big-toggle-half active" data-mode="a">option a</div>
  <div class="big-toggle-divider"></div>
  <div class="big-toggle-half" data-mode="b">option b</div>
</div>
```

Toggle `.active` class between halves on click. All visual styling (fill, text color, divider, font weight) is handled by CSS.

CSS: `.big-toggle`, `.big-toggle-half`, `.big-toggle-half.active`, `.big-toggle-divider` (`screens/remote.css`)
Reference: `frontend/src/remote/RemoteProfileEditor.ts`

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

### Chat Pane

The chat pane renders LLM conversations with markdown output via mertex.md. Used in both API mode (LiteLLM providers) and enhanced CC mode (Claude Code subprocess with `--output-format stream-json`).

**Text hierarchy — assistant output takes focus:**

| Element | Color | Rationale |
|---------|-------|-----------|
| Assistant content | `--text-primary` | This is what you're reading |
| User input (in history) | `--text-muted` | You already know what you asked |
| User prompt prefix | `--accent-green` (`❯`) | Visual anchor |

The user's own messages are deliberately de-emphasized. Focus belongs on the model's response.

**Tool use blocks** — inline indicators within the assistant message flow:

```
✓ Edit  src/config.ts                      done
▸ Bash  npm test                           running…
✗ Bash  npm test                           failed
```

- Text icons only: `▸` (running), `✓` (success), `✗` (error) — no emoji, no CSS shapes
- No left borders — differentiated by icon color alone (`--accent-cyan` running, `--accent-green` success, `--accent-red` error)
- Running state: subtle opacity pulse animation (1.5s ease-in-out)
- Tool name: `--accent-cyan`, 600 weight
- Target/status: `--text-muted`, italic status

**Thinking blocks** — collapsible, auto-collapsed when complete:

- Chevron toggle: `▸`/`▾` to expand/collapse
- No left border — just indentation and muted styling
- Content: `--text-muted`, italic, 12px
- Auto-collapses when text output begins (thinking is done)

**Stream renderer lifecycle:** When tool calls or thinking blocks interrupt text, the current `StreamRenderer` is finalized before inserting the block. A new renderer is created for subsequent text, inside a `.chat-text-segment` wrapper to prevent markdown interference across boundaries.

**Statusline:** Vim-style, bottom-pinned.
- Mode: `CHAT` (API mode) or `CLAUDE CODE` (enhanced CC mode), `--accent-blue`
- Provider: model name, `--accent-cyan`
- Tokens: cumulative count, right-aligned

CSS: `.chat-pane`, `.chat-message`, `.chat-tool-use`, `.chat-thinking` (`workspace/chat.css`)
Files: `frontend/src/chat/chat-pane.ts`, `frontend/src/chat/chat-input.ts`

### File Creation Dialog

TUI-style inline dialog (not a web modal):
- Bracket header: `[ CREATE FILE ]`
- Terminal prompt input: `path: ___`
- Bracket options: `[create]` / `[cancel]`
- Help text: `enter submit  esc cancel`

### Splash Screen

The app entry point. Two modes:

**Status mode** — ASCII logo + `[loading]`/`[enter]` status. Dismiss with Enter/Space/tap. Used during connection/initialization.

**Options mode** — Logo + selectable actions (Local/Remote/Resume). j/k navigate, Enter/l select. MenuNav-powered.

**Scramble effects** — Load-in and dismiss animations using character replacement (binary `01`, braille patterns, ghost punctuation, block chars). Color phases: green → orange → red → muted.

**Mobile** — Narrower box-drawing logo, 14px font, no transform scaling.

CSS: `.splash`, `.splash-logo`, `.splash-status`, `.splash-options`, `.splash-help` (`screens/splash.css`)
Files: `frontend/src/ui/splash.ts`, `frontend/src/ui/splash-effects.ts`

#### Auth Splash Variant

When authentication is required, the splash screen shows an auth form instead of project options. Uses `Splash.setAuthMode()`.

**CSS Classes:**
- `.splash-auth-content` — Main container for auth form content (400px, centered)
- `.auth-message` — "authentication required" text (12px, letter-spacing: 1px)
- `.auth-input-wrapper` — Container for terminal prompt-style token input
- `.auth-input-prompt` — Green "token:" label
- `.auth-input-field` — Password input field with terminal aesthetic
- `.auth-status` — Status/error message area (`.error` or `.validating` modifiers)
- `.splash-options` / `.splash-option` — Reused for `[connect]` `[cancel]` buttons
- `.splash-help` — Reused for help text

**Mobile (≤768px):** Input wrapper switches to vertical layout; 16px font to prevent iOS auto-zoom.

Used for both initial connection auth and mid-session re-auth.

### Mobile Adaptation

CADE adapts to touch devices (≤768px) with enlarged targets and gesture navigation.

**Touch Toolbar** (`.touch-toolbar`):
- Fixed bottom bar, 48px height
- Keys: `esc`, `tab`, `^c`, `^d`, `↑`, `[cmd]`
- Pipe separators between keys
- `[cmd]` button: accent-red, opens command menu
- Repositions above virtual keyboard when detected

**Full-Pane Screens** (`.mobile-screen`):
- Stack-based navigation via `ScreenManager`
- Swipe right from edge to go back
- Standard structure: `.mobile-screen-header` + `.mobile-screen-body` + `.mobile-screen-statusline`
- Touch-safe scrolling (`-webkit-overflow-scrolling: touch`)

**Touch targets:** Minimum 48px hit area for all interactive elements.

**Command Menu:** Full-pane option list, section labels, tab indicators.

Files: `frontend/src/ui/mobile.ts`, `frontend/src/ui/touch-toolbar.ts`, `frontend/src/ui/mobile/`

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

### MenuNav Controller

All TUI screens share a single navigation controller (`MenuNav`) that handles vim keybindings, selection state, and input field navigation.

**Usage:** Create a `MenuNav` instance, delegate `keydown` events to it, and call `wireClickHandlers()` for mouse support.

**Provided behaviors:**
- j/k navigation with circular wrapping
- l/Space/Enter to select
- h/Backspace to go back, Escape to cancel
- Arrow ↑/↓ between input fields and option buttons
- Auto-blur input on Escape
- `renderSelection()` toggles `.selected` class

**Utilities:**
- `escapeHtml(text)` — safe entity escaping for dynamic content
- `renderHelpBar(bindings)` — generates `.pane-help` with `.help-key` spans

File: `frontend/src/ui/menu-nav.ts`
Used by: splash, auth dialog, remote selector, profile editor, theme selector

### Form Interaction Patterns

Forms combine terminal prompt inputs with option buttons. Navigation flows between them seamlessly:

- **↑/↓ arrows** move between input fields (when focused on an input)
- **↓ from last input** jumps to first option button
- **↑ from first option** jumps to last input field
- **Tab** advances to next field
- **Escape** blurs current input (returns to option navigation)
- **Enter in input** can submit (context-dependent)

**Validation:** Focus the first empty required field. No inline error messages — the focus itself indicates the problem.

**Conditional fields:** Toggle visibility with `display: none`. Re-focus first visible field in new group on mode switch.

### Multi-Screen Flows

Complex features use a screen stack (connections → projects → browse).

- Each screen is a full-pane replacement (consistent with Principle 4)
- h/Backspace pops back to previous screen
- Escape cancels entire flow
- State preserved when navigating back
- MenuNav instance per screen

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

### Don't: Equal-Weight Conversational Text

**Bad:**
- User input and assistant output at the same brightness
- Decorative left borders on every inline block type

**Instead:**
- De-emphasize what the user already knows (their own input)
- Emphasize what matters (the model's response)
- Differentiate blocks by icon and color, not borders

**Why:**
Visual weight should match information value. In a conversation, the response matters more than the prompt.

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
- `frontend/styles/` - CSS directory (see CSS directory structure above)
- `frontend/src/config/themes.ts` - Theme definitions
- `frontend/src/ui/menu-nav.ts` - MenuNav controller
- `frontend/src/ui/splash.ts` - Splash screen
- `frontend/src/ui/mobile.ts` - Mobile coordinator
- `frontend/src/remote/RemoteProjectSelector.ts` - Exemplar component
- `frontend/src/remote/RemoteProfileEditor.ts` - Binary toggle exemplar

---

**Summary:** CADE's design is intentionally terminal-first. When in doubt, ask: "Would this feel at home in tmux?" If yes, proceed. If no, rethink.
