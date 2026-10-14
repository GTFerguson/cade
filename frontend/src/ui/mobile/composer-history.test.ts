import { describe, expect, it } from "vitest";
import { COMPOSER_HISTORY_LIMIT, ComposerHistory } from "./composer-history";

describe("ComposerHistory", () => {
  it("walks back through sent prompts and forward to a blank", () => {
    const h = new ComposerHistory();
    h.push("first");
    h.push("second");
    expect(h.prev()).toBe("second");
    expect(h.prev()).toBe("first");
    expect(h.prev()).toBeNull();
    expect(h.next()).toBe("second");
    expect(h.next()).toBe("");
    expect(h.next()).toBeNull();
  });

  it("ignores blanks and immediate repeats", () => {
    const h = new ComposerHistory();
    h.push("   ");
    h.push("same");
    h.push("same");
    expect(h.size).toBe(1);
  });

  it("drops the oldest beyond the limit", () => {
    const h = new ComposerHistory();
    for (let i = 0; i < COMPOSER_HISTORY_LIMIT + 5; i++) h.push(`p${i}`);
    expect(h.size).toBe(COMPOSER_HISTORY_LIMIT);
    let oldest: string | null = null;
    for (let s = h.prev(); s !== null; s = h.prev()) oldest = s;
    expect(oldest).toBe("p5");
  });

  it("resets the cursor after a new push", () => {
    const h = new ComposerHistory();
    h.push("a");
    h.prev();
    h.push("b");
    expect(h.prev()).toBe("b");
  });
});
