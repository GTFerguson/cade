/**
 * Mobile touch toolbar — vim statusline aesthetic.
 *
 * Renders a 6-button bar (esc | tab | ^c | ^d | ↑ | [cmd]) fixed to
 * the bottom of the viewport. Repositions above the virtual keyboard
 * when it opens, and debounces terminal resize.
 */

import type { Component } from "../types";

interface ToolbarKey {
  label: string;
  data: string | null;
  /** CSS class added to this button */
  className?: string;
}

const TOOLBAR_KEYS: ToolbarKey[] = [
  { label: "esc", data: "\x1b" },
  { label: "tab", data: "\t" },
  { label: "^c", data: "\x03" },
  { label: "^d", data: "\x04" },
  { label: "\u2191", data: "\x1b[A" },
  { label: "[cmd]", data: null, className: "key-cmd" },
];

const TOOLBAR_HEIGHT = 48;
const RESIZE_DEBOUNCE_MS = 150;

export class TouchToolbar implements Component {
  private toolbar: HTMLElement;
  private cmdButton: HTMLButtonElement | null = null;
  private resizeTimer: number | null = null;
  private boundViewportResize: () => void;

  constructor(
    private sendInput: (data: string) => void,
    private onCmd: () => void,
  ) {
    this.toolbar = document.getElementById("touch-toolbar") as HTMLElement;
    this.boundViewportResize = () => this.handleViewportResize();
  }

  initialize(): void {
    this.createButtons();
    this.setupViewportListeners();
    this.show();
  }

  private createButtons(): void {
    this.toolbar.innerHTML = "";

    for (let i = 0; i < TOOLBAR_KEYS.length; i++) {
      const key = TOOLBAR_KEYS[i]!;
      const btn = document.createElement("button");

      let cls = "touch-toolbar-btn";
      if (key.className) cls += ` ${key.className}`;
      // Pipe separator on all keys except the last
      if (i < TOOLBAR_KEYS.length - 1) cls += " key-separator";
      btn.className = cls;

      btn.textContent = key.label;
      btn.setAttribute("aria-label", key.label);

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (key.data !== null) {
          this.sendInput(key.data);
        } else {
          this.onCmd();
        }
      });

      this.toolbar.appendChild(btn);

      if (key.className === "key-cmd") {
        this.cmdButton = btn;
      }
    }
  }

  private setupViewportListeners(): void {
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", this.boundViewportResize);
      window.visualViewport.addEventListener("scroll", this.boundViewportResize);
    }
  }

  /**
   * Reposition toolbar above the virtual keyboard and trigger terminal re-fit.
   */
  private handleViewportResize(): void {
    if (!window.visualViewport) return;

    const keyboardHeight = window.innerHeight - window.visualViewport.height;
    this.toolbar.style.bottom = `${Math.max(0, keyboardHeight)}px`;

    // When keyboard is visible, safe-area padding is unnecessary
    if (keyboardHeight > 0) {
      this.toolbar.style.paddingBottom = "0";
    } else {
      this.toolbar.style.paddingBottom = "";
    }

    this.debouncedRefit();
  }

  /**
   * Debounced dispatch of resize event so xterm re-fits to available space.
   */
  private debouncedRefit(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      window.dispatchEvent(new Event("resize"));
    }, RESIZE_DEBOUNCE_MS);
  }

  show(): void {
    this.toolbar.style.display = "flex";
  }

  hide(): void {
    this.toolbar.style.display = "none";
  }

  getHeight(): number {
    return TOOLBAR_HEIGHT;
  }

  /**
   * Show a notification indicator on the [cmd] button.
   */
  showCmdIndicator(): void {
    this.cmdButton?.classList.add("has-indicator");
  }

  clearCmdIndicator(): void {
    this.cmdButton?.classList.remove("has-indicator");
  }

  dispose(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }

    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.boundViewportResize);
      window.visualViewport.removeEventListener("scroll", this.boundViewportResize);
    }

    this.hide();
    this.toolbar.innerHTML = "";
    this.cmdButton = null;
  }
}
