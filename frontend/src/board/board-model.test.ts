import { describe, it, expect } from "vitest";
import {
  boardSections,
  filterSections,
  finishedCount,
  leadPullRequest,
  openTarget,
  type BoardData,
  type BoardStream,
  type BoardWorktree,
} from "./board-model";

const tree = (name: string, over: Partial<BoardWorktree> = {}): BoardWorktree => ({
  name, path: `/w/repos/${name}`, repo: "platform", branch: `gary/${name}`,
  uncommitted: 0, unpushed: 0, pr: null, verdict: "local", ...over,
});
const stream = (ticket: string, over: Partial<BoardStream> = {}): BoardStream => ({
  ticket, url: `https://tracker.test/${ticket}`, title: `Title of ${ticket}`, status: "In Progress",
  statusDetail: "", section: "Active tickets", next: "", handoff: null, missingHandoff: null,
  worktrees: [], prs: [], ...over,
});
const handoff = (name: string) => ({ name, relPath: `docs/plans/handoff/${name}.md`, title: name, modified: 1 });
const data = (over: Partial<BoardData> = {}): BoardData => ({
  project: "/w", hasBoardFile: true, streams: [], handoffs: [], worktrees: [], gathered: 0, ...over,
});
const titles = (d: BoardData) => boardSections(d).map((s) => `${s.title}:${s.rows.length}`);

describe("the board's sections", () => {
  it("groups the tickets in play by status, review first and done last", () => {
    const d = data({
      streams: [
        stream("W-1", { status: "Backlog" }),
        stream("W-2", { status: "Done" }),
        stream("W-3", { status: "In Progress" }),
        stream("W-4", { status: "In Review" }),
        stream("W-5", { status: "Triage" }),
        stream("W-6", { status: "In Progress" }),
      ],
    });
    expect(titles(d)).toEqual(["In Review:1", "In Progress:2", "Backlog:1", "Triage:1", "Done:1"]);
  });

  it("keeps the board file's other headings as they are, in its order", () => {
    const d = data({
      streams: [
        stream("W-1", { section: "Deferred tickets", status: "Todo" }),
        stream("W-2"),
        stream("W-3", { section: "Coming streams", status: "" }),
      ],
    });
    expect(titles(d)).toEqual(["In Progress:1", "Deferred tickets:1", "Coming streams:1"]);
  });

  it("names a ticket in play that has no status", () => {
    expect(titles(data({ streams: [stream("W-1", { status: "" })] }))).toEqual(["No status:1"]);
  });

  it("ends with the gaps: handoffs with no ticket, then worktrees nobody listed", () => {
    const d = data({ streams: [stream("W-1")], handoffs: [handoff("orphan")], worktrees: [tree("stray")] });
    expect(titles(d)).toEqual(["In Progress:1", "Handoffs with no ticket:1", "Worktrees not on the board:1"]);
  });

  it("lists unlisted worktrees with the removable ones first", () => {
    const d = data({
      worktrees: [tree("c"), tree("b", { verdict: "in-review" }), tree("a", { verdict: "finished" }), tree("d", { verdict: "merged-dirty" })],
    });
    const names = boardSections(d)[0]!.rows.map((r) => (r.kind === "worktree" ? r.worktree.name : ""));
    expect(names).toEqual(["a", "d", "b", "c"]);
  });

  it("has no sections for an empty board", () => {
    expect(boardSections(data())).toEqual([]);
  });
});

describe("filtering the board", () => {
  const d = data({
    streams: [
      stream("W-214", { title: "Make the metrics page explorable", handoff: handoff("model-metrics"), worktrees: [tree("platform-metrics")], prs: [1559] }),
      stream("W-230", { title: "Possessions with selective pose", status: "Backlog" }),
    ],
    handoffs: [handoff("court-quality")],
  });
  const found = (q: string) =>
    filterSections(boardSections(d), q).flatMap((s) =>
      s.rows.map((r) => (r.kind === "stream" ? r.stream.ticket : r.kind === "handoff" ? r.handoff.name : r.worktree.name)),
    );

  it("leaves everything when nothing is typed", () => {
    expect(found("")).toEqual(["W-214", "W-230", "court-quality"]);
  });

  it("finds a ticket by id, title, status, handoff, worktree, branch or pull request", () => {
    for (const q of ["w-214", "METRICS page", "in progress", "model-metrics", "platform-metrics", "gary/platform", "#1559"]) {
      expect(found(q), q).toEqual(["W-214"]);
    }
  });

  it("needs every word to be there", () => {
    expect(found("metrics pose")).toEqual([]);
  });

  it("drops sections left empty", () => {
    expect(filterSections(boardSections(d), "court").map((s) => s.title)).toEqual(["Handoffs with no ticket"]);
  });
});

describe("summaries", () => {
  it("counts each removable worktree once, on the board or off it", () => {
    const shared = tree("shared", { verdict: "finished" });
    const d = data({
      streams: [stream("W-1", { worktrees: [shared] }), stream("W-2", { worktrees: [shared] })],
      worktrees: [tree("other", { verdict: "finished" }), tree("busy", { verdict: "merged-dirty" })],
    });
    expect(finishedCount(d)).toBe(2);
  });

  it("sums a stream up by its open pull request before a merged one", () => {
    const merged = { number: 1, title: "", url: "", state: "merged" as const };
    const open = { number: 2, title: "", url: "", state: "open" as const };
    expect(leadPullRequest(stream("W-1", { worktrees: [tree("a", { pr: merged }), tree("b", { pr: open })] }))!.number).toBe(2);
    expect(leadPullRequest(stream("W-1", { worktrees: [tree("a", { pr: merged })] }))!.number).toBe(1);
    expect(leadPullRequest(stream("W-1"))).toBeNull();
  });
});

describe("opening a row", () => {
  it("opens a ticket on the project with its handoff", () => {
    const row = { kind: "stream" as const, stream: stream("W-1", { handoff: handoff("model-metrics") }) };
    expect(openTarget(row, "/w")).toEqual({ path: "/w", handoff: "docs/plans/handoff/model-metrics.md" });
  });

  it("has nothing to open for a ticket with no handoff", () => {
    expect(openTarget({ kind: "stream", stream: stream("W-1") }, "/w")).toBeNull();
  });

  it("opens an unassigned handoff on the project, and a worktree on its own folder", () => {
    expect(openTarget({ kind: "handoff", handoff: handoff("orphan") }, "/w")).toEqual({
      path: "/w", handoff: "docs/plans/handoff/orphan.md",
    });
    expect(openTarget({ kind: "worktree", worktree: tree("stray") }, "/w")).toEqual({
      path: "/w/repos/stray", handoff: null,
    });
  });
});
