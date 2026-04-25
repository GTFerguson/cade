/**
 * Card grid/list component.
 *
 * Optional config:
 *   panel.detail        — { component, ...componentPanelConfig }
 *                         Renders this component inline below a card when
 *                         it's expanded. The card body becomes data[0]
 *                         for the detail component. A chevron icon hints
 *                         at expansion; clicking anywhere on the card
 *                         toggles it.
 *   panel.options.on_favourite — { action, message? }
 *                         When set, the badge whose field is named in
 *                         panel.extra.favourite_field (default
 *                         "favourite") becomes a clickable star toggle.
 *                         Click emits the action with the row's id and
 *                         the flipped favourite value spliced into the
 *                         message template (provider_message convention).
 *   panel.extra.page_size — number
 *                         When set, cards are paginated: the first
 *                         page_size items are shown with a "Load more"
 *                         button below. Search and filter always operate
 *                         on the full (limit-capped) dataset; only the
 *                         visible slice is rendered. State (expanded,
 *                         search query, filters, page) persists across
 *                         data pushes so live updates don't reset the UI.
 */

import { BaseDashboardComponent } from "./base-component";
import { createDefaultRegistry } from "../registry";

export class CardsComponent extends BaseDashboardComponent {
  // Per-instance set of expanded card ids — preserved across re-renders
  // so a push that updates the source doesn't collapse what the user
  // had open. Keyed by item.id, falling back to row index when absent.
  private expanded = new Set<string>();

  private searchQuery = "";
  private activeFilters: Record<string, string> = {};
  // -1 = uninitialised; set to pageSize on first build, then preserved.
  private visibleCount = -1;

  // Stable container for the cards grid + footer. Controls live outside
  // this element so they survive rebuildCards() without losing focus.
  private cardsHost: HTMLElement | null = null;

  protected rebuild(): void {
    // Null out cardsHost so build() recreates it inside the fresh DOM.
    this.cardsHost = null;
    super.rebuild();
  }

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel } = this.props;

    const pageSize =
      typeof panel.extra?.["page_size"] === "number" &&
      (panel.extra["page_size"] as number) > 0
        ? (panel.extra["page_size"] as number)
        : 0;

    if (pageSize > 0 && this.visibleCount < 0) {
      this.visibleCount = pageSize;
    }

    const favouriteField =
      typeof panel.extra?.["favourite_field"] === "string"
        ? (panel.extra["favourite_field"] as string)
        : "favourite";

    // Honour ``limit:`` from the panel config — overview panels use this
    // to hard-cap the record set before search/filter/pagination runs.
    const limited =
      typeof panel.limit === "number" && panel.limit > 0
        ? this.props.data.slice(0, panel.limit)
        : this.props.data;

    // ── Search / filter controls ──────────────────────────────────────
    // Rendered once per full build, outside cardsHost. Search/filter
    // changes call rebuildCards() which only replaces cardsHost contents,
    // leaving the controls DOM (and any focused input) untouched.
    const hasSearch = panel.searchable.length > 0;
    const hasFilter = panel.filterable.length > 0;

    if (hasSearch || hasFilter) {
      const controls = this.el("div", "dash-cards-controls");

      if (hasSearch) {
        const input = document.createElement("input") as HTMLInputElement;
        input.type = "text";
        input.className = "dash-cards-search";
        input.placeholder = "Search…";
        input.value = this.searchQuery;
        input.setAttribute("aria-label", "Search");
        input.addEventListener("input", () => {
          this.searchQuery = input.value.toLowerCase();
          if (pageSize > 0) this.visibleCount = pageSize;
          this.rebuildCards();
        });
        controls.appendChild(input);
      }

      for (const field of panel.filterable) {
        if (field === favouriteField) {
          const isOn = this.activeFilters[field] === "true";
          const btn = this.el(
            "button",
            `dash-cards-filter-toggle${isOn ? " dash-cards-filter-toggle--on" : ""}`,
            isOn ? "★ Starred" : "☆ Starred",
          );
          btn.setAttribute("type", "button");
          btn.addEventListener("click", () => {
            if (this.activeFilters[field] === "true") {
              delete this.activeFilters[field];
            } else {
              this.activeFilters[field] = "true";
            }
            // Update button appearance in-place — avoids a full rebuild
            // just to flip a button class.
            const wasOn = btn.classList.contains("dash-cards-filter-toggle--on");
            btn.classList.toggle("dash-cards-filter-toggle--on", !wasOn);
            btn.textContent = !wasOn ? "★ Starred" : "☆ Starred";
            if (pageSize > 0) this.visibleCount = pageSize;
            this.rebuildCards();
          });
          controls.appendChild(btn);
        } else {
          const values = [
            ...new Set(
              limited
                .map((item) => String(item[field] ?? ""))
                .filter(Boolean),
            ),
          ].sort();
          if (values.length > 1) {
            const select = document.createElement(
              "select",
            ) as HTMLSelectElement;
            select.className = "dash-cards-filter";
            select.setAttribute("aria-label", `Filter by ${field}`);
            const allOpt = document.createElement("option");
            allOpt.value = "";
            allOpt.textContent = `All ${field}`;
            select.appendChild(allOpt);
            for (const v of values) {
              const opt = document.createElement("option");
              opt.value = v;
              opt.textContent = v;
              if (this.activeFilters[field] === v) opt.selected = true;
              select.appendChild(opt);
            }
            select.addEventListener("change", () => {
              if (select.value) {
                this.activeFilters[field] = select.value;
              } else {
                delete this.activeFilters[field];
              }
              if (pageSize > 0) this.visibleCount = pageSize;
              this.rebuildCards();
            });
            controls.appendChild(select);
          }
        }
      }

      this.container.appendChild(controls);
    }

    // ── Cards host ────────────────────────────────────────────────────
    this.cardsHost = this.el("div", "dash-cards-host");
    this.container.appendChild(this.cardsHost);
    this.buildCardsInto(this.cardsHost, limited, pageSize, favouriteField);
  }

  // Rebuild only the cards + footer, leaving controls untouched.
  private rebuildCards(): void {
    if (!this.cardsHost || !this.props) return;
    const { panel } = this.props;
    const pageSize =
      typeof panel.extra?.["page_size"] === "number" &&
      (panel.extra["page_size"] as number) > 0
        ? (panel.extra["page_size"] as number)
        : 0;
    const favouriteField =
      typeof panel.extra?.["favourite_field"] === "string"
        ? (panel.extra["favourite_field"] as string)
        : "favourite";
    const limited =
      typeof panel.limit === "number" && panel.limit > 0
        ? this.props.data.slice(0, panel.limit)
        : this.props.data;
    this.cardsHost.innerHTML = "";
    this.buildCardsInto(this.cardsHost, limited, pageSize, favouriteField);
  }

  private buildCardsInto(
    host: HTMLElement,
    limited: Record<string, unknown>[],
    pageSize: number,
    favouriteField: string,
  ): void {
    if (!this.props) return;
    const { panel, onAction } = this.props;
    const layout = panel.layout ?? "grid";

    // ── Apply search + filter ─────────────────────────────────────────
    let filtered = limited;

    for (const [field, value] of Object.entries(this.activeFilters)) {
      filtered = filtered.filter(
        (item) => String(item[field] ?? "") === value,
      );
    }

    if (this.searchQuery && panel.searchable.length > 0) {
      const q = this.searchQuery;
      filtered = filtered.filter((item) =>
        panel.searchable.some((f) =>
          String(item[f] ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    }

    // ── Sort ─────────────────────────────────────────────────────────
    const sortCfg = panel.extra?.["sort"] as
      | { field?: string; order?: string }
      | undefined;
    if (sortCfg?.field) {
      const sf = sortCfg.field;
      const asc = sortCfg.order !== "desc";
      filtered = [...filtered].sort((a, b) => {
        const av = String(a[sf] ?? "");
        const bv = String(b[sf] ?? "");
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    // ── Paginate ──────────────────────────────────────────────────────
    const visible =
      pageSize > 0 ? filtered.slice(0, this.visibleCount) : filtered;
    const hasMore = pageSize > 0 && filtered.length > this.visibleCount;

    // ── Render cards ──────────────────────────────────────────────────
    const wrapper = this.el("div", `dash-cards dash-cards--${layout}`);
    wrapper.setAttribute("role", "list");

    const titleField = panel.fields[0];
    const groupByField =
      typeof panel.extra?.["group_by"] === "string"
        ? (panel.extra["group_by"] as string)
        : null;

    const preview = panel.extra?.["inline_preview"] as
      | Record<string, unknown>
      | undefined;

    const groups: Array<{ label: string | null; items: typeof visible }> =
      groupByField
        ? (() => {
            const map = new Map<string, typeof visible>();
            for (const item of visible) {
              const key = String(item[groupByField] ?? "");
              if (!map.has(key)) map.set(key, []);
              map.get(key)!.push(item);
            }
            const result: Array<{
              label: string | null;
              items: typeof visible;
            }> = [];
            if (map.has(""))
              result.push({ label: null, items: map.get("")! });
            for (const [key, items] of map) {
              if (key !== "") result.push({ label: key, items });
            }
            return result;
          })()
        : [{ label: null, items: visible }];

    for (const group of groups) {
      if (group.label !== null) {
        const header = this.el("h5", "dash-cards-group-header", group.label);
        wrapper.appendChild(header);
      }
      for (const item of group.items) {
        const card = this.el("article", "dash-card");

        if (preview) {
          const previewComponent = String(preview["component"] ?? "");
          const previewField = preview["field"]
            ? String(preview["field"])
            : null;
          if (previewComponent) {
            const val = previewField ? item[previewField] : item;
            if (val != null) {
              const previewData =
                typeof val === "object" && !Array.isArray(val)
                  ? [val as Record<string, unknown>]
                  : [{ content: String(val) }];
              const previewEl = this.el("div", "dash-card-preview");
              card.appendChild(previewEl);
              const registry = createDefaultRegistry();
              if (registry.has(previewComponent)) {
                try {
                  const comp = registry.create(previewComponent);
                  comp.render(previewEl, {
                    panel: {
                      component: previewComponent,
                      fields: [],
                      columns: [],
                      badges: [],
                      filter: {},
                      sortable: false,
                      filterable: [],
                      searchable: [],
                      inline_edit: [],
                      options:
                        (preview["options"] as Record<string, unknown>) ?? {},
                      extra: {},
                    },
                    data: previewData,
                    allData: this.props!.allData,
                    config: this.props!.config,
                    onAction: this.props!.onAction,
                  });
                } catch {
                  // Silently skip failed previews
                }
              }
              card.appendChild(document.createElement("hr"));
            }
          }
        }

        let firstFieldRendered = false;
        for (const field of panel.fields) {
          const val = this.fieldValue(item, field);
          if (!val) continue;
          if (!firstFieldRendered) {
            card.appendChild(this.el("h4", "dash-card-title", val));
            firstFieldRendered = true;
          } else {
            card.appendChild(this.el("div", "dash-card-field", val));
          }
        }

        const onFavourite = panel.options?.["on_favourite"] as
          | { action: string; message?: Record<string, unknown> }
          | undefined;

        if (panel.badges.length > 0) {
          const badgesEl = this.el("div", "dash-card-badges");
          badgesEl.setAttribute("role", "list");
          badgesEl.setAttribute("aria-label", "tags");
          for (const badgeField of panel.badges) {
            if (onFavourite && badgeField === favouriteField) {
              const isFav = Boolean(item[favouriteField]);
              const star = this.el(
                "button",
                `dash-card-favourite${isFav ? " dash-card-favourite--on" : ""}`,
                isFav ? "★" : "☆",
              );
              star.setAttribute("type", "button");
              star.setAttribute(
                "aria-label",
                isFav ? "unfavourite" : "favourite",
              );
              star.setAttribute("role", "listitem");
              star.addEventListener("click", (e: Event) => {
                e.stopPropagation();
                const message = {
                  ...(onFavourite.message ?? {}),
                  event_id: item["id"],
                  body_md: String(item["_notes"] ?? ""),
                  favourite: !isFav,
                };
                onAction({
                  action: onFavourite.action,
                  source:
                    typeof panel.source === "string" ? panel.source : "",
                  entityId: String(item["id"] ?? ""),
                  message,
                });
              });
              badgesEl.appendChild(star);
              continue;
            }
            const val = this.fieldValue(item, badgeField);
            if (val) {
              const b = this.badge(val, badgeField);
              b.setAttribute("role", "listitem");
              badgesEl.appendChild(b);
            }
          }
          card.appendChild(badgesEl);
        }

        const detailCfg = panel.detail;
        if (detailCfg && typeof detailCfg["component"] === "string") {
          const cardKey = String(item["id"] ?? "");
          const isOpen = cardKey ? this.expanded.has(cardKey) : false;
          const chevron = this.el(
            "span",
            `dash-card-chevron${isOpen ? " dash-card-chevron--open" : ""}`,
            isOpen ? "▾" : "▸",
          );
          chevron.setAttribute("aria-hidden", "true");
          card.appendChild(chevron);

          card.setAttribute("role", "button");
          card.setAttribute("tabindex", "0");
          card.setAttribute("aria-expanded", isOpen ? "true" : "false");
          card.style.cursor = "pointer";

          const detailEl = this.el("div", "dash-card-detail");
          if (isOpen) {
            this.renderDetail(detailEl, detailCfg, item);
            card.appendChild(detailEl);
          }

          const toggle = () => {
            if (!cardKey) return;
            if (this.expanded.has(cardKey)) {
              this.expanded.delete(cardKey);
              card.setAttribute("aria-expanded", "false");
              chevron.classList.remove("dash-card-chevron--open");
              chevron.textContent = "▸";
              detailEl.replaceChildren();
              if (detailEl.parentElement === card) card.removeChild(detailEl);
            } else {
              this.expanded.add(cardKey);
              card.setAttribute("aria-expanded", "true");
              chevron.classList.add("dash-card-chevron--open");
              chevron.textContent = "▾";
              this.renderDetail(detailEl, detailCfg, item);
              card.appendChild(detailEl);
            }
          };
          card.addEventListener("click", (e: Event) => {
            if ((e.target as HTMLElement).closest(".dash-card-detail")) return;
            toggle();
          });
          card.addEventListener("keydown", (e: Event) => {
            const key = (e as KeyboardEvent).key;
            if (key === "Enter" || key === " ") {
              e.preventDefault();
              toggle();
            }
          });
          wrapper.appendChild(card);
          continue;
        }

        const filePath = String(item["_file"] ?? "");
        const url = String(item["url"] ?? "");
        const titleText = titleField ? this.fieldValue(item, titleField) : "";

        if (filePath) {
          card.setAttribute("role", "button");
          card.setAttribute("tabindex", "0");
          card.setAttribute(
            "aria-label",
            titleText ? `${titleText} — open` : "open file",
          );
          card.style.cursor = "pointer";

          const vfp = panel.extra?.["view_file_preview"] as
            | Record<string, unknown>
            | undefined;
          const previewPatch: Record<string, unknown> = {};
          if (vfp) {
            const previewField = vfp["field"] ? String(vfp["field"]) : null;
            const previewComponent = String(vfp["component"] ?? "");
            const previewData = previewField ? item[previewField] : null;
            if (previewComponent && previewData != null) {
              previewPatch["preview"] = {
                component: previewComponent,
                data: previewData,
              };
            }
          }

          const activate = () => {
            onAction({
              action: "view_file",
              source: typeof panel.source === "string" ? panel.source : "",
              entityId: String(item["id"] ?? ""),
              patch: { path: filePath, ...previewPatch },
            });
          };
          card.addEventListener("click", activate);
          card.addEventListener("keydown", (e: Event) => {
            const key = (e as KeyboardEvent).key;
            if (key === "Enter" || key === " ") {
              e.preventDefault();
              activate();
            }
          });
        } else if (url) {
          card.setAttribute("role", "link");
          card.setAttribute("tabindex", "0");
          card.setAttribute(
            "aria-label",
            titleText ? `${titleText} — open external` : "open external link",
          );
          card.style.cursor = "pointer";
          const activate = () => {
            window.open(url, "_blank");
          };
          card.addEventListener("click", activate);
          card.addEventListener("keydown", (e: Event) => {
            const key = (e as KeyboardEvent).key;
            if (key === "Enter" || key === " ") {
              e.preventDefault();
              activate();
            }
          });
        } else {
          card.setAttribute("role", "listitem");
        }

        wrapper.appendChild(card);
      }
    }

    host.appendChild(wrapper);

    // ── Pagination footer ─────────────────────────────────────────────
    if (pageSize > 0 && (hasMore || filtered.length !== limited.length)) {
      const footer = this.el("div", "dash-cards-footer");

      if (hasMore) {
        const remaining = filtered.length - this.visibleCount;
        const nextBatch = Math.min(pageSize, remaining);
        const btn = this.el(
          "button",
          "dash-cards-load-more",
          `Load ${nextBatch} more`,
        );
        btn.setAttribute("type", "button");
        btn.addEventListener("click", () => {
          this.visibleCount += pageSize;
          this.rebuildCards();
        });
        footer.appendChild(btn);
      }

      const shown = Math.min(this.visibleCount, filtered.length);
      footer.appendChild(
        this.el("span", "dash-cards-count", `${shown} of ${filtered.length}`),
      );
      host.appendChild(footer);
    }
  }

  private renderDetail(
    host: HTMLElement,
    detailCfg: Record<string, unknown>,
    row: Record<string, unknown>,
  ): void {
    if (!this.props) return;
    const componentName = String(detailCfg["component"] ?? "");
    if (!componentName) return;
    const registry = createDefaultRegistry();
    if (!registry.has(componentName)) return;
    try {
      const comp = registry.create(componentName);
      const detailPanel = {
        component: componentName,
        fields: Array.isArray(detailCfg["fields"])
          ? (detailCfg["fields"] as string[])
          : [],
        columns: [],
        badges: [],
        filter: {},
        sortable: false,
        filterable: [],
        searchable: [],
        inline_edit: [],
        options:
          (detailCfg["options"] as Record<string, unknown>) ?? detailCfg,
        extra: {},
        ...(this.props.panel.source !== undefined
          ? { source: this.props.panel.source }
          : {}),
      };
      comp.render(host, {
        panel: detailPanel,
        data: [row],
        allData: this.props.allData,
        config: this.props.config,
        onAction: this.props.onAction,
      });
    } catch {
      // Silently skip — broken detail config shouldn't break the card list.
    }
  }
}
