/**
 * Flat viewer-native renderer for NPC JSON files.
 *
 * Renders into the viewer content area: frontmatter (location) at the
 * top, then full-width tabs. Uses h4/p/hr within tab bodies so the
 * visual language matches the markdown viewer.
 */

import { renderProseWithRefs } from "./knowledge-refs";
import { getEntityResolver } from "../platform/entity-resolver";


interface NpcRelationship {
  target_name: string;
  type: string;
  valence: string;
}

interface NpcScheduleEntry {
  activity: string;
  location_id: string;
}

interface NpcSeededReflection {
  text: string;
  year?: number;
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
  seeded_reflections?: (string | NpcSeededReflection)[];
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
const TABS: [string, string][] = [
  ["persona",     "Persona"],
  ["stats",       "Stats"],
  ["inventory",   "Inventory"],
  ["relations",   "Relations"],
  ["schedule",    "Schedule"],
  ["reflections", "Reflections"],
];

export class NpcViewer {
  private activeTab = "persona";
  private tabBodyEl: HTMLElement | null = null;
  private npc: Record<string, unknown> = {};
  private navigateTo: ((path: string) => void) = () => {};

  render(
    container: HTMLElement,
    npc: Record<string, unknown>,
    navigateTo?: (path: string) => void,
  ): void {
    this.npc = npc;
    if (navigateTo) this.navigateTo = navigateTo;
    container.innerHTML = "";

    // Frontmatter — world (clickable) + location
    const worldId    = npc["world_id"]         != null ? String(npc["world_id"])         : null;
    const locationId = npc["location_room_id"] != null ? String(npc["location_room_id"]) : null;

    const fmContainer = document.createElement("div");
    fmContainer.className = "frontmatter";
    const fmRows = el("div", "frontmatter-rows");

    if (worldId) {
      const row = el("div", "frontmatter-row");
      row.appendChild(el("div", "frontmatter-label", "world"));
      const val = el("div", "frontmatter-value");
      const link = el("span", "ir-relation");
      link.title = `Open ${worldId}`;
      link.addEventListener("click", () => this.navigateTo(`content/worlds/padarax/maps/${worldId}.json`));
      link.appendChild(el("span", "target", worldId));
      val.appendChild(link);
      row.appendChild(val);
      fmRows.appendChild(row);
    }

    if (locationId) {
      const row = el("div", "frontmatter-row");
      row.appendChild(el("div", "frontmatter-label", "location"));
      const val = el("div", "frontmatter-value");
      if (worldId) {
        const link = el("span", "ir-relation");
        link.title = `Open ${worldId} — ${locationId}`;
        link.addEventListener("click", () => this.navigateTo(`content/worlds/padarax/maps/${worldId}.json`));
        link.appendChild(el("span", "target", locationId));
        val.appendChild(link);
      } else {
        val.appendChild(el("span", "ir-scalar", locationId));
      }
      row.appendChild(val);
      fmRows.appendChild(row);
    }

    fmContainer.appendChild(fmRows);
    container.appendChild(fmContainer);

    // Tab bar
    const tabBar = el("div", "npc-v-tabs");
    for (const [id, label] of TABS) {
      const btn = el("button", "npc-v-tab", label);
      if (id === this.activeTab) btn.classList.add("npc-v-tab--active");
      btn.addEventListener("click", () => {
        this.activeTab = id;
        for (const b of tabBar.querySelectorAll<HTMLElement>(".npc-v-tab")) {
          b.classList.toggle("npc-v-tab--active", b === btn);
        }
        this.renderTabBody();
      });
      tabBar.appendChild(btn);
    }
    container.appendChild(tabBar);

    const body = el("div", "npc-v-body");
    this.tabBodyEl = body;
    container.appendChild(body);

    this.renderTabBody();
  }

  private renderTabBody(): void {
    const body = this.tabBodyEl;
    if (!body) return;
    body.innerHTML = "";

    const persona   = (this.npc["persona"]            ?? {}) as NpcPersona;
    const sheet     = (this.npc["character_sheet"]     ?? {}) as NpcSheet;
    const drives    = (this.npc["drives"]              ?? {}) as Record<string, number>;
    const schedule  = (this.npc["schedule"]            ?? {}) as Record<string, NpcScheduleEntry>;
    const equipment = (this.npc["starting_equipment"]  ?? []) as string[];
    const wealth    = this.npc["wealth"] as number | undefined;
    const refStatus = (this.npc["_ref_status"] as Record<string, string> | undefined) ?? {};

    switch (this.activeTab) {
      case "persona":     buildPersonaTab(body, persona, this.npc, this.navigateTo, refStatus); break;
      case "stats":       buildStatsTab(body, sheet, drives); break;
      case "inventory":   buildInventoryTab(body, wealth, equipment); break;
      case "relations":   buildRelationsTab(body, persona, this.navigateTo, refStatus); break;
      case "schedule":    buildScheduleTab(body, schedule); break;
      case "reflections": buildReflectionsTab(body, persona, this.navigateTo, refStatus); break;
    }
  }
}

// ─── Tab builders ──────────────────────────────────────────────────────────

function buildPersonaTab(
  container: HTMLElement,
  persona: NpcPersona,
  npc: Record<string, unknown>,
  navigateTo: (path: string) => void,
  refStatus: Record<string, string>,
): void {
  const identity: [string, string][] = [];
  if (persona.name)              identity.push(["name",       persona.name]);
  if (persona.species)           identity.push(["species",    persona.species]);
  if (persona.gender)            identity.push(["gender",     persona.gender]);
  if (npc["occupation"] != null) identity.push(["occupation", String(npc["occupation"])]);

  if (identity.length > 0) {
    const grid = el("div", "npc-v-identity");
    for (const [label, value] of identity) {
      const row = el("div", "npc-v-identity-row");
      row.appendChild(el("span", "npc-v-identity-label", label));
      row.appendChild(el("span", "npc-v-identity-value", value));
      grid.appendChild(row);
    }
    container.appendChild(grid);
  }

  if (persona.role) {
    container.appendChild(heading("Role"));
    container.appendChild(para(persona.role, navigateTo, refStatus));
  }

  if (persona.want) {
    container.appendChild(heading("Want"));
    container.appendChild(para(persona.want, navigateTo, refStatus));
  }

  if (persona.need) {
    container.appendChild(heading("Need"));
    container.appendChild(para(persona.need, navigateTo, refStatus));
  }

  if (persona.flaw) {
    container.appendChild(heading("Flaw"));
    container.appendChild(para(persona.flaw, navigateTo, refStatus));
  }

  if (persona.contradiction) {
    container.appendChild(heading("Contradiction"));
    container.appendChild(para(persona.contradiction, navigateTo, refStatus));
  }

  if (persona.voice) {
    container.appendChild(heading("Voice"));
    container.appendChild(para(persona.voice, navigateTo, refStatus));
  }

  if (persona.current_state) {
    container.appendChild(heading("Active State"));
    container.appendChild(para(persona.current_state, navigateTo, refStatus));
  }

  if (!persona.name && !persona.role && !persona.want && !persona.voice && !persona.current_state) {
    container.appendChild(para("No persona data."));
  }
}

function buildStatsTab(
  container: HTMLElement,
  sheet: NpcSheet,
  drives: Record<string, number>,
): void {
  // State bars
  container.appendChild(heading("State"));
  for (const [label, color, currKey, maxKey] of [
    ["Vitality",  "orangered", "vitality_current",  "vitality_max"],
    ["Composure", "limegreen", "composure_current", "composure_max"],
    ["Essentia",  "#87ceeb",   "essentia_current",  "essentia_max"],
  ] as [string, string, keyof NpcSheet, keyof NpcSheet][]) {
    const curr = (sheet[currKey] as number | undefined) ?? 0;
    const max  = (sheet[maxKey]  as number | undefined) ?? 0;
    const row = el("div", "npc-v-res-row");
    row.appendChild(el("span", "npc-v-res-name", label));
    const barWrap = el("div", "npc-v-res-bar-wrap");
    const bar = el("div", "npc-v-res-bar");
    bar.style.background = color;
    bar.style.width = max > 0 ? `${(curr / max) * 100}%` : "0%";
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
    row.appendChild(el("span", "npc-v-res-num", `${curr}/${max}`));
    container.appendChild(row);
  }

  // Attributes
  container.appendChild(heading("Attributes"));
  for (const [label, key, color] of [
    ["Vigor",    "vigor",    "orangered"],
    ["Finesse",  "finesse",  "limegreen"],
    ["Wit",      "wit",      "var(--accent-yellow, #f5c518)"],
    ["Presence", "presence", "var(--accent-purple, #b36bff)"],
  ] as [string, keyof NpcSheet, string][]) {
    const val = (sheet[key] as number | undefined) ?? 0;
    const row = el("div", "npc-v-attr-row");
    row.appendChild(el("span", "npc-v-attr-name", label));
    const pips = el("div", "npc-v-pips");
    for (let i = 1; i <= 10; i++) {
      const pip = el("div", "npc-v-pip");
      if (i <= val) pip.style.background = color;
      pips.appendChild(pip);
    }
    row.appendChild(pips);
    row.appendChild(el("span", "npc-v-attr-val", String(val)));
    container.appendChild(row);
  }

  const driveEntries = Object.entries(drives);
  if (driveEntries.length > 0) {
    container.appendChild(heading("Drives"));
    for (const [key, val] of driveEntries) {
      const row = el("div", "npc-v-res-row");
      row.appendChild(el("span", "npc-v-res-name", key));
      const barWrap = el("div", "npc-v-res-bar-wrap");
      const bar = el("div", "npc-v-res-bar");
      bar.style.background = "var(--accent-green)";
      bar.style.width = `${val}%`;
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      row.appendChild(el("span", "npc-v-res-num", String(val)));
      container.appendChild(row);
    }
  }
}

function buildInventoryTab(
  container: HTMLElement,
  wealth: number | undefined,
  equipment: string[],
): void {
  if (wealth != null) {
    container.appendChild(heading("Wealth"));
    const p = el("p", "npc-v-wealth");
    p.textContent = `◈ ${wealth}`;
    container.appendChild(p);
  }

  if (equipment.length > 0) {
    container.appendChild(heading("Equipment"));
    for (const item of equipment) {
      const row = el("div", "npc-v-inv-item");
      row.appendChild(el("span", "", item));
      container.appendChild(row);
    }
  }

  if (wealth == null && equipment.length === 0) {
    container.appendChild(para("No inventory data."));
  }
}

function buildRelationsTab(
  container: HTMLElement,
  persona: NpcPersona,
  navigateTo: (path: string) => void,
  refStatus: Record<string, string>,
): void {
  const rels = persona.relationships ?? [];
  if (rels.length === 0) {
    container.appendChild(para("No relationships defined."));
    return;
  }

  const head = el("div", "npc-v-rel-head");
  head.appendChild(el("span", "", "Name"));
  head.appendChild(el("span", "", "Type"));
  head.appendChild(el("span", "", "Valence"));
  container.appendChild(head);

  const resolver = getEntityResolver();
  for (const rel of rels) {
    const row = el("div", "npc-v-rel-row");

    // Enrichment populates _target_id when the relationship resolves to an NPC.
    // Falls back to slugged name only if the file wasn't enriched (no _ref_status).
    const enriched = rel as NpcRelationship & { _target_id?: string | null; _target_status?: string };
    const targetId = enriched._target_id;
    const isResolved = !!targetId;
    const npcFile = isResolved
      ? (resolver?.resolve("npc", targetId!) ?? `content/worlds/padarax/npcs/${targetId}.json`)
      : null;

    const nameLink = el("span", isResolved ? "npc-v-rel-name ir-relation" : "npc-v-rel-name hv-ref--dead");
    nameLink.appendChild(el("span", "target", rel.target_name));
    if (isResolved && npcFile) {
      nameLink.title = `Open NPC: ${rel.target_name}`;
      nameLink.addEventListener("click", () => navigateTo(npcFile));
    } else {
      nameLink.title = `No NPC file found for "${rel.target_name}"`;
    }
    row.appendChild(nameLink);

    const typeEl = el("span", "npc-v-rel-type");
    typeEl.appendChild(renderProseWithRefs(rel.type));
    attachRefHandlers(typeEl, navigateTo, refStatus);
    row.appendChild(typeEl);

    const valEl = el("span", "npc-v-rel-valence");
    valEl.appendChild(renderProseWithRefs(rel.valence));
    attachRefHandlers(valEl, navigateTo, refStatus);
    row.appendChild(valEl);

    container.appendChild(row);
  }
}

function buildScheduleTab(
  container: HTMLElement,
  schedule: Record<string, NpcScheduleEntry>,
): void {
  const hasAny = PERIODS.some(p => p in schedule);
  if (!hasAny) {
    container.appendChild(para("No schedule defined."));
    return;
  }
  for (const period of PERIODS) {
    const entry = schedule[period];
    if (!entry) continue;
    const row = el("div", "npc-v-sched-row");
    row.appendChild(el("span", "npc-v-sched-period", period));
    row.appendChild(el("span", "npc-v-sched-activity", entry.activity));
    row.appendChild(el("span", "npc-v-sched-location", entry.location_id));
    container.appendChild(row);
  }
}

function buildReflectionsTab(
  container: HTMLElement,
  persona: NpcPersona,
  navigateTo: (path: string) => void,
  refStatus: Record<string, string>,
): void {
  const raw = persona.seeded_reflections ?? [];
  if (raw.length === 0) {
    container.appendChild(para("No reflections seeded for this NPC."));
    return;
  }

  const refs: NpcSeededReflection[] = raw.map(r =>
    typeof r === "string" ? { text: r } : r,
  );

  refs.sort((a, b) => {
    if (a.year == null && b.year == null) return 0;
    if (a.year == null) return 1;
    if (b.year == null) return -1;
    return a.year - b.year;
  });

  refs.forEach((ref, i) => {
    const entry = el("div", "npc-v-reflection");
    entry.appendChild(el("span", "npc-v-reflection-num", `${i + 1}.`));
    if (ref.year != null) {
      entry.appendChild(el("span", "npc-v-reflection-year", `${ref.year} AE`));
    }
    const text = el("span", "npc-v-reflection-text");
    text.appendChild(renderProseWithRefs(ref.text));
    attachRefHandlers(text, navigateTo, refStatus);
    entry.appendChild(text);
    container.appendChild(entry);
  });
}

// ─── HTML helpers ─────────────────────────────────────────────────────────

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function heading(text: string): HTMLElement {
  return el("h4", "npc-v-heading", text);
}

function para(
  text: string,
  navigateTo?: (path: string) => void,
  refStatus?: Record<string, string>,
): HTMLElement {
  const p = el("p", "npc-v-para");
  p.appendChild(renderProseWithRefs(text));
  if (navigateTo) attachRefHandlers(p, navigateTo, refStatus);
  return p;
}

function attachRefHandlers(
  host: HTMLElement,
  navigateTo: (path: string) => void,
  refStatus?: Record<string, string>,
): void {
  const resolver = getEntityResolver();
  const badges = host.querySelectorAll<HTMLElement>(".hv-ref");
  for (const badge of badges) {
    const type = badge.dataset["refType"] ?? "";
    const id   = badge.dataset["refId"] ?? "";
    if (!id) continue;
    const status = refStatus?.[`@${type}:${id}`];
    if (status === "dead") {
      badge.classList.add("hv-ref--dead");
      continue;
    }
    const path = resolver?.resolve(type, id) ?? null;
    if (path) {
      badge.classList.add(`hv-ref--${status ?? "resolved"}`);
      badge.addEventListener("click", () => navigateTo(path));
    } else {
      badge.classList.add("hv-ref--dead");
    }
  }
}


