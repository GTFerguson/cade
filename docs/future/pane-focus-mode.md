---
title: Pane Focus Mode
created: 2026-01-18
updated: 2026-01-18
status: future
tags: [future, ui, layout, keyboard-navigation, vim, panes]
---

# Pane Focus Mode

Temporary expansion of the active pane (terminal or viewer) to maximize reading/viewing space while maintaining quick access to other panes.

## Concept

**Core idea**: The file tree serves a dedicated navigation purpose on the left. The terminal and viewer panes in the center/right share the "main work area" and should be able to temporarily expand to use more of that shared space.

**Visual representation:**

**Normal view:**
```
┌─────────┬──────────────┬──────────────┐
│  File   │   Terminal   │    Viewer    │
│  Tree   │   (Claude)   │  (Markdown)  │
│         │              │              │
│  20%    │     50%      │     30%      │
└─────────┴──────────────┴──────────────┘
```

**Focus mode - Viewer expanded:**
```
┌─────────┬─────┬──────────────────────────┐
│  File   │Term.│       Viewer             │
│  Tree   │     │     (Focused)            │
│         │     │                          │
│  20%    │ 10% │         70%              │
└─────────┴─────┴──────────────────────────┘
```

**Focus mode - Terminal expanded:**
```
┌─────────┬──────────────────────────┬────┐
│  File   │      Terminal            │View│
│  Tree   │      (Focused)           │    │
│         │                          │    │
│  20%    │         70%              │10% │
└─────────┴──────────────────────────┴────┘
```

## Use Cases

### 1. File Tree → Viewer Focus

**Scenario**: User is browsing files in the file tree and wants to read a document in detail.

**Current behavior:**
- Press `l` or `Enter` on a file
- File opens in viewer (or updates if already open)
- Viewer pane stays at default 30% width
- User must manually drag resize handle to expand viewer

**Desired behavior:**
- Press `l` or `Enter` on a file
- File opens in viewer AND viewer expands to focus mode (~70% width)
- Terminal shrinks to minimal width (~10%) but remains visible
- File tree stays at normal width (navigation still needed)

**Refinement**:
- If file is already open in viewer, pressing `l` again should:
  - Make viewer the active pane (focus switches from file tree to viewer)
  - Optionally expand viewer to focus mode (configurable)

### 2. Reading Long Documents

**Scenario**: User is reading documentation, plan files, or long markdown documents.

**Workflow:**
1. Open file from tree (auto-expands viewer)
2. Use `j`/`k` for scrolling in expanded viewer
3. Press keybinding to exit focus mode (viewer returns to normal size)
4. Or switch to another pane (auto-exits focus mode)

### 3. Deep Terminal Work

**Scenario**: User is running long commands, viewing logs, or working extensively in the terminal.

**Workflow:**
1. Press focus mode keybinding while in terminal
2. Terminal expands to ~70% width
3. Viewer shrinks to ~10% but remains visible
4. File tree unchanged
5. Press keybinding again or switch panes to exit

### 4. Comparing File Tree with Viewer

**Scenario**: User wants to see file structure while reading documentation.

**Benefit**: File tree stays visible and functional even in focus mode, so user can:
- Navigate to other files without exiting focus mode
- See context of current file in directory structure
- Quickly jump between related files

## Implementation Design

### Pane Proportion Presets

Define proportion presets for different focus states:

```typescript
// In layout.ts

interface LayoutProportions {
  fileTree: number;
  terminal: number;
  viewer: number;
}

const LAYOUT_PRESETS = {
  normal: {
    fileTree: 0.2,
    terminal: 0.5,
    viewer: 0.3,
  },
  focusTerminal: {
    fileTree: 0.2,
    terminal: 0.7,
    viewer: 0.1,
  },
  focusViewer: {
    fileTree: 0.2,
    terminal: 0.1,
    viewer: 0.7,
  },
  // Alternative: More aggressive expansion
  maxTerminal: {
    fileTree: 0.15,
    terminal: 0.8,
    viewer: 0.05,
  },
  maxViewer: {
    fileTree: 0.15,
    terminal: 0.05,
    viewer: 0.8,
  },
} as const;

type LayoutPreset = keyof typeof LAYOUT_PRESETS;
```

### Focus Mode State

Track focus mode state:

```typescript
// In layout.ts

export class Layout implements Component {
  private proportions: LayoutProportions;
  private focusMode: LayoutPreset | null = null;
  private savedProportions: LayoutProportions | null = null;

  /**
   * Enter focus mode for a specific pane.
   */
  enterFocusMode(pane: 'terminal' | 'viewer', aggressive = false): void {
    // Save current proportions to restore later
    if (!this.focusMode) {
      this.savedProportions = { ...this.proportions };
    }

    const preset = aggressive
      ? (pane === 'terminal' ? 'maxTerminal' : 'maxViewer')
      : (pane === 'terminal' ? 'focusTerminal' : 'focusViewer');

    this.focusMode = preset;
    this.setProportions(LAYOUT_PRESETS[preset]);
  }

  /**
   * Exit focus mode and restore previous proportions.
   */
  exitFocusMode(): void {
    if (!this.focusMode) {
      return;
    }

    const proportions = this.savedProportions ?? LAYOUT_PRESETS.normal;
    this.focusMode = null;
    this.savedProportions = null;
    this.setProportions(proportions);
  }

  /**
   * Toggle focus mode for the currently active pane.
   */
  toggleFocusMode(activePane: 'terminal' | 'viewer'): void {
    if (this.focusMode) {
      this.exitFocusMode();
    } else {
      this.enterFocusMode(activePane);
    }
  }

  /**
   * Check if focus mode is active.
   */
  isFocusMode(): boolean {
    return this.focusMode !== null;
  }

  /**
   * Set proportions with animation.
   */
  private setProportions(proportions: LayoutProportions, animate = true): void {
    if (animate) {
      this.container.classList.add('layout-transitioning');
    }

    this.proportions = proportions;
    this.applyProportions();

    if (animate) {
      // Remove transition class after animation completes
      setTimeout(() => {
        this.container.classList.remove('layout-transitioning');
      }, 300);
    }

    this.onChangeCallback?.();
  }
}
```

### CSS Transitions

Smooth animations for entering/exiting focus mode:

```css
/* Layout transitions */
.layout-container.layout-transitioning {
  transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.layout-transitioning #file-tree,
.layout-transitioning #terminal,
.layout-transitioning #viewer {
  transition: opacity 0.2s ease;
}

/* Minimal pane styling (when shrunk in focus mode) */
.layout-container.focus-terminal #viewer,
.layout-container.focus-viewer #terminal {
  /* Maybe add a subtle overlay or dimming */
  opacity: 0.7;
}
```

### Keybindings

Add keybindings for focus mode:

```typescript
// In user-config.ts
export interface PaneKeybindingsConfig {
  // ... existing bindings ...
  toggleFocus: string;  // Toggle focus mode for active pane
}

const DEFAULT_CONFIG: UserConfig = {
  keybindings: {
    pane: {
      // ... existing ...
      toggleFocus: "z",  // prefix + z = zoom/focus mode
    },
  },
};
```

**Keybinding suggestions:**
- `Ctrl+a` then `z` - Toggle focus (zoom) for active pane
- `Ctrl+a` then `Z` - Aggressive focus (max expansion)
- Or use a single key in viewer/terminal: `f` for focus

### File Tree Integration

Modify file-tree.ts to trigger focus mode on file open:

```typescript
// In file-tree.ts

export class FileTree implements Component, PaneKeyHandler {
  private onFileOpenCallback: ((path: string, alreadyOpen: boolean) => void) | null = null;
  private currentOpenFile: string | null = null;

  /**
   * Register callback for file open events.
   */
  onFileOpen(callback: (path: string, alreadyOpen: boolean) => void): void {
    this.onFileOpenCallback = callback;
  }

  private expandOrOpen(): void {
    const item = this.flatList[this.selectedIndex];
    if (!item) {
      return;
    }

    if (item.node.type === "directory") {
      // ... existing directory expansion logic ...
    } else {
      const alreadyOpen = this.currentOpenFile === item.node.path;
      this.openPath = item.node.path;
      this.currentOpenFile = item.node.path;
      this.render();

      // Emit with flag indicating if file was already open
      this.onFileOpenCallback?.(item.node.path, alreadyOpen);
      this.emit("file-select", item.node.path);
    }
  }
}
```

Then in the project context or main app:

```typescript
// In tabs/project-context.ts or main.ts

this.fileTree.onFileOpen((path, alreadyOpen) => {
  if (alreadyOpen) {
    // File already open - switch focus to viewer and optionally expand
    this.focusPane('right');

    if (this.config.autoExpandViewerOnRefocus) {
      this.layout.enterFocusMode('viewer');
    }
  } else {
    // New file - load and optionally auto-expand
    this.markdownViewer.loadFile(path);

    if (this.config.autoExpandViewerOnOpen) {
      this.layout.enterFocusMode('viewer');
    }
  }
});
```

### Auto-Exit Behavior

Focus mode should automatically exit when:

**Option A: Exit on pane switch**
```typescript
// In keybindings or main app
onPaneSwitch(newPane: PaneType): void {
  if (this.layout.isFocusMode()) {
    this.layout.exitFocusMode();
  }
  // ... rest of pane switch logic
}
```

**Option B: Maintain focus until explicit exit**
- User must press the toggle keybinding again to exit
- More predictable but requires extra keypress
- Good for extended reading/working sessions

**Option C: Smart exit (hybrid)**
- Exit when switching to file tree
- Maintain when switching between terminal and viewer
- Best of both worlds

**Recommended: Option C**

```typescript
onPaneSwitch(oldPane: PaneType, newPane: PaneType): void {
  // Only exit focus mode when switching TO file tree
  if (newPane === 'left' && this.layout.isFocusMode()) {
    this.layout.exitFocusMode();
  }

  // When switching between terminal and viewer, maintain focus mode
  // but shift it to the new pane
  if (this.layout.isFocusMode() && newPane !== 'left' && oldPane !== 'left') {
    const targetPane = newPane === 'middle' ? 'terminal' : 'viewer';
    this.layout.enterFocusMode(targetPane);
  }
}
```

## User Configuration

Make focus mode behavior configurable:

```typescript
// In user-config.ts
export interface UserConfig {
  layout?: {
    autoExpandViewerOnOpen?: boolean;      // Auto-expand when opening new file
    autoExpandViewerOnRefocus?: boolean;   // Auto-expand when re-opening file
    focusExitBehavior?: 'manual' | 'pane-switch' | 'smart';
    focusAnimation?: boolean;              // Animate transitions
    focusProportions?: {
      terminal?: number;  // Custom proportions
      viewer?: number;
    };
  };
}

const DEFAULT_CONFIG: UserConfig = {
  layout: {
    autoExpandViewerOnOpen: false,        // Conservative default
    autoExpandViewerOnRefocus: false,     // User can enable if desired
    focusExitBehavior: 'smart',           // Smart exit is best UX
    focusAnimation: true,                 // Smooth transitions
  },
};
```

## Advanced Features

### 1. Focus Level Modes

Multiple levels of focus:

```typescript
type FocusLevel = 'none' | 'light' | 'medium' | 'heavy' | 'max';

const FOCUS_LEVELS = {
  none: 0.3,      // Normal viewer width
  light: 0.4,     // Slightly expanded
  medium: 0.5,    // Balanced
  heavy: 0.7,     // Focused
  max: 0.9,       // Near-fullscreen
};

// Cycle through focus levels
cycleFocusLevel(): void {
  const levels: FocusLevel[] = ['none', 'light', 'medium', 'heavy', 'max'];
  const current = this.currentFocusLevel ?? 'none';
  const currentIndex = levels.indexOf(current);
  const nextIndex = (currentIndex + 1) % levels.length;
  this.setFocusLevel(levels[nextIndex]);
}
```

Keybinding: Press `Ctrl+a` then `z` multiple times to cycle through focus levels.

### 2. Focus Mode Indicator

Visual indicator showing focus mode state:

```html
<div class="focus-mode-indicator">
  📐 Normal | 🔍 Focused | 🔎 Max
</div>
```

Or subtle visual cues:
- Colored border on focused pane
- Dim/fade non-focused panes
- Status bar indicator

### 3. Per-File Focus Preferences

Remember focus state per file:

```typescript
interface FileViewState {
  path: string;
  focusMode: boolean;
  scrollPosition: number;
}

// Save when file is opened in focus mode
// Restore focus mode when file is re-opened
```

### 4. Distraction-Free Mode

Extreme focus mode that hides file tree entirely:

```typescript
enterDistractionFreeMode(): void {
  this.setProportions({
    fileTree: 0,      // Completely hidden
    terminal: 0,
    viewer: 1.0,      // Full width
  });

  // Add escape hatch: Press Esc to exit
}
```

### 5. Dual-Pane Focus

Focus on both terminal and viewer equally, hiding file tree:

```typescript
LAYOUT_PRESETS.dualFocus = {
  fileTree: 0,
  terminal: 0.5,
  viewer: 0.5,
};
```

Useful for:
- Reading docs while following along in terminal
- Viewing plan while Claude is executing
- Comparing two files (future feature)

## UI/UX Considerations

### Visual Feedback

**Entering focus mode:**
- Smooth animation (300ms cubic-bezier)
- Subtle sound effect (optional, configurable)
- Brief toast notification: "Viewer focused (Ctrl+a+z to exit)"

**Focused pane indication:**
- Slightly brighter background
- Subtle colored border (lime accent)
- Drop shadow to create depth

**Non-focused panes:**
- Slightly dimmed (70% opacity)
- Still interactive (can click to switch)
- Content remains readable

### Edge Cases

**What if viewer is already focused?**
- Toggle keybinding exits focus mode
- Or cycles to next level (light → medium → heavy → max → none)

**What if file tree is minimized?**
- Focus mode proportions should account for file tree being at minimum width
- Could redistribute file tree's space to focused pane

**What about mobile?**
- Focus mode doesn't apply (mobile is already fullscreen terminal)
- Keybinding does nothing or shows message

**Manual resize during focus mode?**
- Exit focus mode immediately
- Save new proportions as "custom" preset
- Allow returning to custom proportions

### Accessibility

**Keyboard navigation:**
- All focus mode features accessible via keyboard
- Screen reader announces focus mode state changes
- No functionality locked behind mouse-only interactions

**ARIA labels:**
```html
<div role="region" aria-label="Focused viewer pane" aria-expanded="true">
  <!-- Viewer content -->
</div>
```

**Reduced motion:**
- Respect `prefers-reduced-motion` media query
- Skip animations if user has motion reduction enabled

```css
@media (prefers-reduced-motion: reduce) {
  .layout-container.layout-transitioning {
    transition: none;
  }
}
```

## Implementation Phases

### Phase 1: Core Focus Mode (MVP)

- [ ] Add `enterFocusMode()` / `exitFocusMode()` to Layout class
- [ ] Define basic proportion presets (normal, focusTerminal, focusViewer)
- [ ] Add toggle keybinding (`Ctrl+a` then `z`)
- [ ] Implement smooth transitions (CSS)
- [ ] Test focus mode for both terminal and viewer

### Phase 2: File Tree Integration

- [ ] Detect when file is already open in viewer
- [ ] Add config option: `autoExpandViewerOnOpen`
- [ ] Add config option: `autoExpandViewerOnRefocus`
- [ ] Implement smart auto-exit (exit when switching to file tree)
- [ ] Test workflow: browse files → open → expand → read → exit

### Phase 3: Visual Polish

- [ ] Add focus mode indicator (status bar or overlay)
- [ ] Dim non-focused panes
- [ ] Highlight focused pane border
- [ ] Add toast notification on enter/exit
- [ ] Respect `prefers-reduced-motion`

### Phase 4: Advanced Features

- [ ] Multiple focus levels (cycle with repeated keypresses)
- [ ] Per-file focus state persistence
- [ ] Distraction-free mode (hide file tree)
- [ ] Dual-pane focus mode
- [ ] Custom focus proportions in config

## Technical Considerations

### State Management

**Where to track focus state?**
- Layout class tracks visual proportions
- Main app or project context tracks active pane and triggers focus mode
- Keybinding manager dispatches toggle commands

**State persistence:**
- Save last used focus mode to localStorage?
- Restore focus state on app restart?
- Or always start in normal mode?

### Performance

**Layout recalculation:**
- Applying new proportions triggers CSS grid recalculation
- Should be fast with hardware acceleration
- Test with many files/tabs open

**Animation performance:**
- Use `transform` instead of `width` if possible
- Enable GPU acceleration with `will-change`
- Profile to ensure 60fps transitions

### File Tree Width

**Should file tree participate in focus mode?**

**Option 1: File tree stays fixed (recommended)**
- File tree always at 20% (or user's manual resize)
- Terminal and viewer share the remaining 80%
- Simpler to reason about
- File tree always accessible

**Option 2: File tree shrinks slightly**
- File tree goes from 20% → 15% in focus mode
- Gives 5% more space to focused pane
- More aggressive space usage
- Risk: file tree becomes too narrow

**Option 3: File tree can be hidden**
- Extreme focus mode hides file tree completely
- Requires escape hatch to restore
- Good for distraction-free reading

### Viewport Constraints

**Minimum pane widths:**
- File tree: 150px minimum (show file names)
- Terminal/Viewer minimal: 100px (barely functional)
- Focused pane: 60% minimum (useful focus)

**Maximum proportions:**
- Prevent one pane from taking >90% unless explicit distraction-free mode
- Ensure non-focused pane remains visible and clickable

## Related Code

- `frontend/src/layout.ts` - Layout proportion management
- `frontend/src/file-tree.ts:462-477` - File selection handler
- `frontend/src/keybindings.ts` - Keybinding handlers
- `frontend/src/user-config.ts` - Configuration schema
- `frontend/styles/main.css` - Layout grid and transitions

## See Also

- [[ui-enhancements|UI Enhancements]]
- [[plan-viewer-improvements|Plan Viewer Improvements]]
- [[../user/plan-viewer|Plan Viewer User Guide]]
