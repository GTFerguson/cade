/**
 * Key-value pairs display for summary stats.
 */

import { BaseDashboardComponent } from "./base-component";

export class KeyValueComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;

    const wrapper = this.el("div", "dash-kv");

    for (const field of this.props.panel.fields) {
      const row = this.el("div", "dash-kv-row");
      row.appendChild(this.el("span", "dash-kv-label", field));

      // Aggregate from data or show first item's value
      const data = this.props.data;
      let value = "";
      if (data.length === 1) {
        value = this.fieldValue(data[0]!, field);
      } else if (data.length > 1) {
        value = String(data.length);
      }
      row.appendChild(this.el("span", "dash-kv-value", value));
      wrapper.appendChild(row);
    }

    this.container.appendChild(wrapper);
  }
}
