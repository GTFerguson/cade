/**
 * TUI-style local project selector for browser (non-Tauri) mode.
 *
 * Shows currently open tab projects at the top (active one pre-selected),
 * then the ~/projects directory listing below. l enters a directory,
 * Enter/Space selects. No text input.
 *
 * In dev/demo mode, set window.__MOCK_BROWSE__ to stub the API.
 */

import { escapeHtml } from "@core/ui/menu-nav";
import { basePath } from "../config/config";
import type { FileNode } from "../types";

const DEFAULT_BROWSE_PATH = "~/projects";

function computeParentPath(currentPath: string): string {
  if (currentPath === "~") return "~";
  if (currentPath.startsWith("~/")) {
    const rest = currentPath.slice(2);
    const parts = rest.split("/").filter((p) => p);
    if (parts.length <= 1) return "~";
    parts.pop();
    return "~/" + parts.join("/");
  }
  const parts = currentPath.split("/").filter((p) => p);
  if (parts.length === 0) return "/";
  parts.pop();
  return "/" + parts.join("/") || "/";
}

async function browseDirectory(path: string): Promise<{ path: string; children: FileNode[] }> {
  const mock = (window as any).__MOCK_BROWSE__;
  if (mock) return mock(path);

  const resp = await fetch(`${basePath}/api/browse?path=${encodeURIComponent(path)}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface OpenTab {
  path: string;
  name: string;
  isActive: boolean;
}

export class LocalProjectSelector {
  private container: HTMLDivElement;
  private openTabs: OpenTab[];
  private resolve: ((path: string | null) => void) | null = null;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;

  private selectedIndex = 0;
  private currentBrowsePath: string = DEFAULT_BROWSE_PATH;
  private browseEntries: FileNode[] = [];

  constructor(container: HTMLElement, openTabs: OpenTab[] = []) {
    this.container = document.createElement("div");
    this.container.className = "remote-project-selector";
    container.appendChild(this.container);

    this.openTabs = openTabs;

    // Pre-select the active tab
    const activeIdx = openTabs.findIndex((t) => t.isActive);
    this.selectedIndex = activeIdx >= 0 ? activeIdx : 0;

    this.boundHandleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      const totalOptions = this.openTabs.length + this.browseEntries.length + 1; // +1 for [select]

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex + 1) % totalOptions;
          this.renderScreen();
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex - 1 + totalOptions) % totalOptions;
          this.renderScreen();
          break;
        case "l":
        case "ArrowRight":
          e.preventDefault();
          this.handleNavigateIn();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          this.handleConfirm();
          break;
        case "h":
        case "ArrowLeft":
        case "Backspace":
          e.preventDefault();
          this.handleBack();
          break;
        case "Escape":
          e.preventDefault();
          this.close();
          break;
      }
    };
  }

  async show(): Promise<string | null> {
    this.renderLoading();
    await this.loadBrowse(DEFAULT_BROWSE_PATH);
    document.addEventListener("keydown", this.boundHandleKeyDown, true);
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  private async loadBrowse(path: string): Promise<void> {
    this.currentBrowsePath = path;
    try {
      const data = await browseDirectory(path);
      this.currentBrowsePath = data.path;
      this.browseEntries = data.children.filter((e) => e.type === "directory");
    } catch {
      this.browseEntries = [];
    }
    this.renderScreen();
  }

  private async handleNavigateIn(): Promise<void> {
    const browseStart = this.openTabs.length;
    const selectIdx = browseStart + this.browseEntries.length;

    if (this.selectedIndex < browseStart) {
      // Tab entry — l selects it (same as Enter, nothing to navigate into)
      this.finish(this.openTabs[this.selectedIndex]!.path);
    } else if (this.selectedIndex < selectIdx) {
      // Directory entry — navigate inside
      const entry = this.browseEntries[this.selectedIndex - browseStart]!;
      this.selectedIndex = browseStart; // reset to first dir entry
      this.renderLoading();
      await this.loadBrowse(entry.path);
    } else {
      // [select current directory]
      this.finish(this.currentBrowsePath);
    }
  }

  private handleConfirm(): void {
    const browseStart = this.openTabs.length;
    const selectIdx = browseStart + this.browseEntries.length;

    if (this.selectedIndex < browseStart) {
      this.finish(this.openTabs[this.selectedIndex]!.path);
    } else if (this.selectedIndex < selectIdx) {
      const entry = this.browseEntries[this.selectedIndex - browseStart]!;
      this.finish(entry.path);
    } else {
      this.finish(this.currentBrowsePath);
    }
  }

  private async handleBack(): Promise<void> {
    const parent = computeParentPath(this.currentBrowsePath);
    if (parent !== this.currentBrowsePath) {
      this.selectedIndex = this.openTabs.length; // focus first dir entry on back
      this.renderLoading();
      await this.loadBrowse(parent);
    } else {
      this.close();
    }
  }

  private renderLoading(): void {
    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ LOCAL PROJECT ]</div>
          <div class="browser-section">
            <div class="browser-path">${escapeHtml(this.currentBrowsePath)}</div>
            <p style="color:var(--text-muted);text-align:center;font-family:var(--font-mono);font-size:13px;padding:24px 0">loading...</p>
          </div>
        </div>
      </div>`;
  }

  private renderScreen(): void {
    const browseStart = this.openTabs.length;
    const selectIdx = browseStart + this.browseEntries.length;

    const tabsHtml = this.openTabs.map((t, i) => `
      <div class="option ${this.selectedIndex === i ? "selected" : ""}" data-i="${i}">
        <span class="option-label">[${escapeHtml(t.name)}]</span>
        <span class="option-meta">${escapeHtml(t.path)}</span>
      </div>`).join("");

    const dirsHtml = this.browseEntries.map((e, i) => `
      <div class="option ${this.selectedIndex === browseStart + i ? "selected" : ""}" data-i="${browseStart + i}">
        <span class="option-label">[${escapeHtml(e.name)}/]</span>
      </div>`).join("");

    const noEntries = this.browseEntries.length === 0
      ? `<p style="color:var(--text-muted);text-align:center;font-family:var(--font-mono);font-size:13px;padding:16px 0">no subdirectories</p>`
      : "";

    // preserve scroll across the innerHTML rebuild
    const prevScrollTop = this.container.querySelector<HTMLElement>(".browser-list")?.scrollTop ?? 0;

    this.container.innerHTML = `
      <div class="pane-view">
        <div class="pane-content">
          <div class="pane-header">[ LOCAL PROJECT ]</div>
          ${this.openTabs.length > 0 ? `
          <div class="options-list">${tabsHtml}</div>
          <div class="divider"></div>` : ""}
          <div class="browser-section">
            <div class="browser-path">${escapeHtml(this.currentBrowsePath)}</div>
            <div class="options-list browser-list">
              ${dirsHtml}${noEntries}
            </div>
            <div class="divider"></div>
            <div class="options-list">
              <div class="option ${this.selectedIndex === selectIdx ? "selected" : ""}" data-i="${selectIdx}">
                <span class="option-label">[select current directory]</span>
              </div>
            </div>
          </div>
        </div>
        <div class="pane-help">
          <div><span class="help-key">j/k</span> navigate</div>
          <div><span class="help-key">l</span> enter dir</div>
          <div><span class="help-key">enter</span> select</div>
          <div><span class="help-key">h</span> up</div>
          <div><span class="help-key">esc</span> cancel</div>
        </div>
      </div>`;

    // scroll with 2-item lookahead buffer in both directions
    const list = this.container.querySelector<HTMLElement>(".browser-list");
    const selected = this.container.querySelector<HTMLElement>(".option.selected");
    if (list && selected && list.contains(selected)) {
      list.scrollTop = prevScrollTop;
      const listRect = list.getBoundingClientRect();
      const selRect = selected.getBoundingClientRect();
      const itemH = selRect.height || 29;
      const buffer = itemH * 2;
      const itemTop = selRect.top - listRect.top + list.scrollTop;
      const itemBot = itemTop + itemH;
      if (itemTop - buffer < list.scrollTop) {
        list.scrollTop = Math.max(0, itemTop - buffer);
      } else if (itemBot + buffer > list.scrollTop + list.clientHeight) {
        list.scrollTop = itemBot + buffer - list.clientHeight;
      }
    }

    // click handlers
    this.container.querySelectorAll<HTMLElement>(".option").forEach((el) => {
      const i = parseInt(el.dataset["i"] ?? "0", 10);
      el.addEventListener("click", () => {
        this.selectedIndex = i;
        if (i < browseStart) {
          this.finish(this.openTabs[i]!.path);
        } else if (i < selectIdx) {
          this.showBrowseScreen(this.browseEntries[i - browseStart]!.path);
        } else {
          this.finish(this.currentBrowsePath);
        }
      });
    });
  }

  private async showBrowseScreen(path: string): Promise<void> {
    this.selectedIndex = this.openTabs.length;
    this.renderLoading();
    await this.loadBrowse(path);
  }

  private finish(path: string): void {
    if (this.resolve) { this.resolve(path); this.resolve = null; }
    this.remove();
  }

  private close(): void {
    if (this.resolve) { this.resolve(null); this.resolve = null; }
    this.remove();
  }

  private remove(): void {
    document.removeEventListener("keydown", this.boundHandleKeyDown, true);
    if (this.container.parentNode) this.container.parentNode.removeChild(this.container);
  }
}
