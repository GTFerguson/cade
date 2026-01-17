/**
 * File tree UI component.
 */

import type { Component, EventHandler, FileNode } from "./types";
import type { WebSocketClient } from "./websocket";

interface FileTreeEvents {
  "file-select": string;
}

export class FileTree implements Component {
  private tree: FileNode[] = [];
  private expandedPaths: Set<string> = new Set();
  private selectedPath: string | null = null;
  private recentlyChanged: Set<string> = new Set();
  private handlers: Map<
    keyof FileTreeEvents,
    Set<EventHandler<FileTreeEvents[keyof FileTreeEvents]>>
  > = new Map();

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

    if (node.path === this.selectedPath) {
      row.classList.add("selected");
    }

    if (this.recentlyChanged.has(node.path)) {
      row.classList.add("recently-changed");
    }

    if (node.type === "directory") {
      const isExpanded = this.expandedPaths.has(node.path);

      const chevron = document.createElement("span");
      chevron.className = `file-tree-chevron ${isExpanded ? "expanded" : ""}`;
      chevron.textContent = "▶";
      row.appendChild(chevron);

      const icon = document.createElement("span");
      icon.className = "file-tree-icon folder";
      icon.textContent = isExpanded ? "📂" : "📁";
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
      icon.className = "file-tree-icon file";
      icon.textContent = this.getFileIcon(node.name);
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
   * Get icon for file type.
   */
  private getFileIcon(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";

    const iconMap: Record<string, string> = {
      ts: "📘",
      tsx: "📘",
      js: "📒",
      jsx: "📒",
      json: "📋",
      md: "📝",
      py: "🐍",
      html: "🌐",
      css: "🎨",
      scss: "🎨",
      yaml: "⚙️",
      yml: "⚙️",
      toml: "⚙️",
      txt: "📄",
      sh: "⚡",
      bash: "⚡",
    };

    return iconMap[ext] ?? "📄";
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
  }

  /**
   * Select a file and emit event.
   */
  private selectFile(path: string): void {
    this.selectedPath = path;
    this.render();
    this.emit("file-select", path);
  }

  /**
   * Refresh the tree.
   */
  refresh(): void {
    this.ws.requestTree();
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.container.innerHTML = "";
    this.handlers.clear();
  }
}
