// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { ContextStrip, stripCells, type SessionContext } from "./context-strip";
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
