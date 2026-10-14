import { describe, expect, it } from "vitest";
import { pinchedSize } from "./pinch-zoom";

describe("pinchedSize", () => {
  it("scales the starting size by the spread ratio", () => {
    expect(pinchedSize(14, 100, 200)).toBe(28);
    expect(pinchedSize(14, 100, 50)).toBe(7);
  });

  it("leaves the size alone for a degenerate start", () => {
    expect(pinchedSize(14, 0, 200)).toBe(14);
  });
});
