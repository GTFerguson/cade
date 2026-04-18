/**
 * Card grid/list component.
 */

import { BaseDashboardComponent } from "./base-component";
import { createDefaultRegistry } from "../registry";

export class CardsComponent extends BaseDashboardComponent {
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

      // Render badges
      if (panel.badges.length > 0) {
        const badgesEl = this.el("div", "dash-card-badges");
        badgesEl.setAttribute("role", "list");
        badgesEl.setAttribute("aria-label", "tags");
        for (const badgeField of panel.badges) {
          const val = this.fieldValue(item, badgeField);
          if (val) {
            const b = this.badge(val, badgeField);
            b.setAttribute("role", "listitem");
            badgesEl.appendChild(b);
          }
        }
        card.appendChild(badgesEl);
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
}
