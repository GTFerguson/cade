import type { WebSocketClient } from "../platform/websocket";
import type { NkrdnGraphMessage, GraphModule, MemorySymbol, MemoryEntry, OrphanMemory } from "./types";
import { isGraphModule } from "./types";

export class MemoryGraphTree {
  private data: NkrdnGraphMessage | null = null;

  // Flat navigation list for j/k
  private flatItems: Array<{ type: "symbol" | "memory" | "orphan" | "tombstoned"; data: MemorySymbol | MemoryEntry | OrphanMemory }> = [];
  private selectedIndex = 0;

  // Expand state
  private expandedModules: Set<string> = new Set();
  private expandedSymbols: Set<string> = new Set();

  private container: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private filterInput: HTMLInputElement | null = null;
  private filterTokEl: HTMLElement | null = null;
  private filterValue = "";
  private filterMemOnly = false;

  private onSelectCallback: ((sym: MemorySymbol | null) => void) | null = null;

  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private paneEl: HTMLElement,
    private ws: WebSocketClient,
  ) {}

  initialize(): void {
    this.ws.on("nkrdn-graph" as any, (msg: NkrdnGraphMessage) => {
      this.data = msg;
      // Auto-expand any module path leading to a memory-bearing symbol so the
      // first paint surfaces the interesting content rather than an opaque tree.
      for (const mod of msg.modules) this.autoExpandIfHasMemory(mod);
      this.render();
    });

    this.ws.on("nkrdn-select" as any, () => {
      // Re-render to sync selection highlight
    });
  }

  onSelect(cb: (sym: MemorySymbol | null) => void): void {
    this.onSelectCallback = cb;
  }

  /**
   * Mount the graph tree body into the host pane. The mode toggle lives
   * outside this component (in project-context) since it switches between
   * sibling sub-panes (FileTree vs this component).
   */
  mount(): void {
    this.container = document.createElement("div");
    this.container.className = "memory-tree-container";

    // Filter bar
    const filterBar = document.createElement("div");
    filterBar.className = "memory-tree-filter";
    filterBar.innerHTML = `
      <span class="memory-tree-filter-prompt">/</span>
      <input class="memory-tree-filter-input" type="text" placeholder="filter…" autocomplete="off" spellcheck="false">
      <span class="memory-tree-filter-tok">+mem</span>
    `;
    this.filterInput = filterBar.querySelector("input");
    this.filterTokEl = filterBar.querySelector(".memory-tree-filter-tok");
    this.filterInput?.addEventListener("input", () => {
      this.filterValue = this.filterInput?.value ?? "";
      this.render();
    });
    this.filterTokEl?.addEventListener("click", () => {
      this.filterMemOnly = !this.filterMemOnly;
      this.render();
    });

    // Stats bar
    const statsBar = document.createElement("div");
    statsBar.className = "memory-tree-stats";
    statsBar.dataset["ref"] = "stats";

    // Scroll body
    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "memory-tree-body";

    this.container.appendChild(filterBar);
    this.container.appendChild(statsBar);
    this.container.appendChild(this.bodyEl);
    this.paneEl.appendChild(this.container);

    // Keyboard handler
    this.boundKeyHandler = (e: KeyboardEvent) => this.handleKey(e);
    this.container.setAttribute("tabindex", "-1");
    this.container.addEventListener("keydown", this.boundKeyHandler, true);

    this.render();
  }

  private autoExpandIfHasMemory(node: GraphModule | MemorySymbol): boolean {
    if (isGraphModule(node)) {
      let hasMem = false;
      for (const child of node.children) {
        if (this.autoExpandIfHasMemory(child)) hasMem = true;
      }
      if (hasMem) this.expandedModules.add(node.path);
      return hasMem;
    }
    const sym = node as MemorySymbol;
    const direct = sym.memories.some(m => !m.archived && !m.superseded_by);
    let nested = false;
    for (const child of sym.children ?? []) {
      if (this.autoExpandIfHasMemory(child)) nested = true;
    }
    if (direct) this.expandedSymbols.add(sym.uuid);
    return direct || nested;
  }

  private render(): void {
    if (!this.bodyEl || !this.data) {
      if (this.bodyEl) {
        this.bodyEl.innerHTML = `<div class="memory-tree-empty">no graph data · run nkrdn rebuild</div>`;
      }
      return;
    }

    // Sync +mem token state
    this.filterTokEl?.classList.toggle("memory-tree-filter-tok--on", this.filterMemOnly);

    // Update stats
    const statsEl = this.container?.querySelector<HTMLElement>("[data-ref=stats]");
    if (statsEl) {
      const { symbols, memories, orphans } = this.data.stats;
      statsEl.innerHTML = `
        <span><span class="memory-stat-n">${symbols}</span> sym</span>
        <span><span class="memory-stat-n">${memories}</span> mem</span>
        ${orphans > 0 ? `<span class="memory-stat-warn">${orphans} ⚠</span>` : ""}
      `;
    }

    this.flatItems = [];
    const rows: string[] = [];

    // ── Live modules ──────────────────────────────────────────────────
    for (const mod of this.data.modules) {
      this.renderModule(mod, 0, rows);
    }

    // ── Tombstoned section ────────────────────────────────────────────
    const tombstoned = this.data.tombstoned.filter(s =>
      !this.filterValue || s.name.toLowerCase().includes(this.filterValue.toLowerCase())
    );
    if (tombstoned.length > 0) {
      rows.push(`<div class="memory-tree-section memory-tree-section--warn">
        <span>tombstoned</span><span class="memory-tree-section-count">${tombstoned.length} surviving</span>
      </div>`);
      for (const sym of tombstoned) {
        const idx = this.flatItems.length;
        this.flatItems.push({ type: "tombstoned", data: sym });
        const memCount = sym.memories.length;
        rows.push(`
          <div class="memory-tree-row${this.selectedIndex === idx ? " memory-tree-row--focused" : ""}" data-idx="${idx}">
            <span class="memory-tree-chev">▸</span>
            <span class="memory-tree-kind memory-tree-kind--c">c</span>
            <span class="memory-tree-name memory-tree-name--tomb">${esc(sym.name)}</span>
            <span class="memory-tree-tomb-marker">·×</span>
            ${memCount > 0 ? `<span class="memory-tree-count memory-tree-count--warn">${memCount}m ⚠</span>` : ""}
          </div>`);
      }
    }

    // ── Orphan memories section ───────────────────────────────────────
    const orphans = this.data.orphans.filter(o =>
      !this.filterValue || o.title.toLowerCase().includes(this.filterValue.toLowerCase())
    );
    if (orphans.length > 0) {
      rows.push(`<div class="memory-tree-section memory-tree-section--warn">
        <span>orphan memories</span><span class="memory-tree-section-count">${orphans.length} unresolved</span>
      </div>`);
      for (const orphan of orphans) {
        const idx = this.flatItems.length;
        this.flatItems.push({ type: "orphan", data: orphan });
        const cand = orphan.candidates[0];
        rows.push(`
          <div class="memory-tree-row${this.selectedIndex === idx ? " memory-tree-row--focused" : ""}" data-idx="${idx}">
            <span class="memory-tree-chev">▾</span>
            <span class="memory-pill memory-pill--${orphan.type}">${orphan.type.slice(0,3)}</span>
            <span class="memory-tree-name">${esc(truncate(orphan.title, 30))}</span>
            <span class="memory-tree-date">${esc(orphan.date.slice(5))}</span>
          </div>
          ${cand ? `<div class="memory-tree-row memory-tree-cand-row">
            <span class="memory-tree-cand-conn">└─</span>
            <span class="memory-tree-cand-name">${esc(cand.name)}</span>
            <span class="memory-tree-cand-conf">${cand.confidence.toFixed(2)}</span>
          </div>` : ""}
        `);
      }
    }

    this.bodyEl.innerHTML = rows.join("");

    // Attach click handlers via event delegation
    this.bodyEl.querySelectorAll<HTMLElement>("[data-idx]").forEach(row => {
      row.addEventListener("click", () => {
        const idx = parseInt(row.dataset["idx"] ?? "0", 10);
        this.selectIndex(idx);
      });
    });
  }

  private renderModule(mod: GraphModule, depth: number, rows: string[]): void {
    const expanded = this.expandedModules.has(mod.path);
    const indent = depth * 10;
    rows.push(`
      <div class="memory-tree-row memory-tree-row--module" data-module-path="${esc(mod.path)}" style="padding-left:${10 + indent}px">
        <span class="memory-tree-chev">${expanded ? "▾" : "▸"}</span>
        <span class="memory-tree-name memory-tree-name--mod">${esc(mod.name)}</span>
      </div>
    `);

    if (!expanded) return;

    // Attach module toggle later via event delegation
    for (const child of mod.children) {
      if (isGraphModule(child)) {
        this.renderModule(child, depth + 1, rows);
      } else {
        this.renderSymbol(child as MemorySymbol, depth + 1, rows);
      }
    }
  }

  private renderSymbol(sym: MemorySymbol, depth: number, rows: string[]): void {
    const filter = this.filterValue.toLowerCase();
    if (filter && !sym.name.toLowerCase().includes(filter) && !sym.memories.some(m => m.title.toLowerCase().includes(filter))) return;
    const memCount = sym.memories.filter(m => !m.archived && !m.superseded_by).length;
    if (this.filterMemOnly && memCount === 0 && !(sym.children?.length)) return;

    const idx = this.flatItems.length;
    this.flatItems.push({ type: "symbol", data: sym });

    const expanded = this.expandedSymbols.has(sym.uuid);
    const indent = depth * 10;
    const kindClass = `memory-tree-kind--${sym.kind === "class" ? "c" : sym.kind === "function" ? "f" : "m"}`;
    const kindChar = sym.kind === "class" ? "c" : sym.kind === "function" ? "f" : "m";
    const focused = this.selectedIndex === idx;

    rows.push(`
      <div class="memory-tree-row${focused ? " memory-tree-row--focused" : ""}" data-idx="${idx}" style="padding-left:${10 + indent}px">
        <span class="memory-tree-chev">${memCount > 0 ? (expanded ? "▾" : "▸") : " "}</span>
        <span class="memory-tree-kind ${kindClass}">${kindChar}</span>
        <span class="memory-tree-name memory-tree-name--${sym.kind}">${esc(sym.name)}</span>
        ${memCount > 0 ? `<span class="memory-tree-count"><span class="memory-stat-n">${memCount}</span>m</span>` : ""}
      </div>
    `);

    if (expanded) {
      for (const mem of sym.memories.filter(m => !m.archived && !m.superseded_by)) {
        const mIdx = this.flatItems.length;
        this.flatItems.push({ type: "memory", data: mem });
        const mFocused = this.selectedIndex === mIdx;
        rows.push(`
          <div class="memory-tree-row memory-tree-row--mem${mFocused ? " memory-tree-row--focused" : ""}" data-idx="${mIdx}" style="padding-left:${10 + indent + 14}px">
            <span class="memory-tree-mem-conn">╞═</span>
            <span class="memory-pill memory-pill--${mem.type}">${mem.type.slice(0, 3)}</span>
            <span class="memory-tree-name memory-tree-name--mem">${esc(truncate(mem.title, 26))}</span>
            <span class="memory-tree-date">${esc(mem.date.slice(5))}</span>
          </div>
        `);
      }
    }

    // Render children (functions inside a class)
    if (sym.children) {
      for (const child of sym.children) {
        this.renderSymbol(child, depth + 1, rows);
      }
    }
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.data) return;
    if ((e.target as HTMLElement).tagName === "INPUT") {
      if (e.key === "Escape") (e.target as HTMLInputElement).blur();
      return;
    }

    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        this.selectIndex(Math.min(this.selectedIndex + 1, this.flatItems.length - 1));
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        this.selectIndex(Math.max(this.selectedIndex - 1, 0));
        break;
      case "l":
      case "Enter":
      case " ":
        e.preventDefault();
        this.activateSelected();
        break;
      case "h":
      case "Backspace":
        e.preventDefault();
        this.collapseSelected();
        break;
      case "/":
        e.preventDefault();
        this.filterInput?.focus();
        break;
      case "Escape":
        this.onSelectCallback?.(null);
        break;
    }
  }

  private selectIndex(idx: number): void {
    this.selectedIndex = idx;
    this.render();
    this.scrollToSelected();

    const item = this.flatItems[idx];
    if (!item) return;

    if (item.type === "symbol" || item.type === "tombstoned") {
      this.onSelectCallback?.(item.data as MemorySymbol);
    }
  }

  private activateSelected(): void {
    const item = this.flatItems[this.selectedIndex];
    if (!item) return;

    if (item.type === "symbol") {
      const sym = item.data as MemorySymbol;
      if (this.expandedSymbols.has(sym.uuid)) {
        this.expandedSymbols.delete(sym.uuid);
      } else {
        this.expandedSymbols.add(sym.uuid);
      }
      this.render();
      this.onSelectCallback?.(sym);
    } else if (item.type === "memory") {
      // Opening a memory row opens its parent symbol in detail pane
      // (parent symbol is already selected in most cases)
    }
  }

  private collapseSelected(): void {
    const item = this.flatItems[this.selectedIndex];
    if (!item) return;
    if (item.type === "symbol") {
      this.expandedSymbols.delete((item.data as MemorySymbol).uuid);
      this.render();
    }
  }

  private scrollToSelected(): void {
    const selected = this.bodyEl?.querySelector<HTMLElement>(".memory-tree-row--focused");
    selected?.scrollIntoView({ block: "nearest" });
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
