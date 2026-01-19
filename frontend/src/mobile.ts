/**
 * Mobile UI component for CADE.
 *
 * Provides a mobile-friendly interface with a floating MD button
 * and slide-out viewer panel.
 */

import hljs from "highlight.js";
import type { Component, FileChangeMessage } from "./types";
import type { WebSocketClient } from "./websocket";

const MOBILE_BREAKPOINT = 768;

export class MobileUI implements Component {
  private viewerOpen = false;
  private hasUpdate = false;
  private currentPath: string | null = null;
  private lastChangedPath: string | null = null;

  private mdButton: HTMLButtonElement;
  private slideout: HTMLElement;
  private backdrop: HTMLElement;
  private slideoutTitle: HTMLElement;
  private slideoutContent: HTMLElement;
  private closeButton: HTMLButtonElement;

  constructor(private ws: WebSocketClient) {
    this.mdButton = document.getElementById("md-button") as HTMLButtonElement;
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
    this.updateVisibility();
  }

  /**
   * Setup DOM event listeners.
   */
  private setupEventListeners(): void {
    this.mdButton.addEventListener("click", () => {
      this.toggleViewer();
    });

    this.closeButton.addEventListener("click", () => {
      this.closeViewer();
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
      if (MobileUI.isMobile() && this.viewerOpen) {
        this.currentPath = message.path;
        this.renderContent(message.path, message.content, message.fileType);
      }
    });
  }

  /**
   * Update visibility based on viewport size.
   */
  private updateVisibility(): void {
    const isMobile = MobileUI.isMobile();

    if (!isMobile && this.viewerOpen) {
      this.closeViewer();
    }
  }

  /**
   * Show the update indicator on the MD button.
   */
  showUpdateIndicator(path: string): void {
    if (!MobileUI.isMobile()) return;

    this.hasUpdate = true;
    this.lastChangedPath = path;
    this.mdButton.classList.add("has-update");
  }

  /**
   * Clear the update indicator.
   */
  private clearUpdateIndicator(): void {
    this.hasUpdate = false;
    this.mdButton.classList.remove("has-update");
  }

  /**
   * Toggle the viewer panel.
   */
  private toggleViewer(): void {
    if (this.viewerOpen) {
      this.closeViewer();
    } else {
      this.openViewer();
    }
  }

  /**
   * Open the viewer panel.
   */
  private openViewer(): void {
    this.viewerOpen = true;
    this.slideout.classList.add("open");
    this.backdrop.classList.add("visible");

    if (this.hasUpdate && this.lastChangedPath !== null) {
      this.ws.requestFile(this.lastChangedPath);
      this.clearUpdateIndicator();
    } else if (this.currentPath !== null) {
      this.ws.requestFile(this.currentPath);
    } else {
      this.renderEmpty();
    }
  }

  /**
   * Close the viewer panel.
   */
  private closeViewer(): void {
    this.viewerOpen = false;
    this.slideout.classList.remove("open");
    this.backdrop.classList.remove("visible");
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
  }
}
