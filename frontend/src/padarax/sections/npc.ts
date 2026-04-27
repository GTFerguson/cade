/**
 * Padarax NPC section handlers for entity_detail.
 *
 * Register at startup via padarax/register.ts. Each handler is a port of
 * logic that previously lived split across npc-viewer.ts and npc-detail.ts.
 * Requires ctx.props.data[0] to be an enriched NPC JSON record.
 */

import type { SectionRenderer } from "../../dashboard/components/entity-detail";
import { renderProseWithRefs } from "../../platform/refs";
import { getEntityResolver } from "../../platform/entity-resolver";

interface NpcRelationship {
  target_name: string;
  type: string;
  valence: string;
  _target_id?: string | null;
  _target_status?: string;
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
  role?: string;
  want?: string;
  need?: string;
  flaw?: string;
  contradiction?: string;
  voice?: string;
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

// ─── persona ─────────────────────────────────────────────────────────────────

export const personaSection: SectionRenderer = (container, _section, record, ctx) => {
  const persona = (record["persona"] ?? {}) as NpcPersona;

  const proseField = (label: string, text: string | undefined): void => {
    if (!text) return;
    container.appendChild(ctx.el("h4", "npc-v-heading", label));
    const wrap = ctx.el("div", "npc-v-para-wrap");
    for (const block of text.split(/\n\n+/)) {
      if (!block.trim()) continue;
      const p = ctx.el("p", "npc-v-para");
      p.appendChild(renderProseWithRefs(block));
      ctx.attachRefHandlers(p, _section, record);
      wrap.appendChild(p);
    }
    container.appendChild(wrap);
  };

  proseField("Role",          persona.role);
  proseField("Want",          persona.want);
  proseField("Need",          persona.need);
  proseField("Flaw",          persona.flaw);
  proseField("Contradiction", persona.contradiction);
  proseField("Voice",         persona.voice);
  proseField("Active State",  persona.current_state);

  if (!persona.role && !persona.want && !persona.voice && !persona.current_state) {
    container.appendChild(ctx.el("div", "dash-npc-hint", "No persona data."));
  }
};

// ─── frontmatter ─────────────────────────────────────────────────────────────

export const frontmatterStripSection: SectionRenderer = (container, _section, record, ctx) => {
  const worldId    = record["world_id"]         != null ? String(record["world_id"])         : null;
  const locationId = record["location_room_id"] != null ? String(record["location_room_id"]) : null;

  const rows: Array<[string, () => HTMLElement]> = [];
  rows.push(["id", () => ctx.el("span", "ir-scalar", String(record["id"] ?? ""))]);
  if (worldId)    rows.push(["world",      () => ctx.el("span", "ir-scalar", worldId)]);
  if (locationId) {
    rows.push(["location", () => {
      const link = ctx.el("span", "ir-relation");
      link.title = `Open ${worldId ?? ""} — ${locationId}`;
      if (worldId) {
        link.addEventListener("click", () =>
          ctx.fireViewFile(`content/worlds/padarax/maps/${worldId}.json#room=${locationId}`)
        );
      }
      link.appendChild(ctx.el("span", "target", locationId));
      return link;
    }]);
  }
  if (record["occupation"] != null) {
    rows.push(["occupation", () => ctx.el("span", "ir-scalar", String(record["occupation"]))]);
  }
  if (record["wealth"] != null) {
    rows.push(["wealth", () => ctx.el("span", "ir-scalar", `◈ ${record["wealth"]}`)]);
  }

  const fm = ctx.el("div", "frontmatter");
  const fmRows = ctx.el("div", "frontmatter-rows");
  for (const [label, makeValue] of rows) {
    const row = ctx.el("div", "frontmatter-row");
    row.appendChild(ctx.el("div", "frontmatter-label", label));
    const val = ctx.el("div", "frontmatter-value");
    val.appendChild(makeValue());
    row.appendChild(val);
    fmRows.appendChild(row);
  }
  fm.appendChild(fmRows);
  container.appendChild(fm);
};

// ─── character_sheet ─────────────────────────────────────────────────────────

export const characterSheetSection: SectionRenderer = (container, _section, record, ctx) => {
  const sheet = (record["character_sheet"] ?? {}) as NpcSheet;

  // Attributes
  const attrSect = ctx.el("div", "dash-npc-sheet-section");
  attrSect.appendChild(ctx.el("div", "dash-npc-sheet-head", "Attributes"));
  for (const [label, key, variant] of [
    ["Vigor",    "vigor",    "vigor"],
    ["Finesse",  "finesse",  "finesse"],
    ["Wit",      "wit",      "wit"],
    ["Presence", "presence", "presence"],
  ] as [string, keyof NpcSheet, string][]) {
    const val = (sheet[key] as number | undefined) ?? 0;
    const row = ctx.el("div", "dash-npc-attr-row");
    row.appendChild(ctx.el("span", "dash-npc-attr-name", label));
    const pips = ctx.el("div", "dash-npc-pips");
    for (let i = 1; i <= 10; i++) {
      pips.appendChild(ctx.el("div", `dash-npc-pip${i <= val ? ` dash-npc-pip--${variant}` : ""}`));
    }
    row.appendChild(pips);
    row.appendChild(ctx.el("span", "dash-npc-attr-val", String(val)));
    attrSect.appendChild(row);
  }
  container.appendChild(attrSect);
};

// ─── attributes_bars ─────────────────────────────────────────────────────────

export const attributesBarsSection: SectionRenderer = (container, _section, record, ctx) => {
  const sheet  = (record["character_sheet"] ?? {}) as NpcSheet;
  const drives = (record["drives"] ?? {}) as Record<string, number>;

  // State bars
  const stateSect = ctx.el("div", "dash-npc-sheet-section");
  stateSect.appendChild(ctx.el("div", "dash-npc-sheet-head", "State"));
  for (const [label, variant, currKey, maxKey] of [
    ["Vitality",  "vitality",  "vitality_current",  "vitality_max"],
    ["Composure", "composure", "composure_current", "composure_max"],
    ["Essentia",  "essentia",  "essentia_current",  "essentia_max"],
  ] as [string, string, keyof NpcSheet, keyof NpcSheet][]) {
    const curr = (sheet[currKey] as number | undefined) ?? 0;
    const max  = (sheet[maxKey]  as number | undefined) ?? 0;
    const row = ctx.el("div", "dash-npc-res-row");
    row.appendChild(ctx.el("span", "dash-npc-res-name", label));
    const barWrap = ctx.el("div", "dash-npc-res-bar-wrap");
    const bar = ctx.el("div", `dash-npc-res-bar dash-npc-res-bar--${variant}`);
    bar.style.width = max > 0 ? `${(curr / max) * 100}%` : "0%";
    barWrap.appendChild(bar);
    row.appendChild(barWrap);
    row.appendChild(ctx.el("span", "dash-npc-res-num", `${curr}/${max}`));
    stateSect.appendChild(row);
  }
  container.appendChild(stateSect);

  // Drives
  const driveEntries = Object.entries(drives);
  if (driveEntries.length > 0) {
    const driveSect = ctx.el("div", "dash-npc-sheet-section");
    driveSect.appendChild(ctx.el("div", "dash-npc-sheet-head", "Drives"));
    for (const [key, val] of driveEntries) {
      const row = ctx.el("div", "dash-npc-drive-row");
      row.appendChild(ctx.el("span", "dash-npc-drive-name", key));
      const barWrap = ctx.el("div", "dash-npc-drive-bar-wrap");
      const bar = ctx.el("div", "dash-npc-drive-bar");
      bar.style.width = `${val}%`;
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      row.appendChild(ctx.el("span", "dash-npc-drive-num", String(val)));
      driveSect.appendChild(row);
    }
    container.appendChild(driveSect);
  }
};

// ─── relationships ────────────────────────────────────────────────────────────

export const relationshipsSection: SectionRenderer = (container, section, record, ctx) => {
  const persona = (record["persona"] ?? {}) as NpcPersona;
  const rels = persona.relationships ?? [];
  if (rels.length === 0) {
    container.appendChild(ctx.el("div", "dash-npc-hint", "No relationships defined."));
    return;
  }

  const resolver = getEntityResolver();

  for (const rel of rels) {
    const row = ctx.el("div", "dash-npc-rel-row");

    // Enrichment bakes _target_id when the relationship resolves to an NPC
    const targetId = rel._target_id;
    const npcFile = targetId
      ? (resolver?.resolve("npc", targetId) ?? null)
      : null;

    const nameEl = ctx.el("span", npcFile ? "dash-npc-rel-name hv-ref--resolved" : "dash-npc-rel-name hv-ref--dead");
    nameEl.textContent = rel.target_name;
    if (npcFile) {
      nameEl.title = `Open NPC: ${rel.target_name}`;
      nameEl.addEventListener("click", () => ctx.fireViewFile(npcFile));
    }
    row.appendChild(nameEl);

    const typeEl = ctx.el("span", "dash-npc-rel-type");
    typeEl.appendChild(renderProseWithRefs(rel.type));
    ctx.attachRefHandlers(typeEl, section, record);
    row.appendChild(typeEl);

    const valEl = ctx.el("span", "dash-npc-rel-valence");
    valEl.appendChild(renderProseWithRefs(rel.valence));
    ctx.attachRefHandlers(valEl, section, record);
    row.appendChild(valEl);

    container.appendChild(row);
  }
};

// ─── schedule ─────────────────────────────────────────────────────────────────

export const scheduleSection: SectionRenderer = (container, _section, record, ctx) => {
  const schedule = (record["schedule"] ?? {}) as Record<string, NpcScheduleEntry>;
  const hasAny = PERIODS.some(p => p in schedule);
  if (!hasAny) {
    container.appendChild(ctx.el("div", "dash-npc-hint", "No schedule defined."));
    return;
  }

  for (const period of PERIODS) {
    const entry = schedule[period];
    if (!entry) continue;

    const row = ctx.el("div", "dash-npc-sched-row");
    row.appendChild(ctx.el("span", "dash-npc-sched-period", period));
    row.appendChild(ctx.el("span", "dash-npc-sched-activity", entry.activity));

    const loc = ctx.el("span", "dash-npc-sched-location", entry.location_id);
    loc.addEventListener("click", () => {
      ctx.props.onAction({
        action: "navigate_room",
        source: typeof ctx.props.panel.source === "string" ? ctx.props.panel.source : "",
        entityId: entry.location_id,
        patch: { room_id: entry.location_id },
      });
    });
    row.appendChild(loc);
    container.appendChild(row);
  }
};

// ─── reflections ──────────────────────────────────────────────────────────────

export const reflectionsSection: SectionRenderer = (container, section, record, ctx) => {
  const persona = (record["persona"] ?? {}) as NpcPersona;
  const raw = persona.seeded_reflections ?? [];
  if (raw.length === 0) {
    container.appendChild(ctx.el("div", "dash-npc-hint", "No reflections seeded for this NPC."));
    return;
  }

  const normalized: NpcSeededReflection[] = raw.map(r =>
    typeof r === "string" ? { text: r } : r,
  );

  normalized.sort((a, b) => {
    if (a.year == null && b.year == null) return 0;
    if (a.year == null) return 1;
    if (b.year == null) return -1;
    return a.year - b.year;
  });

  normalized.forEach((ref, i) => {
    const entry = ctx.el("div", "dash-npc-reflection");
    entry.appendChild(ctx.el("span", "dash-npc-reflection-num", `${i + 1}.`));
    if (ref.year != null) {
      entry.appendChild(ctx.el("span", "dash-npc-reflection-year", `${ref.year} AE`));
    }
    const textWrap = ctx.el("div", "dash-npc-reflection-text");
    textWrap.appendChild(renderProseWithRefs(ref.text));
    ctx.attachRefHandlers(textWrap, section, record);
    entry.appendChild(textWrap);
    container.appendChild(entry);
  });
};
