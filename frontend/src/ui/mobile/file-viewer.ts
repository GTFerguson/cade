/**
 * Full-pane file viewer for mobile.
 *
 * Shows file content with syntax highlighting (code) or rendered
 * markdown. Includes bracket header and vim statusline.
 */

import hljs from "highlight.js";
import {
  formatBytes,
  isBinaryPayload,
  renderBinaryContent,
  type BinaryPayload,
} from "../../markdown/binary-viewers";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";

export interface FileViewerCallbacks {
  onBack: () => void;
  /** Ask for the file's git diff; delivered later via showDiff(). */
  onRequestDiff?: (path: string) => void;
}

export class FileViewer implements MobileScreen {
  readonly element: HTMLElement;
  private binaryViewer: { dispose(): void } | null = null;
  private headerEl: HTMLElement;
  private bodyEl: HTMLElement;
  private statusMode: HTMLElement;
  private statusFile: HTMLElement;
  private statusLang: HTMLElement;
  private statusLines: HTMLElement;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private cleanupSwipe: (() => void) | null = null;
  private diffToggle: HTMLButtonElement | null = null;
  private currentPath: string | null = null;
  private current: { content: string; fileType: string; meta: Pick<BinaryPayload, "encoding" | "size" | "mime"> } | null = null;
  private showingDiff = false;

  constructor(private callbacks: FileViewerCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-file-viewer";

    // Header: [ name ] with a diff toggle on the right
    const headerRow = document.createElement("div");
    headerRow.className = "mobile-screen-header viewer-header";
    headerRow.style.fontSize = "12px";
    headerRow.style.letterSpacing = "1px";
    this.headerEl = document.createElement("span");
    this.headerEl.className = "viewer-title";
    headerRow.appendChild(this.headerEl);
    if (this.callbacks.onRequestDiff) {
      this.diffToggle = document.createElement("button");
      this.diffToggle.className = "viewer-diff-toggle";
      this.diffToggle.textContent = "diff";
      this.diffToggle.setAttribute("aria-label", "toggle diff");
      this.diffToggle.style.display = "none";
      this.diffToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleDiff();
      });
      headerRow.appendChild(this.diffToggle);
    }
    this.element.appendChild(headerRow);

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
  showFile(
    path: string,
    content: string,
    fileType: string,
    meta: Pick<BinaryPayload, "encoding" | "size" | "mime"> = {},
  ): void {
    const filename = path.split("/").pop() ?? path;
    this.headerEl.textContent = `[ ${filename} ]`;
    this.statusFile.textContent = filename;
    this.statusLang.textContent = fileType;
    this.currentPath = path;
    this.current = { content, fileType, meta };
    this.showingDiff = false;
    this.statusMode.textContent = "VIEW";
    if (this.diffToggle) {
      this.diffToggle.style.display = isBinaryPayload(meta) ? "none" : "";
      this.diffToggle.classList.remove("active");
    }

    this.binaryViewer?.dispose();
    this.binaryViewer = null;
    this.bodyEl.innerHTML = "";

    if (isBinaryPayload(meta)) {
      this.statusLines.textContent = formatBytes(meta.size ?? 0);
      this.binaryViewer = renderBinaryContent(
        this.bodyEl,
        { fileType, content, ...meta },
        filename,
      );
      return;
    }

    const lineCount = content.split("\n").length;
    this.statusLines.textContent = `${lineCount} ln`;

    if (fileType === "markdown") {
      this.renderMarkdown(content);
    } else {
      this.renderCode(content, fileType);
    }
  }

  /** Path of the file on screen, if any. */
  getPath(): string | null {
    return this.currentPath;
  }

  /** Flip between the file's content and its diff against HEAD. */
  toggleDiff(): void {
    if (!this.currentPath) return;
    if (this.showingDiff) {
      const c = this.current;
      if (c) this.showFile(this.currentPath, c.content, c.fileType, c.meta);
      return;
    }
    this.showingDiff = true;
    this.statusMode.textContent = "DIFF";
    this.diffToggle?.classList.add("active");
    this.bodyEl.innerHTML =
      '<div class="viewer-notice">loading diff…</div>';
    this.callbacks.onRequestDiff?.(this.currentPath);
  }

  /**
   * Render a unified diff for the current file. Ignored if the viewer has
   * moved on to another file or left diff mode in the meantime.
   */
  showDiff(path: string, diff: string, untracked: boolean, error?: string): void {
    if (!this.showingDiff || path !== this.currentPath) return;
    this.bodyEl.innerHTML = "";
    if (error) {
      this.bodyEl.innerHTML = `<div class="viewer-notice">${this.escapeHtml(error)}</div>`;
      return;
    }
    if (diff.trim() === "") {
      this.bodyEl.innerHTML = '<div class="viewer-notice">no changes against HEAD</div>';
      return;
    }
    this.statusLang.textContent = untracked ? "new file" : "diff";
    const pre = document.createElement("pre");
    pre.className = "diff-view";
    const code = document.createElement("code");
    code.className = "hljs language-diff";
    try {
      code.innerHTML = hljs.highlight(diff, { language: "diff" }).value;
    } catch {
      code.textContent = diff;
    }
    pre.appendChild(code);
    this.bodyEl.appendChild(pre);
  }

  /**
   * Show empty state when no file is available.
   */
  showEmpty(): void {
    this.headerEl.textContent = "[ viewer ]";
    this.statusFile.textContent = "";
    this.statusLang.textContent = "";
    this.statusLines.textContent = "";
    this.currentPath = null;
    this.current = null;
    this.showingDiff = false;
    if (this.diffToggle) this.diffToggle.style.display = "none";
    this.bodyEl.innerHTML =
      '<div style="text-align:center;color:var(--text-muted);padding:40px;">no file selected</div>';
  }

  onShow(): void {
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "Backspace" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onBack();
      } else if (e.key === "d" && this.callbacks.onRequestDiff) {
        e.preventDefault();
        this.toggleDiff();
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
