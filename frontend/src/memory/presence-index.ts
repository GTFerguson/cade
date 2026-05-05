import type { WebSocketClient } from "../platform/websocket";
import type { GraphModule, MemoryEntry, MemorySymbol, NkrdnGraphMessage } from "./types";
import { isGraphModule } from "./types";

export interface FileMemoryCounts {
  decision: number;
  attempt: number;
  note: number;
  total: number;
}

/**
 * In-memory "is there memory attached to this file?" lookup, derived from
 * the same nkrdn-graph broadcast the graph tree consumes. Powers presence
 * cues in chat file links and the Neovim pane header — no content is ever
 * surfaced through this index, only counts and the symbol to navigate to
 * when the user pulls.
 */
export class MemoryPresenceIndex {
  private projectRoot: string = "";
  private byFile: Map<string, FileMemoryCounts> = new Map();
  private firstSymByFile: Map<string, MemorySymbol> = new Map();
  private subscribers: Set<() => void> = new Set();
  private boundHandler: ((msg: NkrdnGraphMessage) => void) | null = null;

  constructor(private ws: WebSocketClient) {}

  initialize(): void {
    this.boundHandler = (msg: NkrdnGraphMessage) => this.ingest(msg);
    this.ws.on("nkrdn-graph" as any, this.boundHandler);
  }

  setProjectRoot(root: string): void {
    this.projectRoot = normalizeRoot(root);
  }

  /**
   * Look up counts for a file path. Accepts either a project-relative path
   * (matching nkrdn's stored form) or an absolute path under the current
   * project root.
   */
  getCountsForFile(path: string): FileMemoryCounts | null {
    const key = this.normalize(path);
    return key ? this.byFile.get(key) ?? null : null;
  }

  getFirstSymbolForFile(path: string): MemorySymbol | null {
    const key = this.normalize(path);
    return key ? this.firstSymByFile.get(key) ?? null : null;
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  /** Test hook — feed a graph message directly without a WS round-trip. */
  ingest(msg: NkrdnGraphMessage): void {
    this.byFile.clear();
    this.firstSymByFile.clear();
    for (const mod of msg.modules) {
      this.walkModule(mod);
    }
    for (const cb of this.subscribers) cb();
  }

  dispose(): void {
    if (this.boundHandler) {
      this.ws.off("nkrdn-graph" as any, this.boundHandler);
      this.boundHandler = null;
    }
    this.subscribers.clear();
  }

  private walkModule(node: GraphModule | MemorySymbol): void {
    if (isGraphModule(node)) {
      for (const child of node.children) this.walkModule(child);
      return;
    }
    this.recordSymbol(node);
    for (const child of node.children ?? []) this.walkModule(child);
  }

  private recordSymbol(sym: MemorySymbol): void {
    const file = sym.file;
    if (!file) return;
    const active = sym.memories.filter(isActive);
    if (active.length === 0) return;

    const key = stripLeadingSlash(file.replace(/\\/g, "/"));
    const existing = this.byFile.get(key) ?? { decision: 0, attempt: 0, note: 0, total: 0 };
    for (const mem of active) {
      if (mem.type === "decision") existing.decision++;
      else if (mem.type === "attempt") existing.attempt++;
      else existing.note++;
      existing.total++;
    }
    this.byFile.set(key, existing);

    if (!this.firstSymByFile.has(key)) {
      this.firstSymByFile.set(key, sym);
    }
  }

  private normalize(path: string): string | null {
    if (!path) return null;
    let p = path.replace(/\\/g, "/");
    if (this.projectRoot && p.startsWith(this.projectRoot + "/")) {
      p = p.slice(this.projectRoot.length + 1);
    } else if (this.projectRoot && p === this.projectRoot) {
      return null;
    }
    p = stripLeadingSlash(p);
    return p || null;
  }
}

function isActive(mem: MemoryEntry): boolean {
  return !mem.archived && !mem.superseded_by;
}

function stripLeadingSlash(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

function normalizeRoot(root: string): string {
  if (!root) return "";
  let r = root.replace(/\\/g, "/");
  if (r.endsWith("/")) r = r.slice(0, -1);
  return r;
}
