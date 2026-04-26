/**
 * Claims viewer — layered knowledge with access-filter simulation.
 *
 * Renders the structured claims hierarchy for history events and periods.
 * A filter bar simulates what a given tier + tag combination can see:
 * passing claims are shown normally, locked claims are dimmed so the GM
 * can audit gates without losing context of what exists.
 */

import { BaseDashboardComponent } from "./base-component";
import { renderProseWithRefs, enrichedDirForPath } from "../../padarax/knowledge-refs";
import { getEntityResolver } from "../../platform/entity-resolver";

const TIER_ORDER = ["common", "informed", "specialist", "secret"] as const;

const LAYER_ORDER = ["existence", "surface", "mechanism", "origin"] as const;
type Layer = (typeof LAYER_ORDER)[number];

const LAYER_LABELS: Record<Layer, string> = {
  existence: "Existence",
  surface: "Surface",
  mechanism: "Mechanism",
  origin: "Origin",
};

const TIER_ACCENT: Record<string, string> = {
  common: "var(--text-muted)",
  informed: "var(--accent-cyan)",
  specialist: "var(--accent-orange)",
  secret: "var(--accent-red)",
};

interface Claim {
  tier: string;
  access_tags: string[];
  prose: string;
}

type ClaimsData = Partial<Record<Layer, Claim | Claim[]>>;

function normalizeClaims(raw: Claim | Claim[] | undefined): Claim[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function tierIndex(t: string): number {
  const i = (TIER_ORDER as readonly string[]).indexOf(t);
  return i === -1 ? 999 : i;
}

export class ClaimsComponent extends BaseDashboardComponent {
  private ceilingTier = "";
  private filterTags: string[] = [];

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data } = this.props;
    const record = data[0];
    if (!record) {
      this.container.appendChild(
        this.el("div", "dash-claims-empty", "no record selected"),
      );
      return;
    }

    const field = panel.fields[0] ?? "claims";
    const rawClaims = record[field] as ClaimsData | null | undefined;

    if (!rawClaims || typeof rawClaims !== "object" || Array.isArray(rawClaims)) {
      this.container.appendChild(
        this.el("div", "dash-claims-empty", "no claims data"),
      );
      return;
    }

    const shell = this.el("div", "dash-claims-shell");
    shell.appendChild(this.buildHeader(record));
    shell.appendChild(this.buildFilterBar());

    const layersEl = this.el("div", "dash-claims-layers");
    for (const layer of LAYER_ORDER) {
      const claims = normalizeClaims(rawClaims[layer]);
      if (claims.length === 0) continue;
      layersEl.appendChild(this.buildLayer(layer, claims));
    }
    shell.appendChild(layersEl);

    this.container.appendChild(shell);
  }

  private buildHeader(record: Record<string, unknown>): HTMLElement {
    const header = this.el("div", "dash-claims-header");

    header.appendChild(
      this.el("div", "dash-claims-name", String(record["name"] ?? "")),
    );

    const year = record["year"] != null ? String(record["year"]) : null;
    const yearStart = record["year_start"] != null ? String(record["year_start"]) : null;
    const yearEnd = record["year_end"] != null ? String(record["year_end"]) : null;
    const era = String(record["era"] ?? "");
    const type = String(record["type"] ?? "");

    let dateStr = "";
    if (year) {
      dateStr = `${year} ${era}`;
    } else if (yearStart || yearEnd) {
      dateStr = `${[yearStart, yearEnd].filter(Boolean).join(" – ")} ${era}`;
    }

    const meta = this.el(
      "div",
      "dash-claims-meta",
      [type, dateStr].filter(Boolean).join(" · "),
    );
    header.appendChild(meta);

    return header;
  }

  private buildFilterBar(): HTMLElement {
    const bar = this.el("div", "dash-claims-filter-bar");

    bar.appendChild(this.el("span", "dash-claims-filter-label", "Tier:"));

    const tierSel = document.createElement("select");
    tierSel.className = "dash-table-filter dash-claims-tier-sel";
    const tierOptions: [string, string][] = [
      ["", "— all —"],
      ...TIER_ORDER.map((t): [string, string] => [t, t]),
    ];
    for (const [value, label] of tierOptions) {
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

    bar.appendChild(this.el("span", "dash-claims-filter-label", "Tags:"));

    const tagsWrap = this.el("div", "dash-claims-tags-wrap");
    for (const tag of this.filterTags) {
      tagsWrap.appendChild(this.buildTagChip(tag));
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "dash-claims-tag-input";
    input.placeholder = "add tag…";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const val = input.value.trim().toLowerCase().replace(/,/g, "");
        if (val && !this.filterTags.includes(val)) {
          this.filterTags.push(val);
          this.rebuild();
        } else {
          input.value = "";
        }
      } else if (e.key === "Backspace" && input.value === "" && this.filterTags.length > 0) {
        this.filterTags.pop();
        this.rebuild();
      }
    });
    tagsWrap.appendChild(input);
    bar.appendChild(tagsWrap);

    if (this.ceilingTier || this.filterTags.length > 0) {
      const reset = document.createElement("button");
      reset.className = "dash-claims-reset";
      reset.textContent = "reset";
      reset.addEventListener("click", () => {
        this.ceilingTier = "";
        this.filterTags = [];
        this.rebuild();
      });
      bar.appendChild(reset);
    }

    return bar;
  }

  private buildTagChip(tag: string): HTMLElement {
    const chip = this.el("span", "dash-claims-tag-chip", tag);
    const remove = document.createElement("button");
    remove.className = "dash-claims-tag-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `remove ${tag}`);
    remove.addEventListener("click", () => {
      this.filterTags = this.filterTags.filter((t) => t !== tag);
      this.rebuild();
    });
    chip.appendChild(remove);
    return chip;
  }

  private buildLayer(layer: Layer, claims: Claim[]): HTMLElement {
    const isFiltering = this.ceilingTier !== "" || this.filterTags.length > 0;
    const visible = isFiltering ? claims.filter((c) => this.isVisible(c)) : claims;
    const locked = isFiltering ? claims.filter((c) => !this.isVisible(c)) : [];

    const layerEl = this.el("div", "dash-claims-layer");

    const head = this.el("div", "dash-claims-layer-head");
    head.appendChild(this.el("span", "dash-claims-layer-label", LAYER_LABELS[layer]));
    if (isFiltering) {
      head.appendChild(
        this.el("span", "dash-claims-layer-count", `${visible.length}/${claims.length}`),
      );
    }
    layerEl.appendChild(head);

    const list = this.el("div", "dash-claims-list");
    for (const c of visible) list.appendChild(this.buildClaim(c, true));
    for (const c of locked) list.appendChild(this.buildClaim(c, false));
    layerEl.appendChild(list);

    return layerEl;
  }

  private buildClaim(claim: Claim, visible: boolean): HTMLElement {
    const cls = visible ? "dash-claims-claim" : "dash-claims-claim dash-claims-claim--locked";
    const claimEl = this.el("div", cls);

    const accent = TIER_ACCENT[claim.tier] ?? "var(--text-muted)";
    claimEl.style.borderLeftColor = visible ? accent : "var(--border-color)";

    const meta = this.el("div", "dash-claims-claim-meta");

    const tierBadge = this.el("span", "dash-claims-tier-badge", claim.tier);
    tierBadge.style.color = accent;
    tierBadge.style.borderColor = `color-mix(in srgb, ${accent} 40%, transparent)`;
    meta.appendChild(tierBadge);

    if (claim.access_tags.length > 0) {
      for (const tag of claim.access_tags) {
        meta.appendChild(this.el("span", "dash-claims-access-tag", tag));
      }
    } else {
      meta.appendChild(this.el("span", "dash-claims-access-open", "all"));
    }

    if (!visible) {
      meta.appendChild(this.el("span", "dash-claims-lock", "⊘"));
    }

    claimEl.appendChild(meta);
    if (visible) {
      const proseEl = this.el("div", "dash-claims-prose");
      const refSource = String(this.props?.panel.options?.["ref_source"] ?? "");
      const currentPath = String(this.props?.data[0]?.["_file"] ?? "");
      for (const para of claim.prose.split(/\n\n+/)) {
        if (!para.trim()) continue;
        const p = document.createElement("p");
        p.appendChild(renderProseWithRefs(para));
        this.attachClaimRefHandlers(p, refSource, currentPath, this.props?.data[0] ?? {});
        proseEl.appendChild(p);
      }
      claimEl.appendChild(proseEl);
    } else {
      claimEl.appendChild(this.el("div", "dash-claims-prose", claim.prose));
    }

    return claimEl;
  }

  private attachClaimRefHandlers(
    el: HTMLElement,
    source: string,
    currentPath: string,
    record: Record<string, unknown>,
  ): void {
    const refStatus = record["_ref_status"] as Record<string, string> | undefined;
    const badges = el.querySelectorAll<HTMLElement>(".hv-ref");
    for (const badge of badges) {
      const type = badge.dataset["refType"] ?? "";
      const id   = badge.dataset["refId"] ?? "";
      if (!id) continue;

      const refKey = `@${type}:${id}`;
      if (refStatus?.[refKey] === "dead") {
        badge.classList.add("hv-ref--dead");
        continue;
      }

      let path: string | null = null;

      if (source) {
        const rows = this.props?.allData[source];
        const found = rows?.find((r) => r["id"] === id);
        if (found?._file) path = String(found._file);
      }

      if (!path) {
        const resolver = getEntityResolver();
        if (resolver) path = resolver.resolve(type, id);
      }

      if (!path && currentPath) {
        path = `${enrichedDirForPath(currentPath)}/${id}.json`;
      }

      const status = refStatus?.[refKey] ?? (path ? "resolved" : "dead");
      badge.classList.add(`hv-ref--${status}`);
      if (path) {
        badge.addEventListener("click", () => {
          this.props?.onAction({ action: "view_file", source: "", patch: { path: path! } });
        });
      }
    }
  }

  private isVisible(claim: Claim): boolean {
    if (this.ceilingTier && tierIndex(claim.tier) > tierIndex(this.ceilingTier)) {
      return false;
    }
    if (claim.access_tags.length > 0) {
      if (this.filterTags.length === 0) return false;
      if (!claim.access_tags.some((t) => this.filterTags.includes(t))) return false;
    }
    return true;
  }
}
