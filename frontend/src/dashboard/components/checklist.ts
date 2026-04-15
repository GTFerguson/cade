/**
 * Checklist component with completion state.
 */

import { BaseDashboardComponent } from "./base-component";

export class ChecklistComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data, onAction } = this.props;
    const list = this.el("ul", "dash-checklist");

    for (const item of data) {
      const li = this.el("li", "dash-checklist-item");
      const isDone = item["done"] === true || item["status"] === "done";

      if (isDone) {
        li.classList.add("dash-checklist-item--done");
      }

      // Priority indicator
      const priority = item["priority"];
      if (priority) {
        const pip = this.el("span", `dash-checklist-priority`);
        pip.style.background = this.priorityColor(String(priority));
        li.appendChild(pip);
      }

      // Checkbox
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isDone;
      checkbox.addEventListener("change", () => {
        if (panel.on_check) {
          const sourceName = typeof panel.source === "string" ? panel.source : "";
          onAction({
            action: "patch",
            source: sourceName,
            entityId: String(item["id"] ?? ""),
            patch: panel.on_check["patch"] as Record<string, unknown> ?? { status: "done" },
          });
        }
      });
      li.appendChild(checkbox);

      // Text — use first field or 'text' key, link to URL if available
      const textField = panel.fields[0] ?? "text";
      const text = this.fieldValue(item, textField);
      const url = String(item["url"] ?? "");
      if (url) {
        const link = document.createElement("a");
        link.textContent = text;
        link.href = url;
        link.target = "_blank";
        link.className = "dash-checklist-link";
        li.appendChild(link);
      } else {
        li.appendChild(this.el("span", undefined, text));
      }

      // Deadline badge
      const deadline = item["deadline"];
      if (deadline) {
        li.appendChild(this.el("span", "dash-checklist-deadline", String(deadline)));
      }

      list.appendChild(li);
    }

    this.container.appendChild(list);
  }

  private priorityColor(priority: string): string {
    switch (priority) {
      case "1": case "critical": return "var(--accent-red)";
      case "2": case "high": return "var(--accent-orange)";
      case "3": case "medium": return "var(--accent-blue)";
      default: return "var(--text-muted)";
    }
  }
}
