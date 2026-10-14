import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("requires every query character in order", () => {
    expect(fuzzyScore("abc", "a/b/c.ts")).not.toBeNull();
    expect(fuzzyScore("cba", "a/b/c.ts")).toBeNull();
  });

  it("reports the matched positions", () => {
    expect(fuzzyScore("tm", "terminal-manager.ts")!.positions).toEqual([0, 3]);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("TM", "terminal-manager.ts")).not.toBeNull();
  });
});

describe("fuzzyFilter", () => {
  const paths = [
    "frontend/src/terminal/terminal-manager.ts",
    "frontend/src/tabs/tab-manager.ts",
    "backend/terminal/sessions.py",
    "docs/plans/remote-access-overhaul.md",
  ];

  it("ranks file-name and segment-start hits first", () => {
    const [best] = fuzzyFilter("tabman", paths);
    expect(best!.path).toBe("frontend/src/tabs/tab-manager.ts");
  });

  it("prefers the shorter path on equal evidence", () => {
    const [best] = fuzzyFilter("sessions", ["a/very/long/path/to/sessions.py", "x/sessions.py"]);
    expect(best!.path).toBe("x/sessions.py");
  });

  it("returns everything for an empty query, capped", () => {
    expect(fuzzyFilter("", paths, 2)).toHaveLength(2);
  });

  it("drops non-matches", () => {
    expect(fuzzyFilter("zzz", paths)).toEqual([]);
  });
});
