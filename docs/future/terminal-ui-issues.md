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

This breaks Unix convention but prioritizes familiar copy/paste for CADE's browser-based environment.

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

**Medium Priority:** ✓ RESOLVED
- ~~Splash screen ASCII art (Issue #4)~~ - Removed `text-align: center` from CSS
- ~~Tab position bug (Issue #5)~~ - Added resize event dispatch in `setProportions()`

**Medium-High Priority:**
- Duplicate cursor (Issue #1) - Visual polish and consistency issue (deferred)
  - Two cursors is confusing and unprofessional
  - CSS fix would break cursor when using "exit to shell" in Claude terminal
  - Need smarter solution that detects Claude Code TUI vs shell mode
  - Important for vim integration goals (cursor consistency)

## Recommended Implementation Order

1. ~~**Phase 1: Quick CSS fixes**~~ ✓ DONE
   - ~~Splash screen ASCII art alignment~~ - Removed `text-align: center`
   - ~~Tab position bug~~ - Added resize event dispatch

2. ~~**Phase 2: Keyboard copy/paste**~~ ✓ DONE
   - Implemented Ctrl+C (copy), Ctrl+X (SIGINT), Ctrl+V (paste)

3. ~~**Phase 3: Context menu**~~ ✓ DONE
   - Implemented right-click copy/paste (context-aware based on selection)

4. **Phase 4: Cursor refinement** (Deferred)
   - CSS-only fix would break "exit to shell" functionality
   - Need to detect Claude Code TUI vs regular shell mode
   - Consider sequence filtering only when Claude Code is actively rendering

### ~~4. Splash Screen ASCII Art Misaligned~~ ✓ RESOLVED

**Resolution:** Removed `text-align: center` from `.splash-logo` in `main.css`. The parent `.splash` container already uses flexbox centering, so the text-align was unnecessary and was interfering with `<pre>` whitespace preservation.

**Related code:**
- `frontend/styles/main.css:1106-1112` - `.splash-logo` styling

### ~~5. Tab Position Bug on Project Switch~~ ✓ RESOLVED

**Resolution:** Added `window.dispatchEvent(new Event("resize"))` after `applyProportions()` in the `setProportions()` method in `layout.ts:261`. This ensures tabs update their positions immediately when switching between projects with different pane layouts.

**Root cause:** `setProportions()` updated CSS variables but didn't dispatch a resize event. Other layout methods (`adjustByKeyboard()`, `resetProportions()`) did dispatch resize events, causing inconsistent behavior.

**Related code:**
- `frontend/src/layout.ts:254-263` - `setProportions()` method

## Future Enhancements

Beyond fixing these issues, consider:
- Vim-style visual mode for text selection (aligns with project vim integration goals)
- Custom keyboard shortcuts for terminal operations
- Right-click context menu with terminal-specific options (Clear, Reset, Switch Terminal)
- Mouse-free copy/paste workflow (similar to tmux copy mode)
- Middle-click paste (X11-style)
- Bracketed paste mode support
