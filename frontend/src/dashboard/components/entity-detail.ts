/**
 * Generic entity detail component — renders a record as a series of
 * configurable sections declared in panel.options.sections.
 *
 * Designed to replace bespoke per-content-type viewers. The sections
 * config in YAML drives layout; no TypeScript changes are needed for
 * new content types.
 *
 * Section types: header | key_value | prose | cross_refs | claims
 */

import { BaseDashboardComponent } from "./base-component";
import { createDefaultRegistry } from "../registry";
import type { DashboardComponentProps, PanelConfig } from "../types";
import { renderProseWithRefs } from "../../padarax/knowledge-refs";
import { getEntityResolver } from "../../platform/entity-resolver";

interface SectionConfig {
  type: "header" | "key_value" | "prose" | "cross_refs" | "claims";
  title?: string;
  field?: string;
  fields?: string[];
  source?: string;
}

export class EntityDetailComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;

    const record = this.props.data[0];
    if (!record) {
      this.container.appendChild(this.el("div", "ded-empty", "no record selected"));
      return;
    }

    const sections = (this.props.panel.options["sections"] ?? []) as SectionConfig[];
    const shell = this.el("div", "ded-shell");

    for (const section of sections) {
      const wrap = this.el("div", `ded-section ded-section--${section.type}`);
      if (section.title) {
        wrap.appendChild(this.el("div", "ded-section-title", section.title));
      }
      this.renderSection(wrap, section, record);
      shell.appendChild(wrap);
    }

    this.container.appendChild(shell);
  }

  private renderSection(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    switch (section.type) {
      case "header":     this.renderHeader(container, section, record); break;
      case "key_value":  this.renderKeyValue(container, section, record); break;
      case "prose":      this.renderProse(container, section, record); break;
      case "cross_refs": this.renderCrossRefs(container, section, record); break;
      case "claims":     this.renderClaims(container, section, record); break;
    }
  }

  // --- Section renderers ---

  private renderHeader(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    const fields = section.fields ?? (section.field ? [section.field] : []);
    const strip = this.el("div", "ded-header");
    let first = true;
    for (const f of fields) {
      const val = this.fieldValue(record, f);
      if (!val) continue;
      strip.appendChild(this.el("span", first ? "ded-header-name" : "ded-header-meta", val));
      first = false;
    }
    container.appendChild(strip);
  }

  private renderKeyValue(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    const fields = section.fields ?? (section.field ? [section.field] : []);
    const grid = this.el("div", "ded-kv");
    for (const f of fields) {
      const val = this.fieldValue(record, f);
      if (!val) continue;
      const row = this.el("div", "ded-kv-row");
      row.appendChild(this.el("span", "ded-kv-label", f.replace(/_/g, " ")));
      row.appendChild(this.el("span", "ded-kv-value", val));
      grid.appendChild(row);
    }
    container.appendChild(grid);
  }

  private renderProse(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    if (!section.field) return;
    const text = String(record[section.field] ?? "");
    if (!text) return;

    const wrap = this.el("div", "ded-prose");
    for (const para of text.split(/\n\n+/)) {
      if (!para.trim()) continue;
      const p = document.createElement("p");
      p.appendChild(renderProseWithRefs(para));
      this.attachRefHandlers(p, section, record);
      wrap.appendChild(p);
    }
    container.appendChild(wrap);
  }

  private renderCrossRefs(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    const field = section.field ?? "cross_refs";
    const crossRefs = record[field] as Record<string, string[]> | null | undefined;
    if (!crossRefs || typeof crossRefs !== "object") return;

    const entries = Object.entries(crossRefs).filter(([, ids]) => ids.length > 0);
    if (entries.length === 0) return;

    const wrap = this.el("div", "ded-crossrefs");
    for (const [rel, ids] of entries) {
      const group = this.el("div", "ded-crossrefs-group");
      group.appendChild(
        this.el("span", "ded-crossrefs-rel", rel.replace(/_/g, " ")),
      );
      const badges = this.el("span", "ded-crossrefs-badges");
      for (const rawId of ids) {
        const badge = this.makeCrossRefBadge(rawId, section, record);
        badges.appendChild(badge);
      }
      group.appendChild(badges);
      wrap.appendChild(group);
    }
    container.appendChild(wrap);
  }

  private renderClaims(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    const effectiveSource = section.source ?? this.defaultRefSource();
    const syntheticPanel: PanelConfig = {
      component: "claims",
      fields:      [section.field ?? "claims"],
      columns:     [],
      badges:      [],
      filter:      {},
      filterable:  [],
      searchable:  [],
      inline_edit: [],
      sortable:    false,
      options:     { ref_source: effectiveSource },
      extra:       {},
    };

    const syntheticProps: DashboardComponentProps = {
      panel:    syntheticPanel,
      data:     [record],
      allData:  this.props!.allData,
      config:   this.props!.config,
      onAction: this.props!.onAction,
    };

    const claims = createDefaultRegistry().create("claims");
    claims.render(container, syntheticProps);
  }

  // --- Ref resolution helpers ---

  private makeCrossRefBadge(
    rawId: string,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): HTMLElement {
    // rawId may be "type:id" or just "id"
    const colonIdx = rawId.indexOf(":");
    const type = colonIdx !== -1 ? rawId.slice(0, colonIdx) : "";
    const id   = colonIdx !== -1 ? rawId.slice(colonIdx + 1) : rawId;

    const { path, status } = this.resolveRef(type, id, section, record);

    const badge = this.el("span", `ded-ref ded-ref--${status}`, rawId);
    if (path) {
      badge.addEventListener("click", () => this.fireViewFile(path));
    }
    return badge;
  }

  private resolveRef(
    type: string,
    id: string,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): { path: string | null; status: string } {
    // 1. Pre-computed status from enricher
    const refKey = type ? `@${type}:${id}` : id;
    const refStatus = record["_ref_status"] as Record<string, string> | undefined;
    if (refStatus?.[refKey] === "dead") return { path: null, status: "dead" };

    // 2. allData lookup by entity id
    const source = section.source ?? this.defaultRefSource();
    if (source) {
      const rows = this.props!.allData[source];
      if (rows) {
        const found = rows.find((r) => r["id"] === id);
        if (found?._file) {
          return { path: String(found._file), status: refStatus?.[refKey] ?? "resolved" };
        }
      }
    }

    // 3. EntityResolver (registered by Padarax at startup)
    const resolver = getEntityResolver();
    if (resolver) {
      const resolved = resolver.resolve(type, id);
      if (resolved) return { path: resolved, status: "resolved" };
    }

    // 4. Dead if nothing found
    return { path: null, status: "dead" };
  }

  private attachRefHandlers(
    el: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    const badges = el.querySelectorAll<HTMLElement>(".hv-ref");
    for (const badge of badges) {
      const type = badge.dataset["refType"] ?? "";
      const id   = badge.dataset["refId"] ?? "";
      if (!id) continue;

      const { path, status } = this.resolveRef(type, id, section, record);
      badge.classList.add(`hv-ref--${status}`);
      if (path) {
        badge.addEventListener("click", () => this.fireViewFile(path));
      }
    }
  }

  private fireViewFile(path: string): void {
    this.props!.onAction({ action: "view_file", source: "", patch: { path } });
  }

  private defaultRefSource(): string {
    return String(this.props?.panel.options["ref_source"] ?? "");
  }
}
