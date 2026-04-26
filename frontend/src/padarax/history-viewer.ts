/**
 * Viewer-native renderer for history event/period JSON files.
 *
 * Renders into the CADE file viewer: name/year/era header, cross-refs as
 * frontmatter, access-filter bar, then claims grouped by layer. Claims
 * outside the active filter collapse to their meta row (tier + tags) so the
 * GM can see what knowledge gates exist without losing structural context.
 */

import { parseRef, renderProseWithRefs, enrichedDirForPath } from "./knowledge-refs";

const TIER_ORDER = ["common", "informed", "specialist", "secret"] as const;

const LAYER_ORDER = ["existence", "surface", "mechanism", "origin"] as const;
type Layer = (typeof LAYER_ORDER)[number];

const LAYER_LABELS: Record<Layer, string> = {
  existence: "Existence",
  surface:   "Surface",
  mechanism: "Mechanism",
  origin:    "Origin",
};

const TIER_ACCENT: Record<string, string> = {
  common:     "var(--text-muted)",
  informed:   "var(--accent-cyan)",
  specialist: "var(--accent-orange)",
  secret:     "var(--accent-red)",
};

interface Claim {
  tier: string;
  access_tags: string[];
  prose: string;
}

type ClaimsData = Partial<Record<Layer, Claim | Claim[]>>;

function normalizeClaims(raw: Claim | Claim[] | undefined): Claim[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && "absent" in (raw as object)) return [];
  return [raw];
}

function tierIndex(t: string): number {
  const i = (TIER_ORDER as readonly string[]).indexOf(t);
  return i === -1 ? 999 : i;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}


export class HistoryViewer {
  private container: HTMLElement | null = null;
  private data: Record<string, unknown> = {};
  private ceilingTier = "";
  private filterTag = "";
  private navigateTo: (path: string) => void = () => {};
  private currentPath: string | null = null;

  render(
    container: HTMLElement,
    data: Record<string, unknown>,
    navigateTo?: (path: string) => void,
    path?: string,
  ): void {
    this.container = container;
    this.data = data;
    this.ceilingTier = "";
    this.filterTag = "";
    this.currentPath = path ?? null;
    if (navigateTo) this.navigateTo = navigateTo;
    this.rebuild();
  }

  private allTags(): string[] {
    const claims = this.data["claims"] as ClaimsData | undefined;
    if (!claims) return [];
    const tags = new Set<string>();
    for (const layer of LAYER_ORDER) {
      for (const c of normalizeClaims(claims[layer])) {
        for (const t of c.access_tags) tags.add(t);
      }
    }
    return Array.from(tags).sort();
  }

  private rebuild(): void {
    if (!this.container) return;
    this.container.innerHTML = "";

    const wrap = el("div", "hv-wrap");
    wrap.appendChild(this.buildHeader());

    const crossRefs = this.data["cross_refs"] as Record<string, unknown[]> | undefined;
    if (crossRefs && Object.keys(crossRefs).length > 0) {
      wrap.appendChild(this.buildCrossRefs(crossRefs));
    }

    const gates = this.buildAccessGates();
    if (gates) wrap.appendChild(gates);

    wrap.appendChild(this.buildFilterBar());
    wrap.appendChild(this.buildClaims());

    this.container.appendChild(wrap);
  }

  private buildHeader(): HTMLElement {
    const header = el("div", "hv-header");
    header.appendChild(el("div", "hv-name", String(this.data["name"] ?? "")));

    const year      = this.data["year"]       != null ? String(this.data["year"])       : null;
    const yearStart = this.data["year_start"] != null ? String(this.data["year_start"]) : null;
    const yearEnd   = this.data["year_end"]   != null ? String(this.data["year_end"])   : null;
    const era  = String(this.data["era"]  ?? "");
    const type = String(this.data["type"] ?? "");

    let dateStr = "";
    if (year) {
      dateStr = `${year} ${era}`;
    } else if (yearStart || yearEnd) {
      dateStr = `${[yearStart, yearEnd].filter(Boolean).join(" – ")} ${era}`;
    }

    header.appendChild(el("div", "hv-meta", [type, dateStr].filter(Boolean).join(" · ")));
    return header;
  }

  private buildFilterBar(): HTMLElement {
    const bar = el("div", "hv-filter-bar");

    bar.appendChild(el("span", "hv-filter-label", "Tier:"));

    const tierSel = document.createElement("select");
    tierSel.className = "hv-filter-select";
    const opts: [string, string][] = [
      ["", "— all —"],
      ...TIER_ORDER.map((t): [string, string] => [t, t]),
    ];
    for (const [value, label] of opts) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === this.ceilingTier) opt.selected = true;
      tierSel.appendChild(opt);
    }
    tierSel.addEventListener("change", () => {
      this.ceilingTier = tierSel.value;
      this.rebuild();
    });
    bar.appendChild(tierSel);

    const availableTags = this.allTags();
    if (availableTags.length > 0) {
      bar.appendChild(el("span", "hv-filter-label", "Tags:"));

      const tagSel = document.createElement("select");
      tagSel.className = "hv-filter-select";
      const tagOpts: [string, string][] = [
        ["", "— all —"],
        ...availableTags.map((t): [string, string] => [t, t]),
      ];
      for (const [value, label] of tagOpts) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === this.filterTag) opt.selected = true;
        tagSel.appendChild(opt);
      }
      tagSel.addEventListener("change", () => {
        this.filterTag = tagSel.value;
        this.rebuild();
      });
      bar.appendChild(tagSel);
    }

    if (this.ceilingTier || this.filterTag !== "") {
      const reset = document.createElement("button");
      reset.className = "hv-reset";
      reset.textContent = "reset";
      reset.addEventListener("click", () => {
        this.ceilingTier = "";
        this.filterTag = "";
        this.rebuild();
      });
      bar.appendChild(reset);
    }

    return bar;
  }

  private buildClaims(): HTMLElement {
    const claims = this.data["claims"] as ClaimsData | undefined;
    const wrap = el("div", "hv-claims");

    if (!claims) {
      wrap.appendChild(el("div", "hv-empty", "no claims"));
      return wrap;
    }

    const isFiltering = this.ceilingTier !== "" || this.filterTag !== "";

    for (const layer of LAYER_ORDER) {
      const raw = claims[layer] as unknown;
      if (raw === undefined || raw === null) continue;

      // Absent sentinel — render the reason rather than skipping silently.
      if (typeof raw === "object" && !Array.isArray(raw) && "absent" in (raw as object)) {
        const layerEl = el("div", "hv-layer");
        const head = el("div", "hv-layer-head");
        head.appendChild(el("span", "hv-layer-label", LAYER_LABELS[layer]));
        layerEl.appendChild(head);
        const card = el("div", "hv-claim hv-claim--absent");
        card.appendChild(el("div", "hv-absent", (raw as { absent: string }).absent));
        layerEl.appendChild(card);
        wrap.appendChild(layerEl);
        continue;
      }

      const entries = normalizeClaims(claims[layer]);
      if (entries.length === 0) continue;

      const layerEl = el("div", "hv-layer");

      const head = el("div", "hv-layer-head");
      head.appendChild(el("span", "hv-layer-label", LAYER_LABELS[layer]));
      if (isFiltering) {
        const nVisible = entries.filter((c) => this.isVisible(c)).length;
        head.appendChild(el("span", "hv-layer-count", `${nVisible}/${entries.length}`));
      }
      layerEl.appendChild(head);

      const visible = isFiltering ? entries.filter((c) => this.isVisible(c)) : entries;
      const locked  = isFiltering ? entries.filter((c) => !this.isVisible(c)) : [];

      for (const c of visible) layerEl.appendChild(this.buildClaim(c, true));
      for (const c of locked)  layerEl.appendChild(this.buildClaim(c, false));

      wrap.appendChild(layerEl);
    }

    return wrap;
  }

  private buildClaim(claim: Claim, visible: boolean): HTMLElement {
    const accent = TIER_ACCENT[claim.tier] ?? "var(--text-muted)";
    const claimEl = el("div", visible ? "hv-claim" : "hv-claim hv-claim--locked");
    claimEl.style.borderLeftColor = visible ? accent : "var(--border-color)";

    const meta = el("div", "hv-claim-meta");

    const badge = el("span", "hv-tier-badge", claim.tier);
    badge.style.color = accent;
    badge.style.borderColor = `color-mix(in srgb, ${accent} 40%, transparent)`;
    meta.appendChild(badge);

    if (claim.access_tags.length > 0) {
      for (const tag of claim.access_tags) {
        const m = tag.match(/^@([\w-]+):([\w-]+)$/);
        if (m) {
          const type = m[1]!;
          const id = m[2]!;
          const status = this.refStatus[tag] ?? "dead";
          const badge = el("span", `hv-access-tag hv-ref--${status}`, tag);
          if (status !== "dead") {
            badge.style.cursor = "pointer";
            badge.addEventListener("click", () => this.navigateTo(this.refPath(type, id)));
          }
          meta.appendChild(badge);
        } else {
          meta.appendChild(el("span", "hv-access-tag", tag));
        }
      }
    } else {
      meta.appendChild(el("span", "hv-access-open", "all"));
    }

    if (!visible) meta.appendChild(el("span", "hv-lock", "⊘"));
    claimEl.appendChild(meta);
    if (visible) {
      const p = el("p", "hv-prose");
      const frag = renderProseWithRefs(claim.prose);
      frag.querySelectorAll<HTMLElement>(".hv-ref").forEach((badge) => {
        const type = badge.dataset.refType ?? "";
        const id   = badge.dataset.refId   ?? "";
        if (!type || !id) return;
        const key = `@${type}:${id}`;
        const status = this.refStatus[key] ?? "dead";
        badge.classList.add(`hv-ref--${status}`);
        if (status !== "dead") {
          badge.addEventListener("click", () => this.navigateTo(this.refPath(type, id)));
        }
      });
      p.appendChild(frag);
      claimEl.appendChild(p);
    }

    return claimEl;
  }

  private get refStatus(): Record<string, string> {
    return (this.data["_ref_status"] as Record<string, string>) ?? {};
  }

  private refPath(_type: string, id: string): string {
    return `${enrichedDirForPath(this.currentPath ?? "")}/${id}.json`;
  }

  private makeRefBadge(type: string, id: string): HTMLElement {
    const key = `@${type}:${id}`;
    const status = this.refStatus[key] ?? "dead";
    const badge = el("span", `hv-ref hv-ref--${status}`);
    badge.dataset.refType = type;
    badge.dataset.refId = id;
    badge.textContent = key;
    if (status !== "dead") {
      badge.addEventListener("click", () => this.navigateTo(this.refPath(type, id)));
    }
    return badge;
  }

  private buildAccessGates(): HTMLElement | null {
    const claims = this.data["claims"] as ClaimsData | undefined;
    if (!claims) return null;

    const byPred = new Map<string, string[]>();
    for (const layer of LAYER_ORDER) {
      for (const c of normalizeClaims(claims[layer])) {
        for (const tag of c.access_tags) {
          const m = tag.match(/^@([\w-]+):([\w-]+)$/);
          if (!m) continue;
          const pred = m[1]!;
          const id = m[2]!;
          if (!byPred.has(pred)) byPred.set(pred, []);
          if (!byPred.get(pred)!.includes(id)) byPred.get(pred)!.push(id);
        }
      }
    }
    if (byPred.size === 0) return null;

    const section = el("div", "hv-crossrefs");
    for (const [pred, ids] of byPred) {
      const row = el("div", "hv-crossref-row");
      row.appendChild(el("span", "hv-crossref-rel", pred.replace(/-/g, " ")));
      const wrap = el("span", "hv-crossref-targets");
      for (const id of ids) wrap.appendChild(this.makeRefBadge(pred, id));
      row.appendChild(wrap);
      section.appendChild(row);
    }
    return section;
  }

  private buildCrossRefs(crossRefs: Record<string, unknown[]>): HTMLElement {
    const section = el("div", "hv-crossrefs");
    for (const [rel, targets] of Object.entries(crossRefs)) {
      const arr = Array.isArray(targets) ? targets : [targets];
      const row = el("div", "hv-crossref-row");
      row.appendChild(el("span", "hv-crossref-rel", rel.replace(/_/g, " ")));
      const targetsWrap = el("span", "hv-crossref-targets");
      for (const target of arr) {
        const ref = parseRef(String(target));
        if (ref) {
          targetsWrap.appendChild(this.makeRefBadge(ref.type, ref.id));
        } else {
          targetsWrap.appendChild(el("span", "hv-ref", String(target)));
        }

      }
      row.appendChild(targetsWrap);
      section.appendChild(row);
    }
    return section;
  }

  private isVisible(claim: Claim): boolean {
    if (this.ceilingTier && tierIndex(claim.tier) > tierIndex(this.ceilingTier)) return false;
    if (claim.access_tags.length > 0) {
      if (this.filterTag === "") return false;
      if (!claim.access_tags.includes(this.filterTag)) return false;
    }
    return true;
  }
}
