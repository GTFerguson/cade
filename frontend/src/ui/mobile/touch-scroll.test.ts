import { describe, expect, it } from "vitest";
import { planTouchScroll } from "./touch-scroll";

describe("planTouchScroll", () => {
  it("spends a downward drag on the pane first, then on older lines", () => {
    // Pane scrolled 20px down; finger moves 60px down (content down).
    expect(planTouchScroll(60, 20, 100, 10)).toEqual({ pane: -20, lines: -4 });
  });

  it("spends an upward drag on the pane until its bottom, then newer lines", () => {
    expect(planTouchScroll(-50, 80, 100, 10)).toEqual({ pane: 20, lines: 3 });
  });

  it("uses only the pane when it has room", () => {
    expect(planTouchScroll(-30, 0, 100, 10)).toEqual({ pane: 30, lines: 0 });
  });

  it("goes straight to the buffer when the pane cannot scroll", () => {
    expect(planTouchScroll(25, 0, 0, 10)).toEqual({ pane: 0, lines: -2 });
  });

  it("ignores nothing-moves", () => {
    expect(planTouchScroll(0, 0, 0, 10)).toEqual({ pane: 0, lines: 0 });
  });
});
