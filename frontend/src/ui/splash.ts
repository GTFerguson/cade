/**
 * Splash screen manager for CADE startup.
 * Creates a splash overlay within a specified container (e.g., terminal pane).
 *
 * Two modes:
 *  - Status mode (default): Shows "[loading]" / "[enter]", dismissed with Enter/Space.
 *  - Options mode: Shows selectable actions (e.g. Local/Remote project picker).
 *    Navigate with ↑↓ / j/k, confirm with Enter, or click.
 */

export interface SplashOption {
  label: string;
  action: () => void;
}

const CADE_LOGO = `   █████████    █████████   ██████████   ██████████
  ███░░░░░███  ███░░░░░███ ░░███░░░░███ ░░███░░░░░█
 ███     ░░░  ░███    ░███  ░███   ░░███ ░███  █ ░
░███          ░███████████  ░███    ░███ ░██████
░███          ░███░░░░░███  ░███    ░███ ░███░░█
░░███     ███ ░███    ░███  ░███    ███  ░███ ░   █
 ░░█████████  █████   █████ ██████████   ██████████
  ░░░░░░░░░  ░░░░░   ░░░░░ ░░░░░░░░░░   ░░░░░░░░░░`;

export class Splash {
  private element: HTMLElement;
  private statusEl: HTMLElement;
  private ready = false;
  private onEnter: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private tapHandler: ((e: Event) => void) | null = null;

  private options: SplashOption[] | null = null;
  private selectedIndex = 0;
  private optionEls: HTMLElement[] = [];

  constructor(container: HTMLElement) {
    this.element = document.createElement("div");
    this.element.className = "splash";

    const logo = document.createElement("pre");
    logo.className = "splash-logo";
    logo.textContent = CADE_LOGO;

    this.statusEl = document.createElement("div");
    this.statusEl.className = "splash-status";
    this.statusEl.textContent = "[loading]";

    this.element.appendChild(logo);
    this.element.appendChild(this.statusEl);
    container.appendChild(this.element);

    this.setupKeyListener();
    this.setupTapListener();
  }

  private setupKeyListener(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Options mode: navigate and select
      if (this.options) {
        // Don't intercept keys when a modal overlay is open
        if (document.querySelector(".modal-overlay")) return;

        if (e.key === "ArrowUp" || e.key === "ArrowDown" ||
            e.key === "j" || e.key === "k") {
          e.preventDefault();
          e.stopPropagation();
          this.selectedIndex =
            (this.selectedIndex + (e.key === "ArrowUp" || e.key === "k" ? -1 : 1) +
             this.options.length) % this.options.length;
          this.renderSelection();
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.options[this.selectedIndex]!.action();
          return;
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
    const isMobile = window.innerWidth <= 768;
    this.setStatus(isMobile ? "tap" : "enter");
    this.statusEl.classList.add("blink");
  }

  /**
   * Switch to options mode: replace the status text with selectable actions.
   * Used for the start screen when no tabs are open.
   */
  setOptions(options: SplashOption[]): void {
    this.options = options;
    this.selectedIndex = 0;
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
    this.renderSelection();
  }

  private renderSelection(): void {
    this.optionEls.forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
    });
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
   * Hide the splash screen with a fade animation.
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
    this.element.classList.add("hidden");
    setTimeout(() => this.element.remove(), 300);
  }

  /**
   * Check if splash is still visible.
   */
  isVisible(): boolean {
    return !this.element.classList.contains("hidden");
  }
}
