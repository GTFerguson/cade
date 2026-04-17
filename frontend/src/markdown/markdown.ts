/**
 * Markdown rendering component using mertex.md for Obsidian-like viewing.
 *
 * Coordinator class that delegates to focused modules:
 * - frontmatter.ts: YAML extraction and rendering
 * - code-highlight.ts: Syntax highlighting with line numbers
 * - wiki-links.ts: [[wiki-link]] marked extension + navigation
 * - scroll.ts: Vim-style scroll handling
 * - editor-mode.ts: Milkdown/ProseMirror editor with vim modes
 */

import { MertexMD } from "mertex.md";
import { marked } from "marked";
import hljs from "highlight.js";
import type { PaneKeyHandler } from "../input/keybindings";
import type { Component, EventHandler } from "../types";
import type { WebSocketClient } from "../platform/websocket";
import type { MarkdownEvents, ViewState, MarkdownEventHandlers } from "./types";
import { extractFrontmatter, renderFrontmatter } from "./frontmatter";
import { renderCode } from "./code-highlight";
import { wikiLinkExtension, attachWikiLinkHandlers } from "./wiki-links";
import { handleViewModeScroll, scrollCodeBlocksHorizontally, createScrollState } from "./scroll";
import type { ScrollState } from "./scroll";
import { getUserConfig } from "../config/user-config";
import {
  createEditorModeState,
  handleNormalModeKey,
  enterNormalMode,
  enterEditModeFromNormal,
  enterNormalModeFromEdit,
  doExitToView,
  doSave,
  destroyEditor,
} from "./editor-mode";
import type { EditorModeState, EditorCallbacks } from "./editor-mode";

// Make libraries available globally for mertex.md
declare global {
  interface Window {
    marked: typeof marked;
    hljs: typeof hljs;
  }
}

// Register wiki-link extension with marked
marked.use({ extensions: [wikiLinkExtension] });

// Make libraries available globally for mertex.md AFTER extensions are registered
if (typeof window !== "undefined") {
  window.marked = marked;
  window.hljs = hljs;
}

export class MarkdownViewer implements Component, PaneKeyHandler {
  private currentPath: string | null = null;
  private currentContent: string = "";
  private currentFileType: string = "plaintext";
  private mertex: MertexMD;
  private handlers: MarkdownEventHandlers = new Map();
  private contentContainer: HTMLElement | null = null;
  private scrollState: ScrollState = createScrollState();
  private mainView: ViewState | null = null;
  private planView: ViewState | null = null;
  private isPlanOverlayActive = false;
  private editorState: EditorModeState = createEditorModeState();
  private boundHandlers = {
    fileContent: (message: any) => {
      this.currentPath = message.path;
      this.currentContent = message.content;
      this.currentFileType = message.fileType;
      this.render();
    },
    viewFile: (message: any) => {
      if (message.isPlan) {
        if (!this.isPlanOverlayActive && this.currentPath !== null) {
          this.mainView = this.captureCurrentView();
        }

        this.currentPath = message.path;
        this.currentContent = message.content;
        this.currentFileType = message.fileType;
        this.isPlanOverlayActive = true;
        this.render();
      } else {
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
      katex: false,
      mermaid: false,
    });
  }

  initialize(): void {
    this.ws.on("file-content", this.boundHandlers.fileContent);
    this.ws.on("view-file", this.boundHandlers.viewFile);
    this.ws.on("file-change", this.boundHandlers.fileChange);
    this.renderEmpty();
  }

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

  off<K extends keyof MarkdownEvents>(
    event: K,
    handler: EventHandler<MarkdownEvents[K]>
  ): void {
    this.handlers
      .get(event)
      ?.delete(handler as EventHandler<MarkdownEvents[keyof MarkdownEvents]>);
  }

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

  loadFile(path: string): void {
    this.ws.requestFile(path);
  }

  refresh(): void {
    if (this.currentPath !== null) {
      this.ws.requestFile(this.currentPath);
    }
  }

  getCurrentPath(): string | null {
    return this.currentPath;
  }

  isPlanActive(): boolean {
    return this.isPlanOverlayActive;
  }

  getPlanPath(): string | null {
    return this.planView?.path ?? (this.isPlanOverlayActive ? this.currentPath : null);
  }

  hasContent(): boolean {
    return this.currentPath !== null;
  }

  closePlanOverlay(): boolean {
    if (!this.isPlanOverlayActive) return false;

    this.planView = this.captureCurrentView();
    this.isPlanOverlayActive = false;

    if (this.mainView) {
      this.restoreView(this.mainView);
    } else {
      this.renderEmpty();
    }
    return true;
  }

  private captureCurrentView(): ViewState {
    return {
      path: this.currentPath,
      content: this.currentContent,
      fileType: this.currentFileType,
      scrollTop: this.contentContainer?.scrollTop ?? 0,
    };
  }

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

  private renderEmpty(): void {
    this.container.innerHTML = `
      <div class="viewer-empty">
        <p>Select a file to view</p>
      </div>
    `;
  }

  private async render(): Promise<void> {
    if (this.currentPath === null) {
      this.renderEmpty();
      return;
    }

    const scrollTop = this.contentContainer?.scrollTop ?? 0;

    const header = document.createElement("div");
    header.className = "viewer-header";

    const filename = document.createElement("span");
    filename.className = "viewer-filename";
    const displayName = this.currentPath.split("/").pop() ?? this.currentPath;
    filename.textContent = displayName;
    header.appendChild(filename);

    if (this.isPlanOverlayActive) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "viewer-close-btn";
      closeBtn.textContent = "[x]";
      closeBtn.title = "Close plan (Esc)";
      closeBtn.addEventListener("click", () => this.closePlanOverlay());
      header.appendChild(closeBtn);
    }

    const content = document.createElement("div");
    content.className = "viewer-content";

    if (this.currentFileType === "markdown") {
      const { frontmatter, content: markdown } = extractFrontmatter(this.currentContent);

      if (frontmatter !== null) {
        content.appendChild(renderFrontmatter(frontmatter));
      }

      const markdownContent = document.createElement("div");
      markdownContent.className = "markdown-body";
      markdownContent.innerHTML = await this.mertex.render(markdown);
      content.appendChild(markdownContent);

      attachWikiLinkHandlers(content, this.currentPath, (targetPath) => {
        this.emit("link-click", targetPath);
      });
    } else {
      content.classList.add("code-viewer");
      content.appendChild(renderCode(this.currentContent, this.currentFileType));
    }

    // Vim-style statusline at bottom
    const statusline = document.createElement("div");
    statusline.className = "viewer-statusline";

    const statusMode = document.createElement("span");
    statusMode.className = "status-mode";
    statusMode.textContent = "VIEW";

    const statusFilename = document.createElement("span");
    statusFilename.className = "status-filename";
    statusFilename.textContent = this.currentPath;

    statusline.appendChild(statusMode);
    statusline.appendChild(statusFilename);

    if (this.currentFileType !== "markdown") {
      const statusLang = document.createElement("span");
      statusLang.className = "status-lang";
      statusLang.textContent = this.currentFileType;
      statusline.appendChild(statusLang);

      const statusLines = document.createElement("span");
      statusLines.className = "status-lines";
      statusLines.textContent = `${this.currentContent.split("\n").length} ln`;
      statusline.appendChild(statusLines);
    }

    this.container.innerHTML = "";
    this.container.appendChild(header);
    this.container.appendChild(content);
    this.container.appendChild(statusline);
    this.contentContainer = content;

    if (scrollTop > 0) {
      requestAnimationFrame(() => {
        if (this.contentContainer) {
          this.contentContainer.scrollTop = scrollTop;
        }
      });
    }
  }

  // --- Keyboard handling ---

  handleKeydown(e: KeyboardEvent): boolean {
    // Ctrl+s saves in normal or edit mode
    if (e.key === "s" && e.ctrlKey &&
        (this.editorState.mode === "edit" || this.editorState.mode === "normal")) {
      e.preventDefault();
      doSave(this.editorState, this.editorCallbacks(), this.ws);
      return true;
    }

    // ESC exits normal/edit mode or closes plan overlay
    if (e.key === "Escape") {
      if (this.editorState.mode === "edit" || this.editorState.mode === "normal") {
        doExitToView(this.editorState, this.editorCallbacks(), this.ws);
        return true;
      }
      if (this.isPlanOverlayActive) {
        this.closePlanOverlay();
        return true;
      }
    }

    // View mode: 'i' enters Normal mode (markdown) or opens Neovim (other files)
    if (this.editorState.mode === "view") {
      if (e.key === "i" && this.currentPath !== null) {
        if (this.currentFileType === "markdown") {
          enterNormalMode(this.editorState, this.editorCallbacks(), this.ws);
          return true;
        }
        this.emit("edit-in-neovim", this.currentPath);
        return true;
      }
      if (!this.contentContainer) return false;
      const nav = getUserConfig().keybindings.navigation;
      return handleViewModeScroll(
        e,
        this.contentContainer,
        this.scrollState,
        (dir) => scrollCodeBlocksHorizontally(this.contentContainer, dir),
        { scrollToTop: nav.scrollToTop, scrollToBottom: nav.scrollToBottom }
      );
    }

    // Normal mode handling
    if (this.editorState.mode === "normal") {
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        enterEditModeFromNormal(this.editorState, this.container);
        return true;
      }
      return handleNormalModeKey(
        e,
        this.editorState,
        () => enterEditModeFromNormal(this.editorState, this.container),
        () => doSave(this.editorState, this.editorCallbacks(), this.ws),
        () => doExitToView(this.editorState, this.editorCallbacks(), this.ws)
      );
    }

    // Edit mode: Ctrl+i toggles back to Normal mode
    if (this.editorState.mode === "edit") {
      if (e.ctrlKey && e.key === "i") {
        e.preventDefault();
        enterNormalModeFromEdit(this.editorState, this.container);
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Build the EditorCallbacks bridge for the editor-mode module.
   */
  private editorCallbacks(): EditorCallbacks {
    return {
      getCurrentContent: () => this.currentContent,
      getCurrentPath: () => this.currentPath,
      getCurrentFileType: () => this.currentFileType,
      setCurrentContent: (content: string) => { this.currentContent = content; },
      getContainer: () => this.container,
      onRender: () => this.render(),
    };
  }

  dispose(): void {
    destroyEditor(this.editorState);

    this.ws.off("file-content", this.boundHandlers.fileContent);
    this.ws.off("view-file", this.boundHandlers.viewFile);
    this.ws.off("file-change", this.boundHandlers.fileChange);

    this.container.innerHTML = "";
    this.handlers.clear();
    this.currentPath = null;
    this.currentContent = "";
    this.contentContainer = null;
  }
}
