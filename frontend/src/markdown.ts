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
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/core";
import { $prose } from "@milkdown/utils";
import { Plugin, Selection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { nord } from "@milkdown/theme-nord";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { history } from "@milkdown/plugin-history";
import type { PaneKeyHandler } from "./keybindings";
import type { Component, EventHandler } from "./types";
import { getUserConfig, matchesKeybinding } from "./user-config";
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

interface ViewState {
  path: string | null;
  content: string;
  fileType: string;
  scrollTop: number;
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
  private lastGPressNormal = 0;
  private mainView: ViewState | null = null;
  private planView: ViewState | null = null;
  private isPlanOverlayActive = false;
  private mode: "view" | "normal" | "edit" = "view";
  private isDirty = false;
  private editor: Editor | null = null;
  private editorContainer: HTMLElement | null = null;
  private editorContent: string = "";
  private boundHandlers = {
    fileContent: (message: any) => {
      this.currentPath = message.path;
      this.currentContent = message.content;
      this.currentFileType = message.fileType;
      this.render();
    },
    viewFile: (message: any) => {
      if (message.isPlan) {
        // Save current view as main before showing plan overlay
        if (!this.isPlanOverlayActive && this.currentPath !== null) {
          this.mainView = this.captureCurrentView();
        }

        this.currentPath = message.path;
        this.currentContent = message.content;
        this.currentFileType = message.fileType;
        this.isPlanOverlayActive = true;
        this.render();
      } else {
        // Regular view-file (main view)
        this.currentPath = message.path;
        this.currentContent = message.content;
        this.currentFileType = message.fileType;
        this.isPlanOverlayActive = false;
        this.mainView = null;
        this.render();
      }
    },
    fileChange: (message: any) => {
      if (message.path === this.currentPath) {
        this.refresh();
      }
    },
  };

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
    this.ws.on("file-content", this.boundHandlers.fileContent);
    this.ws.on("view-file", this.boundHandlers.viewFile);
    this.ws.on("file-change", this.boundHandlers.fileChange);

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
   * Check if a plan overlay is currently active.
   */
  isPlanActive(): boolean {
    return this.isPlanOverlayActive;
  }

  /**
   * Get the plan overlay path for session persistence.
   */
  getPlanPath(): string | null {
    return this.planView?.path ?? (this.isPlanOverlayActive ? this.currentPath : null);
  }

  /**
   * Check if the viewer has content to display.
   */
  hasContent(): boolean {
    return this.currentPath !== null;
  }

  /**
   * Close the plan overlay and return to main view.
   * Returns true if a plan was closed, false if no plan was active.
   */
  closePlanOverlay(): boolean {
    if (!this.isPlanOverlayActive) return false;

    // Save plan state
    this.planView = this.captureCurrentView();
    this.isPlanOverlayActive = false;

    // Restore main view
    if (this.mainView) {
      this.restoreView(this.mainView);
    } else {
      this.renderEmpty();
    }
    return true;
  }

  /**
   * Capture current view state including scroll position.
   */
  private captureCurrentView(): ViewState {
    return {
      path: this.currentPath,
      content: this.currentContent,
      fileType: this.currentFileType,
      scrollTop: this.contentContainer?.scrollTop ?? 0,
    };
  }

  /**
   * Restore a saved view state and re-render.
   */
  private restoreView(state: ViewState): void {
    this.currentPath = state.path;
    this.currentContent = state.content;
    this.currentFileType = state.fileType;
    this.render();

    if (state.scrollTop > 0) {
      requestAnimationFrame(() => {
        if (this.contentContainer) {
          this.contentContainer.scrollTop = state.scrollTop;
        }
      });
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

    // Save scroll position before destroying DOM
    const scrollTop = this.contentContainer?.scrollTop ?? 0;

    const header = document.createElement("div");
    header.className = "viewer-header";

    const filename = document.createElement("span");
    filename.className = "viewer-filename";
    filename.textContent = this.currentPath;
    header.appendChild(filename);

    if (this.isPlanOverlayActive) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "viewer-close-btn";
      closeBtn.innerHTML = "&times;";
      closeBtn.title = "Close plan (Esc)";
      closeBtn.addEventListener("click", () => this.closePlanOverlay());
      header.appendChild(closeBtn);
    }

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

    // Restore scroll position after DOM is ready
    if (scrollTop > 0) {
      requestAnimationFrame(() => {
        if (this.contentContainer) {
          this.contentContainer.scrollTop = scrollTop;
        }
      });
    }
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
    // Ctrl+s saves in normal or edit mode
    if (e.key === "s" && e.ctrlKey && (this.mode === "edit" || this.mode === "normal")) {
      e.preventDefault();
      this.save();
      return true;
    }

    // ESC exits normal/edit mode or closes plan overlay
    if (e.key === "Escape") {
      if (this.mode === "edit" || this.mode === "normal") {
        this.exitToView();
        return true;
      }
      if (this.isPlanOverlayActive) {
        this.closePlanOverlay();
        return true;
      }
    }

    // View mode: 'i' enters Normal mode
    if (this.mode === "view") {
      if (e.key === "i" && this.currentPath !== null && this.currentFileType === "markdown") {
        this.enterNormalMode();
        return true;
      }
      // View mode scrolling (when not in editor)
      return this.handleViewModeScroll(e);
    }

    // Normal mode handling
    if (this.mode === "normal") {
      // Ctrl+i toggles to Edit mode
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        this.enterEditModeFromNormal();
        return true;
      }
      // Handle vim navigation
      return this.handleNormalModeKey(e);
    }

    // Edit mode: Ctrl+i toggles back to Normal mode
    if (this.mode === "edit") {
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        this.enterNormalModeFromEdit();
        return true;
      }
      // Let editor handle other keys
      return false;
    }

    return false;
  }

  /**
   * Handle view mode scroll keys.
   */
  private handleViewModeScroll(e: KeyboardEvent): boolean {
    const container = this.contentContainer;
    if (!container) {
      return false;
    }

    const nav = getUserConfig().keybindings.navigation;

    switch (e.key) {
      case "j":
      case "ArrowDown":
        container.scrollBy(0, SCROLL_LINE_HEIGHT);
        return true;
      case "k":
      case "ArrowUp":
        container.scrollBy(0, -SCROLL_LINE_HEIGHT);
        return true;
      case "h":
        this.scrollCodeBlocksHorizontally("left");
        return true;
      case "l":
        this.scrollCodeBlocksHorizontally("right");
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

    // Navigation keybindings (configurable)
    if (matchesKeybinding(e, nav.scrollToTop)) {
      return this.handleScrollToTopKey(container);
    }
    if (matchesKeybinding(e, nav.scrollToBottom)) {
      container.scrollTo(0, container.scrollHeight);
      return true;
    }

    return false;
  }

  /**
   * Handle normal mode vim navigation keys.
   * Returns true if the key was handled.
   */
  private handleNormalModeKey(e: KeyboardEvent): boolean {
    const view = this.getEditorView();
    if (!view) {
      return false;
    }

    const key = e.key;

    // 'i' enters Edit mode (like Vim insert mode)
    if (key === "i" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      this.enterEditModeFromNormal();
      return true;
    }

    // Cursor movement
    switch (key) {
      case "h":
      case "ArrowLeft":
        e.preventDefault();
        this.moveCursorLeft(view);
        return true;
      case "j":
      case "ArrowDown":
        e.preventDefault();
        this.moveCursorDown(view);
        return true;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        this.moveCursorUp(view);
        return true;
      case "l":
      case "ArrowRight":
        e.preventDefault();
        this.moveCursorRight(view);
        return true;
      case "w":
        e.preventDefault();
        this.moveCursorWordForward(view);
        return true;
      case "b":
        e.preventDefault();
        this.moveCursorWordBackward(view);
        return true;
      case "e":
        e.preventDefault();
        this.moveCursorWordEnd(view);
        return true;
      case "0":
        e.preventDefault();
        this.moveCursorLineStart(view);
        return true;
      case "$":
        e.preventDefault();
        this.moveCursorLineEnd(view);
        return true;
      case "G":
        e.preventDefault();
        this.moveCursorDocumentEnd(view);
        return true;
      case "g":
        // Double-tap gg for document start
        return this.handleNormalModeGKey(view);
    }

    // Block all other printable characters in normal mode
    if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      return true;
    }

    return false;
  }

  /**
   * Handle 'g' key for double-tap gg detection in normal mode.
   */
  private handleNormalModeGKey(view: EditorView): boolean {
    const now = Date.now();
    if (now - this.lastGPressNormal < 500) {
      this.moveCursorDocumentStart(view);
      this.lastGPressNormal = 0;
      return true;
    }
    this.lastGPressNormal = now;
    return true;
  }

  /**
   * Get the ProseMirror editor view from Milkdown.
   */
  private getEditorView(): EditorView | null {
    if (!this.editor) {
      return null;
    }
    try {
      return this.editor.ctx.get(editorViewCtx);
    } catch {
      return null;
    }
  }

  /**
   * Move cursor left by one position.
   */
  private moveCursorLeft(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    if ($from.pos > 0) {
      const $pos = state.doc.resolve($from.pos - 1);
      const sel = Selection.near($pos, -1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
  }

  /**
   * Move cursor right by one position.
   */
  private moveCursorRight(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    if ($from.pos < state.doc.content.size) {
      const $pos = state.doc.resolve($from.pos + 1);
      const sel = Selection.near($pos, 1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
  }

  /**
   * Move cursor down by one line.
   */
  private moveCursorDown(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;

    const blockEnd = $from.end();
    if (blockEnd + 1 < state.doc.content.size) {
      const $nextPos = state.doc.resolve(blockEnd + 1);
      const sel = Selection.near($nextPos, 1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
  }

  /**
   * Move cursor up by one line.
   */
  private moveCursorUp(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;

    const blockStart = $from.start();
    if (blockStart > 1) {
      const $prevPos = state.doc.resolve(blockStart - 1);
      const sel = Selection.near($prevPos, -1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
  }

  /**
   * Move cursor to start of next word.
   */
  private moveCursorWordForward(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const text = state.doc.textBetween($from.pos, state.doc.content.size, "\n", "\ufffc");

    const match = text.match(/^\S*\s*/);
    if (match && match[0].length > 0) {
      const targetPos = Math.min($from.pos + match[0].length, state.doc.content.size);
      const $pos = state.doc.resolve(targetPos);
      const sel = Selection.near($pos, 1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
  }

  /**
   * Move cursor to start of previous word.
   */
  private moveCursorWordBackward(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const text = state.doc.textBetween(0, $from.pos, "\n", "\ufffc");

    const match = text.match(/\s*\S+\s*$/);
    if (match) {
      const targetPos = Math.max(0, $from.pos - match[0].length);
      const $pos = state.doc.resolve(targetPos);
      const sel = Selection.near($pos, -1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    } else {
      const $pos = state.doc.resolve(0);
      const sel = Selection.near($pos, 1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
  }

  /**
   * Move cursor to end of current word.
   */
  private moveCursorWordEnd(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const text = state.doc.textBetween($from.pos, state.doc.content.size, "\n", "\ufffc");

    const match = text.match(/^\s*\S*/);
    if (match && match[0].length > 0) {
      const targetPos = Math.min($from.pos + match[0].length, state.doc.content.size);
      const $pos = state.doc.resolve(targetPos);
      const sel = Selection.near($pos, 1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
  }

  /**
   * Move cursor to start of line.
   */
  private moveCursorLineStart(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const start = $from.start();
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, start)).scrollIntoView());
  }

  /**
   * Move cursor to end of line.
   */
  private moveCursorLineEnd(view: EditorView): void {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const end = $from.end();
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, end)).scrollIntoView());
  }

  /**
   * Move cursor to start of document.
   */
  private moveCursorDocumentStart(view: EditorView): void {
    const { state, dispatch } = view;
    const $pos = state.doc.resolve(0);
    const sel = Selection.near($pos, 1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }

  /**
   * Move cursor to end of document.
   */
  private moveCursorDocumentEnd(view: EditorView): void {
    const { state, dispatch } = view;
    const $pos = state.doc.resolve(state.doc.content.size);
    const sel = Selection.near($pos, -1);
    dispatch(state.tr.setSelection(sel).scrollIntoView());
  }

  /**
   * Handle scroll-to-top key for double-tap detection (like vim's gg).
   */
  private handleScrollToTopKey(container: HTMLElement): boolean {
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
   * Scroll visible code blocks horizontally.
   */
  private scrollCodeBlocksHorizontally(direction: "left" | "right"): void {
    const SCROLL_AMOUNT = 40;
    const delta = direction === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT;

    const codeBlocks = this.contentContainer?.querySelectorAll("pre");
    if (!codeBlocks) {
      return;
    }

    codeBlocks.forEach((block) => {
      const rect = block.getBoundingClientRect();
      const containerRect = this.contentContainer!.getBoundingClientRect();

      const isVisible =
        rect.top < containerRect.bottom &&
        rect.bottom > containerRect.top;

      if (isVisible) {
        block.scrollLeft += delta;
      }
    });
  }

  /**
   * Create a ProseMirror plugin to handle vim keys directly within the editor.
   * This bypasses the keybinding manager's contenteditable detection.
   */
  private createVimModePlugin(): Plugin {
    return new Plugin({
      props: {
        handleKeyDown: (view, event) => {
          if (this.mode === "normal") {
            return this.handleNormalModeKeyProseMirror(view, event);
          }
          // Edit mode - only intercept Ctrl+i and Esc
          if (event.ctrlKey && event.key === "i") {
            event.preventDefault();
            this.enterNormalModeFromEdit();
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            this.exitToView();
            return true;
          }
          return false;
        },
        handleTextInput: () => {
          // Block all text input in normal mode
          return this.mode === "normal";
        },
      },
    });
  }

  /**
   * Handle normal mode keys from within ProseMirror plugin.
   * Returns true if the key was handled.
   */
  private handleNormalModeKeyProseMirror(view: EditorView, e: KeyboardEvent): boolean {
    const key = e.key;

    // Ctrl+s saves
    if (e.key === "s" && e.ctrlKey) {
      e.preventDefault();
      this.save();
      return true;
    }

    // ESC exits to View mode
    if (key === "Escape") {
      e.preventDefault();
      this.exitToView();
      return true;
    }

    // 'i' or Ctrl+i enters Edit mode
    if (key === "i" && !e.altKey && !e.metaKey) {
      e.preventDefault();
      this.enterEditModeFromNormal();
      return true;
    }

    // Cursor movement
    switch (key) {
      case "h":
      case "ArrowLeft":
        e.preventDefault();
        this.moveCursorLeft(view);
        return true;
      case "j":
      case "ArrowDown":
        e.preventDefault();
        this.moveCursorDown(view);
        return true;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        this.moveCursorUp(view);
        return true;
      case "l":
      case "ArrowRight":
        e.preventDefault();
        this.moveCursorRight(view);
        return true;
      case "w":
        e.preventDefault();
        this.moveCursorWordForward(view);
        return true;
      case "b":
        e.preventDefault();
        this.moveCursorWordBackward(view);
        return true;
      case "e":
        e.preventDefault();
        this.moveCursorWordEnd(view);
        return true;
      case "0":
        e.preventDefault();
        this.moveCursorLineStart(view);
        return true;
      case "$":
        e.preventDefault();
        this.moveCursorLineEnd(view);
        return true;
      case "G":
        e.preventDefault();
        this.moveCursorDocumentEnd(view);
        return true;
      case "g":
        // Double-tap gg for document start
        e.preventDefault();
        return this.handleNormalModeGKey(view);
    }

    // Block all other printable characters in normal mode
    if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      return true;
    }

    return false;
  }

  /**
   * Enter Normal mode from View mode (opens Milkdown editor in navigation mode).
   */
  private async enterNormalMode(): Promise<void> {
    if (this.mode !== "view" || this.currentPath === null) {
      return;
    }

    if (this.currentFileType !== "markdown") {
      console.log("Can only edit markdown files");
      return;
    }

    this.mode = "normal";
    this.isDirty = false;
    this.editorContent = this.currentContent;

    // Create editor container
    const header = document.createElement("div");
    header.className = "viewer-header normal-mode";

    const filename = document.createElement("span");
    filename.className = "viewer-filename";
    filename.textContent = this.currentPath;
    header.appendChild(filename);

    const modeIndicator = document.createElement("span");
    modeIndicator.className = "mode-indicator mode-normal";
    modeIndicator.textContent = "NORMAL";
    header.appendChild(modeIndicator);

    const dirtyIndicator = document.createElement("span");
    dirtyIndicator.className = "viewer-dirty-indicator";
    dirtyIndicator.textContent = " (unsaved)";
    dirtyIndicator.style.display = "none";
    header.appendChild(dirtyIndicator);

    this.editorContainer = document.createElement("div");
    this.editorContainer.className = "milkdown-editor mode-normal";
    this.editorContainer.id = "milkdown-editor";

    this.container.innerHTML = "";
    this.container.appendChild(header);
    this.container.appendChild(this.editorContainer);

    try {
      // Create Milkdown editor
      this.editor = await Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, this.editorContainer!);
          ctx.set(defaultValueCtx, this.currentContent);

          ctx.get(listenerCtx).markdownUpdated((ctx, markdown) => {
            this.editorContent = markdown;
            const wasDirty = this.isDirty;
            this.isDirty = markdown !== this.currentContent;

            if (this.isDirty !== wasDirty) {
              const indicator = this.container.querySelector(".viewer-dirty-indicator") as HTMLElement;
              if (indicator) {
                indicator.style.display = this.isDirty ? "inline" : "none";
              }
            }
          });
        })
        .config(nord)
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .use($prose(() => this.createVimModePlugin()))
        .create();

      // Focus the editor but intercept input
      requestAnimationFrame(() => {
        const editableEl = this.editorContainer?.querySelector(".milkdown")?.querySelector("[contenteditable]") as HTMLElement;
        if (editableEl) {
          editableEl.focus();
          // Block text input in normal mode
          this.setupNormalModeInputBlock(editableEl);
        }
      });
    } catch (error) {
      console.error("Failed to create Milkdown editor:", error);
      this.mode = "view";
      this.render();
    }
  }

  /**
   * Setup input blocking for Normal mode.
   */
  private setupNormalModeInputBlock(element: HTMLElement): void {
    const handler = (e: InputEvent) => {
      if (this.mode === "normal") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    element.addEventListener("beforeinput", handler as EventListener);
  }

  /**
   * Switch from Normal mode to Edit mode.
   */
  private enterEditModeFromNormal(): void {
    if (this.mode !== "normal") {
      return;
    }

    this.mode = "edit";

    // Update header styling
    const header = this.container.querySelector(".viewer-header");
    if (header) {
      header.classList.remove("normal-mode");
      header.classList.add("edit-mode");
    }

    // Update mode indicator
    const indicator = this.container.querySelector(".mode-indicator");
    if (indicator) {
      indicator.textContent = "EDIT";
      indicator.classList.remove("mode-normal");
      indicator.classList.add("mode-edit");
    }

    // Update editor container styling
    if (this.editorContainer) {
      this.editorContainer.classList.remove("mode-normal");
      this.editorContainer.classList.add("mode-edit");
    }
  }

  /**
   * Switch from Edit mode back to Normal mode.
   */
  private enterNormalModeFromEdit(): void {
    if (this.mode !== "edit") {
      return;
    }

    this.mode = "normal";

    // Update header styling
    const header = this.container.querySelector(".viewer-header");
    if (header) {
      header.classList.remove("edit-mode");
      header.classList.add("normal-mode");
    }

    // Update mode indicator
    const indicator = this.container.querySelector(".mode-indicator");
    if (indicator) {
      indicator.textContent = "NORMAL";
      indicator.classList.remove("mode-edit");
      indicator.classList.add("mode-normal");
    }

    // Update editor container styling
    if (this.editorContainer) {
      this.editorContainer.classList.remove("mode-edit");
      this.editorContainer.classList.add("mode-normal");
    }
  }

  /**
   * Exit to View mode from Normal or Edit mode.
   */
  private async exitToView(): Promise<void> {
    if (this.mode === "view") {
      return;
    }

    // Check for unsaved changes
    if (this.isDirty) {
      const shouldSave = confirm("You have unsaved changes. Save before exiting? (OK = Save, Cancel = Discard)");
      if (shouldSave) {
        await this.save();
      }
    }

    // Cleanup editor
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    this.editorContainer = null;

    this.mode = "view";
    this.isDirty = false;
    this.render();
  }

  /**
   * Save the current editor content.
   */
  private async save(): Promise<void> {
    if ((this.mode !== "edit" && this.mode !== "normal") || !this.editor || !this.currentPath) {
      return;
    }

    try {
      // Get markdown from editor (stored in editorContent by listener)
      const markdown = this.editorContent || this.currentContent;

      // Send write request
      await this.ws.writeFile(this.currentPath, markdown);

      // Update current content and clear dirty flag
      this.currentContent = markdown;
      this.isDirty = false;

      const indicator = this.container.querySelector(".viewer-dirty-indicator") as HTMLElement;
      if (indicator) {
        indicator.style.display = "none";
      }

      console.log("File saved successfully");
    } catch (error) {
      console.error("Failed to save file:", error);
      alert(`Failed to save file: ${error}`);
    }
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    // Cleanup editor if active
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    // Unregister WebSocket handlers
    this.ws.off("file-content", this.boundHandlers.fileContent);
    this.ws.off("view-file", this.boundHandlers.viewFile);
    this.ws.off("file-change", this.boundHandlers.fileChange);

    this.container.innerHTML = "";
    this.handlers.clear();
    this.currentPath = null;
    this.currentContent = "";
    this.contentContainer = null;
    this.editorContainer = null;
  }
}
