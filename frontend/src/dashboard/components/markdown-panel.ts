/**
 * Markdown rich text panel.
 */

import { marked } from "marked";
import { BaseDashboardComponent } from "./base-component";

export class MarkdownPanelComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data } = this.props;
    const wrapper = this.el("div", "dash-markdown");

    // Get content from configured field or 'content' key
    const field = panel.fields[0] ?? "content";
    const content = data[0] ? String(data[0][field] ?? "") : "";

    if (content) {
      wrapper.innerHTML = marked.parse(content, { async: false }) as string;
    }

    this.container.appendChild(wrapper);
  }
}
