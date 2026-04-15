/**
 * Card grid/list component.
 */

import { BaseDashboardComponent } from "./base-component";

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

    for (const item of limited) {
      // <article> gives the card an implicit document region and a
      // stable landmark for screen readers, while letting us override
      // the role to "button"/"link" when the card is interactive.
      const card = this.el("article", "dash-card");

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
        const activate = () => {
          onAction({
            action: "view_file",
            source: typeof panel.source === "string" ? panel.source : "",
            entityId: String(item["id"] ?? ""),
            patch: { path: filePath },
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

    this.container.appendChild(wrapper);
  }
}
