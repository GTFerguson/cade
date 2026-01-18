/**
 * Markdown rendering component using mertex.md for Obsidian-like viewing.
 *
 * Features:
 * - Full GFM support via marked
 * - Wiki-links ([[path]]) with navigation
 * - YAML frontmatter display
 * - Syntax highlighting via highlight.js
 * - Tables, code blocks, and all markdown features
 * - Vim-style keyboard scrolling
 */

import { MertexMD } from "mertex.md";
import { marked, type TokenizerExtension, type RendererExtension } from "marked";
import hljs from "highlight.js";
import type { PaneKeyHandler } from "./keybindings";
import type { Component, EventHandler } from "./types";
import type { WebSocketClient } from "./websocket";

// Make libraries available globally for mertex.md
declare global {
  interface Window {
    marked: typeof marked;
    hljs: typeof hljs;
  }
}

interface MarkdownEvents {
  "link-click": string;
}

interface Frontmatter {
  [key: string]: unknown;
}

interface ParsedContent {
  frontmatter: Frontmatter | null;
  content: string;
}

/**
 * Wiki-link extension for marked.
 * Transforms [[path]] and [[path|display]] syntax into clickable links.
 */
const wikiLinkExtension: TokenizerExtension & RendererExtension = {
  name: "wikiLink",
  level: "inline",
  start(src: string) {
    return src.indexOf("[[");
  },
  tokenizer(src: string) {
    const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
    if (match && match[1] !== undefined) {
      const path = match[1].trim();
      const display = match[2]?.trim() ?? path;
      return {
        type: "wikiLink",
        raw: match[0],
        path,
        display,
      };
    }
    return undefined;
  },
  renderer(token) {
    const t = token as unknown as { path: string; display: string };
    const escapedPath = t.path.replace(/"/g, "&quot;");
    const escapedDisplay = t.display
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<a href="#" class="wiki-link" data-path="${escapedPath}">${escapedDisplay}</a>`;
  },
};

// Register wiki-link extension with marked
marked.use({ extensions: [wikiLinkExtension] });

// Make libraries available globally for mertex.md AFTER extensions are registered
if (typeof window !== "undefined") {
  window.marked = marked;
  window.hljs = hljs;
}

const SCROLL_LINE_HEIGHT = 40;
const SCROLL_PAGE_FACTOR = 0.8;

export class MarkdownViewer implements Component, PaneKeyHandler {
  private currentPath: string | null = null;
  private currentContent: string = "";
  private currentFileType: string = "plaintext";
  private mertex: MertexMD;
  private handlers: Map<
    keyof MarkdownEvents,
    Set<EventHandler<MarkdownEvents[keyof MarkdownEvents]>>
  > = new Map();
  private contentContainer: HTMLElement | null = null;
  private lastGPress = 0;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient
  ) {
    this.mertex = new MertexMD({
      breaks: true,
      gfm: true,
      headerIds: true,
      highlight: true,
      sanitize: true,
      katex: false, // Disable KaTeX for now (can be enabled later)
      mermaid: false, // Disable Mermaid for now (can be enabled later)
    });
  }

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
   * Get the currently viewed file path.
   */
  getCurrentPath(): string | null {
    return this.currentPath;
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
      const { frontmatter, content: markdown } = this.extractFrontmatter(
        this.currentContent
      );

      if (frontmatter !== null) {
        content.appendChild(this.renderFrontmatter(frontmatter));
      }

      const markdownContent = document.createElement("div");
      markdownContent.className = "markdown-body";
      markdownContent.innerHTML = this.mertex.render(markdown);
      content.appendChild(markdownContent);

      this.attachLinkHandlers(content);
    } else {
      content.appendChild(
        this.renderCode(this.currentContent, this.currentFileType)
      );
    }

    this.container.innerHTML = "";
    this.container.appendChild(header);
    this.container.appendChild(content);
    this.contentContainer = content;
  }

  /**
   * Extract YAML frontmatter from markdown content.
   */
  private extractFrontmatter(text: string): ParsedContent {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match || match[1] === undefined || match[2] === undefined) {
      return { frontmatter: null, content: text };
    }

    const frontmatter = this.parseYaml(match[1]);
    return { frontmatter, content: match[2] };
  }

  /**
   * Simple YAML parser for frontmatter.
   * Handles basic key: value pairs, arrays, and nested objects.
   */
  private parseYaml(yaml: string): Frontmatter {
    const result: Frontmatter = {};
    const lines = yaml.split(/\r?\n/);

    for (const line of lines) {
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith("#")) {
        continue;
      }

      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value: unknown = line.slice(colonIndex + 1).trim();

      // Handle inline arrays: [item1, item2]
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((v) => v.trim().replace(/^["']|["']$/g, ""));
      }
      // Handle quoted strings
      else if (typeof value === "string" && /^["'].*["']$/.test(value)) {
        value = value.slice(1, -1);
      }
      // Handle booleans
      else if (value === "true") {
        value = true;
      } else if (value === "false") {
        value = false;
      }
      // Handle numbers
      else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
        value = parseFloat(value);
      }

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Render frontmatter as a styled block.
   */
  private renderFrontmatter(frontmatter: Frontmatter): HTMLElement {
    const container = document.createElement("div");
    container.className = "frontmatter";

    for (const [key, value] of Object.entries(frontmatter)) {
      const row = document.createElement("div");
      row.className = "frontmatter-row";

      const keySpan = document.createElement("span");
      keySpan.className = "frontmatter-key";
      keySpan.textContent = key;

      const separator = document.createElement("span");
      separator.className = "frontmatter-separator";
      separator.textContent = ": ";

      const valueSpan = document.createElement("span");
      valueSpan.className = "frontmatter-value";
      valueSpan.textContent = this.formatFrontmatterValue(value);

      row.appendChild(keySpan);
      row.appendChild(separator);
      row.appendChild(valueSpan);
      container.appendChild(row);
    }

    return container;
  }

  /**
   * Format a frontmatter value for display.
   */
  private formatFrontmatterValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
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
        const linkPath = (link as HTMLElement).dataset["path"];
        if (linkPath != null) {
          const targetPath = this.resolveWikiLink(linkPath);
          this.emit("link-click", targetPath);
        }
      });
    });
  }

  /**
   * Resolve a wiki-link path relative to the current file.
   */
  private resolveWikiLink(linkPath: string): string {
    let targetPath = linkPath;

    // Handle directory links (ending with /)
    if (targetPath.endsWith("/")) {
      targetPath = `${targetPath}README.md`;
    } else {
      // Get filename (last segment after /)
      const lastSlash = targetPath.lastIndexOf("/");
      const filename = lastSlash === -1 ? targetPath : targetPath.slice(lastSlash + 1);

      // Add .md if filename has no extension (no . or only leading .)
      if (!filename.includes(".") || filename.startsWith(".")) {
        targetPath = `${targetPath}.md`;
      }
    }

    // If it's an absolute path (starts with /), use as-is
    if (targetPath.startsWith("/")) {
      return this.normalizePath(targetPath);
    }

    // Resolve relative to current file's directory
    if (this.currentPath != null) {
      const lastSlash = this.currentPath.lastIndexOf("/");
      if (lastSlash !== -1) {
        const currentDir = this.currentPath.slice(0, lastSlash + 1);
        targetPath = currentDir + targetPath;
      }
    }

    return this.normalizePath(targetPath);
  }

  /**
   * Normalize a path by resolving . and .. segments.
   */
  private normalizePath(path: string): string {
    const parts = path.split("/");
    const result: string[] = [];

    for (const part of parts) {
      if (part === "..") {
        result.pop();
      } else if (part !== "." && part !== "") {
        result.push(part);
      }
    }

    return result.join("/");
  }

  /**
   * Handle keyboard navigation (called by KeybindingManager).
   * Returns true if the key was handled.
   */
  handleKeydown(e: KeyboardEvent): boolean {
    const container = this.contentContainer;
    if (!container) {
      return false;
    }

    switch (e.key) {
      case "j":
      case "ArrowDown":
        container.scrollBy(0, SCROLL_LINE_HEIGHT);
        return true;
      case "k":
      case "ArrowUp":
        container.scrollBy(0, -SCROLL_LINE_HEIGHT);
        return true;
      case "g":
        return this.handleGKey(container);
      case "G":
        container.scrollTo(0, container.scrollHeight);
        return true;
      case "d":
        if (e.ctrlKey) {
          container.scrollBy(0, container.clientHeight * SCROLL_PAGE_FACTOR);
          return true;
        }
        return false;
      case "u":
        if (e.ctrlKey) {
          container.scrollBy(0, -container.clientHeight * SCROLL_PAGE_FACTOR);
          return true;
        }
        return false;
    }
    return false;
  }

  /**
   * Handle 'g' key for gg detection.
   */
  private handleGKey(container: HTMLElement): boolean {
    const now = Date.now();
    if (now - this.lastGPress < 500) {
      container.scrollTo(0, 0);
      this.lastGPress = 0;
      return true;
    }
    this.lastGPress = now;
    return true;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.container.innerHTML = "";
    this.handlers.clear();
    this.currentPath = null;
    this.currentContent = "";
    this.contentContainer = null;
  }
}
