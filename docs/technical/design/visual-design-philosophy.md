---
title: Visual Design Philosophy
created: 2026-02-04
updated: 2026-02-04
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
- Badwolf color scheme for consistency
- ASCII art and bracket notation over rounded corners and gradients
- Screen-based navigation (full-pane replacements, not overlays)

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

**Why brackets:**
- Terminal/ASCII aesthetic
- Clear visual boundaries without borders
- Consistent with tmux/vim status line conventions
- Easy to distinguish interactive vs informational text

### Color Scheme: Badwolf

CADE uses the Badwolf color palette throughout.

**Key Colors:**

| Usage | Color | Variable |
|-------|-------|----------|
| Background (primary) | `#1c1b1a` | `--bg-primary` |
| Background (secondary) | `#242321` | `--bg-secondary` |
| Text (primary) | `#f8f6f2` | `--text-primary` |
| Text (muted) | `#857f78` | `--text-muted` |
| Accent (red/headers) | `#ff2c4b` | `--accent-red` |
| Accent (green/prompts) | `#aeee00` | `--accent-green` |
| Accent (blue/paths) | `#0a9dff` | `--accent-blue` |
| Accent (yellow/highlights) | `#ffa724` | `--accent-yellow` |

> [!TIP]
> Use semantic CSS variables, not raw hex values. This maintains consistency and allows future theme variants.

### Typography

**Monospace everywhere:**
- Font stack: `'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace`
- Line height: `1.5` for readability
- Letter spacing: `0.5px` (slightly looser for clarity)

**Hierarchy:**

| Element | Size | Color | Transform |
|---------|------|-------|-----------|
| Headers | `16px` | `--accent-red` | `UPPERCASE` + `letter-spacing: 2px` |
| Options | `14px` | `--text-primary` | As-is |
| Labels | `12px` | `--text-muted` | lowercase |
| Help text | `13px` | `--text-muted` | As-is |

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
- Cursor: block style when possible

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
- Selected state: yellow highlight (`--accent-yellow`)
- Keyboard navigation: j/k to move, l/space/enter to select
- Mouse optional: click to select and activate
- Dividers separate sections (saved vs new actions)

### Headers

**Centered with breathing room:**
```css
.pane-header {
  font-size: 16px;
  color: var(--accent-red);
  letter-spacing: 2px;
  text-align: center;
  text-transform: uppercase;
  margin-bottom: 24px; /* breathing room */
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
- Muted colors (`--text-muted`)
- Highlight keybindings (`--accent-yellow` background, dark text)

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

**File browser:**
- j/k: navigate directories + "select current" button
- l/space/enter: enter directory OR confirm selection (context-aware)
- h/backspace: parent directory

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

### ❌ Don't: Generic Web UI

**Bad:**
- Rounded corners on everything
- Drop shadows and blur effects
- Cards with padding and borders
- Gradients and animations
- Material Design / Bootstrap aesthetics

**Why:**
These visual patterns scream "web app" and clash with terminal aesthetics.

### ❌ Don't: Modal Overlays

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

### ❌ Don't: Inconsistent Keybindings

**Bad:**
- Splash uses only Enter
- Remote selector uses l/space/enter
- File browser uses only space

**Why:**
Users can't build muscle memory. Every screen feels different.

### ❌ Don't: Mouse-Required Interactions

**Bad:**
- Drag-and-drop as only option
- Hover-only tooltips with critical info
- Click-only buttons with no keyboard equivalent

**Why:**
CADE is keyboard-first. Mouse support should be convenience, not necessity.

### ❌ Don't: Auto-Restore Without Choice

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

## Examples

### Good: Remote Project Selector

**Why it works:**
- Full-pane replacement (not modal)
- Bracket notation throughout: `[ BROWSE ]`, `[project name]`
- Vim keybindings: j/k navigate, l select, h back
- Terminal prompt inputs: `name: ___`
- Reuses WebSocket file-tree protocol (DRY)
- Badwolf colors consistently applied

### Good: Session Resume Splash

**Why it works:**
- Opt-in restoration (user chooses)
- Top option when available (easy to access)
- Keyboard-first: j/k + l/space/enter
- ASCII logo + bracket status: `[RESUME SESSION]`
- Clean, centered layout

### Bad: Hypothetical "Settings Modal"

**Why it fails:**
- Modal overlays clash with terminal aesthetic
- Requires mouse to close (X button in corner)
- Form fields look like web forms, not terminal
- Inconsistent keybindings (Tab to navigate?)
- Auto-saves settings without confirmation

**Better approach:**
Full-pane settings screen:
- Bracket headers: `[ SETTINGS ]`
- Terminal-style prompts: `theme: ___`
- Vim navigation between fields
- h to cancel, l to save
- Screen replacement, not overlay

## Future Considerations

### Themes

If CADE adds theme support:
- Keep Badwolf as default/canonical
- Other themes should maintain terminal aesthetic
- Avoid "light mode with pastels" (breaks philosophy)
- Consider: Gruvbox, Nord, Dracula (terminal-focused palettes)

### Mobile/Touch

CADE's desktop-first philosophy may not translate to mobile:
- Touch requires larger targets (conflicts with dense terminal layout)
- Virtual keyboard reduces screen space
- Touch gestures don't map to vim keybindings

**Recommendation:** Keep mobile as "view-only" or simplified interface, not primary target.

### Accessibility

Terminal aesthetics can conflict with accessibility:
- Monospace may be less readable for some users
- Low contrast in some Badwolf combinations
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
- `frontend/src/remote/RemoteProjectSelector.ts` - Exemplar component

---

**Summary:** CADE's design is intentionally terminal-first. When in doubt, ask: "Would this feel at home in tmux?" If yes, proceed. If no, rethink.
