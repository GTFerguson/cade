/**
 * Full-pane dashboard for mobile.
 *
 * Does not own a DashboardPane. The tab already maintains a WS-synced
 * full-width dashboard in `.dashboard-full-container` (hidden until the
 * desktop view toggle). This screen borrows that element into its body
 * while shown and returns it untouched on hide, so dashboard state and
 * the single WS subscription are preserved.
 */

import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";

export interface DashboardScreenCallbacks {
  /** The tab's `.dashboard-full-container`, or null if no dashboard. */
  getContainer: () => HTMLElement | null;
  onBack: () => void;
}

export class DashboardScreen implements MobileScreen {
  readonly element: HTMLElement;
  private bodyEl: HTMLElement;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private cleanupSwipe: (() => void) | null = null;

  /** Where the borrowed container lived before we adopted it. */
  private borrowed: HTMLElement | null = null;
  private originalParent: HTMLElement | null = null;
  private originalDisplay = "";

  constructor(private callbacks: DashboardScreenCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-dashboard";

    const header = document.createElement("div");
    header.className = "mobile-screen-header";
    header.style.fontSize = "12px";
    header.style.letterSpacing = "1px";
    header.textContent = "[ dashboard ]";
    this.element.appendChild(header);

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "mobile-screen-body mobile-dashboard-body";
    this.element.appendChild(this.bodyEl);

    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";
    const help = document.createElement("span");
    help.className = "help-hint";
    help.textContent = "swipe → back";
    statusline.appendChild(help);
    this.element.appendChild(statusline);
  }

  onShow(): void {
    const container = this.callbacks.getContainer();
    if (container) {
      this.borrowed = container;
      this.originalParent = container.parentElement;
      this.originalDisplay = container.style.display;
      this.bodyEl.appendChild(container);
      // Inline style is display:none until the desktop toggle; clearing it
      // lets the .dashboard-full-container flex rule take over.
      container.style.display = "";
    } else {
      this.bodyEl.innerHTML =
        '<div style="text-align:center;color:var(--text-muted);padding:40px;">no dashboard configured</div>';
    }

    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "Backspace" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onBack();
      }
    };
    document.addEventListener("keydown", this.boundKeyHandler, true);

    this.cleanupSwipe = setupSwipeBack(this.element, () =>
      this.callbacks.onBack()
    );
  }

  onHide(): void {
    // Return the borrowed container exactly as we found it.
    if (this.borrowed && this.originalParent) {
      this.originalParent.appendChild(this.borrowed);
      this.borrowed.style.display = this.originalDisplay || "none";
    }
    this.borrowed = null;
    this.originalParent = null;

    if (this.boundKeyHandler) {
      document.removeEventListener("keydown", this.boundKeyHandler, true);
      this.boundKeyHandler = null;
    }
    this.cleanupSwipe?.();
    this.cleanupSwipe = null;
  }

  dispose(): void {
    this.onHide();
  }
}
