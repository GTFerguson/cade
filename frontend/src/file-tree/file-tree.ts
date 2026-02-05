/**
 * File tree UI component with vim-style keyboard navigation.
 */

import type { PaneKeyHandler } from "../input/keybindings";
import type { Component, EventHandler, FileChildrenMessage, FileNode } from "../types";
import { getUserConfig, matchesKeybinding } from "../config/user-config";
import type { WebSocketClient } from "../platform/websocket";

interface FileTreeEvents {
  "file-select": string;
}

interface FlatNode {
  node: FileNode;
  depth: number;
  parentPath: string | null;
}

export class FileTree implements Component, PaneKeyHandler {
  private tree: FileNode[] = [];
  private expandedPaths: Set<string> = new Set();
  private selectedPath: string | null = null;
  private openPath: string | null = null;
  private recentlyChanged: Set<string> = new Set();
  private recentlyChangedTimers: Map<string, number> = new Map();
  private searchDebounceTimer: number | null = null;
  private handlers: Map<
    keyof FileTreeEvents,
    Set<EventHandler<FileTreeEvents[keyof FileTreeEvents]>>
  > = new Map();
  private onExpandChangeCallback: (() => void) | null = null;

  // Keyboard navigation state
  private flatList: FlatNode[] = [];
  private selectedIndex = 0;
  private searchMode = false;
  private searchInputFocused = false;
  private searchQuery = "";
  private searchInput: HTMLInputElement | null = null;
  private lastGPress = 0;
  private showIgnored = true;

  // Lazy loading state
  private pendingLoads: Set<string> = new Set();
  private pendingLoadResolvers: Map<string, () => void> = new Map();

  // Event delegation - single handler on tree root instead of per-row listeners
  private treeRoot: HTMLUListElement | null = null;
  private delegatedClickHandler: ((e: MouseEvent) => void) | null = null;

  private boundHandlers = {
    fileTree: (message: any) => {
      this.tree = message.data;
      this.render();
      this.loadExpandedChildren();
    },
    fileChildren: (message: FileChildrenMessage) => {
      this.handleChildrenLoaded(message.path, message.children);
    },
    fileChange: (message: any) => {
      this.recentlyChanged.add(message.path);
      this.render();

      // Clear existing timer for this path if any
      const existingTimer = this.recentlyChangedTimers.get(message.path);
      if (existingTimer != null) {
        window.clearTimeout(existingTimer);
      }

      // Track new timer
      const timerId = window.setTimeout(() => {
        this.recentlyChanged.delete(message.path);
        this.recentlyChangedTimers.delete(message.path);
        this.render();
      }, 2000);

      this.recentlyChangedTimers.set(message.path, timerId);

      this.ws.requestTree(this.showIgnored);
    },
    connected: () => {
      this.ws.requestTree(this.showIgnored);
    },
  };

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient
  ) {}

  /**
   * Initialize the file tree.
   */
  initialize(): void {
    this.ws.on("file-tree", this.boundHandlers.fileTree);
    this.ws.on("file-children", this.boundHandlers.fileChildren);
    this.ws.on("file-change", this.boundHandlers.fileChange);
    this.ws.on("connected", this.boundHandlers.connected);

    // Setup delegated click handler once - handles all row clicks via event bubbling
    this.delegatedClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const row = target.closest(".file-tree-row") as HTMLElement;
      if (!row) return;

      const path = row.dataset["path"];
      if (!path) return;

      e.stopPropagation();

      if (row.dataset["type"] === "directory") {
        this.toggleFolder(path);
      } else {
        this.selectFile(path);
      }
    };

    if (this.ws.isConnected()) {
      this.ws.requestTree(this.showIgnored);
    }
  }

  /**
   * Register an event handler.
   */
  on<K extends keyof FileTreeEvents>(
    event: K,
    handler: EventHandler<FileTreeEvents[K]>
  ): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers
      .get(event)!
      .add(handler as EventHandler<FileTreeEvents[keyof FileTreeEvents]>);
  }

  /**
   * Remove an event handler.
   */
  off<K extends keyof FileTreeEvents>(
    event: K,
    handler: EventHandler<FileTreeEvents[K]>
  ): void {
    this.handlers
      .get(event)
      ?.delete(handler as EventHandler<FileTreeEvents[keyof FileTreeEvents]>);
  }

  /**
   * Emit an event.
   */
  private emit<K extends keyof FileTreeEvents>(
    event: K,
    data: FileTreeEvents[K]
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
   * Render the file tree.
   */
  private render(): void {
    this.container.innerHTML = "";

    // Build flat list for keyboard navigation
    this.flatList = this.buildFlatList();

    // Sync selectedIndex with selectedPath
    if (this.selectedPath) {
      const idx = this.flatList.findIndex(
        (f) => f.node.path === this.selectedPath
      );
      if (idx >= 0) {
        this.selectedIndex = idx;
      }
    }

    // Ensure selectedIndex is valid
    if (this.selectedIndex >= this.flatList.length) {
      this.selectedIndex = Math.max(0, this.flatList.length - 1);
    }

    // Search input
    if (this.searchMode) {
      const searchContainer = document.createElement("div");
      searchContainer.className = "file-tree-search";

      this.searchInput = document.createElement("input");
      this.searchInput.type = "text";
      this.searchInput.className = "file-tree-search-input";
      this.searchInput.placeholder = "Filter...";
      this.searchInput.value = this.searchQuery;
      this.searchInput.addEventListener("input", (e) => {
        this.onSearchInputChange((e.target as HTMLInputElement).value);
      });
      this.searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.clearSearch();
        } else if (e.key === "Enter") {
          e.preventDefault();
          this.selectFirstResult();
        }
      });

      searchContainer.appendChild(this.searchInput);
      this.container.appendChild(searchContainer);

      if (this.searchInputFocused) {
        this.searchInput.focus();
      }
    }

    const ul = document.createElement("ul");
    ul.className = "file-tree-root";

    // Attach delegated click handler to tree root (single listener handles all rows)
    if (this.delegatedClickHandler) {
      ul.addEventListener("click", this.delegatedClickHandler);
    }
    this.treeRoot = ul;

    if (this.searchMode && this.searchQuery) {
      // Render filtered results flat (no hierarchy during search)
      for (const item of this.flatList) {
        const li = document.createElement("li");
        li.className = "file-tree-item";
        li.dataset["path"] = item.node.path;
        const row = this.createRowElement(item.node, item.depth);
        li.appendChild(row);
        ul.appendChild(li);
      }
    } else {
      // Normal hierarchical render
      for (const node of this.tree) {
        ul.appendChild(this.renderNode(node, 0));
      }
    }

    this.container.appendChild(ul);
  }

  /**
   * Create a row element for a node (used by both renderNode and flat search rendering).
   * Event listeners are NOT attached here - event delegation on tree root handles all clicks.
   */
  private createRowElement(node: FileNode, depth: number): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "file-tree-row";
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    // Data attributes for event delegation
    row.dataset["path"] = node.path;
    row.dataset["type"] = node.type;

    if (node.path === this.openPath) {
      row.classList.add("selected");
    }
    if (node.path === this.selectedPath) {
      row.classList.add("keyboard-selected");
    }

    if (this.recentlyChanged.has(node.path)) {
      row.classList.add("recently-changed");
    }

    if (node.type === "directory") {
      const isExpanded = this.expandedPaths.has(node.path);

      const chevron = document.createElement("span");
      chevron.className = `file-tree-chevron${isExpanded ? " expanded" : ""}`;
      chevron.textContent = isExpanded ? "\u25BE" : "\u25B8";
      row.appendChild(chevron);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "file-tree-spacer";
      row.appendChild(spacer);
    }

    const name = document.createElement("span");
    const typeClass = node.type === "file" ? this.getFileTypeClass(node.name) : "";
    name.className = `file-tree-name${typeClass ? ` ${typeClass}` : ""}`;
    name.textContent = node.name;
    row.appendChild(name);

    return row;
  }

  /**
   * Render a single node.
   */
  private renderNode(node: FileNode, depth: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "file-tree-item";
    li.dataset["path"] = node.path;

    const row = this.createRowElement(node, depth);

    if (node.type === "directory" && this.expandedPaths.has(node.path)) {
      if (node.children != null && node.children.length > 0) {
        const childList = document.createElement("ul");
        childList.className = "file-tree-children";
        for (const child of node.children) {
          childList.appendChild(this.renderNode(child, depth + 1));
        }
        li.appendChild(childList);
      } else if (node.hasMore || this.pendingLoads.has(node.path)) {
        const loading = document.createElement("div");
        loading.className = "file-tree-loading";
        loading.style.paddingLeft = `${(depth + 1) * 16 + 8}px`;
        loading.textContent = "Loading…";
        li.appendChild(loading);
      }
    }

    li.insertBefore(row, li.firstChild);

    return li;
  }

  /**
   * Toggle folder expand/collapse.
   */
  private toggleFolder(path: string): void {
    if (this.expandedPaths.has(path)) {
      this.expandedPaths.delete(path);
    } else {
      this.expandedPaths.add(path);
      this.requestChildrenIfNeeded(path);
    }
    this.render();
    this.onExpandChangeCallback?.();
  }

  /**
   * Select a file and emit event.
   */
  private selectFile(path: string): void {
    this.selectedPath = path;
    this.openPath = path;
    this.render();
    this.emit("file-select", path);
  }

  /**
   * Get CSS class for file type based on extension.
   */
  private getFileTypeClass(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const typeMap: Record<string, string> = {
      ts: "source", tsx: "source", js: "source", jsx: "source",
      py: "source", go: "source", rs: "source", java: "source",
      c: "source", cpp: "source", h: "source",
      md: "markup", mdx: "markup", html: "markup", xml: "markup",
      json: "config", yaml: "config", yml: "config", toml: "config",
      ini: "config", env: "config",
      css: "style", scss: "style", sass: "style", less: "style",
    };
    return typeMap[ext] ?? "";
  }

  /**
   * Reveal and select a file in the tree, expanding parent folders.
   * Does not emit file-select event (use when file is already being loaded).
   */
  async revealFile(path: string): Promise<void> {
    this.selectedPath = path;
    this.openPath = path;

    // Expand all parent folders, loading children as needed
    const parts = path.split("/");
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part !== undefined) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        this.expandedPaths.add(currentPath);

        const node = this.findNodeByPath(currentPath);
        if (node && node.hasMore && !node.children) {
          await this.loadChildren(currentPath);
        }
      }
    }

    this.render();
  }

  /**
   * Refresh the tree.
   */
  refresh(): void {
    this.ws.requestTree(this.showIgnored);
  }

  /**
   * Get the list of expanded folder paths.
   */
  getExpandedPaths(): string[] {
    return Array.from(this.expandedPaths);
  }

  /**
   * Set the expanded folder paths.
   */
  setExpandedPaths(paths: string[]): void {
    this.expandedPaths = new Set(paths);
    this.render();
  }

  /**
   * Get the keyboard-focused path.
   */
  getSelectedPath(): string | null {
    return this.selectedPath;
  }

  /**
   * Get the currently open file path.
   */
  getOpenPath(): string | null {
    return this.openPath;
  }

  /**
   * Register callback for expand/collapse changes.
   */
  onExpandChange(callback: () => void): void {
    this.onExpandChangeCallback = callback;
  }

  /**
   * Collapse all folders in the tree.
   */
  private collapseAll(): void {
    this.expandedPaths.clear();
    this.render();
    this.onExpandChangeCallback?.();
  }

  /**
   * Jump to the next folder in the list (skipping files).
   */
  private jumpToNextFolder(): void {
    if (this.flatList.length === 0) {
      return;
    }

    for (let i = this.selectedIndex + 1; i < this.flatList.length; i++) {
      const item = this.flatList[i];
      if (item?.node.type === "directory") {
        this.selectedIndex = i;
        this.selectedPath = item.node.path;
        this.render();
        this.scrollSelectedIntoView();
        return;
      }
    }
  }

  /**
   * Jump to the previous folder in the list (skipping files).
   */
  private jumpToPrevFolder(): void {
    if (this.flatList.length === 0) {
      return;
    }

    for (let i = this.selectedIndex - 1; i >= 0; i--) {
      const item = this.flatList[i];
      if (item?.node.type === "directory") {
        this.selectedIndex = i;
        this.selectedPath = item.node.path;
        this.render();
        this.scrollSelectedIntoView();
        return;
      }
    }
  }

  /**
   * Toggle showing gitignored files.
   */
  private toggleIgnored(): void {
    this.showIgnored = !this.showIgnored;
    this.ws.requestTree(this.showIgnored);
  }

  /**
   * Show modal to create a new file.
   */
  private showFileCreationModal(): void {
    // Get the currently selected directory
    let basePath = "";
    if (this.selectedPath) {
      const selectedNode = this.findNodeByPath(this.selectedPath);
      if (selectedNode?.type === "directory") {
        basePath = this.selectedPath + "/";
      } else {
        // If a file is selected, use its parent directory
        const lastSlash = this.selectedPath.lastIndexOf("/");
        if (lastSlash !== -1) {
          basePath = this.selectedPath.substring(0, lastSlash + 1);
        }
      }
    }

    // Create TUI dialog
    const overlay = document.createElement("div");
    overlay.className = "file-creation-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "file-creation-modal";

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = "[ CREATE FILE ]";

    const inputWrapper = document.createElement("div");
    inputWrapper.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:20px";

    const inputPrompt = document.createElement("span");
    inputPrompt.style.cssText = `color:var(--accent-green);font-size:13px;font-family:var(--font-mono)`;
    inputPrompt.textContent = "path:";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "modal-input";
    input.placeholder = "plans/new-feature.md";
    input.value = basePath;
    input.style.marginBottom = "0";

    inputWrapper.appendChild(inputPrompt);
    inputWrapper.appendChild(input);

    const buttonContainer = document.createElement("div");
    buttonContainer.className = "modal-buttons";

    const createBtn = document.createElement("button");
    createBtn.textContent = "[create]";
    createBtn.className = "modal-button modal-button-primary";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "[cancel]";
    cancelBtn.className = "modal-button";

    buttonContainer.appendChild(createBtn);
    buttonContainer.appendChild(cancelBtn);

    const helpText = document.createElement("div");
    helpText.style.cssText = "margin-top:16px;font-size:11px;color:var(--text-muted);font-family:var(--font-mono)";
    helpText.innerHTML = `<span style="color:var(--accent-green)">enter</span> create  <span style="color:var(--accent-green)">esc</span> cancel`;

    modal.appendChild(title);
    modal.appendChild(inputWrapper);
    modal.appendChild(buttonContainer);
    modal.appendChild(helpText);
    overlay.appendChild(modal);

    // Handle create
    const handleCreate = async () => {
      const path = input.value.trim();
      if (!path) {
        alert("Please enter a file path");
        return;
      }

      try {
        await this.ws.createFile(path, "");
        document.body.removeChild(overlay);

        // Request updated tree
        this.ws.requestTree(this.showIgnored);

        // Open the new file in the editor
        this.emit("file-select", path);
      } catch (error) {
        alert(`Failed to create file: ${error}`);
      }
    };

    // Event listeners
    createBtn.addEventListener("click", handleCreate);
    cancelBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        handleCreate();
      } else if (e.key === "Escape") {
        document.body.removeChild(overlay);
      }
    });

    // Show modal
    document.body.appendChild(overlay);

    // Focus input and position cursor after base path
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(basePath.length, basePath.length);
    });
  }

  /**
   * Find a node by its path in the tree.
   */
  private findNodeByPath(path: string): FileNode | null {
    const search = (nodes: FileNode[]): FileNode | null => {
      for (const node of nodes) {
        if (node.path === path) {
          return node;
        }
        if (node.children) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    return search(this.tree);
  }

  /**
   * Request children from server if the node needs lazy loading.
   */
  private requestChildrenIfNeeded(path: string): void {
    const node = this.findNodeByPath(path);
    if (!node) return;
    if (node.hasMore && !node.children && !this.pendingLoads.has(path)) {
      this.pendingLoads.add(path);
      this.ws.requestChildren(path, this.showIgnored);
    }
  }

  /**
   * Load children for a path and return a promise that resolves when done.
   */
  private loadChildren(path: string): Promise<void> {
    if (this.pendingLoads.has(path)) {
      return new Promise((resolve) => {
        this.pendingLoadResolvers.set(path, resolve);
      });
    }
    this.pendingLoads.add(path);
    this.ws.requestChildren(path, this.showIgnored);
    return new Promise((resolve) => {
      this.pendingLoadResolvers.set(path, resolve);
    });
  }

  /**
   * Handle children loaded from server.
   */
  private handleChildrenLoaded(path: string, children: FileNode[]): void {
    this.pendingLoads.delete(path);
    const node = this.findNodeByPath(path);
    if (node) {
      if (children.length > 0) {
        node.children = children;
      } else {
        delete node.children;
      }
      node.hasMore = false;
    }
    this.render();

    const resolve = this.pendingLoadResolvers.get(path);
    if (resolve) {
      this.pendingLoadResolvers.delete(path);
      resolve();
    }
  }

  /**
   * Load children for all expanded paths that need lazy loading.
   * Called after tree refresh and session restore.
   */
  async loadExpandedChildren(): Promise<void> {
    // Sort paths so parents load before children
    const paths = Array.from(this.expandedPaths).sort();

    for (const path of paths) {
      const node = this.findNodeByPath(path);
      if (node && node.hasMore && !node.children) {
        await this.loadChildren(path);
      }
    }
  }

  /**
   * Handle keyboard navigation (called by KeybindingManager).
   * Returns true if the key was handled.
   */
  handleKeydown(e: KeyboardEvent): boolean {
    // In search typing mode - only handle Escape, let input handle all other keys
    if (this.searchMode && this.searchInputFocused) {
      if (e.key === "Escape") {
        this.clearSearch();
        return true;
      }
      return false;
    }

    // In search-nav mode or normal mode - vim keys work
    const nav = getUserConfig().keybindings.navigation;

    switch (e.key) {
      case "j":
      case "ArrowDown":
        this.moveSelection(1);
        return true;
      case "k":
      case "ArrowUp":
        this.moveSelection(-1);
        return true;
      case "J":
        this.jumpToNextFolder();
        return true;
      case "K":
        this.jumpToPrevFolder();
        return true;
      case "l":
      case "Enter":
        this.expandOrOpen();
        return true;
      case "h":
        this.collapseOrParent();
        return true;
      case "c":
        this.collapseAll();
        return true;
      case ".":
        this.toggleIgnored();
        return true;
      case "n":
        this.showFileCreationModal();
        return true;
      case "/":
        this.enterSearchMode();
        return true;
      case "Escape":
        if (this.searchMode) {
          this.clearSearch();
          return true;
        }
        return false;
    }

    // Navigation keybindings (configurable)
    if (matchesKeybinding(e, nav.scrollToTop)) {
      return this.handleScrollToTopKey();
    }
    if (matchesKeybinding(e, nav.scrollToBottom)) {
      this.jumpToBottom();
      return true;
    }

    return false;
  }

  /**
   * Move selection by delta items.
   */
  private moveSelection(delta: number): void {
    if (this.flatList.length === 0) {
      return;
    }

    const newIndex = Math.max(
      0,
      Math.min(this.flatList.length - 1, this.selectedIndex + delta)
    );

    this.selectedIndex = newIndex;
    const item = this.flatList[newIndex];
    if (item) {
      this.selectedPath = item.node.path;
      this.render();
      this.scrollSelectedIntoView();
    }
  }

  /**
   * Expand folder or open file at current selection.
   */
  private expandOrOpen(): void {
    const item = this.flatList[this.selectedIndex];
    if (!item) {
      return;
    }

    if (item.node.type === "directory") {
      if (!this.expandedPaths.has(item.node.path)) {
        this.expandedPaths.add(item.node.path);
        this.requestChildrenIfNeeded(item.node.path);
        this.render();
        this.onExpandChangeCallback?.();
      }
    } else {
      this.openPath = item.node.path;
      this.render();
      this.emit("file-select", item.node.path);
    }
  }

  /**
   * Collapse folder or navigate to parent.
   */
  private collapseOrParent(): void {
    const item = this.flatList[this.selectedIndex];
    if (!item) {
      return;
    }

    if (item.node.type === "directory" && this.expandedPaths.has(item.node.path)) {
      this.expandedPaths.delete(item.node.path);
      this.render();
      this.onExpandChangeCallback?.();
    } else if (item.parentPath) {
      // Navigate to parent
      const parentIndex = this.flatList.findIndex(
        (f) => f.node.path === item.parentPath
      );
      if (parentIndex >= 0) {
        this.selectedIndex = parentIndex;
        this.selectedPath = item.parentPath;
        this.render();
        this.scrollSelectedIntoView();
      }
    }
  }

  /**
   * Handle scroll-to-top key for double-tap detection (like vim's gg).
   */
  private handleScrollToTopKey(): boolean {
    const now = Date.now();
    if (now - this.lastGPress < 500) {
      this.jumpToTop();
      this.lastGPress = 0;
      return true;
    }
    this.lastGPress = now;
    return true;
  }

  /**
   * Jump to top of list.
   */
  private jumpToTop(): void {
    if (this.flatList.length === 0) {
      return;
    }
    this.selectedIndex = 0;
    const item = this.flatList[0];
    if (item) {
      this.selectedPath = item.node.path;
      this.render();
      this.scrollSelectedIntoView();
    }
  }

  /**
   * Jump to bottom of list.
   */
  private jumpToBottom(): void {
    if (this.flatList.length === 0) {
      return;
    }
    this.selectedIndex = this.flatList.length - 1;
    const item = this.flatList[this.selectedIndex];
    if (item) {
      this.selectedPath = item.node.path;
      this.render();
      this.scrollSelectedIntoView();
    }
  }

  /**
   * Enter search/filter mode.
   */
  private enterSearchMode(): void {
    this.searchMode = true;
    this.searchInputFocused = true;
    this.searchQuery = "";
    this.render();
  }

  /**
   * Clear search and exit search mode.
   */
  private clearSearch(): void {
    this.searchMode = false;
    this.searchInputFocused = false;
    this.searchQuery = "";
    this.render();
  }

  /**
   * Select the first search result (keeps search open but unfocused).
   */
  private selectFirstResult(): void {
    if (this.flatList.length === 0) {
      return;
    }
    this.selectedIndex = 0;
    const item = this.flatList[0];
    if (item) {
      this.selectedPath = item.node.path;
      if (item.node.type === "file") {
        this.openPath = item.node.path;
        this.emit("file-select", item.node.path);
      }
    }
    this.searchInputFocused = false;
    this.render();
  }

  /**
   * Handle search input change.
   */
  private onSearchInputChange(query: string): void {
    this.searchQuery = query.toLowerCase();

    if (this.searchDebounceTimer != null) {
      window.clearTimeout(this.searchDebounceTimer);
    }

    this.searchDebounceTimer = window.setTimeout(() => {
      this.render();
      this.searchDebounceTimer = null;
    }, 150);
  }

  /**
   * Scroll the selected item into view.
   */
  private scrollSelectedIntoView(): void {
    const selectedRow = this.container.querySelector(
      `.file-tree-row.keyboard-selected`
    );
    if (selectedRow) {
      selectedRow.scrollIntoView({ block: "nearest" });
    }
  }

  /**
   * Build a flat list of visible nodes for keyboard navigation.
   */
  private buildFlatList(): FlatNode[] {
    const result: FlatNode[] = [];
    const searchLower = this.searchQuery.toLowerCase();

    const traverse = (
      nodes: FileNode[],
      depth: number,
      parentPath: string | null
    ): void => {
      for (const node of nodes) {
        // If searching, filter by name match
        if (
          this.searchMode &&
          searchLower &&
          !node.name.toLowerCase().includes(searchLower)
        ) {
          // Still recurse into directories to find matching children
          if (node.type === "directory" && node.children) {
            traverse(node.children, depth + 1, node.path);
          }
          continue;
        }

        result.push({ node, depth, parentPath });

        if (
          node.type === "directory" &&
          this.expandedPaths.has(node.path) &&
          node.children
        ) {
          traverse(node.children, depth + 1, node.path);
        }
      }
    };

    traverse(this.tree, 0, null);
    return result;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    // Remove delegated click handler from tree root
    if (this.treeRoot && this.delegatedClickHandler) {
      this.treeRoot.removeEventListener("click", this.delegatedClickHandler);
    }
    this.treeRoot = null;
    this.delegatedClickHandler = null;

    // Clear all pending timers
    for (const timerId of this.recentlyChangedTimers.values()) {
      window.clearTimeout(timerId);
    }
    this.recentlyChangedTimers.clear();

    // Clear search debounce timer
    if (this.searchDebounceTimer != null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    // Unregister WebSocket handlers
    this.ws.off("file-tree", this.boundHandlers.fileTree);
    this.ws.off("file-children", this.boundHandlers.fileChildren);
    this.ws.off("file-change", this.boundHandlers.fileChange);
    this.ws.off("connected", this.boundHandlers.connected);

    this.container.innerHTML = "";
    this.handlers.clear();
  }
}
