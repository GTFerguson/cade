/**
 * Type definitions for multi-project tab support.
 */

import type { PaneKeyHandler, PaneType } from "../input/keybindings";
import type { Layout } from "../ui/layout";
import type { MarkdownViewer } from "../markdown/markdown";
import type { CustomKeyHandler } from "../terminal/terminal";
import type { TerminalManager } from "../terminal/terminal-manager";
import type { WebSocketClient } from "../platform/websocket";

/**
 * Persistent tab information stored in localStorage.
 */
export interface TabInfo {
  id: string;
  projectPath: string;
  name: string;
}

/**
 * Runtime tab state with active connections.
 */
export interface TabState extends TabInfo {
  ws: WebSocketClient;
  context: ProjectContext | null;
  isConnected: boolean;
}

/**
 * App state persisted to localStorage.
 */
export interface AppState {
  version: number;
  tabs: TabInfo[];
  activeTabId: string;
}

/**
 * Project context interface for per-tab component management.
 */
export interface ProjectContext {
  readonly id: string;
  readonly projectPath: string;
  readonly name: string;
  readonly container: HTMLElement;
  initialize(): Promise<void>;
  show(): void;
  hide(): void;
  focus(): void;
  dispose(): void;
  getFocusedPane(): PaneType;
  focusPane(pane: PaneType): void;
  cycleFocus(direction: "left" | "right"): void;
  getPaneHandler(pane: PaneType): PaneKeyHandler | null;
  getLayout(): Layout | null;
  getViewer(): MarkdownViewer | null;
  getTerminalManager(): TerminalManager | null;
  setTerminalKeyHandler(handler: CustomKeyHandler | null): void;
  toggleTerminal(): void;
}

/**
 * Tab manager events.
 */
export interface TabManagerEvents {
  "tab-created": TabState;
  "tab-closed": string;
  "tab-switched": TabState;
  "tabs-changed": TabState[];
}

/**
 * Tab bar events.
 */
export interface TabBarEvents {
  "tab-select": string;
  "tab-close": string;
  "tab-add": void;
}
