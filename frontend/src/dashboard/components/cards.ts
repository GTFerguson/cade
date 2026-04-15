/**
 * Card grid/list component.
 */

import { BaseDashboardComponent } from "./base-component";

export class CardsComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data, onAction } = this.props;
    const layout = panel.layout ?? "grid";
    const wrapper = this.el(
      "div",
      `dash-cards dash-cards--${layout}`,
    );

    for (const item of data) {
      const card = this.el("div", "dash-card");

      // Render fields
      for (const field of panel.fields) {
        const val = this.fieldValue(item, field);
        if (val) {
          card.appendChild(this.el("div", "dash-card-field", val));
        }
      }

      // Render badges
      if (panel.badges.length > 0) {
        const badgesEl = this.el("div", "dash-card-badges");
        for (const badgeField of panel.badges) {
          const val = this.fieldValue(item, badgeField);
          if (val) {
            badgesEl.appendChild(this.badge(val, badgeField));
          }
        }
        card.appendChild(badgesEl);
      }

      // Click handler — open file in viewer or URL in browser
      const filePath = String(item["_file"] ?? "");
      const url = String(item["url"] ?? "");
      if (filePath) {
        card.style.cursor = "pointer";
        card.addEventListener("click", () => {
          onAction({
            action: "view_file",
            source: typeof panel.source === "string" ? panel.source : "",
            entityId: String(item["id"] ?? ""),
            patch: { path: filePath },
          });
        });
      } else if (url) {
        card.style.cursor = "pointer";
        card.addEventListener("click", () => {
          window.open(url, "_blank");
        });
      }

      wrapper.appendChild(card);
    }

    this.container.appendChild(wrapper);
  }
}
