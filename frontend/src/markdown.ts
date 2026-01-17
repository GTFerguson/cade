/**
 * Markdown rendering component.
 *
 * Uses highlight.js for syntax highlighting.
 * Can be extended to use mertex.md for full markdown rendering.
 */

import hljs from "highlight.js";
import type { Component, EventHandler } from "./types";
import type { WebSocketClient } from "./websocket";

interface MarkdownEvents {
  "link-click": string;
}

export class MarkdownViewer implements Component {
  private currentPath: string | null = null;
  private currentContent: string = "";
  private currentFileType: string = "plaintext";
  private handlers: Map<
    keyof MarkdownEvents,
    Set<EventHandler<MarkdownEvents[keyof MarkdownEvents]>>
  > = new Map();

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient
  ) {}

  /**
   * Initialize the viewer.
   */
  initialize(): void {
    this.ws.on("file-content", (message) => {
      this.currentPath = message.path;
      this.currentContent = message.content;
      this.currentFileType = message.fileType;
      this.render();
    });

    this.ws.on("file-change", (message) => {
      if (message.path === this.currentPath) {
        this.refresh();
      }
    });

    this.renderEmpty();
  }

  /**
   * Register an event handler.
   */
  on<K extends keyof MarkdownEvents>(
    event: K,
    handler: EventHandler<MarkdownEvents[K]>
  ): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers
      .get(event)!
      .add(handler as EventHandler<MarkdownEvents[keyof MarkdownEvents]>);
  }

  /**
   * Remove an event handler.
   */
  off<K extends keyof MarkdownEvents>(
    event: K,
    handler: EventHandler<MarkdownEvents[K]>
  ): void {
    this.handlers
      .get(event)
      ?.delete(handler as EventHandler<MarkdownEvents[keyof MarkdownEvents]>);
  }

  /**
   * Emit an event.
   */
  private emit<K extends keyof MarkdownEvents>(
    event: K,
    data: MarkdownEvents[K]
  ): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in ${event} handler:`, e);
      }
    });
  }

  /**
   * Load a file by path.
   */
  loadFile(path: string): void {
    this.ws.requestFile(path);
  }

  /**
   * Refresh current file.
   */
  refresh(): void {
    if (this.currentPath !== null) {
      this.ws.requestFile(this.currentPath);
    }
  }

  /**
   * Render empty state.
   */
  private renderEmpty(): void {
    this.container.innerHTML = `
      <div class="viewer-empty">
        <p>Select a file to view</p>
      </div>
    `;
  }

  /**
   * Render the content.
   */
  private render(): void {
    if (this.currentPath === null) {
      this.renderEmpty();
      return;
    }

    const header = document.createElement("div");
    header.className = "viewer-header";
    header.textContent = this.currentPath;

    const content = document.createElement("div");
    content.className = "viewer-content";

    if (this.currentFileType === "markdown") {
      content.innerHTML = this.renderMarkdown(this.currentContent);
      this.attachLinkHandlers(content);
    } else {
      content.appendChild(
        this.renderCode(this.currentContent, this.currentFileType)
      );
    }

    this.container.innerHTML = "";
    this.container.appendChild(header);
    this.container.appendChild(content);
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

    html = html.replace(
      /`([^`]+)`/g,
      '<code class="inline-code">$1</code>'
    );

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

    html = html.replace(
      /\n\n/g,
      '</p><p class="md-paragraph">'
    );
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
      if (language !== "plaintext" && hljs.getLanguage(language) !== undefined) {
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
   * Attach click handlers to wiki links.
   */
  private attachLinkHandlers(container: HTMLElement): void {
    const wikiLinks = container.querySelectorAll(".wiki-link");

    wikiLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const path = (link as HTMLElement).dataset["path"];
        if (path != null) {
          let targetPath = path;
          if (!path.endsWith(".md")) {
            targetPath = `${path}.md`;
          }
          this.emit("link-click", targetPath);
        }
      });
    });
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
    this.container.innerHTML = "";
    this.handlers.clear();
    this.currentPath = null;
    this.currentContent = "";
  }
}
