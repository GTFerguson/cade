/**
 * Generic entity detail component — renders a record as a series of
 * configurable sections declared in panel.options.sections.
 *
 * Section types are dispatched through a module-level registry. Built-ins
 * (header, key_value, prose, cross_refs, claims) are pre-registered. Host
 * applications register additional renderers via `registerSectionRenderer`.
 *
 * The `SectionContext` passed to each renderer exposes the primitives
 * needed to render against the same component conventions: element
 * helpers, field accessors, and the ref-resolution machinery used by
 * built-ins. External renderers should use these rather than
 * reimplementing resolution to keep colour-coding and navigation
 * consistent across viewers.
 */

import { BaseDashboardComponent } from "./base-component";
import { createDefaultRegistry } from "../registry";
import type { DashboardComponentProps, PanelConfig } from "../types";
import { renderProseWithRefs, parseRef } from "../../platform/refs";
import { getEntityResolver } from "../../platform/entity-resolver";

export interface SectionConfig {
  type: string;
  title?: string;
  field?: string;
  fields?: string[];
  source?: string;
  [key: string]: unknown;
}

export interface RefResolution {
  path: string | null;
  status: string;
}

export interface SectionContext {
  props: DashboardComponentProps;
  el(tag: string, className?: string, text?: string): HTMLElement;
  fieldValue(record: Record<string, unknown>, field: string): string;
  resolveRef(
    type: string,
    id: string,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): RefResolution;
  makeRefBadge(
    type: string,
    id: string,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): HTMLElement;
  attachRefHandlers(
    el: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void;
  fireViewFile(path: string): void;
  defaultRefSource(): string;
  renderSection(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
  ): void;
}

export type SectionRenderer = (
  container: HTMLElement,
  section: SectionConfig,
  record: Record<string, unknown>,
  ctx: SectionContext,
) => void;

const sectionRegistry = new Map<string, SectionRenderer>();

export function registerSectionRenderer(type: string, renderer: SectionRenderer): void {
  sectionRegistry.set(type, renderer);
}

export function getSectionRenderer(type: string): SectionRenderer | undefined {
  return sectionRegistry.get(type);
}

// --- Built-in renderers ---

const renderHeader: SectionRenderer = (container, section, record, ctx) => {
  const fields = section.fields ?? (section.field ? [section.field] : []);
  if (fields.length === 0) return;

  const header = ctx.el("div", "hv-header");

  const nameVal = ctx.fieldValue(record, fields[0]!);
  if (nameVal) header.appendChild(ctx.el("div", "hv-name", nameVal));

  const metaVals: string[] = [];
  for (const f of fields.slice(1)) {
    const v = ctx.fieldValue(record, f);
    if (v) metaVals.push(v);
  }
  if (record["stub"] === true) metaVals.push("stub");

  if (metaVals.length > 0) {
    header.appendChild(ctx.el("div", "hv-meta", metaVals.join(" · ")));
  }

  container.appendChild(header);
};

const renderKeyValue: SectionRenderer = (container, section, record, ctx) => {
  const fields = section.fields ?? (section.field ? [section.field] : []);
  const grid = ctx.el("div", "hv-kv");
  let any = false;
  for (const f of fields) {
    const val = ctx.fieldValue(record, f);
    if (!val) continue;
    const row = ctx.el("div", "hv-kv-row");
    row.appendChild(ctx.el("span", "hv-kv-label", f.replace(/_/g, " ")));
    row.appendChild(ctx.el("span", "hv-kv-value", val));
    grid.appendChild(row);
    any = true;
  }
  if (any) container.appendChild(grid);
};

const renderProse: SectionRenderer = (container, section, record, ctx) => {
  if (!section.field) return;
  const text = String(record[section.field] ?? "");
  if (!text) return;

  const wrap = ctx.el("div", "hv-prose-wrap");
  for (const para of text.split(/\n\n+/)) {
    if (!para.trim()) continue;
    const p = ctx.el("p", "hv-prose");
    p.appendChild(renderProseWithRefs(para));
    ctx.attachRefHandlers(p, section, record);
    wrap.appendChild(p);
  }
  container.appendChild(wrap);
};

const renderCrossRefs: SectionRenderer = (container, section, record, ctx) => {
  const field = section.field ?? "cross_refs";
  const crossRefs = record[field] as Record<string, unknown[]> | null | undefined;
  if (!crossRefs || typeof crossRefs !== "object") return;

  const entries = Object.entries(crossRefs).filter(([, targets]) => {
    const arr = Array.isArray(targets) ? targets : [targets];
    return arr.length > 0;
  });
  if (entries.length === 0) return;

  const wrap = ctx.el("div", "hv-crossrefs");
  for (const [rel, rawTargets] of entries) {
    const arr = Array.isArray(rawTargets) ? rawTargets : [rawTargets];
    const row = ctx.el("div", "hv-crossref-row");
    row.appendChild(ctx.el("span", "hv-crossref-rel", rel.replace(/_/g, " ")));
    const targetsWrap = ctx.el("span", "hv-crossref-targets");
    for (const target of arr) {
      const ref = parseRef(String(target));
      if (ref) {
        targetsWrap.appendChild(ctx.makeRefBadge(ref.type, ref.id, section, record));
      } else {
        targetsWrap.appendChild(ctx.el("span", "hv-ref", String(target)));
      }
    }
    row.appendChild(targetsWrap);
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
};

const renderClaims: SectionRenderer = (container, section, record, ctx) => {
  // Stub records have no claims — render a friendly note instead of an empty viewer.
  if (record["stub"] === true) {
    const notes = String(record["stub_notes"] ?? "");
    container.appendChild(ctx.el("div", "hv-empty", notes || "stub entry — no claims yet"));
    return;
  }

  const field = section.field ?? "claims";
  const claimsData = record[field];
  if (!claimsData || typeof claimsData !== "object") {
    container.appendChild(ctx.el("div", "hv-empty", "no claims"));
    return;
  }

  const effectiveSource = section.source ?? ctx.defaultRefSource();
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
    allData:  ctx.props.allData,
    config:   ctx.props.config,
    onAction: ctx.props.onAction,
  };

  const claimsHost = ctx.el("div", "hv-claims-host");
  container.appendChild(claimsHost);
  const claims = createDefaultRegistry().create("claims");
  claims.render(claimsHost, syntheticProps);
};

interface TabConfig {
  label: string;
  sections?: SectionConfig[];
}

const renderTabs: SectionRenderer = (container, section, record, ctx) => {
  const tabs = (section["tabs"] as TabConfig[] | undefined) ?? [];
  if (tabs.length === 0) return;

  const wrap = ctx.el("div", "hv-tabs");
  const strip = ctx.el("div", "hv-tab-strip");
  const panels: HTMLElement[] = [];
  const buttons: HTMLElement[] = [];

  tabs.forEach((tab, idx) => {
    const button = ctx.el("button", "hv-tab-button", tab.label);
    (button as HTMLButtonElement).type = "button";
    const panel = ctx.el("div", "hv-tab-panel");
    for (const inner of tab.sections ?? []) {
      ctx.renderSection(panel, inner, record);
    }
    button.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("hv-tab-button--active"));
      panels.forEach((p) => p.classList.remove("hv-tab-panel--active"));
      button.classList.add("hv-tab-button--active");
      panel.classList.add("hv-tab-panel--active");
    });
    if (idx === 0) {
      button.classList.add("hv-tab-button--active");
      panel.classList.add("hv-tab-panel--active");
    }
    buttons.push(button);
    panels.push(panel);
    strip.appendChild(button);
  });

  wrap.appendChild(strip);
  for (const panel of panels) wrap.appendChild(panel);
  container.appendChild(wrap);
};

registerSectionRenderer("header", renderHeader);
registerSectionRenderer("key_value", renderKeyValue);
registerSectionRenderer("prose", renderProse);
registerSectionRenderer("cross_refs", renderCrossRefs);
registerSectionRenderer("claims", renderClaims);
registerSectionRenderer("tabs", renderTabs);

// --- Component ---

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
    const ctx = this.makeContext();

    for (const section of sections) {
      this.renderSection(shell, section, record, ctx);
    }

    this.container.appendChild(shell);
  }

  private renderSection(
    container: HTMLElement,
    section: SectionConfig,
    record: Record<string, unknown>,
    ctx: SectionContext,
  ): void {
    const renderer = sectionRegistry.get(section.type);
    if (!renderer) {
      container.appendChild(
        this.el("div", "hv-unknown-section", `unknown section type: ${section.type}`),
      );
      return;
    }
    renderer(container, section, record, ctx);
  }

  private makeContext(): SectionContext {
    return {
      props: this.props!,
      el: (tag, className, text) => this.el(tag, className, text),
      fieldValue: (record, field) => this.fieldValue(record, field),
      resolveRef: (type, id, section, record) =>
        this.resolveRef(type, id, section, record),
      makeRefBadge: (type, id, section, record) =>
        this.makeRefBadge(type, id, section, record),
      attachRefHandlers: (el, section, record) =>
        this.attachRefHandlers(el, section, record),
      fireViewFile: (path) => this.fireViewFile(path),
      defaultRefSource: () => this.defaultRefSource(),
      renderSection: (container, section, record) =>
        this.renderSection(container, section, record, this.makeContext()),
    };
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
  ): RefResolution {
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
