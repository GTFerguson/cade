# Terminal UI Issues

Issues with terminal display and interaction that need investigation and fixing.

## Current Issues

### 1. Duplicate Cursor (xterm + Claude Code)

**Symptom:** Two cursors display simultaneously - the xterm.js cursor (white) and Claude Code's own cursor.

**Root cause:**
- Claude Code renders its own cursor as part of its TUI
- xterm.js also renders a cursor by default
- The `hideCursor: true` option (terminal.ts:71) is set but not reliably hiding the xterm cursor
- The cursor may re-appear after certain ANSI sequences from Claude Code

**Current configuration:**
- Claude terminal: `hideCursor: true`, `cursorBlink: false`, `cursor: "transparent"`
- Manual terminal: Standard cursor visible (should be lime to match theme)

**Desired behavior:**
- **Claude terminal:** xterm cursor completely hidden (Claude renders its own)
- **Manual terminal:** Lime-colored blinking cursor for consistency with theme
- Both terminals should use lime (#aeee00) when cursor is visible

**Note:** This was attempted before and worked temporarily, but the cursor came back. Need to find a permanent solution.

**Investigation approach:**

1. Verify theme is being applied:
   - Check browser dev tools - inspect `.terminal-claude .xterm-cursor-layer`
   - Confirm `cursor: "transparent"` is in the xterm theme object
   - Monitor if theme gets reset or overridden

2. Test if Claude Code sends cursor control sequences:
   - Watch for ANSI cursor show sequences: `\x1b[?25h` (DECTCEM show)
   - Check if cursor appears after specific Claude Code output
   - Test if terminal reset triggers cursor reappearance

3. Determine if the issue is CSS or ANSI sequence based:
   - If cursor layer exists but is transparent → CSS working
   - If cursor layer is visible with color → theme not applied or overridden
   - If cursor appears/disappears → likely ANSI sequence issue

**Recommended solutions:**

**Option A: CSS override (most reliable)**
Force hide xterm cursor for Claude terminal regardless of theme state:

```css
/* In frontend/styles/main.css */
.terminal-claude .xterm-cursor-layer {
  display: none !important;
}

/* Ensure manual terminal has lime cursor */
.terminal-manual .xterm-cursor-layer .xterm-cursor-block {
  background-color: #aeee00 !important; /* lime */
}
```

Pros:
- Most reliable - CSS !important overrides any JS theme changes
- Simple to implement
- Guaranteed to work regardless of ANSI sequences

Cons:
- Uses !important (but justified for this use case)

**Option B: Filter cursor control sequences**
Strip cursor show/hide sequences from Claude Code output:

```typescript
// In backend/websocket.py or frontend before write
private handleOutput(message: OutputMessage): void {
  const sessionKey = message.sessionKey ?? SessionKey.CLAUDE;

  if (sessionKey === SessionKey.CLAUDE) {
    // Strip cursor show sequences from Claude output
    let data = message.data;
    data = data.replace(/\x1b\[\?25h/g, ''); // Remove DECTCEM show cursor
    data = data.replace(/\x1b\[\?12h/g, ''); // Remove cursor blink enable

    this.claudeTerminal?.write(data);
  } else if (sessionKey === SessionKey.MANUAL && this.manualTerminal) {
    this.manualTerminal.write(message.data);
  }
}
```

Pros:
- Prevents Claude from controlling cursor visibility
- More surgical approach

Cons:
- May need to strip multiple escape sequences
- Could miss edge cases

**Option C: Force cursor hidden after each write**
Append hide cursor sequence after every Claude write:

```typescript
// In terminal-manager.ts handleOutput
private handleOutput(message: OutputMessage): void {
  const sessionKey = message.sessionKey ?? SessionKey.CLAUDE;

  if (sessionKey === SessionKey.CLAUDE) {
    this.claudeTerminal?.write(message.data);
    // Force cursor hidden after Claude writes
    this.claudeTerminal?.write('\x1b[?25l'); // DECTCEM hide cursor
  } else if (sessionKey === SessionKey.MANUAL && this.manualTerminal) {
    this.manualTerminal.write(message.data);
  }
}
```

Pros:
- Simple to implement
- Works even if Claude sends show cursor sequences

Cons:
- Adds overhead to every write
- Reactive rather than preventive

**Recommended approach: Option A (CSS) + Option B (filter)**
- Use CSS override as primary solution (guaranteed to work)
- Optionally filter sequences to prevent Claude from trying to show cursor
- This provides defense in depth

**Additional: Ensure manual terminal cursor consistency**

The manual terminal should display a lime-colored blinking cursor. Current theme has `cursor: "#aeee00"` (lime) defined in BADWOLF_THEME, but verify it's actually rendering correctly.

If the manual terminal cursor is not lime:
```css
/* Force lime cursor for manual terminal */
.terminal-manual .xterm-cursor-layer .xterm-cursor-block {
  background-color: #aeee00 !important; /* lime - matches BADWOLF_THEME */
}

/* Ensure cursor blinks */
.terminal-manual .xterm-cursor-blink {
  animation: xterm-cursor-blink 1.2s infinite step-end;
}
```

This ensures consistent cursor appearance across both terminals:
- Claude terminal: No xterm cursor (Claude renders its own)
- Manual terminal: Lime blinking cursor (matches vim cursor, theme accent)

**Related code:**
- `frontend/src/terminal.ts:71` - `hideCursor` option in constructor
- `frontend/src/terminal.ts:78-80` - Theme with `cursor: "transparent"` when `hideCursor: true`
- `frontend/src/terminal.ts:83` - `cursorBlink: !this.hideCursor`
- `frontend/src/terminal.ts:17-43` - `BADWOLF_THEME` with `cursor: "#aeee00"` (lime)
- `frontend/src/terminal-manager.ts:49-54` - Claude terminal created with `hideCursor: true`
- `frontend/src/terminal-manager.ts:105-109` - Manual terminal created without `hideCursor`
- `frontend/src/terminal-manager.ts:70-77` - Output handling and routing

### ~~2. Copy Keyboard Shortcuts Not Working~~ ✓ RESOLVED

**Resolution:** Implemented custom keyboard shortcuts in `terminal.ts`:

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selection to clipboard |
| `Ctrl+X` | Send SIGINT (interrupt) |
| `Ctrl+V` | Paste from clipboard |

This breaks Unix convention but prioritizes familiar copy/paste for ccplus's browser-based environment.

**Commit:** `8b83f9b` - Remap terminal copy/paste shortcuts for browser compatibility

### ~~3. Right-Click Shows "Copy Image"~~ ✓ RESOLVED

**Resolution:** Implemented custom context menu handler that:
- Copies selected text on right-click (when text is selected)
- Pastes from clipboard on right-click (when no selection)

**Commit:** `8b83f9b` - Remap terminal copy/paste shortcuts for browser compatibility

## Investigation Tasks

**Cursor Issues:**
- [ ] Inspect `.terminal-claude .xterm-cursor-layer` in browser dev tools
- [ ] Verify if cursor is transparent or showing with a color
- [ ] Check Claude Code output for cursor control sequences (`\x1b[?25h`)
- [ ] Test if cursor appears after terminal reset
- [ ] Confirm manual terminal cursor is lime-colored and blinking

**Copy/Paste Issues:** ✓ RESOLVED
- [x] Implemented Ctrl+C for copy, Ctrl+X for SIGINT, Ctrl+V for paste
- [x] Implemented right-click context menu (copy with selection, paste without)

## Priority Assessment

**High Priority:** ✓ RESOLVED
- ~~Copy/paste functionality (Issue #2, #3)~~ - Implemented in commit `8b83f9b`

**Medium Priority:**
- Splash screen ASCII art (Issue #4) - First impression issue
  - Users see this on every startup
  - Quick CSS fix, high visual impact
  - Shows attention to polish and detail

**Medium-High Priority:**
- Duplicate cursor (Issue #1) - Visual polish and consistency issue
  - Two cursors is confusing and unprofessional
  - Quick CSS fix should resolve it permanently
  - Important for vim integration goals (cursor consistency)
  - Shows attention to detail in terminal implementation

## Recommended Implementation Order

1. **Phase 1: Quick CSS fixes** (Quick wins - high visual impact)

   a. Splash screen ASCII art alignment
   - Update `.splash-logo` CSS: `white-space: pre`, proper centering
   - Estimated effort: 5 minutes

   b. Cursor visibility
   - Add CSS override: `.terminal-claude .xterm-cursor-layer { display: none !important; }`
   - Verify manual terminal lime cursor: `.terminal-manual .xterm-cursor-layer .xterm-cursor-block`
   - Estimated effort: 10 minutes

   **Total Phase 1:** ~15 minutes, fixes 2 visual issues

2. ~~**Phase 2: Keyboard copy/paste**~~ ✓ DONE
   - Implemented Ctrl+C (copy), Ctrl+X (SIGINT), Ctrl+V (paste)

3. ~~**Phase 3: Context menu**~~ ✓ DONE
   - Implemented right-click copy/paste (context-aware based on selection)

4. **Phase 4: Cursor refinement** (Optional polish)
   - Test if cursor control sequence filtering is needed
   - Investigate if CSS solution is sufficient or needs augmentation
   - Estimated effort: 30 minutes - 1 hour

### 4. Splash Screen ASCII Art Misaligned

**Symptom:** ASCII art on the splash screen displays incorrectly - spaces at the start of lines aren't preserved, causing misalignment.

**Root cause:**
The `.splash-logo` CSS has `text-align: center` (main.css:1111) which can interfere with leading whitespace in `<pre>` elements. Additionally, there's no explicit `white-space: pre` declaration to guarantee whitespace preservation.

**Current code:**
```typescript
// frontend/src/splash.ts:26-28
const logo = document.createElement("pre");
logo.className = "splash-logo";
logo.textContent = CADE_LOGO;
```

```css
/* frontend/styles/main.css:1106-1111 */
.splash-logo {
  color: var(--accent-red);
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.2;
  text-align: center;  /* This causes the issue */
}
```

**Recommended solution:**

Replace `text-align: center` with proper block centering and add explicit whitespace preservation:

```css
.splash-logo {
  color: var(--accent-red);
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.2;
  white-space: pre;        /* Explicitly preserve all whitespace */
  margin: 0 auto;          /* Center the block itself */
  display: inline-block;   /* Allow margin auto to work */
  text-align: left;        /* Keep text left-aligned within the block */
}
```

This approach:
- Explicitly preserves all spaces and newlines with `white-space: pre`
- Centers the ASCII art block itself using `margin: 0 auto` + `inline-block`
- Keeps the text left-aligned within the block so leading spaces are maintained
- Prevents browser from collapsing or normalizing whitespace

**Alternative approach:**

If the ASCII art still doesn't align, consider wrapping it in a centered container:

```html
<div class="splash-logo-wrapper">
  <pre class="splash-logo">...</pre>
</div>
```

```css
.splash-logo-wrapper {
  display: flex;
  justify-content: center;
}

.splash-logo {
  color: var(--accent-red);
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.2;
  white-space: pre;
  text-align: left;
}
```

**Related code:**
- `frontend/src/splash.ts:6-13` - CADE_LOGO ASCII art definition
- `frontend/src/splash.ts:26-28` - Logo element creation
- `frontend/styles/main.css:1106-1111` - `.splash-logo` styling

## Future Enhancements

Beyond fixing these issues, consider:
- Vim-style visual mode for text selection (aligns with project vim integration goals)
- Custom keyboard shortcuts for terminal operations
- Right-click context menu with terminal-specific options (Clear, Reset, Switch Terminal)
- Mouse-free copy/paste workflow (similar to tmux copy mode)
- Middle-click paste (X11-style)
- Bracketed paste mode support
