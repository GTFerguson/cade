/**
 * Table component — sortable columns, filterable, searchable.
 *
 * Phase 1: sort + filter + search. Inline editing deferred.
 */

import { BaseDashboardComponent } from "./base-component";

export class TableComponent extends BaseDashboardComponent {
  private sortColumn: string | null = null;
  private sortAsc = true;
  private searchQuery = "";
  private activeFilters: Record<string, string> = {};

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data } = this.props;
    const columns = panel.columns as string[];
    const wrapper = this.el("div", "dash-table-wrapper");

    // Filters bar
    if (panel.filterable.length > 0 || panel.searchable.length > 0) {
      const filtersEl = this.el("div", "dash-table-filters");

      // Search input
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

      // Filter dropdowns
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
    // Remove old table if rebuilding
    wrapper.querySelector(".dash-table")?.remove();

    const filteredData = this.getFilteredData();
    const sortedData = this.getSortedData(filteredData);

    const table = this.el("table", "dash-table");

    // Header
    const thead = this.el("thead");
    const headerRow = this.el("tr");
    for (const col of columns) {
      const th = this.el("th", undefined, col);
      if (this.props?.panel.sortable) {
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

    // Body
    const tbody = this.el("tbody");
    for (const item of sortedData) {
      const row = this.el("tr");
      const filePath = String(item["_file"] ?? "");
      if (filePath && this.props?.onAction) {
        row.classList.add("dash-table-row--clickable");
        const activate = () => {
          this.props!.onAction({
            action: "view_file",
            source: typeof this.props!.panel.source === "string" ? this.props!.panel.source : "",
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
      for (const col of columns) {
        const td = this.el("td", undefined, this.fieldValue(item, col));
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
  }

  private rebuildTable(wrapper: HTMLElement, columns: string[]): void {
    this.buildTable(wrapper, columns);
  }

  private getFilteredData(): Record<string, unknown>[] {
    if (!this.props) return [];
    let data = this.props.data;

    // Apply active filters
    for (const [field, value] of Object.entries(this.activeFilters)) {
      data = data.filter((item) => String(item[field] ?? "") === value);
    }

    // Apply search
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
