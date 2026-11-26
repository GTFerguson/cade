/**
 * Drag-to-reorder for the tab bar.
 *
 * Uses pointer events rather than HTML5 drag-and-drop: native DnD shows a
 * detached ghost image and can't animate siblings, and in Tauri it competes
 * with the window's drag region. Here the dragged tab follows the pointer
 * while the tabs it passes slide aside to open its landing slot.
 *
 * A drag can also end on another workspace's chip, which moves the tab into
 * that workspace instead of reordering it.
 */

/** Pointer travel (px) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** Duration of the sibling slide and the dragged tab's settle into its slot. */
const SLIDE_MS = 150;

export interface TabSlot {
  left: number;
  width: number;
}

/**
 * Horizontal offset for the dragged tab, held so it never leaves the strip.
 */
export function clampDragOffset(fromIndex: number, dx: number, slots: TabSlot[]): number {
  const self = slots[fromIndex]!;
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;
  const min = first.left - self.left;
  const max = last.left + last.width - (self.left + self.width);
  return Math.max(min, Math.min(dx, max));
}

/**
 * Index the dragged tab (moved by `offset`) lands at: it takes the slot of
 * every tab whose midpoint its leading edge has crossed. The leading edge,
 * not the dragged tab's midpoint, so the end slot stays reachable when the
 * tab is pinned at the strip edge: at that point its midpoint may not have
 * passed a narrower or equal-width last tab's midpoint.
 */
export function computeDropIndex(
  fromIndex: number,
  offset: number,
  slots: TabSlot[],
): number {
  const self = slots[fromIndex]!;
  const leftEdge = self.left + offset;
  const rightEdge = leftEdge + self.width;
  let target = fromIndex;
  for (let i = 0; i < slots.length; i++) {
    if (i === fromIndex) continue;
    const center = slots[i]!.left + slots[i]!.width / 2;
    if (i < fromIndex && leftEdge < center) target = Math.min(target, i);
    if (i > fromIndex && rightEdge > center) target = Math.max(target, i);
  }
  return target;
}

/** Somewhere a dragged tab can be dropped to change its workspace. */
export interface DropTarget {
  el: HTMLElement;
  /** The workspace it stands for; null for the ungrouped tabs. */
  group: string | null;
}

export interface TargetRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Index of the rectangle the pointer is inside, or -1. */
export function targetAt(x: number, y: number, rects: TargetRect[]): number {
  return rects.findIndex((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}

interface ActiveDrag {
  tabEl: HTMLElement;
  pointerId: number;
  startX: number;
  fromIndex: number;
  toIndex: number;
  tabEls: HTMLElement[];
  slots: TabSlot[];
  started: boolean;
  settling: boolean;
  targets: DropTarget[];
  targetRects: TargetRect[];
  /** Index into `targets` of the chip the pointer is over, or -1. */
  over: number;
}

export class TabDragController {
  private drag: ActiveDrag | null = null;
  private suppressClick = false;

  constructor(
    private tabList: HTMLElement,
    private onDrop: (tabId: string, toIndex: number) => void,
    private onEnd: () => void,
    /** The chips a tab of this strip may be dropped on, read when a drag starts. */
    private dropTargets: () => DropTarget[] = () => [],
    private onDropOnTarget: (tabId: string, group: string | null) => void = () => {},
  ) {}

  isDragging(): boolean {
    return this.drag?.started ?? false;
  }

  attach(tabEl: HTMLElement): void {
    tabEl.addEventListener("pointerdown", (e) => this.onPointerDown(e, tabEl));
    tabEl.addEventListener("pointermove", (e) => this.onPointerMove(e));
    tabEl.addEventListener("pointerup", (e) => this.onPointerUp(e));
    tabEl.addEventListener("pointercancel", (e) => this.onPointerCancel(e));
    // A drag ends with a click on the same tab; swallow it so dropping a tab
    // doesn't also switch to it.
    tabEl.addEventListener(
      "click",
      (e) => {
        if (this.suppressClick) {
          this.suppressClick = false;
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  }

  private onPointerDown(e: PointerEvent, tabEl: HTMLElement): void {
    if (e.button !== 0 || this.drag) return;
    if ((e.target as HTMLElement).closest(".tab-close")) return;

    const tabEls = Array.from(this.tabList.querySelectorAll<HTMLElement>(".tab"));
    const fromIndex = tabEls.indexOf(tabEl);
    const targets = this.dropTargets();
    // A lone tab has nowhere to be reordered to, but can still change workspace.
    if (fromIndex === -1 || (tabEls.length < 2 && targets.length === 0)) return;

    this.drag = {
      tabEl,
      pointerId: e.pointerId,
      startX: e.clientX,
      fromIndex,
      toIndex: fromIndex,
      tabEls,
      slots: [],
      started: false,
      settling: false,
      targets,
      targetRects: [],
      over: -1,
    };
  }

  private onPointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId || drag.settling) return;

    const dx = e.clientX - drag.startX;
    if (!drag.started) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      this.start(drag);
    }

    const over = targetAt(e.clientX, e.clientY, drag.targetRects);
    if (over !== drag.over) {
      drag.targets[drag.over]?.el.classList.remove("tab-drop-target");
      drag.targets[over]?.el.classList.add("tab-drop-target");
      drag.tabEl.classList.toggle("tab-dropping", over !== -1);
      drag.over = over;
    }
    if (over !== -1) {
      // Over a chip the tab leaves its strip to follow the pointer there,
      // and its siblings close the gap it left.
      drag.tabEl.style.transform = `translateX(${dx}px)`;
      drag.toIndex = drag.fromIndex;
      this.shiftSiblings(drag);
      return;
    }

    const offset = clampDragOffset(drag.fromIndex, dx, drag.slots);
    drag.tabEl.style.transform = `translateX(${offset}px)`;
    drag.toIndex = computeDropIndex(drag.fromIndex, offset, drag.slots);
    this.shiftSiblings(drag);
  }

  private start(drag: ActiveDrag): void {
    drag.started = true;
    drag.slots = drag.tabEls.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, width: r.width };
    });
    drag.targetRects = drag.targets.map((t) => {
      const r = t.el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    drag.tabEl.setPointerCapture(drag.pointerId);
    drag.tabEl.classList.add("tab-dragging");
    this.tabList.classList.add("tab-list-dragging");
    for (const el of drag.tabEls) {
      if (el !== drag.tabEl) el.style.transition = `transform ${SLIDE_MS}ms ease`;
    }
  }

  private shiftSiblings(drag: ActiveDrag): void {
    const { fromIndex, toIndex } = drag;
    const width = drag.slots[fromIndex]!.width;
    drag.tabEls.forEach((el, i) => {
      if (i === fromIndex) return;
      let shift = 0;
      if (fromIndex < toIndex && i > fromIndex && i <= toIndex) shift = -width;
      if (fromIndex > toIndex && i >= toIndex && i < fromIndex) shift = width;
      el.style.transform = shift ? `translateX(${shift}px)` : "";
    });
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId || drag.settling) return;
    if (!drag.started) {
      this.drag = null;
      return;
    }
    drag.settling = true;
    this.suppressClick = true;

    const target = drag.targets[drag.over];
    if (target) {
      const id = drag.tabEl.dataset["tabId"];
      this.finish(drag);
      if (id) this.onDropOnTarget(id, target.group);
      this.onEnd();
      return;
    }

    // Settle the dragged tab into the slot its siblings opened, then commit.
    const { slots, fromIndex, toIndex } = drag;
    const self = slots[fromIndex]!;
    const slotLeft =
      toIndex < fromIndex
        ? slots[toIndex]!.left
        : slots[toIndex]!.left + slots[toIndex]!.width - self.width;
    drag.tabEl.style.transition = `transform ${SLIDE_MS}ms ease`;
    drag.tabEl.style.transform = `translateX(${slotLeft - self.left}px)`;

    const tabId = drag.tabEl.dataset["tabId"];
    window.setTimeout(() => {
      this.finish(drag);
      if (tabId && toIndex !== fromIndex) this.onDrop(tabId, toIndex);
      this.onEnd();
    }, SLIDE_MS);
  }

  private onPointerCancel(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId || drag.settling) return;
    this.finish(drag);
    this.onEnd();
  }

  private finish(drag: ActiveDrag): void {
    for (const el of drag.tabEls) {
      el.style.transition = "";
      el.style.transform = "";
    }
    drag.tabEl.classList.remove("tab-dragging", "tab-dropping");
    drag.targets[drag.over]?.el.classList.remove("tab-drop-target");
    this.tabList.classList.remove("tab-list-dragging");
    if (drag.tabEl.hasPointerCapture(drag.pointerId)) {
      drag.tabEl.releasePointerCapture(drag.pointerId);
    }
    this.drag = null;
  }
}
