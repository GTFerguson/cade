/**
 * Main entry point for ccplus frontend.
 */

import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/vs2015.css";
import "../styles/main.css";

import { FileTree } from "./file-tree";
import { Layout } from "./layout";
import { MarkdownViewer } from "./markdown";
import { MobileUI } from "./mobile";
import { Terminal } from "./terminal";
import { WebSocketClient } from "./websocket";
import type { Component } from "./types";

class App {
  private components: Component[] = [];
  private ws: WebSocketClient;
  private layout: Layout | null = null;
  private terminal: Terminal | null = null;
  private fileTree: FileTree | null = null;
  private viewer: MarkdownViewer | null = null;
  private mobileUI: MobileUI | null = null;

  constructor() {
    this.ws = new WebSocketClient();
  }

  /**
   * Initialize the application.
   */
  async initialize(): Promise<void> {
    const appContainer = document.getElementById("app");
    if (appContainer == null) {
      throw new Error("App container not found");
    }

    this.layout = new Layout(appContainer);
    this.layout.initialize();
    this.components.push(this.layout);

    const containers = this.layout.getContainers();

    this.terminal = new Terminal(containers.terminal, this.ws);
    this.terminal.initialize();
    this.components.push(this.terminal);

    this.fileTree = new FileTree(containers.fileTree, this.ws);
    this.fileTree.initialize();
    this.components.push(this.fileTree);

    this.viewer = new MarkdownViewer(containers.viewer, this.ws);
    this.viewer.initialize();
    this.components.push(this.viewer);

    this.mobileUI = new MobileUI(this.ws);
    this.mobileUI.initialize();
    this.components.push(this.mobileUI);

    this.fileTree.on("file-select", (path) => {
      this.viewer?.loadFile(path);
    });

    this.viewer.on("link-click", (path) => {
      this.viewer?.loadFile(path);
    });

    this.ws.on("connected", (message) => {
      console.log("Connected to server:", message.workingDir);
    });

    this.ws.on("disconnected", () => {
      console.log("Disconnected from server");
    });

    this.ws.on("error", (message) => {
      console.error("Server error:", message.code, message.message);
    });

    this.ws.connect();

    window.addEventListener("beforeunload", () => {
      this.dispose();
    });

    this.terminal.focus();
  }

  /**
   * Dispose of all components.
   */
  async dispose(): Promise<void> {
    this.ws.disconnect();

    for (const component of this.components) {
      try {
        await component.dispose();
      } catch (e) {
        console.error("Error disposing component:", e);
      }
    }

    this.components = [];
  }
}

const app = new App();

document.addEventListener("DOMContentLoaded", () => {
  app.initialize().catch((e) => {
    console.error("Failed to initialize app:", e);
  });
});
