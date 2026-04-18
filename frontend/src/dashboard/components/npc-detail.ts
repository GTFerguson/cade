import { BaseDashboardComponent } from "./base-component";

interface NpcRelationship {
  target_name: string;
  type: string;
  valence: string;
}

interface NpcScheduleEntry {
  activity: string;
  location_id: string;
}

interface NpcPersona {
  name?: string;
  species?: string;
  gender?: string;
  role?: string;
  want?: string;
  need?: string;
  flaw?: string;
  voice?: string;
  contradiction?: string;
  current_state?: string;
  relationships?: NpcRelationship[];
  seeded_reflections?: string[];
}

interface NpcSheet {
  vigor?: number;
  finesse?: number;
  wit?: number;
  presence?: number;
  vitality_current?: number;
  vitality_max?: number;
  composure_current?: number;
  composure_max?: number;
  essentia_current?: number;
  essentia_max?: number;
}

const PERIODS = ["dawn", "morning", "midday", "evening", "night"] as const;
const ATTR_COLORS: Record<string, string> = {
  vigor: "vigor", finesse: "finesse", wit: "wit", presence: "presence",
};

export class NpcDetailComponent extends BaseDashboardComponent {
  private selected: Record<string, unknown> | null = null;
  private searchQuery = "";
  private activeTab = "persona";
  private listRowsEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;

  protected build(): void {
    if (!this.container || !this.props) return;

    const shell = this.el("div", "dash-npc-shell");
    const single = this.props.data.length === 1;

    const detailPane = this.el("div", "dash-npc-detail-pane");
    this.detailEl = detailPane;

    if (!single) {
      const listPane = this.el("div", "dash-npc-list-pane");
      shell.appendChild(listPane);
      this.buildListPane(listPane);
    }

    shell.appendChild(detailPane);
    this.container.appendChild(shell);

    if (!this.selected && this.props.data.length > 0) {
      this.selected = this.props.data[0] ?? null;
    }

    if (!single) this.renderListRows();
    this.renderDetail();
  }

  private buildListPane(pane: HTMLElement): void {
    if (!this.props) return;
    const { panel } = this.props;

    if (panel.searchable.length > 0) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "dash-npc-search";
      input.placeholder = "Search…";
      input.value = this.searchQuery;
      input.addEventListener("input", () => {
        this.searchQuery = input.value.toLowerCase();
        this.renderListRows();
      });
      pane.appendChild(input);
    }

    const head = this.el("div", "dash-npc-list-head");
    head.innerHTML = "<span>id</span><span>world</span><span>occ</span>";
    pane.appendChild(head);

    const rows = this.el("div", "dash-npc-list-rows");
    this.listRowsEl = rows;
    pane.appendChild(rows);
  }

  private renderListRows(): void {
    const el = this.listRowsEl;
    if (!el || !this.props) return;
    el.innerHTML = "";

    const { panel, data } = this.props;
    let items = data;

    if (this.searchQuery && panel.searchable.length > 0) {
      const q = this.searchQuery;
      items = data.filter(item =>
        panel.searchable.some(f => String(item[f] ?? "").toLowerCase().includes(q))
      );
    }

    for (const item of items) {
      const row = this.el("div", "dash-npc-list-row");
      if (item === this.selected) row.classList.add("dash-npc-list-row--selected");

      const world = String(item["world_id"] ?? "");
      row.appendChild(this.el("span", "dash-npc-col-id", String(item["id"] ?? "")));
      row.appendChild(this.el("span", "dash-npc-col-world", world.length > 9 ? world.slice(0, 8) + "…" : world));
      row.appendChild(this.el("span", "dash-npc-col-occ", String(item["occupation"] ?? "—")));

      row.addEventListener("click", () => {
        this.selected = item;
        this.activeTab = "persona";
        this.renderListRows();
        this.renderDetail();
      });
      el.appendChild(row);
    }
  }

  private renderDetail(): void {
    const el = this.detailEl;
    if (!el) return;
    el.innerHTML = "";

    if (!this.selected) {
      el.appendChild(this.el("div", "dash-npc-empty", "[ select an NPC ]"));
      return;
    }

    const item = this.selected;
    const persona = (item["persona"] ?? {}) as NpcPersona;
    const sheet = (item["character_sheet"] ?? {}) as NpcSheet;
    const drives = (item["drives"] ?? {}) as Record<string, number>;
    const schedule = (item["schedule"] ?? {}) as Record<string, NpcScheduleEntry>;

    // Frontmatter strip
    const fm = this.el("div", "dash-npc-fm");
    const fmFields: [string, string, string][] = [
      ["id",     String(item["id"] ?? ""),               "id"],
      ["world",  String(item["world_id"] ?? "—"),         "world"],
      ["room",   String(item["location_room_id"] ?? "—"), "room"],
      ["occ",    String(item["occupation"] ?? "—"),       ""],
      ["wealth", item["wealth"] != null ? `◈ ${item["wealth"]}` : "—", "wealth"],
    ];
    let first = true;
    for (const [label, value, mod] of fmFields) {
      if (!first) fm.appendChild(this.el("span", "dash-npc-fm-sep", "·"));
      first = false;
      const field = this.el("div", "dash-npc-fm-field");
      field.appendChild(this.el("span", "dash-npc-fm-label", label));
      const valEl = this.el("span", mod ? `dash-npc-fm-value dash-npc-fm-value--${mod}` : "dash-npc-fm-value", value);
      if (mod === "room") {
        valEl.title = "Jump to room in world view";
        valEl.addEventListener("click", () => {
          this.props?.onAction({
            action: "navigate_room",
            source: typeof this.props?.panel.source === "string" ? this.props.panel.source : "",
            entityId: String(item["location_room_id"] ?? ""),
            patch: { world_id: String(item["world_id"] ?? ""), room_id: String(item["location_room_id"] ?? "") },
          });
        });
      }
      field.appendChild(valEl);
      fm.appendChild(field);
    }
    el.appendChild(fm);

    // Tab bar
    const tabs: [string, string][] = [
      ["persona", "Persona"],
      ["relationships", "Relationships"],
      ["charsheet", "Char Sheet"],
      ["schedule", "Schedule"],
      ["reflections", "Reflections"],
    ];
    const tabBar = this.el("div", "dash-npc-tabs");
    for (const [id, label] of tabs) {
      const btn = this.el("button", "dash-npc-tab", label);
      if (id === this.activeTab) btn.classList.add("dash-npc-tab--active");
      btn.addEventListener("click", () => { this.activeTab = id; this.renderDetail(); });
      tabBar.appendChild(btn);
    }
    el.appendChild(tabBar);

    // Tab content
    const content = this.el("div", "dash-npc-content");
    el.appendChild(content);

    switch (this.activeTab) {
      case "persona":       this.buildPersonaTab(content, persona); break;
      case "relationships": this.buildRelationshipsTab(content, persona); break;
      case "charsheet":     this.buildCharSheetTab(content, sheet, drives); break;
      case "schedule":      this.buildScheduleTab(content, schedule); break;
      case "reflections":   this.buildReflectionsTab(content, persona); break;
    }
  }

  private buildPersonaTab(el: HTMLElement, persona: NpcPersona): void {
    if (persona.role) {
      const block = this.el("div", "dash-npc-field");
      block.appendChild(this.fieldLabel("Role"));
      block.appendChild(this.el("div", "dash-npc-field-body", persona.role));
      el.appendChild(block);
    }

    if (persona.want || persona.need || persona.flaw) {
      const strip = this.el("div", "dash-npc-wnf");
      for (const [mod, label, text] of [
        ["want", "Want", persona.want ?? ""],
        ["need", "Need", persona.need ?? ""],
        ["flaw", "Flaw", persona.flaw ?? ""],
      ] as [string, string, string][]) {
        const cell = this.el("div", "dash-npc-wnf-cell");
        cell.appendChild(this.el("div", `dash-npc-wnf-label dash-npc-wnf-label--${mod}`, label));
        cell.appendChild(this.el("div", "dash-npc-wnf-text", text));
        strip.appendChild(cell);
      }
      el.appendChild(strip);
    }

    if (persona.contradiction) {
      const block = this.el("div", "dash-npc-field dash-npc-field--contradiction");
      block.appendChild(this.fieldLabel("Contradiction"));
      block.appendChild(this.el("div", "dash-npc-field-body", persona.contradiction));
      el.appendChild(block);
    }

    if (persona.voice) {
      const block = this.el("div", "dash-npc-field dash-npc-field--voice");
      block.appendChild(this.fieldLabel("Voice"));
      block.appendChild(this.el("div", "dash-npc-field-body", persona.voice));
      el.appendChild(block);
    }

    if (persona.current_state) {
      const block = this.el("div", "dash-npc-field dash-npc-field--state");
      block.appendChild(this.fieldLabel("Active State"));
      block.appendChild(this.el("div", "dash-npc-field-body dash-npc-field-body--state", persona.current_state));
      el.appendChild(block);
    }
  }

  private buildRelationshipsTab(el: HTMLElement, persona: NpcPersona): void {
    const rels = persona.relationships ?? [];
    if (rels.length === 0) {
      el.appendChild(this.el("div", "dash-npc-hint", "No relationships defined."));
      return;
    }

    el.appendChild(this.el("p", "dash-npc-hint", "Click a name to navigate to that NPC."));

    for (const rel of rels) {
      const row = this.el("div", "dash-npc-rel-row");
      row.appendChild(this.el("span", "dash-npc-rel-name", rel.target_name));
      row.appendChild(this.el("span", "dash-npc-rel-type", rel.type));
      row.appendChild(this.el("span", "dash-npc-rel-valence", rel.valence));
      row.addEventListener("click", () => {
        if (!this.props) return;
        const name = rel.target_name.toLowerCase();
        const target = this.props.data.find(d => {
          const p = d["persona"] as NpcPersona | undefined;
          return (
            String(d["id"] ?? "").toLowerCase().replace(/_/g, " ") === name ||
            String(p?.name ?? "").toLowerCase() === name
          );
        });
        if (target) {
          this.selected = target;
          this.activeTab = "persona";
          this.renderListRows();
          this.renderDetail();
        }
      });
      el.appendChild(row);
    }
  }

  private buildCharSheetTab(
    el: HTMLElement,
    sheet: NpcSheet,
    drives: Record<string, number>,
  ): void {
    // Attributes
    const attrSection = this.el("div", "dash-npc-sheet-section");
    attrSection.appendChild(this.el("div", "dash-npc-sheet-head", "Attributes"));

    for (const [label, key] of [
      ["Vigor",    "vigor"],
      ["Finesse",  "finesse"],
      ["Wit",      "wit"],
      ["Presence", "presence"],
    ] as [string, keyof NpcSheet][]) {
      const val = (sheet[key] as number | undefined) ?? 0;
      const row = this.el("div", "dash-npc-attr-row");
      row.appendChild(this.el("span", "dash-npc-attr-name", label));

      const pips = this.el("div", "dash-npc-pips");
      for (let i = 1; i <= 10; i++) {
        const color = ATTR_COLORS[key];
        pips.appendChild(this.el("div", `dash-npc-pip${i <= val ? ` dash-npc-pip--${color}` : ""}`));
      }
      row.appendChild(pips);
      row.appendChild(this.el("span", "dash-npc-attr-val", String(val)));
      attrSection.appendChild(row);
    }
    el.appendChild(attrSection);

    // State bars
    const stateSection = this.el("div", "dash-npc-sheet-section");
    stateSection.appendChild(this.el("div", "dash-npc-sheet-head", "State"));

    for (const [label, variant, currKey, maxKey] of [
      ["Vitality",  "vitality",  "vitality_current",  "vitality_max"],
      ["Composure", "composure", "composure_current", "composure_max"],
      ["Essentia",  "essentia",  "essentia_current",  "essentia_max"],
    ] as [string, string, keyof NpcSheet, keyof NpcSheet][]) {
      const curr = (sheet[currKey] as number | undefined) ?? 0;
      const max  = (sheet[maxKey]  as number | undefined) ?? 0;
      const row = this.el("div", "dash-npc-res-row");
      row.appendChild(this.el("span", "dash-npc-res-name", label));

      const barWrap = this.el("div", "dash-npc-res-bar-wrap");
      const bar = this.el("div", `dash-npc-res-bar dash-npc-res-bar--${variant}`);
      bar.style.width = max > 0 ? `${(curr / max) * 100}%` : "0%";
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      row.appendChild(this.el("span", "dash-npc-res-num", `${curr}/${max}`));
      stateSection.appendChild(row);
    }
    el.appendChild(stateSection);

    // Drives (optional)
    const driveEntries = Object.entries(drives);
    if (driveEntries.length > 0) {
      const drivesSection = this.el("div", "dash-npc-sheet-section");
      drivesSection.appendChild(this.el("div", "dash-npc-sheet-head", "Drives"));
      for (const [key, val] of driveEntries) {
        const row = this.el("div", "dash-npc-drive-row");
        row.appendChild(this.el("span", "dash-npc-drive-name", key));
        const barWrap = this.el("div", "dash-npc-drive-bar-wrap");
        const bar = this.el("div", "dash-npc-drive-bar");
        bar.style.width = `${val}%`;
        barWrap.appendChild(bar);
        row.appendChild(barWrap);
        row.appendChild(this.el("span", "dash-npc-drive-num", String(val)));
        drivesSection.appendChild(row);
      }
      el.appendChild(drivesSection);
    }
  }

  private buildScheduleTab(
    el: HTMLElement,
    schedule: Record<string, NpcScheduleEntry>,
  ): void {
    const hasAny = PERIODS.some(p => p in schedule);
    if (!hasAny) {
      el.appendChild(this.el("div", "dash-npc-hint", "No schedule defined."));
      return;
    }

    el.appendChild(this.el("p", "dash-npc-hint", "Locations link to the world view."));

    for (const period of PERIODS) {
      const entry = schedule[period];
      if (!entry) continue;

      const row = this.el("div", "dash-npc-sched-row");
      row.appendChild(this.el("span", "dash-npc-sched-period", period));
      row.appendChild(this.el("span", "dash-npc-sched-activity", entry.activity));

      const loc = this.el("span", "dash-npc-sched-location", entry.location_id);
      loc.addEventListener("click", () => {
        this.props?.onAction({
          action: "navigate_room",
          source: typeof this.props?.panel.source === "string" ? this.props.panel.source : "",
          entityId: entry.location_id,
          patch: { room_id: entry.location_id },
        });
      });
      row.appendChild(loc);
      el.appendChild(row);
    }
  }

  private buildReflectionsTab(el: HTMLElement, persona: NpcPersona): void {
    const refs = persona.seeded_reflections ?? [];
    if (refs.length === 0) {
      el.appendChild(this.el("div", "dash-npc-hint", "No reflections seeded for this NPC."));
      return;
    }
    refs.forEach((text, i) => {
      const entry = this.el("div", "dash-npc-reflection");
      entry.appendChild(this.el("span", "dash-npc-reflection-num", `${i + 1}.`));
      entry.appendChild(this.el("span", "dash-npc-reflection-text", text));
      el.appendChild(entry);
    });
  }

  private fieldLabel(text: string): HTMLElement {
    const el = this.el("div", "dash-npc-field-label", text);
    return el;
  }
}
