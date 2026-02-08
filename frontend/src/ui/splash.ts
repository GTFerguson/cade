/**
 * Splash screen manager for CADE startup.
 * Creates a splash overlay within a specified container (e.g., terminal pane).
 *
 * Two modes:
 *  - Status mode (default): Shows "[loading]" / "[enter]", dismissed with Enter/Space.
 *  - Options mode: Shows selectable actions (e.g. Local/Remote project picker).
 *    Navigate with ↑↓ / j/k, confirm with Enter, or click.
 *
 * On mobile (≤768px), uses a narrower box-drawing logo and scramble effects.
 */

import { MenuNav, renderHelpBar } from "./menu-nav";
import {
  CADE_LOGO,
  CADE_LOGO_MOBILE,
  runLoadIn,
  runDismiss,
} from "./splash-effects";

export interface SplashOption {
  label: string;
  action: () => void;
}

const MOBILE_BREAKPOINT = 768;

export class Splash {
  private element: HTMLElement;
  private logoEl: HTMLPreElement;
  private statusEl: HTMLElement;
  private ready = false;
  private onEnter: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private tapHandler: ((e: Event) => void) | null = null;
  private isMobile: boolean;
  private logo: string;

  private options: SplashOption[] | null = null;
  private optionEls: HTMLElement[] = [];
  private nav: MenuNav;

  private progressEl: HTMLElement | null = null;
  private progressSegs: HTMLElement[] = [];
  private progressLabelEl: HTMLElement | null = null;
  private static TOTAL_STEPS = 4;

  constructor(container: HTMLElement) {
    this.isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    this.logo = this.isMobile ? CADE_LOGO_MOBILE : CADE_LOGO;

    this.element = document.createElement("div");
    this.element.className = "splash";

    this.logoEl = document.createElement("pre");
    this.logoEl.className = this.isMobile
      ? "splash-logo splash-logo-mobile"
      : "splash-logo";
    this.logoEl.textContent = "";

    this.statusEl = document.createElement("div");
    this.statusEl.className = "splash-status";
    this.statusEl.textContent = "[loading]";

    this.element.appendChild(this.logoEl);
    this.element.appendChild(this.statusEl);
    container.appendChild(this.element);

    // Run load-in scramble effect
    runLoadIn(this.logoEl, this.logo, "binaryBootSlow", () => {
      // Animation complete — logo is now fully visible
    });

    this.nav = new MenuNav({
      getOptions: () => this.optionEls,
      onSelect: (i) => this.options?.[i]?.action(),
    });

    this.setupKeyListener();
    this.setupTapListener();
  }

  private setupKeyListener(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Options mode: delegate to MenuNav
      if (this.options) {
        // Don't intercept keys when another screen is overlaid
        if (document.querySelector(".modal-overlay, .remote-project-selector")) return;

        if (this.nav.handleKeyDown(e)) {
          e.stopPropagation();
        }
        return;
      }

      // Status mode: dismiss on Enter/Space
      if (this.ready && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
      }
    };
    // Use capture phase to intercept before other handlers
    document.addEventListener("keydown", this.keyHandler, true);
  }

  private setupTapListener(): void {
    this.tapHandler = (e: Event) => {
      // Only dismiss on tap in status mode
      if (this.ready && !this.options) {
        e.preventDefault();
        this.dismiss();
      }
    };
    this.element.addEventListener("click", this.tapHandler);
  }

  private dismiss(): void {
    this.hide();
    this.onEnter?.();
  }

  /**
   * Update the status message displayed on the splash screen.
   */
  setStatus(message: string): void {
    this.statusEl.textContent = `[${message}]`;
    this.statusEl.classList.remove("blink");
  }

  /**
   * Mark the splash as ready, showing "enter" and enabling key press to dismiss.
   */
  setReady(callback: () => void): void {
    this.ready = true;
    this.onEnter = callback;
    this.setStatus(this.isMobile ? "tap" : "enter");
    this.statusEl.classList.add("blink");
  }

  /**
   * Switch to options mode: replace the status text with selectable actions.
   * Used for the start screen when no tabs are open.
   */
  setOptions(options: SplashOption[]): void {
    this.options = options;
    this.nav.reset();
    this.ready = true;

    this.statusEl.style.display = "none";

    const container = document.createElement("div");
    container.className = "splash-options";

    this.optionEls = options.map((opt) => {
      const el = document.createElement("div");
      el.className = "splash-option";
      el.textContent = `[${opt.label}]`;
      el.addEventListener("click", () => opt.action());
      container.appendChild(el);
      return el;
    });

    this.element.appendChild(container);
    this.nav.renderSelection();

    const helpEl = document.createElement("div");
    helpEl.className = "splash-help";
    helpEl.innerHTML = renderHelpBar([
      { key: "j/k", label: "navigate" },
      { key: "l", label: "select" },
    ]);
    this.element.appendChild(helpEl);
  }

  /**
   * Transition from options mode to a progress bar.
   * Called when user has selected an action and we're waiting for shell readiness.
   */
  setLoading(): void {
    this.options = null;
    this.optionEls = [];
    this.ready = false;

    this.element.querySelector(".splash-options")?.remove();
    this.element.querySelector(".splash-help")?.remove();
    this.statusEl.style.display = "none";

    this.progressEl = document.createElement("div");
    this.progressEl.className = "splash-progress";

    const bar = document.createElement("div");
    bar.className = "splash-progress-bar";

    this.progressSegs = [];
    for (let i = 0; i < Splash.TOTAL_STEPS; i++) {
      const seg = document.createElement("div");
      seg.className = "seg";
      bar.appendChild(seg);
      this.progressSegs.push(seg);
    }

    this.progressLabelEl = document.createElement("div");
    this.progressLabelEl.className = "splash-progress-label";
    this.progressLabelEl.textContent = "initializing";

    this.progressEl.appendChild(bar);
    this.progressEl.appendChild(this.progressLabelEl);
    this.element.appendChild(this.progressEl);

    // Start at step 1
    this.setProgress(1, "initializing");
  }

  /**
   * Update the progress bar to the given step (1-based).
   */
  setProgress(step: number, label: string): void {
    for (let i = 0; i < this.progressSegs.length; i++) {
      this.progressSegs[i]?.classList.toggle("filled", i < step);
    }
    if (this.progressLabelEl) {
      this.progressLabelEl.textContent = label;
    }
  }

  /**
   * Auto-skip the splash screen and immediately call the callback.
   * Used when reconnecting to an active session.
   */
  autoSkip(callback: () => void): void {
    this.onEnter = callback;
    this.hide();
    callback();
  }

  /**
   * Hide the splash screen with dismiss scramble effect.
   */
  hide(): void {
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler, true);
      this.keyHandler = null;
    }
    if (this.tapHandler) {
      this.element.removeEventListener("click", this.tapHandler);
      this.tapHandler = null;
    }

    // Run dismiss effect, then remove element
    runDismiss(this.logoEl, this.logo, "binaryEntropySmooth", () => {
      this.element.classList.add("hidden");
      setTimeout(() => this.element.remove(), 100);
    });
  }

  /**
   * Check if splash is still visible.
   */
  isVisible(): boolean {
    return !this.element.classList.contains("hidden");
  }
}
