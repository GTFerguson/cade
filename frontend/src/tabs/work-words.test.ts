import { describe, it, expect } from "vitest";
import { isDone, isQueued, pullRequestWords, ticketTone, type AnyPullRequest } from "./work-words";

const pr = (over: Partial<AnyPullRequest> = {}): AnyPullRequest => ({
  number: 9, title: "A change", url: "https://example.test/9", ...over,
});

describe("a ticket's status", () => {
  it("is read from the tracker's kind of state when there is one", () => {
    expect(isDone({ status: "Shipped", statusType: "completed" })).toBe(true);
    expect(isDone({ status: "Done", statusType: "started" })).toBe(false);
    expect(isQueued({ status: "Up next", statusType: "unstarted" })).toBe(true);
  });

  it("is read from its name when a board file is all there is", () => {
    expect(isDone({ status: "Done" })).toBe(true);
    expect(isQueued({ status: "Backlog" })).toBe(true);
    expect(isQueued({ status: "" })).toBe(true);
    expect(isDone({ status: "In Progress" })).toBe(false);
  });

  it("gets a tone for each of finished, waiting, in review and under way", () => {
    expect(ticketTone({ status: "Done" })).toBe("good");
    expect(ticketTone({ status: "Backlog" })).toBe("muted");
    expect(ticketTone({ status: "In Review", statusType: "started" })).toBe("review");
    expect(ticketTone({ status: "Building", statusType: "started" })).toBe("busy");
  });
});

describe("a pull request in words", () => {
  it("says merged and closed plainly, with nothing more", () => {
    expect(pullRequestWords(pr({ state: "merged", checks: "failing" }))).toEqual({ text: "#9 merged", tone: "good", rest: [] });
    expect(pullRequestWords(pr({ state: "closed" }))).toEqual({ text: "#9 closed", tone: "muted", rest: [] });
  });

  it("treats one with no state as open", () => {
    expect(pullRequestWords(pr({ checks: "failing" })).text).toBe("#9 ✗ checks failing");
  });

  it("leads with what matters most and lists what that leaves unsaid", () => {
    const words = pullRequestWords(pr({ state: "open", conflicts: true, checks: "failing", review: "required", draft: true }));
    expect(words.text).toBe("#9 ≠ conflicts with its base");
    expect(words.tone).toBe("bad");
    expect(words.rest).toEqual(["draft", "checks failing", "review required"]);
  });

  it("does not repeat the leading state among the rest", () => {
    expect(pullRequestWords(pr({ checks: "passing", review: "approved" })).rest).toEqual([]);
  });
});
