/**
 * Timeline component — date-ordered events with connector line.
 */

import { BaseDashboardComponent } from "./base-component";

export class TimelineComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;

    const { data, panel } = this.props;
    const wrapper = this.el("div", "dash-timeline");

    let currentHeading = "";

    for (const item of data) {
      // Section heading (e.g. month)
      const heading = String(item["heading"] ?? "");
      if (heading && heading !== currentHeading) {
        currentHeading = heading;
        wrapper.appendChild(this.el("div", "dash-timeline-heading", heading));
      }

      const entry = this.el("div", "dash-timeline-entry");

      // Date
      const date = item["date"];
      if (date) {
        entry.appendChild(this.el("div", "dash-timeline-date", String(date)));
      }

      // Text — use 'text' field or 'what' field or first configured field
      const textField = panel.fields[0] ?? "text";
      const text = this.fieldValue(item, textField) || this.fieldValue(item, "text") || this.fieldValue(item, "what");
      if (text) {
        entry.appendChild(this.el("div", "dash-timeline-text", text));
      }

      // Extra fields as secondary info
      for (const field of panel.fields.slice(1)) {
        const val = this.fieldValue(item, field);
        if (val) {
          entry.appendChild(this.el("div", "dash-timeline-text", `${field}: ${val}`));
        }
      }

      wrapper.appendChild(entry);
    }

    this.container.appendChild(wrapper);
  }
}
