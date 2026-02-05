/**
 * Help overlay displaying keybinding guide.
 *
 * Shows a modal with all available keyboard shortcuts.
 * Dismissed by any key press or click.
 */

import type { Component } from "./types";

const KEYBINDINGS_HTML = `
<div class="help-overlay-content">
  <h2>Keyboard Shortcuts</h2>
  <p class="help-prefix-note">Prefix key: <kbd>Ctrl-a</kbd></p>

  <div class="help-section">
    <h3>Pane Navigation</h3>
    <table>
      <tr><td><kbd>prefix</kbd> + <kbd>f</kbd> / <kbd>h</kbd> / <kbd>←</kbd></td><td>Focus pane left</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>g</kbd> / <kbd>l</kbd> / <kbd>→</kbd></td><td>Focus pane right</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Terminal</h3>
    <table>
      <tr><td><kbd>prefix</kbd> + <kbd>s</kbd></td><td>Toggle claude/shell terminal</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>g</kbd></td><td>Scroll to top</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>G</kbd></td><td>Scroll to bottom</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Pane Resize</h3>
    <table>
      <tr><td><kbd>prefix</kbd> + <kbd>Alt-h</kbd></td><td>Shrink left / grow right</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>Alt-l</kbd></td><td>Grow left / shrink right</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Tab Navigation</h3>
    <table>
      <tr><td><kbd>prefix</kbd> + <kbd>d</kbd></td><td>Previous tab</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>f</kbd></td><td>Next tab</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>1-9</kbd></td><td>Go to tab 1-9</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>c</kbd></td><td>Create new tab</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>C</kbd></td><td>Create remote tab</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>x</kbd></td><td>Close current tab</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Right Pane</h3>
    <table>
      <tr><td><kbd>prefix</kbd> + <kbd>v</kbd></td><td>Toggle viewer pane visibility</td></tr>
      <tr><td><kbd>prefix</kbd> + <kbd>n</kbd></td><td>Toggle Neovim mode</td></tr>
      <tr><td><kbd>Ctrl-g</kbd></td><td>View latest plan</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Appearance</h3>
    <table>
      <tr><td><kbd>prefix</kbd> + <kbd>t</kbd></td><td>Open theme selector</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>File Tree (when focused)</h3>
    <table>
      <tr><td><kbd>j</kbd> / <kbd>↓</kbd></td><td>Move selection down</td></tr>
      <tr><td><kbd>k</kbd> / <kbd>↑</kbd></td><td>Move selection up</td></tr>
      <tr><td><kbd>l</kbd> / <kbd>Enter</kbd></td><td>Expand folder / open file</td></tr>
      <tr><td><kbd>h</kbd></td><td>Collapse folder / go to parent</td></tr>
      <tr><td><kbd>g</kbd><kbd>g</kbd></td><td>Jump to top</td></tr>
      <tr><td><kbd>G</kbd></td><td>Jump to bottom</td></tr>
      <tr><td><kbd>/</kbd></td><td>Start search/filter</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Clear search</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Viewer (when focused)</h3>
    <table>
      <tr><td><kbd>j</kbd> / <kbd>↓</kbd></td><td>Scroll down</td></tr>
      <tr><td><kbd>k</kbd> / <kbd>↑</kbd></td><td>Scroll up</td></tr>
      <tr><td><kbd>g</kbd><kbd>g</kbd></td><td>Scroll to top</td></tr>
      <tr><td><kbd>G</kbd></td><td>Scroll to bottom</td></tr>
      <tr><td><kbd>Ctrl-d</kbd></td><td>Page down</td></tr>
      <tr><td><kbd>Ctrl-u</kbd></td><td>Page up</td></tr>
      <tr><td><kbd>i</kbd></td><td>Enter Normal mode (editor)</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Markdown Editor - Normal Mode</h3>
    <table>
      <tr><td><kbd>h</kbd> / <kbd>←</kbd></td><td>Move cursor left</td></tr>
      <tr><td><kbd>j</kbd> / <kbd>↓</kbd></td><td>Move cursor down</td></tr>
      <tr><td><kbd>k</kbd> / <kbd>↑</kbd></td><td>Move cursor up</td></tr>
      <tr><td><kbd>l</kbd> / <kbd>→</kbd></td><td>Move cursor right</td></tr>
      <tr><td><kbd>w</kbd></td><td>Jump to next word</td></tr>
      <tr><td><kbd>b</kbd></td><td>Jump to previous word</td></tr>
      <tr><td><kbd>e</kbd></td><td>Jump to end of word</td></tr>
      <tr><td><kbd>0</kbd></td><td>Jump to start of line</td></tr>
      <tr><td><kbd>$</kbd></td><td>Jump to end of line</td></tr>
      <tr><td><kbd>g</kbd><kbd>g</kbd></td><td>Jump to document start</td></tr>
      <tr><td><kbd>G</kbd></td><td>Jump to document end</td></tr>
      <tr><td><kbd>Ctrl-i</kbd></td><td>Enter Edit mode (insert)</td></tr>
      <tr><td><kbd>Ctrl-s</kbd></td><td>Save file</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Exit to View mode</td></tr>
    </table>
  </div>

  <div class="help-section">
    <h3>Markdown Editor - Edit Mode</h3>
    <table>
      <tr><td><kbd>Ctrl-i</kbd></td><td>Return to Normal mode</td></tr>
      <tr><td><kbd>Ctrl-s</kbd></td><td>Save file</td></tr>
      <tr><td><kbd>Escape</kbd></td><td>Exit to View mode</td></tr>
    </table>
  </div>

  <p class="help-dismiss-note">Press any key or click to dismiss</p>
</div>
`;

export class HelpOverlay implements Component {
  private overlay: HTMLElement | null = null;
  private boundHandleKeydown: (e: KeyboardEvent) => void;
  private boundHandleClick: (e: MouseEvent) => void;
  private isVisible = false;

  constructor() {
    this.boundHandleKeydown = this.handleKeydown.bind(this);
    this.boundHandleClick = this.handleClick.bind(this);
  }

  /**
   * Initialize the help overlay.
   */
  initialize(): void {
    this.overlay = document.createElement("div");
    this.overlay.className = "help-overlay";
    this.overlay.innerHTML = KEYBINDINGS_HTML;
    document.body.appendChild(this.overlay);
  }

  /**
   * Show the help overlay.
   */
  show(): void {
    if (this.isVisible || !this.overlay) {
      return;
    }

    this.isVisible = true;
    this.overlay.classList.add("visible");

    // Delay adding listeners to avoid immediate dismissal
    setTimeout(() => {
      document.addEventListener("keydown", this.boundHandleKeydown);
      document.addEventListener("click", this.boundHandleClick);
    }, 100);
  }

  /**
   * Hide the help overlay.
   */
  hide(): void {
    if (!this.isVisible || !this.overlay) {
      return;
    }

    this.isVisible = false;
    this.overlay.classList.remove("visible");
    document.removeEventListener("keydown", this.boundHandleKeydown);
    document.removeEventListener("click", this.boundHandleClick);
  }

  /**
   * Toggle visibility.
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Check if visible.
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Handle keydown to dismiss.
   */
  private handleKeydown(e: KeyboardEvent): void {
    e.preventDefault();
    this.hide();
  }

  /**
   * Handle click to dismiss.
   */
  private handleClick(_e: MouseEvent): void {
    this.hide();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.hide();
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
