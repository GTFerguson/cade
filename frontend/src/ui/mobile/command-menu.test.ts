import { describe, expect, it } from "vitest";
import { sessionMeta } from "./command-menu";

const pr = { number: 41, title: "Phone PR state", url: "https://example.test/41", checks: "failing" as const };

describe("what a session's row says", () => {
  it("says whether the agent wants the user, then the pull request in its tone", () => {
    expect(sessionMeta("input", pr, "/repo")).toEqual([
      { text: "needs you" },
      { text: " · " },
      { text: "#41 ✗ checks failing", tone: "bad" },
    ]);
  });

  it("gives the pull request alone when the agent wants nothing", () => {
    expect(sessionMeta(null, { ...pr, state: "merged" }, "/repo")).toEqual([
      { text: "#41 merged", tone: "good" },
    ]);
  });

  it("falls back when there is neither", () => {
    expect(sessionMeta(null, null, "/repo")).toEqual([{ text: "/repo" }]);
    expect(sessionMeta("idle", undefined, "/repo")).toEqual([{ text: "done" }]);
  });
});
