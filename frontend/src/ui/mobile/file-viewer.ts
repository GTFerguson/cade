/**
 * Full-pane file viewer for mobile.
 *
 * Shows file content with syntax highlighting (code) or rendered
 * markdown. Includes bracket header and vim statusline.
 */

import hljs from "highlight.js";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";

export interface FileViewerCallbacks {
  onBack: () => void;
}

export class FileViewer implements MobileScreen {
  readonly element: HTMLElement;
  private headerEl: HTMLElement;
  private bodyEl: HTMLElement;
  private statusMode: HTMLElement;
  private statusFile: HTMLElement;
  private statusLang: HTMLElement;
  private statusLines: HTMLElement;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private cleanupSwipe: (() => void) | null = null;

  constructor(private callbacks: FileViewerCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-file-viewer";

    // Header
    this.headerEl = document.createElement("div");
    this.headerEl.className = "mobile-screen-header";
    this.headerEl.style.fontSize = "12px";
    this.headerEl.style.letterSpacing = "1px";
    this.element.appendChild(this.headerEl);

    // Body
    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "viewer-body";
    this.element.appendChild(this.bodyEl);

    // Statusline
    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";

    this.statusMode = document.createElement("span");
    this.statusMode.className = "status-mode";
    this.statusMode.textContent = "VIEW";

    this.statusFile = document.createElement("span");
    this.statusFile.className = "status-file";

    this.statusLang = document.createElement("span");
    this.statusLang.className = "status-lang";

    this.statusLines = document.createElement("span");

    const helpSpan = document.createElement("span");
    helpSpan.className = "help-hint";
    helpSpan.textContent = "swipe → back";

    statusline.appendChild(this.statusMode);
    statusline.appendChild(this.statusFile);
    statusline.appendChild(this.statusLang);
    statusline.appendChild(this.statusLines);
    statusline.appendChild(helpSpan);
    this.element.appendChild(statusline);
  }

  /**
   * Load and display file content.
   */
  showFile(path: string, content: string, fileType: string): void {
    const filename = path.split("/").pop() ?? path;
    this.headerEl.textContent = `[ ${filename} ]`;
    this.statusFile.textContent = filename;
    this.statusLang.textContent = fileType;

    const lineCount = content.split("\n").length;
    this.statusLines.textContent = `${lineCount} ln`;

    this.bodyEl.innerHTML = "";

    if (fileType === "markdown") {
      this.renderMarkdown(content);
    } else {
      this.renderCode(content, fileType);
    }
  }

  /**
   * Show empty state when no file is available.
   */
  showEmpty(): void {
    this.headerEl.textContent = "[ viewer ]";
    this.statusFile.textContent = "";
    this.statusLang.textContent = "";
    this.statusLines.textContent = "";
    this.bodyEl.innerHTML =
      '<div style="text-align:center;color:var(--text-muted);padding:40px;">no file selected</div>';
  }

  onShow(): void {
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "Backspace" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onBack();
      }
    };
    document.addEventListener("keydown", this.boundKeyHandler, true);

    // Swipe right from edge to go back
    this.cleanupSwipe = setupSwipeBack(this.element, () =>
      this.callbacks.onBack()
    );
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

  // ─── Rendering ────────────────────────────────────────

  private renderCode(code: string, language: string): void {
    const lines = code.split("\n");
    const container = document.createElement("div");
    container.className = "code-view-mobile";

    // Line numbers
    const nums = document.createElement("div");
    nums.className = "code-numbers";
    for (let i = 1; i <= lines.length; i++) {
      const ln = document.createElement("span");
      ln.className = "ln";
      ln.textContent = String(i);
      nums.appendChild(ln);
    }

    // Code body
    const body = document.createElement("div");
    body.className = "code-body";

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

    body.appendChild(codeEl);

    container.appendChild(nums);
    container.appendChild(body);
    this.bodyEl.appendChild(container);
  }

  private renderMarkdown(text: string): void {
    const container = document.createElement("div");
    container.className = "md-view";
    container.innerHTML = this.markdownToHtml(text);
    this.bodyEl.appendChild(container);
  }

  private markdownToHtml(text: string): string {
    let html = this.escapeHtml(text);

    // Fenced code blocks
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

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
