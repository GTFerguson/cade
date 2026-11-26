// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { ContextStrip, effectivePullRequest, stripCells, type ContextTicket, type SessionContext } from "./context-strip";
import type { PullRequestSummary } from "./pull-request";

const NOW = 100_000;
const pr = (over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 12, title: "Add a thing", url: "https://example.test/pr/12",
  draft: false, checks: null, review: null, conflicts: false, ...over,
});
const context = (over: Partial<SessionContext> = {}): SessionContext => ({
  branch: "feature", uncommitted: 0, unpushed: 0, handoff: null, ...over,
});
const text = (cells: ReturnType<typeof stripCells>) =>
  cells.map((c) => c.parts.map((p) => p.text).join(""));

describe("what the strip says", () => {
  it("says nothing when nothing is known", () => {
    expect(stripCells(null, null, NOW)).toEqual([]);
  });

  it("leads with the pull request's state and adds what that leaves unsaid", () => {
    const cells = stripCells(pr({ checks: "failing", review: "required" }), null, NOW);
    expect(text(cells)).toEqual(["#12 ✗ checks failing · review required"]);
    expect(cells[0]!.parts[0]!.tone).toBe("bad");
    expect(cells[0]!.open).toEqual({ url: "https://example.test/pr/12" });
  });

  it("does not repeat the leading state among the extras", () => {
    expect(text(stripCells(pr({ checks: "passing", review: "approved" }), null, NOW))).toEqual(["#12 ✓ approved"]);
    expect(text(stripCells(pr({ conflicts: true, checks: "failing" }), null, NOW))).toEqual([
      "#12 ≠ conflicts with its base · checks failing",
    ]);
  });

  it("names the branch and what is pending on it", () => {
    expect(text(stripCells(null, context({ uncommitted: 3, unpushed: 2 }), NOW))).toEqual([
      "branch feature · 3 uncommitted · 2 unpushed",
    ]);
  });

  it("calls a branch with nothing pending clean, upstream or not", () => {
    expect(text(stripCells(null, context(), NOW))).toEqual(["branch feature · clean"]);
    expect(text(stripCells(null, context({ unpushed: null }), NOW))).toEqual(["branch feature · clean"]);
  });

  it("names the latest handoff with its age, and opens it", () => {
    const handoff = { name: "model-metrics", relPath: "docs/plans/handoff/model-metrics.md", title: "Metrics", modified: NOW - 240 };
    const cells = stripCells(null, context({ branch: null, handoff }), NOW);
    expect(text(cells)).toEqual(["handoff model-metrics 4m"]);
    expect(cells[0]!.open).toEqual({ file: "docs/plans/handoff/model-metrics.md" });
  });

  it("orders pull request, branch, handoff", () => {
    const handoff = { name: "h", relPath: "h.md", title: "H", modified: NOW };
    expect(stripCells(pr(), context({ handoff }), NOW).map((c) => c.kind)).toEqual(["pr", "branch", "handoff"]);
  });
});

describe("a tab on its own stream", () => {
  const ticket = (id: string, over: Partial<ContextTicket> = {}): ContextTicket => ({
    ticket: id, title: `Title of ${id}`, url: `https://tracker.test/${id}`, status: "In Progress", statusType: "started", ...over,
  });
  const handoff = { name: "model-metrics", relPath: "docs/plans/handoff/model-metrics.md", title: "Metrics", modified: NOW - 240, source: "titled" };

  it("leads with the ticket it is on, and says how many more the handoff carries", () => {
    const cells = stripCells(null, context({ tickets: [ticket("W-1"), ticket("W-2"), ticket("W-3")] }), NOW);
    expect(cells[0]!.kind).toBe("ticket");
    expect(text(cells)[0]).toBe("W-1 In Progress +2  Title of W-1");
    expect(cells[0]!.open).toEqual({ url: "https://tracker.test/W-1" });
  });

  it("leads with a ticket still open, not one already finished", () => {
    const cells = stripCells(null, context({ tickets: [ticket("W-1", { status: "Done", statusType: "completed" }), ticket("W-2")] }), NOW);
    expect(text(cells)[0]).toContain("W-2 In Progress +1");
  });

  it("leads with a ticket under way before one still in the backlog", () => {
    const cells = stripCells(null, context({ tickets: [ticket("W-1", { status: "Backlog", statusType: "backlog" }), ticket("W-2")] }), NOW);
    expect(text(cells)[0]).toContain("W-2 In Progress +1");
  });

  it("shows the stream's pull request in place of the folder's", () => {
    const stream = { number: 77, title: "Stream PR", url: "https://example.test/pr/77", state: "open" as const, draft: false, checks: "running" as const, review: null, conflicts: false };
    const cells = stripCells(pr({ checks: "failing" }), context({ pr: stream }), NOW);
    expect(text(cells)).toContain("#77 \u2026 checks running");
    expect(text(cells).join()).not.toContain("#12");
  });

  it("says a merged or closed pull request plainly", () => {
    const merged = { number: 77, title: "Stream PR", url: "https://example.test/pr/77", state: "merged" as const };
    const cells = stripCells(null, context({ pr: merged }), NOW);
    expect(text(cells)).toContain("#77 merged");
    expect(cells.find((c) => c.kind === "pr")!.parts[0]!.tone).toBe("good");
    expect(text(stripCells(null, context({ pr: { ...merged, state: "closed" } }), NOW))).toContain("#77 closed");
  });

  it("shows the stream's worktree in place of the folder the tab was opened on", () => {
    const cells = stripCells(null, context({ branch: "main", worktree: { name: "platform-metrics", branch: "gary/metrics", uncommitted: 2, unpushed: 0 } }), NOW);
    expect(text(cells)).toEqual(["branch gary/metrics \u00b7 2 uncommitted"]);
    expect(cells[0]!.title).toBe("worktree platform-metrics");
  });

  it("falls back on the folder when the stream has no worktree", () => {
    expect(text(stripCells(null, context({ branch: "main", worktree: null }), NOW))).toEqual(["branch main \u00b7 clean"]);
  });

  it("says how the handoff is known", () => {
    const cells = stripCells(null, context({ branch: null, handoff }), NOW);
    expect(cells[0]!.title).toContain("the handoff this tab's title names");
  });

  it("orders ticket, pull request, branch, handoff", () => {
    const stream = { number: 77, title: "t", url: "u", state: "merged" as const };
    const cells = stripCells(null, context({ tickets: [ticket("W-1")], pr: stream, handoff }), NOW);
    expect(cells.map((c) => c.kind)).toEqual(["ticket", "pr", "branch", "handoff"]);
  });

  it("gives the tab's badge the stream's pull request before the folder's", () => {
    const stream = { number: 77, title: "t", url: "u", state: "open" as const };
    expect(effectivePullRequest(pr(), context({ pr: stream }))!.number).toBe(77);
    expect(effectivePullRequest(pr(), context())!.number).toBe(12);
    expect(effectivePullRequest(null, null)).toBeNull();
  });
});

describe("the strip element", () => {
  it("is hidden until there is something to say, and again when there is not", () => {
    const strip = new ContextStrip({ onOpenUrl: vi.fn(), onOpenFile: vi.fn() });
    expect(strip.element.hidden).toBe(true);
    strip.setContext(context());
    expect(strip.element.hidden).toBe(false);
    strip.setContext(null);
    expect(strip.element.hidden).toBe(true);
    strip.dispose();
  });

  it("opens the pull request and the handoff from their cells", () => {
    const onOpenUrl = vi.fn();
    const onOpenFile = vi.fn();
    const strip = new ContextStrip({ onOpenUrl, onOpenFile });
    strip.setPullRequest(pr());
    strip.setContext(context({ handoff: { name: "h", relPath: "docs/h.md", title: "H", modified: 1 } }));
    strip.element.querySelector<HTMLElement>('[data-kind="pr"]')!.click();
    strip.element.querySelector<HTMLElement>('[data-kind="handoff"]')!.click();
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.test/pr/12");
    expect(onOpenFile).toHaveBeenCalledWith("docs/h.md");
    expect(strip.element.querySelector('[data-kind="branch"]')!.tagName).toBe("SPAN");
    strip.dispose();
  });
});
