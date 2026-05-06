/**
 * Table component — sortable columns, filterable, searchable,
 * inline-editable cells and expandable detail rows.
 */

import { BaseDashboardComponent } from "./base-component";
import type { EntityConfig, PanelConfig } from "../types";

interface ExpandableConfig {
  fields?: string[];
  editable?: string[];
}

export class TableComponent extends BaseDashboardComponent {
  private sortColumn: string | null = null;
  private sortAsc = true;
  private searchQuery = "";
  private activeFilters: Record<string, string> = {};
  private expandedRows = new Set<string>();

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data } = this.props;
    const columns = panel.columns as string[];
    const wrapper = this.el("div", "dash-table-wrapper");

    if (panel.filterable.length > 0 || panel.searchable.length > 0) {
      const filtersEl = this.el("div", "dash-table-filters");

      if (panel.searchable.length > 0) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "dash-table-search";
        input.placeholder = `Search ${panel.searchable.join(", ")}...`;
        input.value = this.searchQuery;
        input.addEventListener("input", () => {
          this.searchQuery = input.value.toLowerCase();
          this.rebuildTable(wrapper, columns);
        });
        filtersEl.appendChild(input);
      }

      for (const filterField of panel.filterable) {
        const values = this.uniqueValues(data, filterField);
        const select = document.createElement("select");
        select.className = "dash-table-filter";
        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = `All ${filterField}`;
        select.appendChild(allOption);
        for (const v of values) {
          const option = document.createElement("option");
          option.value = v;
          option.textContent = v;
          if (this.activeFilters[filterField] === v) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener("change", () => {
          if (select.value) {
            this.activeFilters[filterField] = select.value;
          } else {
            delete this.activeFilters[filterField];
          }
          this.rebuildTable(wrapper, columns);
        });
        filtersEl.appendChild(select);
      }

      wrapper.appendChild(filtersEl);
    }

    this.buildTable(wrapper, columns);
    this.container.appendChild(wrapper);
  }

  private buildTable(wrapper: HTMLElement, columns: string[]): void {
    wrapper.querySelector(".dash-table")?.remove();

    if (!this.props) return;
    const panel = this.props.panel;
    const expandable = panel.expandable as ExpandableConfig | undefined;
    const inlineEditable = new Set(panel.inline_edit ?? []);

    const filteredData = this.getFilteredData();
    const sortedData = this.getSortedData(filteredData);

    const table = this.el("table", "dash-table");

    // Header
    const thead = this.el("thead");
    const headerRow = this.el("tr");
    if (expandable) {
      headerRow.appendChild(this.el("th", "dash-table-expand-cell"));
    }
    for (const col of columns) {
      const th = this.el("th", undefined, col);
      if (panel.sortable) {
        if (this.sortColumn === col) {
          const indicator = this.el("span", "dash-sort-indicator", this.sortAsc ? "▴" : "▾");
          th.appendChild(indicator);
        }
        th.addEventListener("click", () => {
          if (this.sortColumn === col) {
            this.sortAsc = !this.sortAsc;
          } else {
            this.sortColumn = col;
            this.sortAsc = true;
          }
          this.rebuildTable(wrapper, columns);
        });
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const totalCols = columns.length + (expandable ? 1 : 0);
    const tbody = this.el("tbody");
    for (const item of sortedData) {
      const rowKey = String(item["id"] ?? `${item["_file"] ?? ""}`);
      const row = this.el("tr");
      const filePath = String(item["_file"] ?? "");

      // Whole-row click navigates to the underlying file when one is
      // present and there's no expandable detail (which would conflict).
      if (filePath && !expandable) {
        row.classList.add("dash-table-row--clickable");
        const activate = () => {
          this.emitAction({
            action: "view_file",
            entityId: String(item["id"] ?? ""),
            patch: { path: filePath },
          });
        };
        row.addEventListener("click", activate);
        row.addEventListener("keydown", (e: Event) => {
          const key = (e as KeyboardEvent).key;
          if (key === "Enter" || key === " ") { e.preventDefault(); activate(); }
        });
        row.setAttribute("tabindex", "0");
        row.setAttribute("role", "button");
      }

      if (expandable) {
        const td = this.el("td", "dash-table-expand-cell");
        const btn = this.el(
          "button",
          "dash-table-expand-toggle",
          this.expandedRows.has(rowKey) ? "▾" : "▸",
        );
        btn.setAttribute("aria-label", "Toggle row details");
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.expandedRows.has(rowKey)) {
            this.expandedRows.delete(rowKey);
          } else {
            this.expandedRows.add(rowKey);
          }
          this.rebuildTable(wrapper, columns);
        });
        td.appendChild(btn);
        row.appendChild(td);
      }

      for (const col of columns) {
        const td = this.el("td");
        if (inlineEditable.has(col)) {
          td.appendChild(this.buildEditor(item, col));
        } else {
          td.textContent = this.fieldValue(item, col);
        }
        row.appendChild(td);
      }
      tbody.appendChild(row);

      if (expandable && this.expandedRows.has(rowKey)) {
        tbody.appendChild(this.buildDetailRow(item, expandable, totalCols));
      }
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
  }

  private buildEditor(
    item: Record<string, unknown>,
    field: string,
  ): HTMLElement {
    const current = item[field];
    const entity = this.entityForSource();

    // Status fields with declared enum → select.
    if (field === "status" && entity && entity.statuses.length > 0) {
      const select = document.createElement("select");
      select.className = "dash-table-edit dash-table-edit--select";
      for (const opt of entity.statuses) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (String(current ?? "") === opt) o.selected = true;
        select.appendChild(o);
      }
      select.addEventListener("click", (e) => e.stopPropagation());
      select.addEventListener("change", () => {
        this.patchEntity(item, { [field]: select.value });
      });
      return select;
    }

    // Numeric fields → number input.
    const isNumeric = typeof current === "number";
    const input = document.createElement("input");
    input.type = isNumeric ? "number" : "text";
    input.className = "dash-table-edit dash-table-edit--input";
    input.value = current == null ? "" : String(current);
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e: Event) => {
      const key = (e as KeyboardEvent).key;
      if (key === "Enter") { e.preventDefault(); input.blur(); }
    });
    input.addEventListener("change", () => {
      const raw = input.value;
      const next: unknown = isNumeric && raw !== "" ? Number(raw) : raw;
      this.patchEntity(item, { [field]: next });
    });
    return input;
  }

  private buildDetailRow(
    item: Record<string, unknown>,
    expandable: ExpandableConfig,
    colspan: number,
  ): HTMLElement {
    const tr = this.el("tr", "dash-table-detail-row");
    const td = this.el("td", "dash-table-detail-cell");
    td.setAttribute("colspan", String(colspan));

    const editable = new Set(expandable.editable ?? []);
    const fields = expandable.fields ?? [];
    const grid = this.el("dl", "dash-table-detail-grid");
    for (const field of fields) {
      const dt = this.el("dt", "dash-table-detail-key", field);
      const dd = this.el("dd", "dash-table-detail-value");
      if (editable.has(field)) {
        const ta = document.createElement("textarea");
        ta.className = "dash-table-detail-textarea";
        ta.value = String(item[field] ?? "");
        ta.rows = 4;
        ta.addEventListener("click", (e) => e.stopPropagation());
        ta.addEventListener("blur", () => {
          if (ta.value !== String(item[field] ?? "")) {
            this.patchEntity(item, { [field]: ta.value });
          }
        });
        dd.appendChild(ta);
      } else {
        dd.textContent = this.fieldValue(item, field);
      }
      grid.appendChild(dt);
      grid.appendChild(dd);
    }
    td.appendChild(grid);
    tr.appendChild(td);
    return tr;
  }

  private patchEntity(
    item: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): void {
    this.emitAction({
      action: "patch",
      entityId: String(item["id"] ?? ""),
      patch,
    });
  }

  private emitAction(partial: {
    action: string;
    entityId?: string;
    patch?: Record<string, unknown>;
  }): void {
    if (!this.props) return;
    const sourceName =
      typeof this.props.panel.source === "string" ? this.props.panel.source : "";
    this.props.onAction({
      source: sourceName,
      ...partial,
    });
  }

  private entityForSource(): EntityConfig | undefined {
    if (!this.props) return undefined;
    const panel = this.props.panel as PanelConfig;
    const sourceName = typeof panel.source === "string" ? panel.source : "";
    if (!sourceName) return undefined;
    const src = this.props.config.data_sources[sourceName];
    return src?.entity;
  }

  private rebuildTable(wrapper: HTMLElement, columns: string[]): void {
    this.buildTable(wrapper, columns);
  }

  private getFilteredData(): Record<string, unknown>[] {
    if (!this.props) return [];
    let data = this.props.data;

    for (const [field, value] of Object.entries(this.activeFilters)) {
      data = data.filter((item) => String(item[field] ?? "") === value);
    }

    if (this.searchQuery && this.props.panel.searchable.length > 0) {
      const fields = this.props.panel.searchable;
      data = data.filter((item) =>
        fields.some((f) =>
          String(item[f] ?? "").toLowerCase().includes(this.searchQuery),
        ),
      );
    }

    return data;
  }

  private getSortedData(data: Record<string, unknown>[]): Record<string, unknown>[] {
    if (!this.sortColumn) return data;
    const col = this.sortColumn;
    const asc = this.sortAsc;
    return [...data].sort((a, b) => {
      const va = String(a[col] ?? "");
      const vb = String(b[col] ?? "");
      const cmp = va.localeCompare(vb, undefined, { numeric: true });
      return asc ? cmp : -cmp;
    });
  }

  private uniqueValues(data: Record<string, unknown>[], field: string): string[] {
    const set = new Set<string>();
    for (const item of data) {
      const v = item[field];
      if (v != null) set.add(String(v));
    }
    return [...set].sort();
  }
}
