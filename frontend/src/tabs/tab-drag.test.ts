/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { clampDragOffset, computeDropIndex, type TabSlot } from "./tab-drag";

// Four 100px tabs side by side: midpoints at 50, 150, 250, 350.
const slots: TabSlot[] = [0, 100, 200, 300].map((left) => ({ left, width: 100 }));

/** Where the dragged tab lands after being dragged by `dx` (clamped like the UI). */
function dropAfterDrag(fromIndex: number, dx: number, s: TabSlot[] = slots): number {
  return computeDropIndex(fromIndex, clampDragOffset(fromIndex, dx, s), s);
}

describe("computeDropIndex", () => {
  it("stays put for small drags", () => {
    expect(dropAfterDrag(1, 0)).toBe(1);
    expect(dropAfterDrag(1, 49)).toBe(1);
    expect(dropAfterDrag(1, -49)).toBe(1);
  });

  it("moves right once its leading edge passes a neighbour's midpoint", () => {
    expect(dropAfterDrag(1, 51)).toBe(2);
    expect(dropAfterDrag(1, 151)).toBe(3);
    expect(dropAfterDrag(0, 999)).toBe(3);
  });

  it("moves left once its leading edge passes a neighbour's midpoint", () => {
    expect(dropAfterDrag(3, -51)).toBe(2);
    expect(dropAfterDrag(3, -151)).toBe(1);
    expect(dropAfterDrag(3, -999)).toBe(0);
  });

  it("can swap two equal-width tabs, the dragged tab being held inside the strip", () => {
    const two = slots.slice(0, 2);
    expect(dropAfterDrag(0, 999, two)).toBe(1);
    expect(dropAfterDrag(1, -999, two)).toBe(0);
  });

  it("can reach either end past wider neighbours", () => {
    const mixed: TabSlot[] = [
      { left: 0, width: 80 },
      { left: 80, width: 200 },
      { left: 280, width: 200 },
    ];
    expect(dropAfterDrag(0, 999, mixed)).toBe(2);
    expect(dropAfterDrag(2, -999, mixed)).toBe(0);
  });
});

describe("clampDragOffset", () => {
  it("keeps the dragged tab inside the strip", () => {
    expect(clampDragOffset(0, -50, slots)).toBe(0);
    expect(clampDragOffset(0, 500, slots)).toBe(300);
    expect(clampDragOffset(2, 42, slots)).toBe(42);
  });
});
