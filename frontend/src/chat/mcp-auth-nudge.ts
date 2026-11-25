/**
 * Decides when a tab asks the user to sign in to an MCP server.
 *
 * MCP servers supply tools to the API chat. A tab on a terminal agent has no
 * use for them, so the request waits until the chat is on screen instead of
 * appearing on every connect.
 */

import type { MCPEntry } from "./mcp-status-icon";

export class McpAuthNudge {
  private latest: MCPEntry[] = [];
  private owed = false;
  private chatVisible = false;

  constructor(private ask: (name: string, serverUrl: string) => void) {}

  /** The servers' state as last reported, for a chat pane created later. */
  status(): MCPEntry[] {
    return this.latest;
  }

  /**
   * Record the reported state. `ask` is false for a report that should not
   * raise the question again, such as the one a restored session gets.
   */
  report(entries: MCPEntry[], ask: boolean): void {
    this.latest = entries;
    if (ask) this.owed = true;
    this.flush();
  }

  /** Fold in a later change to some servers, such as a completed sign-in. */
  amend(entries: MCPEntry[]): void {
    const changed = new Map(entries.map((e) => [e.name, e]));
    this.latest = this.latest.map((e) => changed.get(e.name) ?? e);
  }

  setChatVisible(visible: boolean): void {
    this.chatVisible = visible;
    this.flush();
  }

  private flush(): void {
    if (!this.owed || !this.chatVisible) return;
    this.owed = false;
    for (const entry of this.latest) {
      if (!entry.authenticated && entry.serverUrl) this.ask(entry.name, entry.serverUrl);
    }
  }
}
