/**
 * Full-pane file explorer for mobile.
 *
 * Wraps the existing FileTree component in a full-screen layout with
 * header, path bar, and statusline. Selecting a file fires onFileSelect
 * so the parent can push a FileViewer screen.
 */

import { FileTree } from "../../file-tree/file-tree";
import type { WebSocketClient } from "../../platform/websocket";
import type { MobileScreen } from "./screen-manager";
import { setupSwipeBack } from "./swipe-back";

export interface FileExplorerCallbacks {
  getActiveWs: () => WebSocketClient;
  onFileSelect: (path: string) => void;
  onBack: () => void;
  getProjectPath: () => string;
}

export class FileExplorer implements MobileScreen {
  readonly element: HTMLElement;
  private fileTree: FileTree | null = null;
  private treeContainer: HTMLElement;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private cleanupSwipe: (() => void) | null = null;

  constructor(private callbacks: FileExplorerCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "mobile-screen mobile-file-explorer";

    // Header
    const header = document.createElement("div");
    header.className = "mobile-screen-header";
    header.textContent = "[ files ]";
    this.element.appendChild(header);

    // Path bar
    const pathBar = document.createElement("div");
    pathBar.className = "explorer-path";
    pathBar.textContent = this.callbacks.getProjectPath();
    this.element.appendChild(pathBar);

    // File tree container
    this.treeContainer = document.createElement("div");
    this.treeContainer.className = "explorer-list";
    this.element.appendChild(this.treeContainer);

    // Statusline
    const statusline = document.createElement("div");
    statusline.className = "mobile-screen-statusline";
    statusline.innerHTML =
      `<span><span class="status-mode">BROWSE</span></span>` +
      `<span style="flex:1"></span>` +
      `<span class="help-hint">tap to select · swipe → back</span>`;
    this.element.appendChild(statusline);
  }

  onShow(): void {
    if (!this.fileTree) {
      const ws = this.callbacks.getActiveWs();
      this.fileTree = new FileTree(this.treeContainer, ws);
      this.fileTree.initialize();

      this.fileTree.on("file-select", (path: string) => {
        this.callbacks.onFileSelect(path);
      });
    }

    this.boundKeyHandler = (e: KeyboardEvent) => {
      // h/Backspace/Esc → back to command menu
      if (e.key === "h" || e.key === "Backspace" || e.key === "Escape") {
        // Only intercept if not in the file tree search input
        if ((e.target as HTMLElement).tagName !== "INPUT") {
          e.preventDefault();
          e.stopPropagation();
          this.callbacks.onBack();
          return;
        }
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
    this.fileTree?.dispose();
    this.fileTree = null;
  }
}
