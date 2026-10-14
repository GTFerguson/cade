import { describe, expect, it } from "vitest";
import { RECENT_LIMIT, recordChange, relativeTime } from "./recent-files";

describe("recordChange", () => {
  it("puts the newest first and collapses repeats of a path", () => {
    let list = recordChange([], { path: "a", event: "modified", at: 1 });
    list = recordChange(list, { path: "b", event: "created", at: 2 });
    list = recordChange(list, { path: "a", event: "modified", at: 3 });
    expect(list.map((c) => c.path)).toEqual(["a", "b"]);
    expect(list[0]!.at).toBe(3);
  });

  it("keeps only the most recent entries", () => {
    let list: ReturnType<typeof recordChange> = [];
    for (let i = 0; i < RECENT_LIMIT + 10; i++) {
      list = recordChange(list, { path: `f${i}`, event: "modified", at: i });
    }
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]!.path).toBe(`f${RECENT_LIMIT + 9}`);
  });
});

describe("relativeTime", () => {
  it("picks the largest useful unit", () => {
    expect(relativeTime(0, 5_000)).toBe("5s");
    expect(relativeTime(0, 120_000)).toBe("2m");
    expect(relativeTime(0, 3 * 3_600_000)).toBe("3h");
    expect(relativeTime(0, 2 * 86_400_000)).toBe("2d");
  });
});
