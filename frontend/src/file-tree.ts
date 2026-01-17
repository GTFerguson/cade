/**
 * File tree UI component with vim-style keyboard navigation.
 */

import type { PaneKeyHandler } from "./keybindings";
import type { Component, EventHandler, FileNode } from "./types";
import type { WebSocketClient } from "./websocket";

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
  private handlers: Map<
    keyof FileTreeEvents,
    Set<EventHandler<FileTreeEvents[keyof FileTreeEvents]>>
  > = new Map();
  private onExpandChangeCallback: (() => void) | null = null;

  // Keyboard navigation state
  private flatList: FlatNode[] = [];
  private selectedIndex = 0;
  private searchMode = false;
  private searchQuery = "";
  private searchInput: HTMLInputElement | null = null;
  private lastGPress = 0;

  constructor(
    private container: HTMLElement,
    private ws: WebSocketClient
  ) {}

  /**
   * Initialize the file tree.
   */
  initialize(): void {
    this.ws.on("file-tree", (message) => {
      this.tree = message.data;
      this.render();
    });

    this.ws.on("file-change", (message) => {
      this.recentlyChanged.add(message.path);
      this.render();

      setTimeout(() => {
        this.recentlyChanged.delete(message.path);
        this.render();
      }, 2000);

      this.ws.requestTree();
    });

    this.ws.on("connected", () => {
      this.ws.requestTree();
    });

    if (this.ws.isConnected()) {
      this.ws.requestTree();
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

      searchContainer.appendChild(this.searchInput);
      this.container.appendChild(searchContainer);

      // Focus after appending
      setTimeout(() => this.searchInput?.focus(), 0);
    }

    const ul = document.createElement("ul");
    ul.className = "file-tree-root";

    for (const node of this.tree) {
      ul.appendChild(this.renderNode(node, 0));
    }

    this.container.appendChild(ul);
  }

  /**
   * Render a single node.
   */
  private renderNode(node: FileNode, depth: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "file-tree-item";
    li.dataset["path"] = node.path;

    const row = document.createElement("div");
    row.className = "file-tree-row";
    row.style.paddingLeft = `${depth * 16 + 8}px`;

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
      chevron.className = `file-tree-chevron ${isExpanded ? "expanded" : ""}`;
      row.appendChild(chevron);

      const icon = document.createElement("span");
      icon.className = `file-tree-icon folder${isExpanded ? " expanded" : ""}`;
      row.appendChild(icon);

      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleFolder(node.path);
      });

      if (isExpanded && node.children != null && node.children.length > 0) {
        const childList = document.createElement("ul");
        childList.className = "file-tree-children";
        for (const child of node.children) {
          childList.appendChild(this.renderNode(child, depth + 1));
        }
        li.appendChild(childList);
      }
    } else {
      const spacer = document.createElement("span");
      spacer.className = "file-tree-spacer";
      row.appendChild(spacer);

      const icon = document.createElement("span");
      const typeClass = this.getFileTypeClass(node.name);
      icon.className = `file-tree-icon file${typeClass ? ` ${typeClass}` : ""}`;
      row.appendChild(icon);

      row.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectFile(node.path);
      });
    }

    const name = document.createElement("span");
    name.className = "file-tree-name";
    name.textContent = node.name;
    row.appendChild(name);

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
  revealFile(path: string): void {
    this.selectedPath = path;
    this.openPath = path;

    // Expand all parent folders
    const parts = path.split("/");
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part !== undefined) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        this.expandedPaths.add(currentPath);
      }
    }

    this.render();
  }

  /**
   * Refresh the tree.
   */
  refresh(): void {
    this.ws.requestTree();
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
   * Handle keyboard navigation (called by KeybindingManager).
   * Returns true if the key was handled.
   */
  handleKeydown(e: KeyboardEvent): boolean {
    if (this.searchMode) {
      return this.handleSearchInput(e);
    }

    switch (e.key) {
      case "j":
      case "ArrowDown":
        this.moveSelection(1);
        return true;
      case "k":
      case "ArrowUp":
        this.moveSelection(-1);
        return true;
      case "l":
      case "Enter":
        this.expandOrOpen();
        return true;
      case "h":
        this.collapseOrParent();
        return true;
      case "g":
        return this.handleGKey();
      case "G":
        this.jumpToBottom();
        return true;
      case "/":
        this.enterSearchMode();
        return true;
      case "Escape":
        this.clearSearch();
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
   * Handle 'g' key for gg detection.
   */
  private handleGKey(): boolean {
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
    this.searchQuery = "";
    this.render();
    this.searchInput?.focus();
  }

  /**
   * Clear search and exit search mode.
   */
  private clearSearch(): void {
    this.searchMode = false;
    this.searchQuery = "";
    this.render();
  }

  /**
   * Handle input in search mode.
   */
  private handleSearchInput(e: KeyboardEvent): boolean {
    if (e.key === "Escape") {
      this.clearSearch();
      return true;
    }
    if (e.key === "Enter") {
      // Select first matching item
      if (this.flatList.length > 0) {
        this.selectedIndex = 0;
        const item = this.flatList[0];
        if (item) {
          this.selectedPath = item.node.path;
          if (item.node.type === "file") {
            this.openPath = item.node.path;
            this.emit("file-select", item.node.path);
          }
        }
      }
      this.searchMode = false;
      this.render();
      return true;
    }
    // Let the input handle the key
    return false;
  }

  /**
   * Handle search input change.
   */
  private onSearchInputChange(query: string): void {
    this.searchQuery = query.toLowerCase();
    this.render();
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
    this.container.innerHTML = "";
    this.handlers.clear();
  }
}
