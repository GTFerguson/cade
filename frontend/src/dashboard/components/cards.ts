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
 */

import { BaseDashboardComponent } from "./base-component";
import { createDefaultRegistry } from "../registry";

export class CardsComponent extends BaseDashboardComponent {
  // Per-instance set of expanded card ids — preserved across re-renders
  // so a push that updates the source doesn't collapse what the user
  // had open. Keyed by item.id, falling back to row index when absent.
  private expanded = new Set<string>();

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data, onAction } = this.props;
    const layout = panel.layout ?? "grid";
    const wrapper = this.el("div", `dash-cards dash-cards--${layout}`);
    wrapper.setAttribute("role", "list");

    // Honour ``limit:`` from the panel config — otherwise overview panels
    // dump every record and the pane becomes absurdly tall.
    const limited =
      typeof panel.limit === "number" && panel.limit > 0
        ? data.slice(0, panel.limit)
        : data;

    const titleField = panel.fields[0];
    const groupByField = typeof panel.extra?.["group_by"] === "string"
      ? panel.extra["group_by"] as string
      : null;

    // inline_preview: render a sub-component inside each card body.
    // Config: { component: "graph", field: "_sibling" }
    // The field value becomes data[0] for the sub-component.
    const preview = panel.extra?.["inline_preview"] as Record<string, unknown> | undefined;

    // Group items if group_by is set. Ungrouped (empty field) items come first.
    const groups: Array<{ label: string | null; items: typeof limited }> = groupByField
      ? (() => {
          const map = new Map<string, typeof limited>();
          for (const item of limited) {
            const key = String(item[groupByField] ?? "");
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(item);
          }
          const result: Array<{ label: string | null; items: typeof limited }> = [];
          // Ungrouped (empty key) first, no label
          if (map.has("")) result.push({ label: null, items: map.get("")! });
          for (const [key, items] of map) {
            if (key !== "") result.push({ label: key, items });
          }
          return result;
        })()
      : [{ label: null, items: limited }];

    for (const group of groups) {
      if (group.label !== null) {
        const header = this.el("h5", "dash-cards-group-header", group.label);
        wrapper.appendChild(header);
      }
      for (const item of group.items) {
      // <article> gives the card an implicit document region and a
      // stable landmark for screen readers, while letting us override
      // the role to "button"/"link" when the card is interactive.
      const card = this.el("article", "dash-card");

      // Inline preview — rendered at the TOP of the card, separated from
      // the title/fields by a divider (like frontmatter in a markdown file).
      if (preview) {
        const previewComponent = String(preview["component"] ?? "");
        const previewField = preview["field"] ? String(preview["field"]) : null;
        if (previewComponent) {
          const val = previewField ? item[previewField] : item;
          if (val != null) {
            const previewData = typeof val === "object" && !Array.isArray(val)
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
                    options: (preview["options"] as Record<string, unknown>) ?? {},
                    extra: {},
                  },
                  data: previewData,
                  allData: this.props!.allData,
                  config: this.props!.config,
                  onAction: this.props!.onAction,
                });
              } catch {
                // Silently skip failed previews — don't break the card
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
          // First field is the card's title — heading tag gives it a
          // place in the viewer's document outline.
          card.appendChild(this.el("h4", "dash-card-title", val));
          firstFieldRendered = true;
        } else {
          card.appendChild(this.el("div", "dash-card-field", val));
        }
      }

      // Favourite-toggle config — when set, the badge whose field is
      // `favouriteField` becomes a clickable star instead of a static label.
      const onFavourite = panel.options?.["on_favourite"] as
        | { action: string; message?: Record<string, unknown> }
        | undefined;
      const favouriteField = typeof panel.extra?.["favourite_field"] === "string"
        ? (panel.extra["favourite_field"] as string)
        : "favourite";

      // Render badges
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
            star.setAttribute("aria-label", isFav ? "unfavourite" : "favourite");
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
                source: typeof panel.source === "string" ? panel.source : "",
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

      // Inline detail expansion — when panel.detail is configured, every
      // card gets a chevron and is clickable. Click anywhere on the card
      // toggles the detail block. State persists in this.expanded across
      // re-renders so live pushes don't collapse what the user opened.
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
          // Don't toggle when the click came from inside the detail
          // (textarea, button, etc.) — only the card chrome should toggle.
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

      // Interaction — clickable cards become keyboard-accessible
      // buttons/links with an aria-label derived from the title field
      // so screen readers announce ``Aela, Goddess of Light — open`` etc.
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

        // view_file_preview: { component, field } — attaches preview data to
        // the view_file action so the viewer can render a preview above the file.
        const vfp = panel.extra?.["view_file_preview"] as Record<string, unknown> | undefined;
        const previewPatch: Record<string, unknown> = {};
        if (vfp) {
          const previewField = vfp["field"] ? String(vfp["field"]) : null;
          const previewComponent = String(vfp["component"] ?? "");
          const previewData = previewField ? item[previewField] : null;
          if (previewComponent && previewData != null) {
            previewPatch["preview"] = { component: previewComponent, data: previewData };
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
        // Non-interactive card still gets listitem semantics.
        card.setAttribute("role", "listitem");
      }

      wrapper.appendChild(card);
      }
    }

    this.container.appendChild(wrapper);
  }

  // Render the configured detail component into `host`, with the row
  // becoming the single-element `data` array. Failures are swallowed
  // — a broken detail config shouldn't take down the whole panel.
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
        fields: Array.isArray(detailCfg["fields"]) ? (detailCfg["fields"] as string[]) : [],
        columns: [],
        badges: [],
        filter: {},
        sortable: false,
        filterable: [],
        searchable: [],
        inline_edit: [],
        options: (detailCfg["options"] as Record<string, unknown>) ?? detailCfg,
        extra: {},
        source: this.props.panel.source,
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
