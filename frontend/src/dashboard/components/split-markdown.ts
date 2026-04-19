/**
 * Split markdown component — read-only top zone + editable bottom zone.
 *
 * The read zone renders one field as immutable rendered markdown (the
 * world fact). The edit zone shows the player's current value of a
 * second field in a textarea with a Save button; saving emits a
 * configurable action, typically a provider_message that the engine
 * upserts as the row's per-PC notes.
 *
 * Panel options:
 *   read_field:  string                  — field rendered as markdown (top)
 *   edit_field:  string                  — field shown in the textarea (bottom)
 *   edit_label:  string?                 — heading for the edit zone
 *   on_save:     { action, message? }    — emitted on Save; the component
 *                                          appends event_id, body_md, and
 *                                          favourite (if available on row)
 *                                          into message.
 */

import { marked } from "marked";
import { BaseDashboardComponent } from "./base-component";

export class SplitMarkdownComponent extends BaseDashboardComponent {
  protected build(): void {
    if (!this.container || !this.props) return;
    const { panel, data, onAction } = this.props;
    const row = data[0] ?? {};

    const readField = String(panel.options?.["read_field"] ?? "_body");
    const editField = String(panel.options?.["edit_field"] ?? "_notes");
    const editLabel = String(panel.options?.["edit_label"] ?? "Your notes");

    const wrapper = this.el("div", "dash-split-md");

    // Read zone — rendered markdown of the immutable world fact.
    const readZone = this.el("div", "dash-split-md__read");
    const readContent = String(row[readField] ?? "");
    if (readContent) {
      readZone.innerHTML = marked.parse(readContent, { async: false }) as string;
    }
    wrapper.appendChild(readZone);

    // Divider between zones — bold so the player reads the split as
    // "above is the world, below is yours" and not a single doc.
    wrapper.appendChild(this.el("hr", "dash-split-md__divider"));

    // Edit zone — heading + textarea + Save button.
    const editZone = this.el("div", "dash-split-md__edit");
    editZone.appendChild(this.el("h5", "dash-split-md__edit-label", editLabel));

    const textarea = this.el("textarea", "dash-split-md__textarea") as HTMLTextAreaElement;
    textarea.value = String(row[editField] ?? "");
    textarea.rows = 4;
    editZone.appendChild(textarea);

    const onSave = panel.options?.["on_save"] as
      | { action: string; message?: Record<string, unknown> }
      | undefined;

    if (onSave && typeof onSave.action === "string") {
      const saveBtn = this.el("button", "dash-split-md__save", "Save");
      saveBtn.setAttribute("type", "button");
      saveBtn.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        const message = {
          ...(onSave.message ?? {}),
          event_id: row["id"],
          body_md: textarea.value,
          favourite: Boolean(row["favourite"]),
        };
        onAction({
          action: onSave.action,
          source: typeof panel.source === "string" ? panel.source : "",
          entityId: String(row["id"] ?? ""),
          message,
        });
      });
      editZone.appendChild(saveBtn);
    }

    wrapper.appendChild(editZone);
    this.container.appendChild(wrapper);
  }
}
