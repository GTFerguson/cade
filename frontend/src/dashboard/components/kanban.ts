/**
 * Kanban component — status columns with draggable cards.
 *
 * A move sends `panel.on_move.patch` with `$column` replaced by the target
 * column's status, or `{status: <column>}` when no patch is given. Moves
 * the source's `entity.transitions` do not allow are refused before
 * anything is sent.
 */

import { BaseDashboardComponent } from "./base-component";
import { canTransition, entityConfigFor, entityIdOf } from "../entity";
import type { DashboardAction } from "../types";

const COLUMN_PLACEHOLDER = "$column";

// How long a refused card stays marked, so the user sees which card the
// drop was refused for.
const REFUSED_MARK_MS = 1200;

function substituteColumn(value: unknown, column: string): unknown {
  if (typeof value === "string") return value.split(COLUMN_PLACEHOLDER).join(column);
  if (Array.isArray(value)) return value.map((v) => substituteColumn(v, column));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        substituteColumn(v, column),
      ]),
    );
  }
  return value;
}

/** The patch a move into `column` sends, built from `on_move`. */
export function movePatch(
  onMove: Record<string, unknown> | undefined,
  column: string,
): Record<string, unknown> {
  const template = onMove?.["patch"];
  if (template && typeof template === "object" && !Array.isArray(template)) {
    return substituteColumn(template, column) as Record<string, unknown>;
  }
  return { status: column };
}

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
          this.applyMove(
            cardsEl,
            this.dragCard,
            this.dragItem,
            onAction,
            wrapper,
          );
        }
      });

      for (const item of items) {
        const card = this.createCard(
          item,
          columns,
          col.status,
          onAction,
          wrapper,
        );
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
    onAction: (action: DashboardAction) => void,
    wrapper: HTMLElement,
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

    // Touch drag: HTML5 DnD doesn't fire on touch. Track finger movement;
    // a small move is treated as a tap (falls through to the click handler
    // which opens the move menu), a larger one as a drag. The threshold
    // and elementFromPoint hit-testing mirror the desktop drop logic.
    let startX = 0;
    let startY = 0;
    let touchDragging = false;
    const clearDropTargets = () =>
      wrapper
        .querySelectorAll(".dash-kanban-cards")
        .forEach((c) => c.classList.remove("drag-over"));

    card.addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        touchDragging = false;
      },
      { passive: true },
    );

    card.addEventListener(
      "touchmove",
      (e) => {
        const t = e.touches[0];
        if (!t) return;
        const moved = Math.hypot(t.clientX - startX, t.clientY - startY);
        if (!touchDragging && moved < 8) return;
        if (!touchDragging) {
          touchDragging = true;
          this.dragCard = card;
          this.dragItem = item;
          card.classList.add("dragging");
        }
        // Prevent the screen from scrolling while dragging a card.
        e.preventDefault();
        const under = document.elementFromPoint(t.clientX, t.clientY);
        const target = under?.closest(
          ".dash-kanban-cards",
        ) as HTMLElement | null;
        clearDropTargets();
        target?.classList.add("drag-over");
      },
      { passive: false },
    );

    card.addEventListener(
      "touchend",
      (e) => {
        if (!touchDragging) {
          // A tap — let the click handler open the move menu.
          return;
        }
        card.classList.remove("dragging");
        clearDropTargets();
        const t = e.changedTouches[0];
        const under = t
          ? document.elementFromPoint(t.clientX, t.clientY)
          : null;
        const target = under?.closest(
          ".dash-kanban-cards",
        ) as HTMLElement | null;
        if (target && this.dragItem) {
          this.applyMove(target, card, this.dragItem, onAction, wrapper);
        }
        this.dragCard = null;
        this.dragItem = null;
        touchDragging = false;
        // Suppress the synthetic click so the move menu doesn't open
        // right after a successful drag.
        e.preventDefault();
      },
      { passive: false },
    );

    // Click fallback: context menu for move (also the primary tap path
    // on touch when the finger doesn't travel far enough to drag).
    card.addEventListener("click", () => {
      this.showMoveMenu(card, item, columns, currentStatus, onAction);
    });

    return card;
  }

  /**
   * Move a card into a column and fire the patch mutation. Shared by the
   * desktop HTML5 drop handler and the touch-drag handler. A drop on the
   * card's own column does nothing, and a drop the transitions refuse
   * leaves the card where it was.
   */
  private applyMove(
    targetCardsEl: HTMLElement,
    card: HTMLElement,
    item: Record<string, unknown>,
    onAction: (action: DashboardAction) => void,
    wrapper: HTMLElement,
  ): void {
    const status = targetCardsEl.dataset["status"] ?? "";
    const from = String(item["status"] ?? "");
    if (status === from) return;
    if (!this.allowsMove(from, status)) {
      this.markRefused(card, from, status);
      return;
    }
    targetCardsEl.appendChild(card);
    this.updateCounts(wrapper);
    this.sendMove(item, status, onAction);
  }

  private allowsMove(from: string, to: string): boolean {
    if (!this.props) return false;
    const entity = entityConfigFor(this.props.panel, this.props.config);
    return canTransition(entity, from, to);
  }

  private sendMove(
    item: Record<string, unknown>,
    column: string,
    onAction: (action: DashboardAction) => void,
  ): void {
    if (!this.props) return;
    const { panel, config } = this.props;
    onAction({
      action: "patch",
      source: panel.source ?? "",
      entityId: entityIdOf(item, panel, config),
      patch: movePatch(panel.on_move, column),
    });
  }

  private markRefused(card: HTMLElement, from: string, to: string): void {
    card.classList.add("dash-kanban-card--refused");
    card.title = `Moving from ${from || "(none)"} to ${to} is not allowed`;
    setTimeout(() => {
      card.classList.remove("dash-kanban-card--refused");
      card.removeAttribute("title");
    }, REFUSED_MARK_MS);
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
      if (!this.allowsMove(currentStatus, col.status)) continue;
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
        this.sendMove(item, col.status, onAction);
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
