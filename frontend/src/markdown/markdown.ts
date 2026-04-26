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
import { renderJsonTree } from "./json-tree";
import { wikiLinkExtension, attachWikiLinkHandlers, resolveMarkdownLinkHref } from "./wiki-links";
import { patchLinks } from "@core/chat/linkify";
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
import { viewerRegistry } from "./viewer-registry";

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
  private currentRoot: string | null = null;
  private currentContent: string = "";
  private currentFileType: string = "plaintext";
  private currentMeta: Record<string, unknown> | undefined = undefined;
  private parsedMode = true;
  private activeParsedComponent: { dispose(): void } | null = null;
  private mertex: MertexMD;
  private handlers: MarkdownEventHandlers = new Map();
  private contentContainer: HTMLElement | null = null;
  private scrollState: ScrollState = createScrollState();
  private mainView: ViewState | null = null;
  private planView: ViewState | null = null;
  private isPlanOverlayActive = false;
  private editorState: EditorModeState = createEditorModeState();
  private dashboardReturnCallback: (() => void) | null = null;
  private previewEl: HTMLElement | null = null;
  private locked = false;
  private projectPath: string | null = null;
  private filterFlyoutEl: HTMLElement | null = null;
  private cfgClickListener: ((e: MouseEvent) => void) | null = null;
  private boundHandlers = {
    fileContent: (message: any) => {
      this.currentPath = message.path;
      this.currentContent = message.content;
      this.currentFileType = message.fileType;
      this.render();
    },
    viewFile: (message: any) => {
      if (this.locked) return;
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
        // Delegate to link-click so project-context can handle pane switching,
        // map loading for world files, and file-tree reveal.
        this.emit("link-click", message.path);
      }
    },
    fileChange: (message: any) => {
      if (this.locked) return;
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

  setProjectPath(path: string): void {
    this.projectPath = path;
  }

  isLocked(): boolean {
    return this.locked;
  }

  toggleLock(): void {
    this.locked = !this.locked;
    void this.render();
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

  /**
   * Register a callback that returns the user to the dashboard.
   * Pass null to clear (e.g. when the viewer is opened from the file tree).
   */
  setDashboardReturn(fn: (() => void) | null): void {
    this.dashboardReturnCallback = fn;
    if (this.currentPath !== null) {
      this.render();
    }
  }

  /**
   * Attach an element to render above the file content (with an hr divider).
   * Pass null to clear. Re-renders if a file is open.
   */
  setPreview(el: HTMLElement | null): void {
    this.previewEl = el;
    if (this.currentPath !== null) {
      this.render();
    }
  }

  loadFile(path: string, meta?: Record<string, unknown>, root?: string | null): void {
    this.currentMeta = meta;
    this.currentRoot = root ?? null;
    this.parsedMode = true;
    this.ws.requestFile(path, root ?? undefined);
  }

  refresh(): void {
    if (this.currentPath !== null) {
      this.ws.requestFile(this.currentPath, this.currentRoot ?? undefined);
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
    const header = document.createElement("div");
    header.className = "viewer-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "viewer-header-left";
    header.appendChild(headerLeft);

    const filenameEl = document.createElement("span");
    filenameEl.className = "viewer-filename";
    filenameEl.textContent = "viewer";
    header.appendChild(filenameEl);

    const headerRight = document.createElement("div");
    headerRight.className = "viewer-header-right";
    headerRight.appendChild(this.buildLockButton());
    header.appendChild(headerRight);

    const content = document.createElement("div");
    content.className = "viewer-empty";
    const p = document.createElement("p");
    p.textContent = "Select a file to view";
    content.appendChild(p);

    this.container.innerHTML = "";
    this.container.appendChild(header);
    this.container.appendChild(content);
    if (this.filterFlyoutEl) this.container.appendChild(this.filterFlyoutEl);
  }

  private buildLockButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "viewer-lock-btn" + (this.locked ? " viewer-lock-btn--locked" : "");
    btn.title = this.locked
      ? "Viewer locked — hooks cannot change it (click to unlock)"
      : "Lock viewer to prevent hooks from changing it";
    btn.innerHTML = this.locked
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2H9V7a3 3 0 0 1 5.83-1 1 1 0 1 0 1.78-.92A5 5 0 0 0 12 2z"/></svg>';
    btn.addEventListener("click", () => this.toggleLock());
    return btn;
  }

  private async render(): Promise<void> {
    if (this.currentPath === null) {
      this.renderEmpty();
      return;
    }

    const scrollTop = this.contentContainer?.scrollTop ?? 0;

    const header = document.createElement("div");
    header.className = "viewer-header";

    // Left section: optional JSON toggle
    const headerLeft = document.createElement("div");
    headerLeft.className = "viewer-header-left";
    header.appendChild(headerLeft);

    // Center: filename
    const filename = document.createElement("span");
    filename.className = "viewer-filename";
    const displayName = this.currentPath.split("/").pop() ?? this.currentPath;
    filename.textContent = displayName;
    header.appendChild(filename);

    // Right section: lock button + close/back button
    const headerRight = document.createElement("div");
    headerRight.className = "viewer-header-right";
    headerRight.appendChild(this.buildLockButton());
    if (this.isPlanOverlayActive) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "viewer-close-btn";
      closeBtn.textContent = "[x]";
      closeBtn.title = "Close plan (Esc)";
      closeBtn.addEventListener("click", () => this.closePlanOverlay());
      headerRight.appendChild(closeBtn);
    } else if (this.dashboardReturnCallback) {
      const backBtn = document.createElement("button");
      backBtn.className = "viewer-close-btn";
      backBtn.textContent = "[← dash]";
      backBtn.title = "Return to dashboard (Esc)";
      backBtn.addEventListener("click", () => this.dashboardReturnCallback?.());
      headerRight.appendChild(backBtn);
    }
    header.appendChild(headerRight);

    const content = document.createElement("div");
    content.className = "viewer-content";

    if (this.previewEl) {
      content.appendChild(this.previewEl);
      const divider = document.createElement("hr");
      divider.className = "viewer-preview-divider";
      content.appendChild(divider);
    }

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
      patchLinks(content, (href) => {
        this.emit("link-click", resolveMarkdownLinkHref(href, this.currentPath));
      });
    } else if (this.currentFileType === "json") {
      const viewerFactory = this.detectJsonViewerFactory();
      if (viewerFactory) {
        // JSON mode toggle goes in the header's left section
        const toggleEl = document.createElement("span");
        toggleEl.className = "viewer-json-toggle";

        const rawBtn = document.createElement("button");
        rawBtn.className = "viewer-json-btn" + (!this.parsedMode ? " viewer-json-btn--active" : "");
        rawBtn.textContent = "[raw]";
        rawBtn.addEventListener("click", () => { this.parsedMode = false; void this.render(); });

        const parsedBtn = document.createElement("button");
        parsedBtn.className = "viewer-json-btn" + (this.parsedMode ? " viewer-json-btn--active" : "");
        parsedBtn.textContent = "[parsed]";
        parsedBtn.addEventListener("click", () => { this.parsedMode = true; void this.render(); });

        toggleEl.appendChild(rawBtn);
        toggleEl.appendChild(parsedBtn);
        headerLeft.appendChild(toggleEl);

        if (this.parsedMode) {
          this.renderParsedContent(content, viewerFactory);
        } else {
          this.activeParsedComponent?.dispose();
          this.activeParsedComponent = null;
          content.classList.add("json-viewer");
          content.appendChild(renderJsonTree(this.currentContent));
        }
      } else {
        content.classList.add("json-viewer");
        content.appendChild(renderJsonTree(this.currentContent));
      }
    } else {
      content.classList.add("code-viewer");
      content.appendChild(renderCode(this.currentContent, this.currentFileType));
    }

    // Vim-style statusline at bottom
    const statusline = document.createElement("div");
    statusline.className = "viewer-statusline";

    const statusMode = document.createElement("span");
    statusMode.className = "status-mode";
    statusMode.textContent = this.locked ? "LOCK" : "VIEW";

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

    if (this.projectPath) {
      const cfgBtn = document.createElement("button");
      cfgBtn.className = "viewer-cfg-btn" + (this.filterFlyoutEl ? " viewer-cfg-btn--active" : "");
      cfgBtn.textContent = "[filter]";
      cfgBtn.title = "Manage viewer ignore patterns for this project";
      cfgBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.openFilterFlyout();
      });
      statusline.appendChild(cfgBtn);
    }

    this.container.innerHTML = "";
    this.container.appendChild(header);
    this.container.appendChild(content);
    this.container.appendChild(statusline);
    this.contentContainer = content;

    // Re-attach flyout if open (innerHTML clear removes it from DOM)
    if (this.filterFlyoutEl) {
      this.container.appendChild(this.filterFlyoutEl);
    }

    if (scrollTop > 0) {
      requestAnimationFrame(() => {
        if (this.contentContainer) {
          this.contentContainer.scrollTop = scrollTop;
        }
      });
    }
  }

  private async openFilterFlyout(): Promise<void> {
    if (this.filterFlyoutEl) {
      this.closeFilterFlyout();
      void this.render();
      return;
    }

    const flyout = document.createElement("div");
    flyout.className = "viewer-cfg-flyout";

    const title = document.createElement("div");
    title.className = "viewer-cfg-flyout-title";
    title.textContent = "ignore patterns";
    flyout.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "viewer-cfg-flyout-desc";
    desc.textContent = "Files matching these globs won't open in the viewer (one per line):";
    flyout.appendChild(desc);

    const textarea = document.createElement("textarea");
    textarea.className = "viewer-cfg-flyout-input";
    textarea.placeholder = "*.lock\nnode_modules/**\ndist/**";
    textarea.rows = 5;
    textarea.spellcheck = false;
    flyout.appendChild(textarea);

    if (this.projectPath) {
      try {
        const res = await fetch(`/api/project/filters?project=${encodeURIComponent(this.projectPath)}`);
        if (res.ok) {
          const data = await res.json() as { exclude?: string[] };
          textarea.value = (data.exclude ?? []).join("\n");
        }
      } catch { /* keep empty */ }
    }

    const actions = document.createElement("div");
    actions.className = "viewer-cfg-flyout-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = "viewer-cfg-flyout-btn";
    saveBtn.textContent = "[save]";
    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!this.projectPath) return;
      const patterns = textarea.value.split("\n").map((p) => p.trim()).filter(Boolean);
      try {
        await fetch("/api/project/filters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: this.projectPath, exclude: patterns }),
        });
      } catch { /* best-effort */ }
      this.closeFilterFlyout();
      void this.render();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "viewer-cfg-flyout-btn";
    cancelBtn.textContent = "[cancel]";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeFilterFlyout();
      void this.render();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    flyout.appendChild(actions);

    this.container.appendChild(flyout);
    this.filterFlyoutEl = flyout;

    textarea.focus();

    this.cfgClickListener = (e: MouseEvent) => {
      if (this.filterFlyoutEl && !this.filterFlyoutEl.contains(e.target as Node)) {
        this.closeFilterFlyout();
        void this.render();
      }
    };
    setTimeout(() => {
      if (this.cfgClickListener) {
        document.addEventListener("click", this.cfgClickListener);
      }
    }, 0);

    void this.render();
  }

  private closeFilterFlyout(): void {
    if (this.cfgClickListener) {
      document.removeEventListener("click", this.cfgClickListener);
      this.cfgClickListener = null;
    }
    this.filterFlyoutEl?.remove();
    this.filterFlyoutEl = null;
  }

  private detectJsonViewerFactory(): ReturnType<typeof viewerRegistry.detect> {
    const p = this.currentPath;
    if (!p) return null;
    return viewerRegistry.detect(p);
  }

  private renderParsedContent(container: HTMLElement, factory: NonNullable<ReturnType<typeof viewerRegistry.detect>>): void {
    this.activeParsedComponent?.dispose();
    this.activeParsedComponent = null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(this.currentContent) as Record<string, unknown>;
    } catch {
      container.textContent = "[ invalid JSON ]";
      return;
    }

    // Allow registered viewers to receive sibling preview data (e.g. world map).
    const preview = this.currentMeta?.["preview"] as Record<string, unknown> | undefined;
    if (preview?.["data"] != null) {
      parsed["_sibling"] = preview["data"];
    }

    this.activeParsedComponent = factory(container, parsed, (path) => this.emit("link-click", path), this.currentPath ?? undefined);
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

    // ESC exits normal/edit mode, closes plan overlay, or returns to dashboard
    if (e.key === "Escape") {
      if (this.editorState.mode === "edit" || this.editorState.mode === "normal") {
        doExitToView(this.editorState, this.editorCallbacks(), this.ws);
        return true;
      }
      if (this.isPlanOverlayActive) {
        this.closePlanOverlay();
        return true;
      }
      if (this.dashboardReturnCallback) {
        this.dashboardReturnCallback();
        return true;
      }
    }

    // View mode: 'i' enters Normal mode (markdown) or opens Neovim (other files)
    if (this.editorState.mode === "view") {
      if (e.key === "l" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.toggleLock();
        return true;
      }
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

    this.activeParsedComponent?.dispose();
    this.activeParsedComponent = null;

    this.closeFilterFlyout();

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
