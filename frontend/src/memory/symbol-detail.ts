import type { MemorySymbol, MemoryEntry, MemoryEvidence } from "./types";

export class SymbolDetailPane {
  private currentSymbol: MemorySymbol | null = null;
  private expandedEntries: Set<string> = new Set();
  private showSuperseded = false;
  private selectedEntryIdx = 0;
  private onPromoteCallback: ((memory: MemoryEntry, symbol: MemorySymbol) => void) | null = null;

  private headerEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(private container: HTMLElement, private projectPath: string = "") {}

  setOnPromote(cb: ((memory: MemoryEntry, symbol: MemorySymbol) => void) | null): void {
    this.onPromoteCallback = cb;
  }

  initialize(): void {
    this.container.className = "memory-detail-pane";
    this.container.innerHTML = `
      <div class="memory-detail-header">
        <div class="memory-detail-bracket">[ SELECT A SYMBOL ]</div>
        <div class="memory-detail-sub">navigate the graph tree to the left</div>
      </div>
      <div class="memory-detail-body"></div>
      <div class="memory-detail-status">
        <span class="memory-detail-mode">DETAIL</span>
        <span class="memory-detail-path"></span>
        <span class="memory-detail-right">
          <span class="memory-detail-lang"></span>
          <span class="memory-detail-alert"></span>
        </span>
      </div>
    `;

    this.headerEl = this.container.querySelector(".memory-detail-header");
    this.bodyEl   = this.container.querySelector(".memory-detail-body");
    this.statusEl = this.container.querySelector(".memory-detail-status");

    this.container.setAttribute("tabindex", "-1");
    this.container.addEventListener("keydown", (e) => this.handleKey(e), true);
  }

  setProjectPath(path: string): void {
    this.projectPath = path;
  }

  showSymbol(sym: MemorySymbol): void {
    this.currentSymbol = sym;
    this.expandedEntries.clear();
    this.selectedEntryIdx = 0;

    // Auto-expand first active entry
    const first = sym.memories.find(m => !m.archived && !m.superseded_by);
    if (first) this.expandedEntries.add(first.uuid);

    this.render();
    this.container.focus();
  }

  clear(): void {
    this.currentSymbol = null;
    const headerEl = this.container.querySelector(".memory-detail-bracket");
    const subEl = this.container.querySelector(".memory-detail-sub");
    if (headerEl) headerEl.textContent = "[ SELECT A SYMBOL ]";
    if (subEl) subEl.textContent = "navigate the graph tree to the left";
    if (this.bodyEl) this.bodyEl.innerHTML = "";
    this.updateStatus(null);
  }

  private render(): void {
    const sym = this.currentSymbol;
    if (!sym || !this.headerEl || !this.bodyEl) return;

    // Header
    const bracketEl = this.headerEl.querySelector(".memory-detail-bracket");
    const subEl = this.headerEl.querySelector(".memory-detail-sub");
    if (bracketEl) bracketEl.textContent = `[ ${sym.name.toUpperCase()} ]`;
    if (subEl) {
      const tombChip = sym.tombstoned ? ` <span class="memory-detail-tomb-chip">deleted ${sym.deleted_at ?? ""}</span>` : "";
      subEl.innerHTML = `${sym.kind} · <span class="memory-detail-uuid">code:entity/${sym.uuid}</span>${tombChip}`;
    }

    const html: string[] = [];

    // ── Structure ──────────────────────────────────────────────────────
    html.push(`<div class="memory-detail-section">
      <div class="memory-detail-section-title">
        structure
        <span class="memory-detail-section-meta">indexed · ${sym.file ?? ""}</span>
      </div>
      <div class="memory-detail-struct">
        <div class="memory-struct-decl">
          <span class="memory-struct-kw">${sym.kind}</span>
          <span class="memory-struct-name">${esc(sym.name)}</span>
        </div>
        ${sym.file ? `<div class="memory-struct-row"><span class="memory-struct-conn">├─</span><span class="memory-struct-label">defined in</span><span class="memory-struct-path">${esc(sym.file)}${sym.line_start ? ` : ${sym.line_start}–${sym.line_end}` : ""}</span></div>` : ""}
        ${sym.previous_name ? `<div class="memory-struct-row"><span class="memory-struct-conn">└─</span><span class="memory-struct-label">renamed from</span><span class="memory-struct-ty">${esc(sym.previous_name)}</span></div>` : ""}
        ${sym.tombstoned ? `<div class="memory-struct-row" style="color:var(--accent-orange)"><span class="memory-struct-conn" style="color:var(--text-muted)">└─</span><span class="memory-struct-label">tombstoned</span><span>${esc(sym.deleted_at ?? "")}</span></div>` : ""}
      </div>
    </div>`);

    // ── Orphan banner (tombstoned with memories) ────────────────────
    if (sym.tombstoned && sym.memories.length > 0) {
      html.push(`<div class="memory-detail-orphan-banner">
        <div class="memory-detail-orphan-body">
          <span class="memory-detail-orphan-label">memory orphaned</span>
          <strong>${sym.memories.length} ${sym.memories.length === 1 ? "entry" : "entries"}</strong> still attached to this tombstone.
          The symbol was not seen in the last nkrdn rebuild.
        </div>
      </div>`);
    }

    // ── Attached memory ────────────────────────────────────────────────
    const activeMemories = sym.memories.filter(m => !m.archived && !m.superseded_by);
    const supersededMemories = sym.memories.filter(m => !!m.superseded_by && !m.archived);

    html.push(`<div class="memory-detail-section">
      <div class="memory-detail-section-title">
        ${sym.tombstoned ? "attached memory · awaiting review" : "attached memory"}
        <span class="memory-detail-section-meta">
          <span class="memory-stat-n">${activeMemories.length}</span> active ·
          <span class="memory-stat-n">${supersededMemories.length}</span> superseded ·
          <span class="memory-stat-n">${sym.memories.filter(m => m.archived).length}</span> archived
        </span>
      </div>
    `);

    activeMemories.forEach((mem, i) => {
      html.push(this.renderMemoryEntry(mem, i === this.selectedEntryIdx, sym.tombstoned));
    });

    if (supersededMemories.length > 0 && !this.showSuperseded) {
      html.push(`<div class="memory-detail-superseded-row">
        <span><span class="memory-struct-conn">└─ </span>${supersededMemories.length} superseded ${supersededMemories.length === 1 ? "entry" : "entries"} hidden · s to show</span>
      </div>`);
    }

    if (this.showSuperseded) {
      supersededMemories.forEach(mem => {
        html.push(this.renderMemoryEntry(mem, false, sym.tombstoned, true));
      });
    }

    html.push(`</div>`);

    this.bodyEl.innerHTML = html.join("");

    // Wire expand/collapse clicks
    this.bodyEl.querySelectorAll<HTMLElement>("[data-mem-uuid]").forEach(el => {
      el.addEventListener("click", () => {
        const uuid = el.dataset["memUuid"]!;
        if (this.expandedEntries.has(uuid)) {
          this.expandedEntries.delete(uuid);
        } else {
          this.expandedEntries.add(uuid);
        }
        this.render();
      });
    });

    this.updateStatus(sym);
  }

  private renderMemoryEntry(mem: MemoryEntry, _focused: boolean, tombstoned = false, superseded = false): string {
    const expanded = this.expandedEntries.has(mem.uuid);
    const pillClass = `memory-pill memory-pill--${mem.type}`;
    const entryClass = `memory-detail-entry${expanded ? " memory-detail-entry--expanded" : ""}${tombstoned ? " memory-detail-entry--orphan" : ""}${superseded ? " memory-detail-entry--superseded" : ""}`;

    let body = "";
    if (expanded) {
      const rejRows = (mem.rejected_alternatives ?? []).map(alt =>
        `<div class="memory-meta-alt"><span class="memory-meta-rej">${esc(alt.label)}</span><span>${esc(alt.reason)}</span></div>`
      ).join("");

      const evRows = (mem.evidence ?? []).map(ev => this.renderEvidence(ev)).join("");
      const tags = (mem.tags ?? []).map(t => `<span class="memory-tag">#${esc(t)}</span>`).join(" ");

      body = `<div class="memory-detail-body-inner">
        ${mem.body ? `<p class="memory-detail-body-text">${esc(mem.body)}</p>` : ""}
        <dl class="memory-meta-grid">
          ${rejRows ? `<dt>rejected</dt><dd>${rejRows}</dd>` : ""}
          ${evRows  ? `<dt>evidence</dt><dd class="memory-meta-evidence">${evRows}</dd>` : ""}
          ${mem.authored_by ? `<dt>authored</dt><dd><span class="memory-meta-author">${esc(mem.authored_by)}</span>${mem.session ? `<span class="memory-meta-session">session ${esc(mem.session)}</span>` : ""}</dd>` : ""}
          ${tags ? `<dt>tags</dt><dd>${tags}</dd>` : ""}
        </dl>
      </div>`;
    }

    return `<article class="${entryClass}" data-mem-uuid="${esc(mem.uuid)}">
      <header class="memory-detail-entry-head">
        <span class="memory-entry-chev">${expanded ? "▾" : "▸"}</span>
        <span class="${pillClass}">${mem.type}</span>
        <span class="memory-entry-title">${esc(mem.title)}</span>
        <span class="memory-entry-date">${esc(mem.date.slice(0, 7))}</span>
      </header>
      ${body}
    </article>`;
  }

  private renderEvidence(ev: MemoryEvidence): string {
    const cls = ev.kind === "doc" ? "memory-ev-doc" : ev.kind === "code" ? "memory-ev-code" : "memory-ev-ext";
    return `<span class="${cls}">→ ${esc(ev.uri)}</span>`;
  }

  private updateStatus(sym: MemorySymbol | null): void {
    const modeEl  = this.statusEl?.querySelector(".memory-detail-mode");
    const pathEl  = this.statusEl?.querySelector(".memory-detail-path");
    const alertEl = this.statusEl?.querySelector(".memory-detail-alert");
    const langEl  = this.statusEl?.querySelector(".memory-detail-lang");

    if (!sym) {
      if (modeEl)  modeEl.textContent = "DETAIL";
      if (pathEl)  pathEl.textContent = "";
      if (alertEl) alertEl.textContent = "";
      if (langEl)  langEl.textContent = "";
      return;
    }

    const orphanCount = sym.memories.filter(m => !m.archived).length;
    if (modeEl)  modeEl.textContent = sym.tombstoned ? "REVIEW" : "DETAIL";
    if (modeEl)  (modeEl as HTMLElement).style.color = sym.tombstoned ? "var(--accent-orange)" : "";
    if (pathEl)  pathEl.textContent = sym.file ? `${sym.file} · ${sym.name}` : sym.name;
    if (langEl)  langEl.textContent = sym.file?.split(".").pop() ?? "";
    if (alertEl) alertEl.textContent = sym.tombstoned ? `${orphanCount} orphan` : "";
  }

  private handleKey(e: KeyboardEvent): void {
    const sym = this.currentSymbol;
    if (!sym) return;

    const active = sym.memories.filter(m => !m.archived && !m.superseded_by);

    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        this.selectedEntryIdx = Math.min(this.selectedEntryIdx + 1, active.length - 1);
        this.render();
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        this.selectedEntryIdx = Math.max(this.selectedEntryIdx - 1, 0);
        this.render();
        break;
      case "l":
      case "Enter":
        e.preventDefault();
        if (active[this.selectedEntryIdx]) {
          const uuid = active[this.selectedEntryIdx]!.uuid;
          if (this.expandedEntries.has(uuid)) {
            this.expandedEntries.delete(uuid);
          } else {
            this.expandedEntries.add(uuid);
          }
          this.render();
        }
        break;
      case "h":
        e.preventDefault();
        if (active[this.selectedEntryIdx]) {
          this.expandedEntries.delete(active[this.selectedEntryIdx]!.uuid);
          this.render();
        }
        break;
      case "s":
        e.preventDefault();
        this.showSuperseded = !this.showSuperseded;
        this.render();
        break;
      case "a": {
        e.preventDefault();
        const entry = active[this.selectedEntryIdx];
        if (entry) this.archiveEntry(entry.uuid);
        break;
      }
      case "p": {
        e.preventDefault();
        const entry = active[this.selectedEntryIdx];
        if (entry?.type === "decision" && this.onPromoteCallback) {
          this.onPromoteCallback(entry, sym);
        }
        break;
      }
    }
  }

  private async archiveEntry(uuid: string): Promise<void> {
    if (!this.projectPath) return;
    const uri = `http://nkrdn.knowledge/memory#${uuid}`;
    try {
      await fetch("/api/memory/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: this.projectPath, uri }),
      });
    } catch { /* FileWatcher triggers rebuild + re-emit */ }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
