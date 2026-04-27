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
import { renderProseWithRefs, parseRef } from "../../padarax/knowledge-refs";
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
      this.container.appendChild(this.el("div", "hv-empty", "no record selected"));
      return;
    }

    const sections = (this.props.panel.options["sections"] ?? []) as SectionConfig[];
    const shell = this.el("div", "hv-wrap");

    for (const section of sections) {
      this.renderSection(shell, section, record);
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
    if (fields.length === 0) return;

    const header = this.el("div", "hv-header");

    const nameVal = this.fieldValue(record, fields[0]!);
    if (nameVal) header.appendChild(this.el("div", "hv-name", nameVal));

    const metaVals: string[] = [];
    for (const f of fields.slice(1)) {
      const v = this.fieldValue(record, f);
      if (v) metaVals.push(v);
    }
    if (record["stub"] === true) metaVals.push("stub");

    if (metaVals.length > 0) {
      header.appendChild(this.el("div", "hv-meta", metaVals.join(" · ")));
    }

    container.appendChild(header);
  }

  private renderKeyValue(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    const fields = section.fields ?? (section.field ? [section.field] : []);
    const grid = this.el("div", "hv-kv");
    let any = false;
    for (const f of fields) {
      const val = this.fieldValue(record, f);
      if (!val) continue;
      const row = this.el("div", "hv-kv-row");
      row.appendChild(this.el("span", "hv-kv-label", f.replace(/_/g, " ")));
      row.appendChild(this.el("span", "hv-kv-value", val));
      grid.appendChild(row);
      any = true;
    }
    if (any) container.appendChild(grid);
  }

  private renderProse(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    if (!section.field) return;
    const text = String(record[section.field] ?? "");
    if (!text) return;

    const wrap = this.el("div", "hv-prose-wrap");
    for (const para of text.split(/\n\n+/)) {
      if (!para.trim()) continue;
      const p = this.el("p", "hv-prose");
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
    const crossRefs = record[field] as Record<string, unknown[]> | null | undefined;
    if (!crossRefs || typeof crossRefs !== "object") return;

    const entries = Object.entries(crossRefs).filter(([, targets]) => {
      const arr = Array.isArray(targets) ? targets : [targets];
      return arr.length > 0;
    });
    if (entries.length === 0) return;

    const wrap = this.el("div", "hv-crossrefs");
    for (const [rel, rawTargets] of entries) {
      const arr = Array.isArray(rawTargets) ? rawTargets : [rawTargets];
      const row = this.el("div", "hv-crossref-row");
      row.appendChild(
        this.el("span", "hv-crossref-rel", rel.replace(/_/g, " ")),
      );
      const targetsWrap = this.el("span", "hv-crossref-targets");
      for (const target of arr) {
        const ref = parseRef(String(target));
        if (ref) {
          targetsWrap.appendChild(this.makeRefBadge(ref.type, ref.id, section, record));
        } else {
          targetsWrap.appendChild(this.el("span", "hv-ref", String(target)));
        }
      }
      row.appendChild(targetsWrap);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  private renderClaims(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void {
    // Stub records have no claims — render a friendly note instead of an empty viewer.
    if (record["stub"] === true) {
      const notes = String(record["stub_notes"] ?? "");
      const stubEl = this.el("div", "hv-empty", notes || "stub entry — no claims yet");
      container.appendChild(stubEl);
      return;
    }

    const field = section.field ?? "claims";
    const claimsData = record[field];
    if (!claimsData || typeof claimsData !== "object") {
      container.appendChild(this.el("div", "hv-empty", "no claims"));
      return;
    }

    const effectiveSource = section.source ?? this.defaultRefSource();
    const syntheticPanel: PanelConfig = {
      component: "claims",
      fields:      [field],
      columns:     [],
      badges:      [],
      filter:      {},
      filterable:  [],
      searchable:  [],
      inline_edit: [],
      sortable:    false,
      options:     { ref_source: effectiveSource, render_header: false },
      extra:       {},
    };

    const syntheticProps: DashboardComponentProps = {
      panel:    syntheticPanel,
      data:     [record],
      allData:  this.props!.allData,
      config:   this.props!.config,
      onAction: this.props!.onAction,
    };

    const claimsHost = this.el("div", "hv-claims-host");
    container.appendChild(claimsHost);
    const claims = createDefaultRegistry().create("claims");
    claims.render(claimsHost, syntheticProps);
  }

  // --- Ref resolution ---

  private makeRefBadge(
    type: string,
    id: string,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): HTMLElement {
    const { path, status } = this.resolveRef(type, id, section, record);
    const badge = this.el("span", `hv-ref hv-ref--${status}`, `@${type}:${id}`);
    if (path && status !== "dead") {
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
    const refKey = `@${type}:${id}`;
    const refStatus = record["_ref_status"] as Record<string, string> | undefined;
    const preComputed = refStatus?.[refKey];
    if (preComputed === "dead") return { path: null, status: "dead" };

    const source = section.source ?? this.defaultRefSource();
    if (source) {
      const rows = this.props!.allData[source];
      if (rows) {
        const found = rows.find((r) => r["id"] === id);
        if (found?._file) {
          return { path: String(found._file), status: preComputed ?? "resolved" };
        }
      }
    }

    const resolver = getEntityResolver();
    if (resolver) {
      const resolved = resolver.resolve(type, id);
      if (resolved) return { path: resolved, status: preComputed ?? "resolved" };
    }

    return { path: null, status: preComputed ?? "dead" };
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
      if (path && status !== "dead") {
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
