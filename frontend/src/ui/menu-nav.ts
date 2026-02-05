/**
 * Shared TUI menu navigation controller.
 *
 * Owns the selectedIndex, vim key dispatch, option selection rendering,
 * input field guard, and click handler wiring that every menu duplicated.
 * Components create a MenuNav with callbacks, then delegate keydown events.
 */

import { wrapIndex } from "../nav";

// ─── Pure utilities ──────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]!);
}

export function renderHelpBar(
  bindings: { key: string; label: string }[]
): string {
  return bindings
    .map((b) => `<span class="help-key">${b.key}</span> ${b.label}`)
    .join("&nbsp;&nbsp;");
}

// ─── MenuNav ─────────────────────────────────────────────────────────

export interface MenuNavConfig {
  /** Returns current option elements (may change between renders). */
  getOptions: () => ArrayLike<HTMLElement>;

  /** Returns input fields for menus with forms. Omit for option-only menus. */
  getInputFields?: () => ArrayLike<HTMLInputElement>;

  /** Called when an option is confirmed (Enter/l/Space or click). */
  onSelect: (index: number) => void;

  /** Called on h/Backspace. Omit to ignore these keys. */
  onBack?: () => void;

  /** Called on Escape. Omit to ignore Escape. */
  onCancel?: () => void;

  /** Called after selectedIndex changes via navigate(). */
  onNavigate?: (index: number) => void;

  /**
   * Custom handler for keys pressed while focused in an input field.
   * Called after built-in handling (Escape→blur, ArrowUp/Down→field nav).
   * Return true if handled.
   */
  onInputKey?: (e: KeyboardEvent, input: HTMLInputElement) => boolean;
}

export class MenuNav {
  selectedIndex = 0;

  constructor(private config: MenuNavConfig) {}

  /** Toggle "selected" class on the current option elements. */
  renderSelection(): void {
    const options = this.config.getOptions();
    for (let i = 0; i < options.length; i++) {
      options[i]!.classList.toggle("selected", i === this.selectedIndex);
    }
  }

  /** Move selection by delta, wrapping at bounds. */
  navigate(delta: number): void {
    const options = this.config.getOptions();
    const len = options.length;
    if (len === 0) return;

    // Going up from first option with input fields → jump to last field
    if (delta < 0 && this.selectedIndex === 0 && this.config.getInputFields) {
      const fields = this.config.getInputFields();
      if (fields.length > 0) {
        options[0]?.classList.remove("selected");
        fields[fields.length - 1]!.focus();
        return;
      }
    }

    this.selectedIndex = wrapIndex(this.selectedIndex, delta, len);
    this.renderSelection();
    this.config.onNavigate?.(this.selectedIndex);
  }

  /**
   * Handle a keydown event. Returns true if consumed.
   * Does NOT call stopPropagation — the caller decides that.
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    if ((e.target as HTMLElement).tagName === "INPUT") {
      return this.handleInputKey(e);
    }

    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        this.navigate(1);
        return true;

      case "k":
      case "ArrowUp":
        e.preventDefault();
        this.navigate(-1);
        return true;

      case "l":
      case " ":
      case "Enter":
        e.preventDefault();
        this.config.onSelect(this.selectedIndex);
        return true;

      case "h":
      case "Backspace":
        if (this.config.onBack) {
          e.preventDefault();
          this.config.onBack();
          return true;
        }
        return false;

      case "Escape":
        if (this.config.onCancel) {
          e.preventDefault();
          this.config.onCancel();
          return true;
        }
        return false;

      default:
        return false;
    }
  }

  /** Wire click handlers on the current set of option elements. */
  wireClickHandlers(): void {
    const options = this.config.getOptions();
    for (let i = 0; i < options.length; i++) {
      const idx = i;
      options[i]!.addEventListener("click", () => {
        this.selectedIndex = idx;
        this.renderSelection();
        this.config.onSelect(idx);
      });
    }
  }

  reset(): void {
    this.selectedIndex = 0;
  }

  // ─── Input field handling ────────────────────────────────────────

  private handleInputKey(e: KeyboardEvent): boolean {
    const input = e.target as HTMLInputElement;

    if (e.key === "Escape") {
      e.preventDefault();
      input.blur();
      return true;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const fields = this.config.getInputFields?.();
      if (!fields || fields.length === 0) return false;

      e.preventDefault();
      const fieldsArr = Array.from(fields);
      const idx = fieldsArr.indexOf(input);
      if (idx < 0) return false;

      const direction = e.key === "ArrowDown" ? 1 : -1;
      const nextIdx = idx + direction;

      if (nextIdx >= 0 && nextIdx < fields.length) {
        fields[nextIdx]!.focus();
      } else if (direction > 0) {
        // Past last field → jump to first option
        input.blur();
        this.selectedIndex = 0;
        this.renderSelection();
      }
      return true;
    }

    // Delegate to component-specific input key handling
    if (this.config.onInputKey) {
      return this.config.onInputKey(e, input);
    }

    return false;
  }
}
