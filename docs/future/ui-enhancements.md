---
title: UI Enhancements
created: 2026-01-18
updated: 2026-01-18
status: future
tags: [future, ui, tabs, security, privacy, keybindings]
---

# UI Enhancements

User interface improvements for better usability and workflow control.

## Tab Renaming

**Problem**: Project tabs are automatically named based on the folder name extracted from the project path. There's no way to customize tab names for better organization.

**Current behavior:**
- Tab name is derived from the last segment of the project path
- Example: `/home/user/projects/my-awesome-project` → "my-awesome-project"
- Name is auto-updated when the server confirms working directory
- No user control over the display name

**Use cases for custom tab names:**
- Distinguish between multiple tabs for the same project (different branches/sessions)
- Use shorter, more readable names for deeply nested projects
- Add context: "Frontend", "Backend", "Tests", etc.
- Organize tabs semantically rather than by folder structure

### Proposed Solution

Add the ability to rename tabs via double-click or keyboard shortcut.

#### Option A: Double-Click to Rename

**User interaction:**
1. Double-click on a tab name
2. Tab name becomes an editable text field
3. Type the new name
4. Press Enter to save, Esc to cancel
5. Click outside to save and close

**Implementation:**
```typescript
// In tab-bar.ts createTabElement()
nameEl.addEventListener('dblclick', (e) => {
  e.stopPropagation();
  this.enterEditMode(nameEl, tab.id);
});

private enterEditMode(nameEl: HTMLElement, tabId: string): void {
  const currentName = nameEl.textContent ?? '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-name-input';
  input.value = currentName;
  input.addEventListener('blur', () => this.exitEditMode(input, tabId));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      this.exitEditMode(input, tabId);
    } else if (e.key === 'Escape') {
      this.emit('tab-rename-cancel', tabId);
      this.render(); // Re-render to restore original state
    }
  });

  nameEl.replaceWith(input);
  input.focus();
  input.select();
}

private exitEditMode(input: HTMLInputElement, tabId: string): void {
  const newName = input.value.trim();
  if (newName && newName !== input.defaultValue) {
    this.emit('tab-rename', { tabId, newName });
  }
}
```

**Tab manager changes:**
```typescript
// In tab-manager.ts
renameTab(id: string, newName: string): void {
  const tab = this.tabs.get(id);
  if (tab) {
    tab.name = newName;
    this.saveState();
    this.emit("tabs-changed", this.getTabs());
  }
}
```

**State persistence:**
The custom name is already stored in localStorage as part of the TabInfo interface. Just need to:
- Allow manual updates to `tab.name`
- Preserve custom names across sessions
- Optionally: Add a flag to distinguish auto-generated vs custom names

#### Option B: Context Menu Rename

Right-click on tab → "Rename..." option → Modal dialog for entering new name.

**Pros:**
- More discoverable for new users
- Can include additional context/help text
- Consistent with traditional desktop UI patterns

**Cons:**
- Requires implementing context menu system
- More clicks than double-click
- Modal dialog interrupts flow

#### Option C: Keyboard Shortcut

Press a key combination (e.g., `F2`, `Ctrl+r`) while tab is focused to enter edit mode.

**Implementation:**
Would need to add keyboard focus to tabs and handle F2 key:

```typescript
// In keybinding manager, add tab-specific bindings
if (e.key === 'F2' && focusedPane === 'tab-bar') {
  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    tabBar.startRenameMode(activeTab.id);
  }
  return true;
}
```

**Pros:**
- Keyboard-first workflow (aligns with vim philosophy)
- No mouse required
- F2 is standard rename key in many applications

**Cons:**
- Less discoverable than double-click
- Requires tab focus mechanism

#### Recommended Approach

**Combine Option A + Option C:**
- Double-click for mouse users (intuitive, widely understood)
- F2 key for keyboard users (standard convention, efficient)
- Both methods enter the same inline edit mode

This provides maximum flexibility while keeping the implementation simple.

### Additional Considerations

**Reset to auto-generated name:**
- Add a "Reset" button or action to revert to folder-based name
- Could be triggered by clearing the input field or a special command

**Visual indication:**
- Show a subtle icon or indicator for custom-named tabs
- Helps distinguish between auto-generated and user-defined names

**Validation:**
- Prevent empty names
- Limit name length (e.g., 50 characters)
- Optionally: Prevent duplicate tab names (or allow with warning)

**Persistence edge case:**
- If `updateTabPath()` is called after user renames, should it override the custom name?
- Recommendation: Preserve custom names, only auto-update if name hasn't been manually changed

### Related Code

- `frontend/src/tabs/tab-bar.ts:56-83` - Tab element creation
- `frontend/src/tabs/tab-manager.ts:26-33` - `getProjectName()` auto-naming logic
- `frontend/src/tabs/tab-manager.ts:216-224` - `updateTabPath()`
- `frontend/src/tabs/tab-manager.ts:314-332` - State persistence
- `frontend/src/tabs/types.ts` - TabInfo interface

## Lock Screen

**Problem**: When stepping away from the computer, there's no way to lock CADE while keeping all processes running. Sensitive terminal output, code, and Claude conversations remain visible on screen.

**Use cases:**
- Privacy when working in public spaces (coffee shops, coworking)
- Security when leaving workstation temporarily
- Prevent accidental input when AFK
- Compliance with security policies (auto-lock after idle time)

### Proposed Solution

Full-screen lock overlay that blocks all input except the unlock keybinding, while all background processes continue running normally.

#### Core Requirements

**Lock behavior:**
- Display full-screen splash/lock screen over entire UI
- Block all keyboard input except unlock shortcut
- Block all mouse input (clicks, scrolling, selection)
- Terminals, websockets, and Claude Code continue running in background
- PTY sessions remain active and buffer output
- File watchers continue monitoring for changes

**Unlock behavior:**
- Press unlock keybinding (e.g., password or key sequence)
- Smoothly fade lock screen away
- Return to exact state before locking (scroll positions, focus, etc.)
- Show any notifications or changes that occurred while locked

#### Option A: Simple Keybinding Lock

Press a key sequence to unlock (no password required).

**Lock trigger:**
- Keyboard shortcut: `Ctrl+Shift+L` or similar
- Auto-lock: After N minutes of inactivity (configurable)

**Unlock trigger:**
- Same keyboard shortcut: `Ctrl+Shift+L`
- Or specific unlock sequence: Press Space or Enter

**Implementation:**
```typescript
// In main app component
private lockScreen: LockScreen | null = null;
private isLocked = false;
private idleTimer: number | null = null;

lockApplication(): void {
  if (this.isLocked) return;

  this.isLocked = true;
  this.lockScreen = new LockScreen(document.body, {
    onUnlock: () => this.unlockApplication()
  });
  this.lockScreen.show();

  // Stop idle timer
  if (this.idleTimer !== null) {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

unlockApplication(): void {
  if (!this.isLocked) return;

  this.isLocked = false;
  this.lockScreen?.hide();
  this.lockScreen = null;

  // Restart idle timer
  this.resetIdleTimer();
}

resetIdleTimer(): void {
  if (this.idleTimer !== null) {
    window.clearTimeout(this.idleTimer);
  }

  const idleTimeout = this.config.lockScreenIdleMinutes;
  if (idleTimeout > 0) {
    this.idleTimer = window.setTimeout(
      () => this.lockApplication(),
      idleTimeout * 60 * 1000
    );
  }
}
```

**Lock screen component:**
```typescript
// frontend/src/lock-screen.ts
export class LockScreen {
  private overlay: HTMLElement;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private options: { onUnlock: () => void }
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'lock-screen';

    const logo = document.createElement('pre');
    logo.className = 'lock-logo';
    logo.textContent = CADE_LOGO; // Reuse splash screen logo

    const statusEl = document.createElement('div');
    statusEl.className = 'lock-status';
    statusEl.textContent = '[locked - press space to unlock]';
    statusEl.classList.add('blink');

    this.overlay.appendChild(logo);
    this.overlay.appendChild(statusEl);

    this.setupKeyListener();
  }

  private setupKeyListener(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Block ALL keys except unlock sequence
      e.preventDefault();
      e.stopPropagation();

      if (e.key === ' ' || e.key === 'Enter') {
        this.options.onUnlock();
      }
    };

    // Capture phase to intercept before ALL other handlers
    document.addEventListener('keydown', this.keyHandler, true);

    // Block mouse events
    this.overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);

    this.overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  show(): void {
    this.container.appendChild(this.overlay);
    // Prevent body scrolling while locked
    document.body.style.overflow = 'hidden';
  }

  hide(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }

    this.overlay.classList.add('hidden');
    document.body.style.overflow = '';

    setTimeout(() => this.overlay.remove(), 300); // Wait for fade animation
  }
}
```

**CSS:**
```css
.lock-screen {
  position: fixed;
  inset: 0;
  z-index: 9999; /* Above everything */
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  opacity: 1;
  transition: opacity 0.3s ease;
  cursor: default;
}

.lock-screen.hidden {
  opacity: 0;
  pointer-events: none;
}

.lock-logo {
  color: var(--accent-red);
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.2;
  white-space: pre;
  text-align: center;
}

.lock-status {
  color: var(--accent-red);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: center;
}

.lock-status.blink {
  animation: blink 1s step-end infinite;
}
```

**Pros:**
- Simple implementation
- No password to remember/type
- Fast unlock (single keypress)
- Good for quick privacy (screen locked while getting coffee)

**Cons:**
- No authentication - anyone can unlock by pressing Space
- Security is visual privacy only, not access control
- Not suitable for high-security environments

#### Option B: Password Lock

Require entering a password or PIN to unlock.

**Lock trigger:**
- Same as Option A

**Unlock trigger:**
- Type password, press Enter
- Password stored in config or set on first lock

**Implementation additions:**
```typescript
private passwordInput: HTMLInputElement;

constructor(container: HTMLElement, options: LockOptions) {
  // ... create overlay ...

  const inputContainer = document.createElement('div');
  inputContainer.className = 'lock-input-container';

  this.passwordInput = document.createElement('input');
  this.passwordInput.type = 'password';
  this.passwordInput.className = 'lock-password-input';
  this.passwordInput.placeholder = 'Enter password to unlock';
  this.passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      this.attemptUnlock();
    } else if (e.key === 'Escape') {
      this.passwordInput.value = '';
    }
  });

  inputContainer.appendChild(this.passwordInput);
  this.overlay.appendChild(inputContainer);

  // Auto-focus password input
  setTimeout(() => this.passwordInput.focus(), 100);
}

private attemptUnlock(): void {
  const enteredPassword = this.passwordInput.value;
  const storedPassword = this.options.password ?? '';

  if (enteredPassword === storedPassword) {
    this.options.onUnlock();
  } else {
    // Show error
    this.showError('Incorrect password');
    this.passwordInput.value = '';
    this.passwordInput.classList.add('error');
    setTimeout(() => this.passwordInput.classList.remove('error'), 500);
  }
}
```

**Configuration:**
```typescript
// In user config
interface UserConfig {
  lockScreen?: {
    enabled: boolean;
    autoLockMinutes: number;  // 0 = disabled
    requirePassword: boolean;
    password?: string;  // Optional password (hashed in production)
  };
}
```

**Pros:**
- Actual security, not just privacy
- Suitable for shared workstations
- Configurable password strength

**Cons:**
- More complex to implement
- Slower unlock (need to type password)
- Need to handle forgotten passwords
- Security concerns: storing password, hashing, etc.

#### Option C: System Lock Integration

Trigger the OS lock screen (Windows Lock, macOS login screen, Linux screensaver).

**Implementation:**
```typescript
// Call OS lock screen via Electron (if packaged) or browser fullscreen API
lockApplication(): void {
  if (window.electronAPI) {
    window.electronAPI.lockScreen();
  } else {
    // Fallback to custom lock screen
    this.showCustomLockScreen();
  }
}
```

**Pros:**
- Uses system authentication
- Integrates with OS security policies
- Familiar to users

**Cons:**
- Requires Electron or native integration
- Doesn't work in browser-only mode
- Less control over UX

#### Recommended Approach

**Start with Option A (Simple Keybinding Lock), with Option B as future enhancement:**

**Phase 1: Simple lock (MVP)**
- `Ctrl+Shift+L` to lock/unlock
- Or press Space/Enter to unlock
- Full-screen overlay, block all input
- Auto-lock after N minutes idle (configurable)
- No password required

**Phase 2: Password option (security enhancement)**
- Add config option: `lockScreen.requirePassword`
- If enabled, prompt for password on first lock
- Store hashed password in config
- Show password input on lock screen
- Validate password on unlock attempt

**Phase 3: Advanced features**
- Multiple unlock methods (password + keybinding)
- Lock screen customization (logo, message, theme)
- Lock history/audit log
- Emergency unlock code (in case of forgotten password)

### Additional Features

**Lock screen display options:**
- Show clock/time while locked
- Show system status (battery, network)
- Custom lock message ("Be back soon", "In a meeting", etc.)
- Blank screen mode (complete privacy, no logo)

**Idle detection:**
- Track keyboard and mouse activity
- Configurable idle threshold (minutes)
- Warning before auto-lock ("Locking in 30 seconds...")
- Disable auto-lock when terminal is active (optional)

**Security enhancements:**
- Failed unlock attempt counter
- Temporary lockout after N failed attempts
- Notification when unlocked (show time locked)
- Log lock/unlock events

**Integration:**
- Lock automatically when system goes to sleep
- Unlock when system wakes (or require re-auth)
- Lock on window blur (when CADE loses focus)
- Preserve lock state across tab refreshes

### Configuration Example

```json
{
  "lockScreen": {
    "enabled": true,
    "lockKeybinding": "Ctrl+Shift+L",
    "autoLockMinutes": 10,
    "requirePassword": false,
    "showClock": true,
    "lockMessage": "",
    "blankScreen": false,
    "lockOnBlur": false
  }
}
```

### Keybindings Summary

| Keybinding | Action |
|------------|--------|
| `Ctrl+Shift+L` | Toggle lock screen |
| `Space` or `Enter` | Unlock (when password not required) |
| `Esc` | Clear password input |

### Related Code

- `frontend/src/splash.ts` - Can reuse splash screen component/styles
- `frontend/src/keybindings.ts` - Add lock keybinding handler
- `frontend/src/user-config.ts` - Lock screen configuration
- `frontend/src/main.ts` or app root - Idle timer and lock state management

## Terminal Pane Visual Hierarchy

**Problem**: The terminal pane has the same background color as the file tree and viewer panes. This doesn't guide the user's focus to where the primary interaction happens (the terminal).

**Goal**: Make the terminal/Claude pane visually prominent to:
- Draw user's focus to the primary interaction area
- Create clear visual hierarchy (terminal = focus, sidebars = context)
- Match common IDE patterns (VSCode darkens terminal, IntelliJ darkens console)
- Improve workflow clarity - eyes naturally go to the work area

### Current State

All panes use the same background:
```
┌──────────┬──────────┬──────────┐
│          │          │          │
│  File    │ Terminal │ Markdown │
│  Tree    │ (Claude) │  Viewer  │
│          │          │          │
│  Same bg │  Same bg │  Same bg │
└──────────┴──────────┴──────────┘
```

### Proposed Design

Darken the terminal pane to create focus:
```
┌──────────┬──────────┬──────────┐
│          │▓▓▓▓▓▓▓▓▓▓│          │
│  File    │▓Terminal▓│ Markdown │
│  Tree    │▓(Claude)▓│  Viewer  │
│          │▓▓▓▓▓▓▓▓▓▓│          │
│  Lighter │  Darker  │  Lighter │
└──────────┴──────────┴──────────┘
```

### Implementation

**CSS changes:**

```css
/* Terminal pane - darker background for focus */
.terminal-pane {
  background: #0f0e0d; /* Darker than primary bg */
}

/* Or use CSS variable for consistency */
:root {
  --bg-primary: #1c1b1a;      /* Current background (blackgravel) */
  --bg-terminal: #0f0e0d;     /* Darker for terminal (blackestgravel) */
  --bg-secondary: #242321;    /* Lighter for headers/UI */
  --bg-tertiary: #35322d;     /* Even lighter for cards */
}

.terminal-pane,
.terminal-container {
  background: var(--bg-terminal);
}
```

**Visual hierarchy:**
```
Darkest  → Terminal pane (primary focus)
  ↓
Dark     → Main background (file tree, viewer content)
  ↓
Medium   → Headers, status bars
  ↓
Light    → Cards, hover states
```

### Color Options

**Option A: Subtle darkening (recommended)**
- Main background: `#1c1b1a` (blackgravel)
- Terminal background: `#0f0e0d` (blackestgravel - from Badwolf theme)
- Difference: Subtle but noticeable
- Pros: Maintains cohesion, not jarring
- Cons: May be too subtle for some users

**Option B: Moderate darkening**
- Main background: `#1c1b1a`
- Terminal background: `#0a0909` (darker than Badwolf palette)
- Difference: More pronounced
- Pros: Clearer focus separation
- Cons: May feel too dark, requires testing

**Option C: Alternative - Lighten sidebars instead**
- Main background: `#1c1b1a` (terminal stays this color)
- Sidebar background: `#242321` (lighter - between primary and secondary)
- Difference: Same visual effect, reversed
- Pros: Terminal keeps the "true" background
- Cons: May make sidebars feel disconnected

**Recommended: Option A** - Use Badwolf's blackestgravel for terminal, keeps color palette consistent.

### Additional Refinements

**Pane borders:**
```css
/* Subtle borders to reinforce hierarchy */
.terminal-pane {
  background: var(--bg-terminal);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}
```

**Terminal status indicator:**
Consider darkening the `[claude]` / `[shell]` status indicator background to match:
```css
.terminal-status-indicator {
  background: rgba(0, 0, 0, 0.3); /* Darker overlay on already-dark bg */
}
```

**Gradual transitions:**
```css
.terminal-pane {
  background: var(--bg-terminal);
  transition: background-color 0.2s ease;
}

/* Could add subtle glow when terminal is active/typing */
.terminal-pane.active {
  box-shadow: inset 0 0 0 1px rgba(174, 238, 0, 0.1); /* Subtle lime glow */
}
```

### User Configuration

Make this configurable in user settings:

```json
{
  "appearance": {
    "terminalDarkerBackground": true,  // Default: true
    "terminalBackgroundOpacity": 0.8    // 0-1 scale for darkness
  }
}
```

This allows users who prefer uniform backgrounds to disable it.

### Testing Checklist

- [ ] Test readability of terminal text on darker background
- [ ] Ensure cursor is still visible (already lime - should be fine)
- [ ] Test with different terminal content (lots of text, errors, etc.)
- [ ] Verify status indicator `[claude]` / `[shell]` is readable
- [ ] Test in different lighting conditions (bright room, dark room)
- [ ] Ensure file tree and viewer don't feel "washed out" by comparison
- [ ] Test border visibility between panes

### Related Code

- `frontend/styles/main.css` - Terminal pane styling
- `frontend/src/terminal.ts:17-43` - BADWOLF_THEME color definitions
- Color variables likely defined in main.css `:root` or theme section

### Alternative Approaches

**Approach 1: Subtle backdrop**
Instead of changing background, add a subtle dark overlay:
```css
.terminal-pane::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
  pointer-events: none;
  z-index: 0;
}
```

**Approach 2: Inverse - Brighten active pane**
Make the focused/active pane slightly brighter instead of darker. Less common but could work.

**Approach 3: Colored accent**
Add a subtle colored tint to the terminal pane (very subtle lime or blue):
```css
.terminal-pane {
  background: linear-gradient(
    to bottom,
    rgba(174, 238, 0, 0.02),
    transparent
  ), var(--bg-primary);
}
```

## Priority Assessment

**High Priority:**
- Terminal pane darker background
  - Quick CSS change (~5 minutes)
  - High visual impact
  - Improves focus and usability
  - Aligns with IDE conventions

- Lock screen (MVP - simple keybinding lock)
  - Important for privacy and security
  - Common use case for remote/public work
  - Relatively simple to implement (reuse splash screen)
  - High value-to-effort ratio

**Medium Priority:**
- Tab renaming
  - Quality of life improvement
  - Enhances organization for power users
  - Moderate implementation complexity
  - Low risk, high polish factor

**Future Enhancements:**
- Password-based lock screen
- System lock integration
- Advanced lock features (audit log, custom messages, etc.)
- Configurable terminal background darkness

## Implementation Phases

**Phase 1: Lock Screen MVP**
1. Create `LockScreen` component (reuse splash screen styling)
2. Add lock/unlock state management to main app
3. Implement keybinding toggle (`Ctrl+Shift+L`)
4. Add idle timer with configurable timeout
5. Block all input except unlock key
6. Test that background processes continue running

**Phase 2: Tab Renaming**
1. Add double-click handler to tab names
2. Create inline edit input field
3. Implement save/cancel logic
4. Add `renameTab()` method to TabManager
5. Persist custom names to localStorage
6. Add F2 keyboard shortcut for rename

**Phase 3: Lock Screen Enhancements**
1. Add password option to config
2. Implement password validation
3. Add lock screen customization options
4. Implement failed attempt handling
5. Add lock event logging

## Help Modal Not Appearing

**Problem**: The help keyboard shortcut (`prefix` + `?`, default `Ctrl+a` then `?`) doesn't bring up the help modal showing keybindings.

**Current state:**
- HelpOverlay component exists and is implemented (`frontend/src/help-overlay.ts`)
- Component is initialized in main app (`main.ts:62`)
- Keybinding handler calls `showHelp()` callback (`keybindings.ts:270-272`)
- CSS styles are defined and look correct (`.help-overlay` with `.visible` class)
- Default keybinding is configured as `"?"` in config (`user-config.ts:218`)

**Possible causes:**

1. **Prefix mode issue**: The help binding is `"?"` which requires prefix key first (`Ctrl+a` then `?`). If prefix mode isn't working correctly, the `?` key might not be recognized.

2. **Key event interception**: Another handler (terminal, viewer, file tree) might be capturing the `?` key before it reaches the keybinding manager.

3. **Shift key confusion**: On US keyboards, `?` requires `Shift+/`. The keybinding matcher might be looking for literal `?` but receiving `Shift+/` key events.

4. **Focus issue**: The help keybinding might only work when certain elements are focused.

### Investigation Steps

1. **Test the help overlay directly:**
   - Open browser console
   - Run: `app.helpOverlay.show()`
   - If this works, the component is fine and it's a keybinding issue

2. **Check prefix mode:**
   - Test other prefix bindings (e.g., `Ctrl+a` then `f` for focus left)
   - If those don't work, prefix mode is broken
   - If they work, `?` key specifically has an issue

3. **Test alternative binding:**
   - Temporarily change help binding from `"?"` to `"h"` in config
   - Test `Ctrl+a` then `h`
   - If this works, it's a `?` key matching issue

4. **Check event flow:**
   - Add logging to `keybindings.ts` at line 270:
     ```typescript
     console.log('Checking help binding:', e.key, config.misc.help);
     if (this.matchesBinding(e, config.misc.help)) {
       console.log('Help binding matched!');
       this.callbacks?.showHelp();
       return;
     }
     ```
   - Press `Ctrl+a` then `?`
   - Check console to see if binding is matched

### Recommended Fix

**Issue is likely the Shift+/ vs ? key detection.**

The `matchesBinding` method in keybindings.ts needs to handle special characters correctly:

```typescript
private matchesBinding(e: KeyboardEvent, binding: string): boolean {
  // Don't use prefix for the prefix key itself
  if (binding === this.config.prefixKey) {
    return e.key === binding && !e.ctrlKey && !e.altKey && !e.metaKey;
  }

  // For non-prefix bindings, require prefix mode OR explicit modifiers
  const requiresPrefix = !binding.includes('+');

  if (requiresPrefix && !this.isInPrefixMode) {
    return false;
  }

  // Special case: Map '?' to 'Shift+/' for proper detection
  if (binding === '?') {
    return e.key === '?' || (e.shiftKey && e.key === '/');
  }

  // Existing binding match logic...
}
```

Alternatively, **use a different default binding** that doesn't require Shift:
- `h` for help (conflicts with left navigation, but in prefix mode it's fine)
- `/` for help (common for search, but could work)
- `?` without prefix (global binding, works anywhere)

### Short-term Workaround

Update the help binding to not use `?`:

```json
{
  "keybindings": {
    "misc": {
      "help": "h"
    }
  }
}
```

Then press `Ctrl+a` then `h` to show help.

### Related Code

- `frontend/src/help-overlay.ts:79-175` - HelpOverlay component
- `frontend/src/keybindings.ts:269-273` - Help binding handler
- `frontend/src/keybindings.ts:150-200` - `matchesBinding()` method (approximate location)
- `frontend/src/user-config.ts:218` - Default help keybinding
- `frontend/styles/main.css:989-1008` - Help overlay CSS

## Tab Number Shortcuts Off-by-One

**Problem**: Tab shortcuts `Ctrl+a` then `0-9` start at index 0 instead of 1. Pressing `Ctrl+a` then `1` goes to the second tab (index 1), not the first tab.

**Current behavior:**
- `Ctrl+a` + `0` → First tab (index 0)
- `Ctrl+a` + `1` → Second tab (index 1)
- `Ctrl+a` + `2` → Third tab (index 2)
- etc.

**Expected behavior (standard convention):**
- `Ctrl+a` + `1` → First tab
- `Ctrl+a` + `2` → Second tab
- `Ctrl+a` + `9` → Ninth tab
- `Ctrl+a` + `0` → Tenth tab (tmux/screen convention)

**Root cause:**
In `keybindings.ts:283`, the key value is passed directly to `goToTab()`:
```typescript
if (/^[0-9]$/.test(e.key)) {
  this.callbacks?.goToTab(parseInt(e.key, 10));
  return;
}
```

This means pressing `1` calls `goToTab(1)`, which accesses `tabs[1]` (second tab).

### Fix

**Option A: Map keys to indices (recommended)**

```typescript
// In keybindings.ts
if (/^[0-9]$/.test(e.key)) {
  const keyNum = parseInt(e.key, 10);
  // Map 1-9 to indices 0-8, and 0 to index 9 (tmux style)
  const tabIndex = keyNum === 0 ? 9 : keyNum - 1;
  this.callbacks?.goToTab(tabIndex);
  return;
}
```

**Mapping:**
```
Key pressed → Tab index
─────────────────────
1 → 0 (first tab)
2 → 1 (second tab)
3 → 2 (third tab)
...
9 → 8 (ninth tab)
0 → 9 (tenth tab)
```

This follows tmux/screen convention where `0` goes to the 10th window.

**Option B: Ignore 0 key**

```typescript
if (/^[1-9]$/.test(e.key)) {
  const tabIndex = parseInt(e.key, 10) - 1;
  this.callbacks?.goToTab(tabIndex);
  return;
}
```

**Mapping:**
```
Key pressed → Tab index
─────────────────────
1 → 0 (first tab)
2 → 1 (second tab)
...
9 → 8 (ninth tab)
0 → (ignored)
```

Simpler but wastes the `0` key.

**Option C: Use 0 for last tab (browser style)**

```typescript
if (/^[0-9]$/.test(e.key)) {
  const keyNum = parseInt(e.key, 10);
  if (keyNum === 0) {
    // Go to last tab
    const tabs = this.tabManager.getTabs();
    this.callbacks?.goToTab(tabs.length - 1);
  } else {
    // Go to tab 1-9
    this.callbacks?.goToTab(keyNum - 1);
  }
  return;
}
```

Matches browser behavior (Ctrl+9 goes to last tab).

### Recommended: Option A

Use tmux/screen convention (`0` = 10th tab) because:
- CADE is tmux-inspired (prefix key, keybindings)
- Consistent with terminal multiplexer conventions
- Simple mental model: "0 comes after 9"
- No special-casing needed for "last tab"

### Implementation

**File to change:**
- `frontend/src/keybindings.ts:281-285`

**Before:**
```typescript
// Tab direct access: 0-9 (always hardcoded for convenience)
if (/^[0-9]$/.test(e.key)) {
  this.callbacks?.goToTab(parseInt(e.key, 10));
  return;
}
```

**After:**
```typescript
// Tab direct access: 1-9 for tabs 1-9, 0 for tab 10 (tmux style)
if (/^[0-9]$/.test(e.key)) {
  const keyNum = parseInt(e.key, 10);
  const tabIndex = keyNum === 0 ? 9 : keyNum - 1;
  this.callbacks?.goToTab(tabIndex);
  return;
}
```

**Update help text:**
- `frontend/src/help-overlay.ts:43`

**Before:**
```html
<tr><td><kbd>prefix</kbd> + <kbd>0-9</kbd></td><td>Go to tab N</td></tr>
```

**After:**
```html
<tr><td><kbd>prefix</kbd> + <kbd>1-9</kbd></td><td>Go to tab 1-9</td></tr>
<tr><td><kbd>prefix</kbd> + <kbd>0</kbd></td><td>Go to tab 10</td></tr>
```

Or more concise:
```html
<tr><td><kbd>prefix</kbd> + <kbd>1-9,0</kbd></td><td>Go to tab 1-9, 10</td></tr>
```

**Update comment in tab-manager.ts:**
- `frontend/src/tabs/tab-manager.ts:193`

**Before:**
```typescript
/**
 * Switch to a tab by index (0-9).
 */
goToTab(index: number): void {
```

**After:**
```typescript
/**
 * Switch to a tab by index (0-based array index).
 * Called from keybindings where key 1→index 0, key 2→index 1, ..., key 0→index 9
 */
goToTab(index: number): void {
```

### Related Code

- `frontend/src/keybindings.ts:281-285` - Key handler (needs fix)
- `frontend/src/tabs/tab-manager.ts:195-200` - goToTab implementation (no change needed)
- `frontend/src/help-overlay.ts:43` - Help text (update description)

### Testing Checklist

- [ ] Press `Ctrl+a` then `1` - should go to first tab
- [ ] Press `Ctrl+a` then `2` - should go to second tab
- [ ] Press `Ctrl+a` then `9` - should go to ninth tab (if exists)
- [ ] Press `Ctrl+a` then `0` - should go to tenth tab (if exists)
- [ ] Press `Ctrl+a` then `5` with only 3 tabs - should do nothing (no error)
- [ ] Verify help overlay shows correct description

## See Also

- [[terminal-ui-issues|Terminal UI Issues]]
- [[plan-viewer-improvements|Plan Viewer Improvements]]
