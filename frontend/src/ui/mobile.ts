/**
 * Mobile UI component for CADE.
 *
 * Coordinates the touch toolbar, overflow menu, and slide-out viewer
 * for mobile-sized viewports.
 */

import hljs from "highlight.js";
import type { Component, FileChangeMessage } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import { FileTree } from "../file-tree/file-tree";
import { TouchToolbar } from "./touch-toolbar";
import { OverflowMenu, type OverflowTab } from "./overflow-menu";

const MOBILE_BREAKPOINT = 768;

export interface MobileUICallbacks {
  sendInput: (data: string) => void;
  getTabs: () => OverflowTab[];
  onSwitchTab: (id: string) => void;
  getActiveWs: () => WebSocketClient;
}

export class MobileUI implements Component {
  private viewerOpen = false;
  private hasUpdate = false;
  private currentPath: string | null = null;
  private lastChangedPath: string | null = null;
  private mode: "explorer" | "content" = "content";
  private fileTree: FileTree | null = null;

  private slideout: HTMLElement;
  private backdrop: HTMLElement;
  private slideoutTitle: HTMLElement;
  private slideoutContent: HTMLElement;
  private closeButton: HTMLButtonElement;
  private backButton: HTMLButtonElement;
  private fileTreeContainer: HTMLElement;

  private toolbar: TouchToolbar | null = null;
  private overflowMenu: OverflowMenu | null = null;

  constructor(
    private ws: WebSocketClient,
    private callbacks: MobileUICallbacks,
  ) {
    this.slideout = document.getElementById("viewer-slideout") as HTMLElement;
    this.backdrop = document.getElementById("slideout-backdrop") as HTMLElement;
    this.slideoutTitle = document.getElementById(
      "slideout-title"
    ) as HTMLElement;
    this.slideoutContent = document.getElementById(
      "slideout-content"
    ) as HTMLElement;
    this.closeButton = document.getElementById(
      "slideout-close"
    ) as HTMLButtonElement;
    this.backButton = document.getElementById(
      "slideout-back"
    ) as HTMLButtonElement;
    this.fileTreeContainer = document.getElementById(
      "slideout-file-tree"
    ) as HTMLElement;
  }

  /**
   * Check if current viewport is mobile-sized.
   */
  static isMobile(): boolean {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  /**
   * Initialize the mobile UI.
   */
  initialize(): void {
    this.setupEventListeners();
    this.setupWebSocketListeners();

    if (MobileUI.isMobile()) {
      this.initializeToolbar();
    }

    this.updateVisibility();
  }

  /**
   * Create and initialize the touch toolbar and overflow menu.
   */
  private initializeToolbar(): void {
    this.overflowMenu = new OverflowMenu({
      getTabs: () => this.callbacks.getTabs(),
      onSwitchTab: (id) => this.callbacks.onSwitchTab(id),
      onFileExplorer: () => this.openExplorer(),
      onViewFile: () => this.openViewer(),
      onReconnect: () => {
        const ws = this.callbacks.getActiveWs();
        ws.disconnect();
        ws.connect();
      },
    });
    this.overflowMenu.initialize();

    this.toolbar = new TouchToolbar(
      (data) => this.callbacks.sendInput(data),
      () => this.overflowMenu!.toggle(),
    );
    this.toolbar.initialize();

  }

  /**
   * Setup DOM event listeners.
   */
  private setupEventListeners(): void {
    this.closeButton.addEventListener("click", () => {
      this.closeViewer();
    });

    this.backButton.addEventListener("click", () => {
      this.switchToExplorer();
    });

    this.backdrop.addEventListener("click", () => {
      this.closeViewer();
    });

    window.addEventListener("resize", () => {
      this.updateVisibility();
    });
  }

  /**
   * Setup WebSocket event listeners.
   */
  private setupWebSocketListeners(): void {
    this.ws.on("file-change", (message: FileChangeMessage) => {
      if (message.path.endsWith(".md")) {
        this.showUpdateIndicator(message.path);
      }
    });

    this.ws.on("file-content", (message) => {
      if (!MobileUI.isMobile() || !this.viewerOpen) return;

      this.currentPath = message.path;
      this.renderContent(message.path, message.content, message.fileType);

      // When a file is selected from explorer, switch to content mode
      if (this.mode === "explorer") {
        this.switchToContent();
      }
    });
  }

  /**
   * Update visibility based on viewport size.
   */
  private updateVisibility(): void {
    const isMobile = MobileUI.isMobile();

    if (isMobile && !this.toolbar) {
      this.initializeToolbar();
    } else if (!isMobile && this.toolbar) {
      this.toolbar.hide();
    } else if (isMobile && this.toolbar) {
      this.toolbar.show();
    }

    if (!isMobile && this.viewerOpen) {
      this.closeViewer();
    }
  }

  /**
   * Show the update indicator on the overflow button (or MD button as fallback).
   */
  showUpdateIndicator(path: string): void {
    if (!MobileUI.isMobile()) return;

    this.hasUpdate = true;
    this.lastChangedPath = path;

    if (this.toolbar) {
      this.toolbar.showOverflowIndicator();
    }
  }

  /**
   * Clear the update indicator.
   */
  private clearUpdateIndicator(): void {
    this.hasUpdate = false;
    this.toolbar?.clearOverflowIndicator();
  }

  /**
   * Open the viewer panel in content mode (shows current/last file).
   */
  private openViewer(): void {
    this.mode = "content";
    this.viewerOpen = true;
    this.slideout.classList.add("open");
    this.backdrop.classList.add("visible");
    this.fileTreeContainer.classList.remove("visible");
    this.slideoutContent.style.display = "";
    this.backButton.classList.remove("visible");

    // Use the active tab's WebSocket for file requests
    const ws = this.callbacks.getActiveWs();

    if (this.hasUpdate && this.lastChangedPath !== null) {
      ws.requestFile(this.lastChangedPath);
      this.clearUpdateIndicator();
    } else if (this.currentPath !== null) {
      ws.requestFile(this.currentPath);
    } else {
      this.renderEmpty();
    }
  }

  /**
   * Open the slideout in file explorer mode.
   */
  private openExplorer(): void {
    this.mode = "explorer";
    this.viewerOpen = true;
    this.slideout.classList.add("open");
    this.backdrop.classList.add("visible");
    this.slideoutTitle.textContent = "Files";
    this.backButton.classList.remove("visible");
    this.fileTreeContainer.classList.add("visible");
    this.slideoutContent.style.display = "none";

    // Lazily create FileTree on first open
    if (!this.fileTree) {
      const ws = this.callbacks.getActiveWs();
      this.fileTree = new FileTree(this.fileTreeContainer, ws);
      this.fileTree.initialize();

      this.fileTree.on("file-select", (path: string) => {
        const activeWs = this.callbacks.getActiveWs();
        activeWs.requestFile(path);
      });
    }
  }

  /**
   * Switch slideout to content mode (from explorer after file select).
   */
  private switchToContent(): void {
    this.mode = "content";
    this.fileTreeContainer.classList.remove("visible");
    this.slideoutContent.style.display = "";
    this.backButton.classList.add("visible");
  }

  /**
   * Switch slideout back to explorer mode (back button).
   */
  private switchToExplorer(): void {
    this.mode = "explorer";
    this.slideoutTitle.textContent = "Files";
    this.fileTreeContainer.classList.add("visible");
    this.slideoutContent.style.display = "none";
    this.backButton.classList.remove("visible");
  }

  /**
   * Close the viewer panel.
   */
  private closeViewer(): void {
    this.viewerOpen = false;
    this.mode = "content";
    this.slideout.classList.remove("open");
    this.backdrop.classList.remove("visible");
    this.backButton.classList.remove("visible");
    this.fileTreeContainer.classList.remove("visible");
    this.slideoutContent.style.display = "";
  }

  /**
   * Render empty state in the slide-out.
   */
  private renderEmpty(): void {
    this.slideoutTitle.textContent = "";
    this.slideoutContent.innerHTML = `
      <div class="viewer-empty">
        <p>No file selected</p>
      </div>
    `;
  }

  /**
   * Render file content in the slide-out.
   */
  private renderContent(path: string, content: string, fileType: string): void {
    this.slideoutTitle.textContent = path;

    if (fileType === "markdown") {
      this.slideoutContent.innerHTML = this.renderMarkdown(content);
    } else {
      this.slideoutContent.innerHTML = "";
      this.slideoutContent.appendChild(this.renderCode(content, fileType));
    }
  }

  /**
   * Basic markdown to HTML conversion.
   */
  private renderMarkdown(text: string): string {
    let html = this.escapeHtml(text);

    html = html.replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      (_, lang: string | undefined, code: string) => {
        const language = lang ?? "plaintext";
        let highlighted: string;
        try {
          highlighted = hljs.highlight(code.trim(), { language }).value;
        } catch {
          highlighted = this.escapeHtml(code.trim());
        }
        return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
      }
    );

    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.+?)_/g, "<em>$1</em>");

    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="md-link">$1</a>'
    );

    html = html.replace(
      /\[\[([^\]]+)\]\]/g,
      '<a href="#" class="wiki-link" data-path="$1">$1</a>'
    );

    html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

    html = html.replace(/\n\n/g, '</p><p class="md-paragraph">');
    html = `<p class="md-paragraph">${html}</p>`;

    html = html.replace(/<p class="md-paragraph"><\/p>/g, "");

    return html;
  }

  /**
   * Render code with syntax highlighting.
   */
  private renderCode(code: string, language: string): HTMLPreElement {
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");

    codeEl.className = `hljs language-${language}`;

    try {
      if (
        language !== "plaintext" &&
        hljs.getLanguage(language) !== undefined
      ) {
        codeEl.innerHTML = hljs.highlight(code, { language }).value;
      } else {
        codeEl.innerHTML = hljs.highlightAuto(code).value;
      }
    } catch {
      codeEl.textContent = code;
    }

    pre.appendChild(codeEl);
    return pre;
  }

  /**
   * Escape HTML entities.
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.closeViewer();
    this.slideoutContent.innerHTML = "";
    this.fileTree?.dispose();
    this.toolbar?.dispose();
    this.overflowMenu?.dispose();
  }
}
