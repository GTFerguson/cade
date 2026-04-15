/**
 * Abstract base for dashboard components.
 *
 * Provides shared rendering utilities. Subclasses implement build().
 */

import type {
  DashboardComponent,
  DashboardComponentProps,
} from "../types";

export abstract class BaseDashboardComponent implements DashboardComponent {
  protected container: HTMLElement | null = null;
  protected props: DashboardComponentProps | null = null;

  render(container: HTMLElement, props: DashboardComponentProps): void {
    this.container = container;
    this.props = props;
    this.build();
  }

  update(props: DashboardComponentProps): void {
    this.props = props;
    this.rebuild();
  }

  dispose(): void {
    if (this.container) {
      this.container.innerHTML = "";
    }
    this.container = null;
    this.props = null;
  }

  protected abstract build(): void;

  protected rebuild(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.build();
    }
  }

  // Helpers

  protected el(
    tag: string,
    className?: string,
    text?: string,
  ): HTMLElement {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  protected badge(label: string, variant?: string): HTMLElement {
    const cls = variant ? `dash-badge dash-badge--${variant}` : "dash-badge";
    return this.el("span", cls, String(label));
  }

  protected fieldValue(item: Record<string, unknown>, field: string): string {
    const val = item[field];
    if (val == null) return "";
    return unwrapWikiLinks(String(val));
  }
}

/**
 * Replace ``[[target|display]]`` / ``[[target]]`` patterns with just the
 * human-readable display text. Dashboard field cells render as plain
 * strings, so leaving raw wiki-link syntax in them leaks vault paths
 * into the UI (e.g. ``[[vault/Pantheons/Pantheons/Essentian|Essentian]]``
 * shows up verbatim on a card). We strip to the alias when one exists,
 * otherwise to the basename of the target path.
 */
function unwrapWikiLinks(text: string): string {
  return text.replace(
    /\[\[([^\]|#\n]+?)(?:\|([^\]\n]*))?\]\]/g,
    (_match, target: string, alias: string | undefined) => {
      if (alias) return alias.trim();
      const basename = target.trim().split("/").pop() ?? target;
      return basename.replace(/\.md$/i, "").trim();
    },
  );
}
