/**
 * Mobile touch toolbar providing keys that virtual keyboards can't produce.
 *
 * Renders a 6-button bar (↑, Tab, Esc, ^C, ^D, ⋯) fixed to the bottom
 * of the viewport, repositioning above the virtual keyboard when it opens.
 */

import type { Component } from "../types";

interface ToolbarKey {
  label: string;
  data: string | null;
}

const TOOLBAR_KEYS: ToolbarKey[] = [
  { label: "↑",   data: "\x1b[A" },
  { label: "Tab", data: "\t"     },
  { label: "Esc", data: "\x1b"   },
  { label: "^C",  data: "\x03"   },
  { label: "^D",  data: "\x04"   },
  { label: "⋯",   data: null     },
];

const TOOLBAR_HEIGHT = 48;
const RESIZE_DEBOUNCE_MS = 150;

export class TouchToolbar implements Component {
  private toolbar: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private resizeTimer: number | null = null;
  private boundViewportResize: () => void;

  constructor(
    private sendInput: (data: string) => void,
    private onOverflowMenu: () => void,
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

    for (const key of TOOLBAR_KEYS) {
      const btn = document.createElement("button");
      btn.className = "touch-toolbar-btn";
      btn.textContent = key.label;
      btn.setAttribute("aria-label", key.label);

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (key.data !== null) {
          this.sendInput(key.data);
        } else {
          this.onOverflowMenu();
        }
      });

      this.toolbar.appendChild(btn);
      this.buttons.push(btn);
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

  /**
   * Get the toolbar height for layout calculations.
   */
  getHeight(): number {
    return TOOLBAR_HEIGHT;
  }

  /**
   * Show a notification indicator on the overflow (⋯) button.
   */
  showOverflowIndicator(): void {
    const overflowBtn = this.buttons[this.buttons.length - 1];
    overflowBtn?.classList.add("has-indicator");
  }

  clearOverflowIndicator(): void {
    const overflowBtn = this.buttons[this.buttons.length - 1];
    overflowBtn?.classList.remove("has-indicator");
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
    this.buttons = [];
  }
}
