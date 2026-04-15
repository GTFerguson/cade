/**
 * Kanban component — status columns with draggable cards.
 */

import { BaseDashboardComponent } from "./base-component";
import type { DashboardAction } from "../types";

export class KanbanComponent extends BaseDashboardComponent {
  private dragCard: HTMLElement | null = null;
  private dragItem: Record<string, unknown> | null = null;

  protected build(): void {
    if (!this.container || !this.props) return;

    const { panel, data, onAction } = this.props;
    const columns = panel.columns as { status: string; label: string }[];
    const wrapper = this.el("div", "dash-kanban");

    // Group data by status
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const col of columns) {
      groups.set(col.status, []);
    }
    for (const item of data) {
      const status = String(item["status"] ?? "");
      const group = groups.get(status);
      if (group) {
        group.push(item);
      }
    }

    for (const col of columns) {
      const items = groups.get(col.status) ?? [];
      const colEl = this.el("div", "dash-kanban-column");

      // Header
      const header = this.el("div", "dash-kanban-column-header");
      header.appendChild(this.el("span", undefined, col.label));
      header.appendChild(
        this.el("span", "dash-kanban-count", String(items.length)),
      );
      colEl.appendChild(header);

      // Cards container — drop target
      const cardsEl = this.el("div", "dash-kanban-cards");
      cardsEl.dataset["status"] = col.status;

      cardsEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
        cardsEl.classList.add("drag-over");
      });

      cardsEl.addEventListener("dragleave", () => {
        cardsEl.classList.remove("drag-over");
      });

      cardsEl.addEventListener("drop", (e) => {
        e.preventDefault();
        cardsEl.classList.remove("drag-over");
        if (this.dragCard && this.dragItem) {
          cardsEl.appendChild(this.dragCard);
          this.updateCounts(wrapper);

          // Fire mutation action
          const sourceName =
            typeof panel.source === "string" ? panel.source : "";
          onAction({
            action: "patch",
            source: sourceName,
            entityId: String(this.dragItem["id"] ?? ""),
            patch: { status: col.status },
          });
        }
      });

      for (const item of items) {
        const card = this.createCard(item, columns, col.status, panel, onAction);
        cardsEl.appendChild(card);
      }

      colEl.appendChild(cardsEl);
      wrapper.appendChild(colEl);
    }

    this.container.appendChild(wrapper);
  }

  private createCard(
    item: Record<string, unknown>,
    columns: { status: string; label: string }[],
    currentStatus: string,
    panel: NonNullable<typeof this.props>["panel"],
    onAction: (action: DashboardAction) => void,
  ): HTMLElement {
    const card = this.el("div", "dash-kanban-card");
    card.draggable = true;

    const title = String(
      item["title"] ?? item["name"] ?? item["text"] ?? item["id"] ?? "",
    );
    card.textContent = title;

    // Drag start
    card.addEventListener("dragstart", (e) => {
      this.dragCard = card;
      this.dragItem = item;
      card.classList.add("dragging");
      (e as DragEvent).dataTransfer!.effectAllowed = "move";
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document
        .querySelectorAll(".dash-kanban-cards")
        .forEach((c) => c.classList.remove("drag-over"));
      this.dragCard = null;
      this.dragItem = null;
    });

    // Click fallback: context menu for move
    card.addEventListener("click", () => {
      this.showMoveMenu(card, item, columns, currentStatus, panel, onAction);
    });

    return card;
  }

  private updateCounts(wrapper: HTMLElement): void {
    wrapper.querySelectorAll(".dash-kanban-column").forEach((col) => {
      const count = col.querySelectorAll(".dash-kanban-card").length;
      const countEl = col.querySelector(".dash-kanban-count");
      if (countEl) countEl.textContent = String(count);
    });
  }

  private showMoveMenu(
    card: HTMLElement,
    item: Record<string, unknown>,
    columns: { status: string; label: string }[],
    currentStatus: string,
    panel: NonNullable<typeof this.props>["panel"],
    onAction: (action: DashboardAction) => void,
  ): void {
    document.querySelector(".dash-kanban-move-menu")?.remove();

    const menu = this.el("div", "dash-kanban-move-menu");
    menu.style.cssText = `
      position: absolute; z-index: 100;
      background: var(--bg-secondary); border: 1px solid var(--border-color);
      padding: 4px 0; min-width: 120px;
    `;

    for (const col of columns) {
      if (col.status === currentStatus) continue;
      const option = this.el("div", undefined, `\u2192 ${col.label}`);
      option.style.cssText = `
        padding: 4px 12px; cursor: pointer; font-family: var(--font-mono);
        font-size: 11px; color: var(--text-secondary);
      `;
      option.addEventListener("mouseenter", () => {
        option.style.background = "var(--bg-tertiary, var(--bg-primary))";
      });
      option.addEventListener("mouseleave", () => {
        option.style.background = "";
      });
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.remove();
        const sourceName =
          typeof panel.source === "string" ? panel.source : "";
        onAction({
          action: "patch",
          source: sourceName,
          entityId: String(item["id"] ?? ""),
          patch: { status: col.status },
        });
      });
      menu.appendChild(option);
    }

    card.style.position = "relative";
    card.appendChild(menu);

    const close = (e: Event) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
}
