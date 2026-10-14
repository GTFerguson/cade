/**
 * Full-pane fuzzy file search for mobile. A tree is slow to navigate with
 * a thumb; typing a few letters of the name is not.
 */

import { escapeHtml } from "@core/ui/menu-nav";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";
import { fuzzyFilter, type FuzzyMatch } from "./fuzzy";

export interface FileSearchCallbacks {
  /** Ask the backend for the file list; delivered later via setFiles(). */
  requestFiles: () => void;
  onFileSelect: (path: string) => void;
  onBack: () => void;
}

const RESULT_LIMIT = 60;

export function highlightMatch(match: FuzzyMatch): string {
  const hits = new Set(match.positions);
  let html = "";
  for (let i = 0; i < match.path.length; i++) {
    const ch = escapeHtml(match.path[i]!);
    html += hits.has(i) ? `<mark>${ch}</mark>` : ch;
  }
  return html;
}

export class FileSearch implements MobileScreen {
  readonly element: HTMLElement;
  private input: HTMLInputElement;
  private results: HTMLElement;
  private status: HTMLElement;
  private files: string[] = [];
  private truncated = false;
  private loaded = false;
  private cleanupSwipe: (() => void) | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private callbacks: FileSearchCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-file-search";

    const header = document.createElement("div");
    header.className = "mobile-screen-header";
    header.textContent = "[ search ]";
    this.element.appendChild(header);

    const bar = document.createElement("div");
    bar.className = "search-bar";
    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.className = "search-input";
    this.input.placeholder = "file name…";
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("autocorrect", "off");
    this.input.setAttribute("spellcheck", "false");
    this.input.setAttribute("enterkeyhint", "go");
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = this.results.querySelector<HTMLElement>(".search-result");
        first?.click();
      }
    });
    bar.appendChild(this.input);
    this.element.appendChild(bar);

    this.results = document.createElement("div");
    this.results.className = "search-results";
    this.element.appendChild(this.results);

    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";
    this.status = document.createElement("span");
    this.status.className = "status-file";
    statusline.innerHTML = `<span><span class="status-mode">FIND</span></span>`;
    statusline.appendChild(this.status);
    const help = document.createElement("span");
    help.className = "help-hint";
    help.textContent = "swipe → back";
    statusline.appendChild(help);
    this.element.appendChild(statusline);
  }

  setFiles(files: string[], truncated: boolean): void {
    this.files = files;
    this.truncated = truncated;
    this.loaded = true;
    this.render();
  }

  private render(): void {
    const query = this.input.value.trim();
    this.results.innerHTML = "";

    if (!this.loaded) {
      this.status.textContent = "loading…";
      return;
    }

    const matches = fuzzyFilter(query, this.files, RESULT_LIMIT);
    for (const m of matches) {
      const row = document.createElement("div");
      row.className = "search-result";
      const slash = m.path.lastIndexOf("/");
      row.innerHTML =
        `<span class="search-result-path">${highlightMatch(m)}</span>`;
      row.title = m.path.slice(slash + 1);
      row.addEventListener("click", () => this.callbacks.onFileSelect(m.path));
      this.results.appendChild(row);
    }

    const total = this.files.length + (this.truncated ? "+" : "");
    this.status.textContent = query
      ? `${matches.length} of ${total}`
      : `${total} files`;
  }

  onShow(): void {
    if (!this.loaded) this.callbacks.requestFiles();
    this.render();
    // Focus after the screen is on screen so the keyboard opens for it.
    setTimeout(() => this.input.focus(), 50);

    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onBack();
      }
    };
    document.addEventListener("keydown", this.boundKeyHandler, true);
    this.cleanupSwipe = setupSwipeBack(this.element, () => this.callbacks.onBack());
  }

  onHide(): void {
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
