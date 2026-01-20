---
title: Plan Viewer Improvements
created: 2026-01-18
updated: 2026-01-18
status: future
tags: [future, plan-viewer, improvements, keyboard-navigation, vim]
---

# Plan Viewer Improvements

Future enhancements for the plan viewer feature.

## Session-Aware Plan Tracking

**Problem**: The current `Ctrl+g` shortcut finds the most recently modified file in `~/.claude/plans/`. This works well for single-session usage but may show the wrong plan when multiple Claude sessions are active simultaneously.

**Proposed Solution**: Track session_id → plan file mapping.

### Implementation Approach

1. When Claude enters plan mode, it creates/edits a plan file in `~/.claude/plans/`
2. The hook could extract the session_id from the Claude Code context and store a mapping
3. `Ctrl+g` would then look up the plan file for the current session

### Challenges

- Claude Code hooks don't currently expose session_id in a straightforward way
- Would require changes to how CADE tracks which Claude session is connected
- The mapping file would need cleanup when sessions end

### Alternative: Project-Based Plans

Instead of session tracking, use project path as the key:

1. Store plans in `~/.claude/plans/<project-hash>/`
2. `Ctrl+g` would use the current tab's working directory to find the right plan
3. Simpler to implement, works well for most use cases

## Live Plan Updates

**Problem**: Currently, the viewer shows a snapshot of the plan when `Ctrl+g` is pressed. If Claude continues editing the plan, the viewer doesn't update.

**Proposed Solution**: File watching for the displayed plan file.

### Implementation

1. When a plan file is displayed via `Ctrl+g`, start watching it for changes
2. On file change, automatically refresh the viewer content
3. Stop watching when a different file is displayed or the viewer is closed

### Considerations

- May cause visual disruption if updates are too frequent
- Could add a "live mode" toggle in the viewer UI
- Need to debounce rapid successive changes

## Plan History

**Problem**: No way to see previous versions of a plan or navigate between plans.

**Proposed Solution**: Plan history sidebar or dropdown.

### Features

- List all plans in `~/.claude/plans/` sorted by modification time
- Quick navigation between plans
- Optional: Show plan metadata (project, date, size)
- Optional: Git-like history if plans are versioned

## Horizontal Scrolling for Wide Content

**Problem**: Code blocks, tables, and other elements with horizontal overflow have no keyboard-based way to scroll horizontally. Currently, only vertical scrolling is supported (j/k, gg, G, Ctrl+d/u).

**Impact**:
- Cannot view full content of wide code blocks or tables
- Forces users to use mouse to scroll horizontally
- Breaks the vim-inspired keyboard-first navigation philosophy

### Current Implementation

The markdown viewer (frontend/src/markdown.ts) implements vertical scrolling:

| Key | Action |
|-----|--------|
| j / ↓ | Scroll down one line |
| k / ↑ | Scroll up one line |
| gg | Jump to top |
| G | Jump to bottom |
| Ctrl+d | Page down |
| Ctrl+u | Page up |

Missing: h/l for horizontal scrolling

### The Multi-Block Challenge

When multiple blocks with horizontal overflow are visible simultaneously (e.g., two wide code blocks on screen), there's an ambiguity: which block should h/l scroll?

**Example scenario:**
```
[viewport]
  Regular text...

  ┌─────────────────────────────────────┐
  │ function example() { /* very wide code */ }  ← Block 1 (overflow)
  └─────────────────────────────────────┘

  More text...

  ┌─────────────────────────────────────┐
  │ | Column 1 | Column 2 | Column 3 | Column 4 | ← Block 2 (overflow)
  └─────────────────────────────────────┘

  More text...
```

Pressing `h` or `l` - which block scrolls?

### Proposed Solutions

#### Option A: Focus Mode (Explicit Selection)

Add a "focus" state where pressing a key (e.g., `f` or `Enter`) selects the nearest horizontally-scrollable block.

**Keybindings:**
- `f` or `Enter`: Enter focus mode on the nearest overflowing block
- `h`/`l`: Scroll horizontally within the focused block
- `Esc` or `j`/`k`: Exit focus mode, return to vertical scrolling

**Visual feedback:**
- Focused block gets a highlight border or background change
- Cursor/indicator shows which block is active

**Implementation:**
```typescript
private focusedBlock: HTMLElement | null = null;

handleKeydown(e: KeyboardEvent): boolean {
  // ... existing vertical scrolling ...

  switch (e.key) {
    case 'f':
    case 'Enter':
      this.focusNearestScrollableBlock();
      return true;
    case 'h':
    case 'ArrowLeft':
      if (this.focusedBlock) {
        this.focusedBlock.scrollBy(-40, 0);
        return true;
      }
      return false;
    case 'l':
    case 'ArrowRight':
      if (this.focusedBlock) {
        this.focusedBlock.scrollBy(40, 0);
        return true;
      }
      return false;
    case 'Escape':
      this.clearFocus();
      return true;
    case 'j':
    case 'k':
      // Vertical scrolling exits focus mode
      this.clearFocus();
      // Fall through to existing vertical scroll handling
      break;
  }
}

private focusNearestScrollableBlock(): void {
  // Find blocks with horizontal overflow near viewport center
  const blocks = this.contentContainer?.querySelectorAll('pre, table');
  // Select the one closest to viewport center
  // Add visual highlight
}
```

**Pros:**
- Clear, explicit selection
- No ambiguity about which block is active
- Works well with multiple overflowing blocks
- Follows vim's modal philosophy

**Cons:**
- Requires an extra keypress to enter focus mode
- Adds cognitive overhead (another mode to track)

#### Option B: Viewport-Centered Scrolling (Implicit Selection)

Automatically scroll the overflowing block that's currently most centered in the viewport.

**Keybindings:**
- `h`/`l`: Scroll the block nearest to viewport center
- No mode switching needed

**Algorithm:**
```typescript
private scrollHorizontallyAtViewportCenter(direction: number): void {
  const blocks = this.contentContainer?.querySelectorAll('pre, table');
  const viewportCenter = this.contentContainer.scrollTop +
                         this.contentContainer.clientHeight / 2;

  // Find block closest to viewport center
  let closestBlock: HTMLElement | null = null;
  let closestDistance = Infinity;

  blocks?.forEach(block => {
    const blockCenter = block.offsetTop + block.clientHeight / 2;
    const distance = Math.abs(blockCenter - viewportCenter);
    if (distance < closestDistance && block.scrollWidth > block.clientWidth) {
      closestDistance = distance;
      closestBlock = block as HTMLElement;
    }
  });

  closestBlock?.scrollBy(direction * 40, 0);
}
```

**Pros:**
- No mode switching required
- Intuitive (scrolls what you're looking at)
- Simpler mental model

**Cons:**
- Can be unpredictable if multiple blocks are near center
- No visual feedback about which block will scroll
- May scroll wrong block if viewport is between two blocks

#### Option C: Scroll-All (Synchronized)

When pressing h/l, scroll ALL horizontally-overflowing blocks simultaneously.

**Keybindings:**
- `h`/`l`: Scroll all overflowing blocks in sync

**Pros:**
- Simple to understand
- No selection ambiguity
- Works well if all blocks overflow similarly

**Cons:**
- Different blocks may have different overflow widths
- Scrolling unrelated blocks can be confusing
- Doesn't work well if user only wants to see one block

#### Option D: Modal Approach (h/l Always Active)

Make h/l always mean horizontal scrolling, and use only j/k for vertical.

**Keybindings:**
- `h`/`l`: Horizontal scrolling (focused block or viewport-centered)
- `j`/`k`: Vertical scrolling only
- Arrow keys: 2D navigation (↑/↓ vertical, ←/→ horizontal)

**Pros:**
- Consistent vim-style directional keys
- h/l don't conflict with anything else
- Natural 2D navigation

**Cons:**
- Still need to solve which block to scroll

### Recommended Approach

**Option A (Focus Mode)** is recommended because:
1. **Explicit control**: User knows exactly which block is active
2. **Aligns with vim philosophy**: Modal interaction (normal mode vs focus mode)
3. **Scales well**: Works cleanly with any number of overflowing blocks
4. **Visual feedback**: Can highlight the focused block clearly
5. **Extensible**: Could add more focus-mode features later (e.g., copy from focused block)

**Implementation phases:**

1. **Phase 1: Basic focus mode**
   - `f` to focus nearest overflowing block
   - `h`/`l` to scroll horizontally
   - `Esc` to exit focus
   - CSS highlight for focused block

2. **Phase 2: Smart focus selection**
   - Prefer block closest to viewport center
   - Skip blocks without horizontal overflow
   - Visual indicator of available scrollable blocks

3. **Phase 3: Enhanced navigation**
   - `n`/`p` (or `Tab`/`Shift+Tab`) to cycle through overflowing blocks
   - Show scroll position indicator (e.g., "23/156 cols")
   - Smooth scrolling animations

### Alternative: Hybrid Approach

Combine Option A and Option B:
- `h`/`l` with no focused block: Scrolls viewport-centered block (Option B)
- `f` to explicitly focus a block for more precise control (Option A)
- `Esc` to clear focus and return to viewport-centered mode

This gives quick access for simple cases, with precision available when needed.

### Related Code

- `frontend/src/markdown.ts:470-518` - Current keyboard navigation implementation
- `frontend/src/markdown.ts:85-86` - Scroll constants (could add SCROLL_COLUMN_WIDTH)

### CSS Considerations

Focused block styling:
```css
/* Indicate focused block */
.viewer-content pre.focused,
.viewer-content table.focused {
  outline: 2px solid var(--accent-lime);
  outline-offset: 2px;
  box-shadow: 0 0 8px rgba(174, 238, 0, 0.3);
}

/* Show horizontal scrollbar when focused */
.viewer-content pre.focused,
.viewer-content table.focused {
  overflow-x: auto;
  scrollbar-width: thin;
}
```

## Frontmatter Display Improvements

**Problem**: The current frontmatter display uses a heavy card design with background, border, and padding. It looks clunky and draws too much attention. Obsidian's frontmatter is clean, minimal, and unobtrusive.

**Current implementation:**
- Heavy card style with `background: var(--bg-tertiary)`, border, border-radius
- Simple key-value rows with basic coloring
- Always visible, takes up significant visual space
- No special handling for different value types (tags, dates, etc.)

**Current CSS:**
```css
.frontmatter {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-family: var(--font-mono);
  font-size: 12px;
}
```

### Obsidian-Style Design Principles

**Characteristics of Obsidian's frontmatter:**
1. **Minimal visual weight** - Subtle, doesn't distract from content
2. **Optional visibility** - Can be collapsed/hidden
3. **Semantic formatting** - Tags as pills, dates formatted nicely
4. **Clean typography** - Good spacing, hierarchy, alignment
5. **Contextual display** - Shows what matters, hides noise

### Proposed Design Options

#### Option A: Minimal Inline Style

Remove the card entirely, display frontmatter as subtle metadata at the top.

**Visual mockup:**
```
┌─────────────────────────────────────────────┐
│                                             │
│  Title: Plan Viewer Improvements            │
│  Created: 2026-01-18  •  Updated: 2026-01-18│
│  Status: future  •  Tags: future, ui, vim   │
│  ─────────────────────────────────────────  │
│                                             │
│  # Plan Viewer Improvements                 │
│                                             │
│  Future enhancements for the plan viewer... │
└─────────────────────────────────────────────┘
```

**CSS:**
```css
.frontmatter {
  border-bottom: 1px solid var(--border-color);
  padding: 0 0 12px 0;
  margin-bottom: 24px;
  font-family: var(--font-sans); /* Not monospace */
  font-size: 13px;
}

.frontmatter-row {
  display: inline-block;
  margin-right: 16px;
  margin-bottom: 6px;
  color: var(--text-secondary);
}

.frontmatter-key {
  font-weight: 500;
  color: var(--text-muted);
  text-transform: capitalize;
}

.frontmatter-separator {
  margin: 0 4px;
  color: var(--text-muted);
}

.frontmatter-value {
  color: var(--text-primary);
}
```

**Pros:**
- Very clean, minimal
- Feels like natural document metadata
- Doesn't compete with content
- Easy to scan

**Cons:**
- Less structured than a card
- May get lost if frontmatter is very long

#### Option B: Collapsible Metadata Block

Frontmatter is collapsed by default, expandable on click.

**Visual mockup (collapsed):**
```
┌─────────────────────────────────────────────┐
│                                             │
│  ▸ Metadata                                 │
│  ─────────────────────────────────────────  │
│                                             │
│  # Plan Viewer Improvements                 │
└─────────────────────────────────────────────┘
```

**Visual mockup (expanded):**
```
┌─────────────────────────────────────────────┐
│                                             │
│  ▾ Metadata                                 │
│    title: Plan Viewer Improvements          │
│    created: 2026-01-18                      │
│    updated: 2026-01-18                      │
│    status: future                           │
│    tags: future, ui, vim                    │
│  ─────────────────────────────────────────  │
│                                             │
│  # Plan Viewer Improvements                 │
└─────────────────────────────────────────────┘
```

**Implementation:**
```typescript
private renderFrontmatter(frontmatter: Frontmatter): HTMLElement {
  const container = document.createElement("div");
  container.className = "frontmatter";

  const header = document.createElement("div");
  header.className = "frontmatter-header";
  header.innerHTML = '<span class="frontmatter-toggle">▸</span> Metadata';

  const content = document.createElement("div");
  content.className = "frontmatter-content";
  content.style.display = "none"; // Start collapsed

  for (const [key, value] of Object.entries(frontmatter)) {
    const row = this.createFrontmatterRow(key, value);
    content.appendChild(row);
  }

  header.addEventListener("click", () => {
    const isExpanded = content.style.display !== "none";
    content.style.display = isExpanded ? "none" : "block";
    const toggle = header.querySelector(".frontmatter-toggle");
    if (toggle) {
      toggle.textContent = isExpanded ? "▸" : "▾";
    }
  });

  container.appendChild(header);
  container.appendChild(content);

  return container;
}
```

**CSS:**
```css
.frontmatter {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
  margin-bottom: 24px;
}

.frontmatter-header {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 0;
  user-select: none;
}

.frontmatter-header:hover {
  color: var(--text-primary);
}

.frontmatter-toggle {
  display: inline-block;
  width: 12px;
  font-size: 10px;
  transition: transform 0.2s ease;
}

.frontmatter-content {
  padding-left: 16px;
  margin-top: 8px;
  font-size: 13px;
}
```

**Pros:**
- Completely out of the way when collapsed
- User controls visibility
- Still accessible when needed
- Reduces visual clutter

**Cons:**
- Requires extra click to view
- Users might miss important metadata

#### Option C: Obsidian-Style Grid Layout

Organized grid with semantic formatting for special fields.

**Visual mockup:**
```
┌─────────────────────────────────────────────┐
│                                             │
│  Plan Viewer Improvements                   │
│  ─────────────────────────────────────────  │
│  Created    Jan 18, 2026                    │
│  Updated    Jan 18, 2026                    │
│  Status     🔵 future                       │
│  Tags       #future #ui #vim #keyboard...   │
│  ─────────────────────────────────────────  │
│                                             │
│  # Plan Viewer Improvements                 │
└─────────────────────────────────────────────┘
```

**Features:**
- Title field displayed prominently at top
- Dates formatted nicely ("Jan 18, 2026" instead of "2026-01-18")
- Tags as inline pills/badges with # prefix
- Status with color indicator
- Grid layout for clean alignment

**Implementation:**
```typescript
private renderFrontmatter(frontmatter: Frontmatter): HTMLElement {
  const container = document.createElement("div");
  container.className = "frontmatter";

  // Extract and render title specially
  if (frontmatter.title) {
    const titleEl = document.createElement("div");
    titleEl.className = "frontmatter-title";
    titleEl.textContent = String(frontmatter.title);
    container.appendChild(titleEl);

    const divider = document.createElement("hr");
    divider.className = "frontmatter-divider";
    container.appendChild(divider);
  }

  const grid = document.createElement("div");
  grid.className = "frontmatter-grid";

  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === "title") continue; // Already rendered

    const row = document.createElement("div");
    row.className = "frontmatter-row";

    const keyEl = document.createElement("div");
    keyEl.className = "frontmatter-key";
    keyEl.textContent = this.capitalizeKey(key);

    const valueEl = document.createElement("div");
    valueEl.className = "frontmatter-value";
    valueEl.innerHTML = this.formatFrontmatterValueHTML(key, value);

    row.appendChild(keyEl);
    row.appendChild(valueEl);
    grid.appendChild(row);
  }

  container.appendChild(grid);

  return container;
}

private formatFrontmatterValueHTML(key: string, value: unknown): string {
  // Special handling for tags
  if (key === "tags" && Array.isArray(value)) {
    return value
      .map(tag => `<span class="frontmatter-tag">#${tag}</span>`)
      .join(" ");
  }

  // Special handling for status
  if (key === "status") {
    const statusColors: Record<string, string> = {
      active: "🟢",
      future: "🔵",
      draft: "🟡",
      archived: "⚫",
    };
    const indicator = statusColors[String(value)] ?? "";
    return `${indicator} ${value}`;
  }

  // Special handling for dates
  if (key.includes("date") || key === "created" || key === "updated") {
    return this.formatDate(String(value));
  }

  // Arrays as comma-separated
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}

private formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

private capitalizeKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}
```

**CSS:**
```css
.frontmatter {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 16px;
  margin-bottom: 24px;
}

.frontmatter-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.frontmatter-divider {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 8px 0 12px 0;
}

.frontmatter-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  font-size: 13px;
}

.frontmatter-row {
  display: contents;
}

.frontmatter-key {
  color: var(--text-muted);
  font-weight: 500;
  text-align: right;
}

.frontmatter-value {
  color: var(--text-secondary);
}

.frontmatter-tag {
  display: inline-block;
  padding: 2px 8px;
  margin-right: 4px;
  background: var(--bg-tertiary);
  border-radius: 12px;
  font-size: 11px;
  color: var(--accent-blue);
  font-weight: 500;
}

.frontmatter-tag:hover {
  background: var(--accent-blue);
  color: var(--bg-primary);
  cursor: pointer;
}
```

**Pros:**
- Very polished, professional look
- Semantic formatting improves readability
- Tags are clickable/interactive (future enhancement)
- Dates are human-readable
- Grid layout is clean and aligned

**Cons:**
- More complex implementation
- Requires special cases for different field types

#### Option D: Hybrid - Minimal + Collapsible

Start minimal, add expand button for full details.

**Visual mockup (default):**
```
┌─────────────────────────────────────────────┐
│                                             │
│  Plan Viewer Improvements                   │
│  Jan 18, 2026  •  #future #ui #vim     [•••]│
│  ─────────────────────────────────────────  │
│                                             │
│  # Plan Viewer Improvements                 │
└─────────────────────────────────────────────┘
```

**Visual mockup (expanded):**
```
┌─────────────────────────────────────────────┐
│                                             │
│  Plan Viewer Improvements              [−] │
│  Created    Jan 18, 2026                    │
│  Updated    Jan 18, 2026                    │
│  Status     🔵 future                       │
│  Tags       #future #ui #vim #keyboard...   │
│  ─────────────────────────────────────────  │
│                                             │
│  # Plan Viewer Improvements                 │
└─────────────────────────────────────────────┘
```

**Pros:**
- Best of both: minimal by default, detailed on demand
- Shows most important info (title, tags, date) upfront
- Full details available without scrolling
- Progressive disclosure

**Cons:**
- Most complex to implement
- Need to decide what's "summary" vs "details"

### Recommended Approach

**Option C (Obsidian-Style Grid)** is recommended because:

1. **Clean and professional** - Matches Obsidian's aesthetic
2. **Semantic formatting** - Dates, tags, status look appropriate
3. **Grid alignment** - Keys and values align nicely
4. **Extensible** - Easy to add more special formatting
5. **Not hidden** - Metadata is visible but unobtrusive
6. **Moderate complexity** - Reasonable implementation effort

**Implementation priority:**
1. Basic grid layout with clean styling
2. Special formatting for tags (pills/badges)
3. Date formatting (human-readable)
4. Status indicators (colored dots or emoji)
5. Future: Clickable tags (filter/search by tag)
6. Future: Relative dates ("2 days ago")

### Additional Enhancements

**Tag interactions:**
- Click tag to filter documents by that tag (future feature)
- Hover tag to see count of docs with that tag
- Tag autocomplete when editing frontmatter

**Smart field detection:**
- Detect URLs and make them clickable
- Detect email addresses and make them clickable
- Detect file paths and make them clickable (open in viewer)

**Frontmatter editing:**
- Allow editing frontmatter inline (advanced feature)
- Validate field types
- Save changes back to file

**Configurable visibility:**
- Hide/show specific frontmatter fields
- Customize which fields show in summary view
- Reorder fields

### Related Code

- `frontend/src/markdown.ts:326-368` - Frontmatter rendering
- `frontend/styles/main.css:592-616` - Frontmatter CSS
- `frontend/src/markdown.ts:265-273` - Frontmatter extraction

## Obsidian Callout Blocks

**Problem**: Obsidian-style callout blocks (e.g., `> [!NOTE]`, `> [!WARNING]`) are not rendering with proper styling. They currently display as plain blockquotes instead of styled callout boxes.

**Current behavior:**
```markdown
> [!NOTE]
> This is a note callout
```

Renders as a basic blockquote with the `[!NOTE]` text shown literally.

**Expected behavior (Obsidian-style):**
Should render as a styled callout box with:
- Colored left border or background
- Icon for the callout type
- Type label (NOTE, WARNING, etc.)
- Distinct visual appearance from regular blockquotes

### Obsidian Callout Syntax

**Basic syntax:**
```markdown
> [!NOTE]
> Content goes here
```

**Supported types:**
- `[!NOTE]` - Information, tips, general notes (blue)
- `[!TIP]` - Helpful suggestions (cyan/teal)
- `[!IMPORTANT]` - Critical information (purple)
- `[!WARNING]` - Warnings about potential issues (orange)
- `[!CAUTION]` - Serious warnings, negative consequences (red)
- `[!EXAMPLE]` - Example usage (green)
- `[!QUOTE]` - Quotations (gray)
- `[!INFO]` - Alias for NOTE
- `[!TODO]` - Task/action items (blue/purple)
- `[!SUCCESS]` - Success messages (green)
- `[!QUESTION]` - Questions, help needed (yellow)
- `[!FAILURE]` - Error messages (red)
- `[!DANGER]` - Alias for CAUTION
- `[!BUG]` - Bug reports (red)

**Advanced features:**
```markdown
> [!NOTE] Custom Title
> Content with custom title

> [!WARNING]- Foldable callout
> Content (collapsed by default)

> [!TIP]+ Foldable callout
> Content (expanded by default)
```

### Implementation Approach

#### Option 1: Post-Processing DOM

Transform blockquotes into callouts after markdown rendering.

```typescript
// In markdown.ts after rendering HTML
private transformCallouts(container: HTMLElement): void {
  const blockquotes = container.querySelectorAll('blockquote');

  blockquotes.forEach(blockquote => {
    const firstPara = blockquote.querySelector('p');
    if (!firstPara) return;

    const text = firstPara.textContent ?? '';
    const calloutMatch = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|EXAMPLE|QUOTE|INFO|TODO|SUCCESS|QUESTION|FAILURE|DANGER|BUG)\]([+-]?)\s*(.*)?$/i);

    if (calloutMatch) {
      const [, type, foldable, customTitle] = calloutMatch;
      this.convertToCallout(blockquote, type.toUpperCase(), foldable, customTitle);
    }
  });
}

private convertToCallout(
  blockquote: HTMLElement,
  type: string,
  foldable: string,
  customTitle?: string
): void {
  // Create callout structure
  const callout = document.createElement('div');
  callout.className = `callout callout-${type.toLowerCase()}`;

  const header = document.createElement('div');
  header.className = 'callout-header';

  const icon = document.createElement('span');
  icon.className = 'callout-icon';
  icon.textContent = this.getCalloutIcon(type);

  const title = document.createElement('span');
  title.className = 'callout-title';
  title.textContent = customTitle?.trim() || type;

  header.appendChild(icon);
  header.appendChild(title);

  const content = document.createElement('div');
  content.className = 'callout-content';

  // Move blockquote content to callout
  const firstPara = blockquote.querySelector('p');
  if (firstPara) {
    // Remove the [!TYPE] line
    const remainingText = firstPara.innerHTML.replace(/^\[!.*?\]([+-]?)(\s*.*?)(<br>|$)/, '');
    if (remainingText.trim()) {
      const newPara = document.createElement('p');
      newPara.innerHTML = remainingText;
      content.appendChild(newPara);
    }
  }

  // Move remaining children
  Array.from(blockquote.children).forEach((child, index) => {
    if (index > 0) { // Skip first paragraph (already processed)
      content.appendChild(child.cloneNode(true));
    }
  });

  callout.appendChild(header);
  callout.appendChild(content);

  // Handle foldable
  if (foldable) {
    callout.classList.add('callout-foldable');
    if (foldable === '-') {
      content.style.display = 'none';
      callout.classList.add('callout-collapsed');
    }

    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      const isCollapsed = content.style.display === 'none';
      content.style.display = isCollapsed ? 'block' : 'none';
      callout.classList.toggle('callout-collapsed');
    });
  }

  // Replace blockquote with callout
  blockquote.replaceWith(callout);
}

private getCalloutIcon(type: string): string {
  const icons: Record<string, string> = {
    NOTE: 'ℹ️',
    INFO: 'ℹ️',
    TIP: '💡',
    IMPORTANT: '❗',
    WARNING: '⚠️',
    CAUTION: '🔥',
    DANGER: '🔥',
    EXAMPLE: '📝',
    QUOTE: '💬',
    TODO: '☑️',
    SUCCESS: '✅',
    QUESTION: '❓',
    FAILURE: '❌',
    BUG: '🐛',
  };
  return icons[type] ?? 'ℹ️';
}
```

Then call in render:
```typescript
private render(): void {
  // ... existing rendering code ...

  if (this.currentFileType === "markdown") {
    const { frontmatter, content: markdown } = this.extractFrontmatter(
      this.currentContent
    );

    if (frontmatter !== null) {
      content.appendChild(this.renderFrontmatter(frontmatter));
    }

    const markdownContent = document.createElement("div");
    markdownContent.className = "markdown-body";
    markdownContent.innerHTML = this.mertex.render(markdown);

    // Transform Obsidian callouts
    this.transformCallouts(markdownContent);

    content.appendChild(markdownContent);
    this.attachLinkHandlers(content);
  }
  // ...
}
```

#### Option 2: Custom Marked Extension

Create a marked tokenizer extension for callouts (more robust).

```typescript
// In markdown.ts before marked configuration

import { marked, type Token, type Tokens } from 'marked';

interface CalloutToken extends Tokens.Generic {
  type: 'callout';
  calloutType: string;
  title?: string;
  foldable?: '-' | '+';
  text: string;
  tokens: Token[];
}

const calloutExtension = {
  name: 'callout',
  level: 'block',
  start(src: string) {
    return src.match(/^>\s*\[!/)?.index;
  },
  tokenizer(src: string): CalloutToken | undefined {
    const match = src.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|EXAMPLE|QUOTE|INFO|TODO|SUCCESS|QUESTION|FAILURE|DANGER|BUG)\]([+-]?)\s*(.*?)$/im);

    if (!match) return;

    const [fullMatch, calloutType, foldable, title] = match;

    // Extract the rest of the blockquote content
    const lines = src.split('\n');
    const contentLines: string[] = [];
    let i = 1;

    while (i < lines.length && lines[i]?.startsWith('>')) {
      contentLines.push(lines[i].replace(/^>\s?/, ''));
      i++;
    }

    const text = contentLines.join('\n');
    const raw = lines.slice(0, i).join('\n');

    return {
      type: 'callout',
      raw,
      calloutType: calloutType.toUpperCase(),
      title: title?.trim() || calloutType,
      foldable: foldable as '-' | '+' | undefined,
      text,
      tokens: this.lexer.blockTokens(text),
    };
  },
  renderer(token: CalloutToken) {
    const foldableClass = token.foldable ? ' callout-foldable' : '';
    const collapsedClass = token.foldable === '-' ? ' callout-collapsed' : '';
    const displayStyle = token.foldable === '-' ? ' style="display: none;"' : '';

    const icon = getCalloutIcon(token.calloutType);

    return `
      <div class="callout callout-${token.calloutType.toLowerCase()}${foldableClass}${collapsedClass}">
        <div class="callout-header">
          <span class="callout-icon">${icon}</span>
          <span class="callout-title">${token.title}</span>
        </div>
        <div class="callout-content"${displayStyle}>
          ${this.parser.parse(token.tokens)}
        </div>
      </div>
    `;
  }
};

// Register extension
marked.use({ extensions: [calloutExtension] });
```

**Pros (Option 2):**
- More robust, integrates with marked's parser
- Handles nested content correctly
- Better performance

**Cons (Option 2):**
- More complex to implement
- Requires deeper understanding of marked's tokenizer API

#### Recommended: Option 1 (Post-Processing)

Start with post-processing approach because:
- Simpler to implement and debug
- Easier to understand and maintain
- Works with existing mertex.md setup
- Can upgrade to Option 2 later if needed

### CSS Styling

```css
/* Callout base styles */
.callout {
  border-left: 4px solid var(--callout-color, var(--border-color));
  border-radius: 4px;
  margin: 16px 0;
  padding: 0;
  background: var(--callout-bg, rgba(var(--callout-color-rgb), 0.1));
  overflow: hidden;
}

.callout-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-weight: 600;
  background: rgba(var(--callout-color-rgb), 0.15);
  color: var(--text-primary);
}

.callout-icon {
  font-size: 16px;
  line-height: 1;
}

.callout-title {
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.callout-content {
  padding: 12px 16px;
  color: var(--text-secondary);
}

.callout-content > *:first-child {
  margin-top: 0;
}

.callout-content > *:last-child {
  margin-bottom: 0;
}

/* Foldable callouts */
.callout-foldable .callout-header {
  cursor: pointer;
  user-select: none;
}

.callout-foldable .callout-header::before {
  content: '▾';
  margin-right: 4px;
  font-size: 12px;
  transition: transform 0.2s ease;
}

.callout-foldable.callout-collapsed .callout-header::before {
  transform: rotate(-90deg);
}

.callout-foldable .callout-header:hover {
  background: rgba(var(--callout-color-rgb), 0.2);
}

/* Callout type colors */
.callout-note,
.callout-info {
  --callout-color: #3b82f6; /* blue */
  --callout-color-rgb: 59, 130, 246;
}

.callout-tip {
  --callout-color: #06b6d4; /* cyan */
  --callout-color-rgb: 6, 182, 212;
}

.callout-important {
  --callout-color: #a855f7; /* purple */
  --callout-color-rgb: 168, 85, 247;
}

.callout-warning {
  --callout-color: #f59e0b; /* orange */
  --callout-color-rgb: 245, 158, 11;
}

.callout-caution,
.callout-danger {
  --callout-color: #ef4444; /* red */
  --callout-color-rgb: 239, 68, 68;
}

.callout-example {
  --callout-color: #10b981; /* green */
  --callout-color-rgb: 16, 185, 129;
}

.callout-quote {
  --callout-color: #6b7280; /* gray */
  --callout-color-rgb: 107, 114, 128;
}

.callout-todo {
  --callout-color: #8b5cf6; /* violet */
  --callout-color-rgb: 139, 92, 246;
}

.callout-success {
  --callout-color: #22c55e; /* bright green */
  --callout-color-rgb: 34, 197, 94;
}

.callout-question {
  --callout-color: #eab308; /* yellow */
  --callout-color-rgb: 234, 179, 8;
}

.callout-failure,
.callout-bug {
  --callout-color: #dc2626; /* dark red */
  --callout-color-rgb: 220, 38, 38;
}
```

### Visual Examples

**NOTE callout:**
```
┌─────────────────────────────────────────┐
│ ℹ️  NOTE                                │ (blue header bg)
├─────────────────────────────────────────┤
│ This is a note callout with useful     │
│ information for the reader.            │
└─────────────────────────────────────────┘
```

**WARNING callout:**
```
┌─────────────────────────────────────────┐
│ ⚠️  WARNING                             │ (orange header bg)
├─────────────────────────────────────────┤
│ Be careful when doing this operation.  │
│ It may have unintended consequences.   │
└─────────────────────────────────────────┘
```

**Foldable callout (collapsed):**
```
┌─────────────────────────────────────────┐
│ ▸ 💡 TIP                                │ (cyan header bg)
└─────────────────────────────────────────┘
```

**Foldable callout (expanded):**
```
┌─────────────────────────────────────────┐
│ ▾ 💡 TIP                                │ (cyan header bg)
├─────────────────────────────────────────┤
│ Here's a helpful tip for improving     │
│ your workflow.                          │
└─────────────────────────────────────────┘
```

### Implementation Priority

1. **Phase 1: Basic callouts**
   - Implement post-processing transformation
   - Add CSS for NOTE, WARNING, TIP, IMPORTANT, CAUTION
   - Test with example documents

2. **Phase 2: All callout types**
   - Add remaining callout types (EXAMPLE, TODO, etc.)
   - Ensure icons and colors match Obsidian

3. **Phase 3: Foldable callouts**
   - Implement `[!TYPE]+` and `[!TYPE]-` syntax
   - Add expand/collapse interaction
   - Preserve collapsed state during re-renders (optional)

4. **Phase 4: Custom titles**
   - Support `[!NOTE] Custom Title Here` syntax
   - Ensure title wraps nicely for long text

5. **Phase 5: Polish**
   - Smooth animations for expand/collapse
   - Keyboard navigation (Enter to toggle)
   - Accessibility (ARIA labels, focus management)

### Related Code

- `frontend/src/markdown.ts:220-260` - Markdown rendering
- `frontend/src/markdown.ts:100-113` - Mertex initialization
- `frontend/styles/main.css` - Add new callout styles

## See Also

- [[../user/plan-viewer|Plan Viewer User Guide]]
