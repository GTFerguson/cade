/**
 * TUI-style theme selector overlay.
 *
 * Shows a centered panel with all available themes. Navigate with j/k,
 * select with Enter/l. Live-previews theme colors as you move through
 * the list. Esc reverts to the previously active theme.
 */

import { themes, getSavedThemeId, applyTheme, type Theme } from "../config/themes";

export class ThemeSelector {
  private overlay: HTMLElement | null = null;
  private optionEls: HTMLElement[] = [];
  private selectedIndex = 0;
  private previousThemeId: string;
  private isVisible = false;
  private boundKeyHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.previousThemeId = getSavedThemeId();
    this.boundKeyHandler = this.handleKeydown.bind(this);
  }

  show(): void {
    if (this.isVisible) return;

    this.previousThemeId = getSavedThemeId();
    this.selectedIndex = themes.findIndex((t) => t.id === this.previousThemeId);
    if (this.selectedIndex < 0) this.selectedIndex = 0;

    this.isVisible = true;
    this.render();

    setTimeout(() => {
      document.addEventListener("keydown", this.boundKeyHandler, true);
    }, 50);
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    document.removeEventListener("keydown", this.boundKeyHandler, true);
    this.overlay?.remove();
    this.overlay = null;
    this.optionEls = [];
  }

  toggle(): void {
    if (this.isVisible) {
      this.cancel();
    } else {
      this.show();
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }

  private render(): void {
    this.overlay = document.createElement("div");
    this.overlay.className = "theme-selector-overlay";

    const panel = document.createElement("div");
    panel.className = "theme-selector-panel";

    // Header
    const header = document.createElement("div");
    header.className = "theme-selector-header";
    header.textContent = "THEME";
    panel.appendChild(header);

    // Divider
    const divider = document.createElement("div");
    divider.className = "theme-selector-divider";
    panel.appendChild(divider);

    // Options
    const list = document.createElement("div");
    list.className = "theme-selector-list";

    this.optionEls = themes.map((theme, i) => {
      const row = document.createElement("div");
      row.className = "theme-selector-option";

      const name = document.createElement("span");
      name.className = "theme-option-name";
      name.textContent = theme.name;

      const desc = document.createElement("span");
      desc.className = "theme-option-desc";
      desc.textContent = theme.description;

      // Color swatches — show the 5 background tones
      const swatches = document.createElement("span");
      swatches.className = "theme-option-swatches";
      const colors = [
        theme.colors.bgPrimary,
        theme.colors.bgSecondary,
        theme.colors.bgTertiary,
        theme.colors.bgHover,
        theme.colors.borderColor,
      ];
      for (const color of colors) {
        const dot = document.createElement("span");
        dot.className = "theme-swatch";
        dot.style.background = color;
        swatches.appendChild(dot);
      }

      row.appendChild(name);
      row.appendChild(swatches);
      row.appendChild(desc);

      row.addEventListener("click", () => {
        this.selectedIndex = i;
        this.confirm();
      });

      list.appendChild(row);
      return row;
    });

    panel.appendChild(list);

    // Help text
    const help = document.createElement("div");
    help.className = "theme-selector-help";
    help.innerHTML =
      `<span class="help-key">j/k</span> navigate  ` +
      `<span class="help-key">enter</span> select  ` +
      `<span class="help-key">esc</span> cancel`;
    panel.appendChild(help);

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    // Force reflow then add visible class for transition
    void this.overlay.offsetHeight;
    this.overlay.classList.add("visible");

    this.renderSelection();
  }

  private renderSelection(): void {
    this.optionEls.forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
    });

    // Live preview
    const theme = themes[this.selectedIndex];
    if (theme) {
      this.previewTheme(theme);
    }
  }

  private previewTheme(theme: Theme): void {
    const root = document.documentElement;
    const c = theme.colors;
    root.style.setProperty("--bg-primary", c.bgPrimary);
    root.style.setProperty("--bg-secondary", c.bgSecondary);
    root.style.setProperty("--bg-tertiary", c.bgTertiary);
    root.style.setProperty("--bg-hover", c.bgHover);
    root.style.setProperty("--bg-selected", c.bgSelected);
    root.style.setProperty("--text-primary", c.textPrimary);
    root.style.setProperty("--text-secondary", c.textSecondary);
    root.style.setProperty("--text-muted", c.textMuted);
    root.style.setProperty("--border-color", c.borderColor);
    root.style.setProperty("--scrollbar-bg", c.scrollbarBg);
    root.style.setProperty("--scrollbar-thumb", c.scrollbarThumb);
    root.style.setProperty("--scrollbar-thumb-hover", c.scrollbarThumbHover);
  }

  private confirm(): void {
    const theme = themes[this.selectedIndex];
    if (theme) {
      applyTheme(theme.id);
    }
    this.hide();
  }

  private cancel(): void {
    // Revert to previously saved theme
    applyTheme(this.previousThemeId);
    this.hide();
  }

  private handleKeydown(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();

    switch (e.key) {
      case "j":
      case "ArrowDown":
        this.selectedIndex = (this.selectedIndex + 1) % themes.length;
        this.renderSelection();
        break;

      case "k":
      case "ArrowUp":
        this.selectedIndex = (this.selectedIndex - 1 + themes.length) % themes.length;
        this.renderSelection();
        break;

      case "Enter":
      case "l":
      case " ":
        this.confirm();
        break;

      case "Escape":
      case "h":
      case "q":
        this.cancel();
        break;
    }
  }

  dispose(): void {
    this.hide();
  }
}
