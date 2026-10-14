/**
 * Files changed on disk recently, newest first: the quickest route to
 * "what did the agent just touch?" from a phone.
 */

import { escapeHtml } from "@core/ui/menu-nav";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";

export interface RecentChange {
  path: string;
  event: string;
  at: number;
}

export const RECENT_LIMIT = 40;

/** Insert a change at the front, dropping an older entry for the same path. */
export function recordChange(list: RecentChange[], change: RecentChange): RecentChange[] {
  const rest = list.filter((c) => c.path !== change.path);
  return [change, ...rest].slice(0, RECENT_LIMIT);
}

export function relativeTime(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export interface RecentFilesCallbacks {
  getChanges: () => RecentChange[];
  onFileSelect: (path: string) => void;
  onBack: () => void;
}

export class RecentFiles implements MobileScreen {
  readonly element: HTMLElement;
  private list: HTMLElement;
  private cleanupSwipe: (() => void) | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private callbacks: RecentFilesCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-recent-files";

    const header = document.createElement("div");
    header.className = "mobile-screen-header";
    header.textContent = "[ recent ]";
    this.element.appendChild(header);

    this.list = document.createElement("div");
    this.list.className = "recent-list";
    this.element.appendChild(this.list);

    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";
    statusline.innerHTML =
      `<span><span class="status-mode">RECENT</span></span>` +
      `<span style="flex:1"></span>` +
      `<span class="help-hint">tap to view · swipe → back</span>`;
    this.element.appendChild(statusline);
  }

  render(): void {
    this.list.innerHTML = "";
    const changes = this.callbacks.getChanges();
    if (changes.length === 0) {
      this.list.innerHTML =
        '<div class="recent-empty">no changes yet this session</div>';
      return;
    }
    const now = Date.now();
    for (const c of changes) {
      const row = document.createElement("div");
      row.className = "recent-row";
      const slash = c.path.lastIndexOf("/");
      const dir = slash >= 0 ? c.path.slice(0, slash + 1) : "";
      const name = c.path.slice(slash + 1);
      row.innerHTML =
        `<span class="recent-name">${escapeHtml(name)}</span>` +
        `<span class="recent-dir">${escapeHtml(dir)}</span>` +
        `<span class="recent-meta">${escapeHtml(c.event)} · ${relativeTime(c.at, now)}</span>`;
      row.addEventListener("click", () => this.callbacks.onFileSelect(c.path));
      this.list.appendChild(row);
    }
  }

  onShow(): void {
    this.render();
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "Backspace" || e.key === "Escape") {
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
