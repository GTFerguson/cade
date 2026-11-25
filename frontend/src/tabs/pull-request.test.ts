import { describe, it, expect } from "vitest";
import { PR_DISPLAY, pullRequestState, pullRequestTitle, type PullRequestSummary } from "./pull-request";

const pr = (over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 12,
  title: "Add a thing",
  url: "https://example.test/pr/12",
  draft: false,
  checks: null,
  review: null,
  conflicts: false,
  ...over,
});

describe("the one state a tab shows for a pull request", () => {
  it("is plain open when nothing is known", () => {
    expect(pullRequestState(pr())).toBe("open");
  });

  it("puts a conflict above everything", () => {
    expect(pullRequestState(pr({ conflicts: true, checks: "failing", review: "approved" }))).toBe("conflicts");
  });

  it("puts failing checks above any review", () => {
    expect(pullRequestState(pr({ checks: "failing", review: "approved" }))).toBe("failing");
  });

  it("puts requested changes above checks that are fine or running", () => {
    expect(pullRequestState(pr({ checks: "passing", review: "changes" }))).toBe("changes");
    expect(pullRequestState(pr({ checks: "running", review: "changes" }))).toBe("changes");
  });

  it("shows running checks until they finish, even once approved", () => {
    expect(pullRequestState(pr({ checks: "running", review: "approved" }))).toBe("running");
  });

  it("shows approved, then passing, when nothing is wrong", () => {
    expect(pullRequestState(pr({ checks: "passing", review: "approved" }))).toBe("approved");
    expect(pullRequestState(pr({ checks: "passing", review: "required" }))).toBe("passing");
  });

  it("gives every state that needs attention its own mark", () => {
    const marks = (["conflicts", "failing", "changes", "running", "approved"] as const).map((s) => PR_DISPLAY[s].mark);
    expect(new Set(marks).size).toBe(marks.length);
    expect(marks.every((m) => m !== "")).toBe(true);
  });
});

describe("the badge's tooltip", () => {
  it("lists everything known, not only the state shown", () => {
    const text = pullRequestTitle(pr({ draft: true, checks: "passing", review: "required" }));
    expect(text).toContain("#12 Add a thing");
    expect(text).toContain("draft, checks passing, review required");
  });

  it("says open when there is nothing else to say", () => {
    expect(pullRequestTitle(pr())).toContain("\nopen\n");
  });
});
