import { describe, it, expect } from "vitest";
import {
  boardSections,
  filterSections,
  finishedCount,
  groupStreams,
  leadPullRequest,
  openTarget,
  openTickets,
  sectionAt,
  sectionJump,
  stageCounts,
  stageOf,
  visibleRows,
  wantsAuthor,
  type BoardData,
  type BoardPullRequest,
  type BoardRow,
  type BoardStream,
  type BoardWorktree,
} from "./board-model";

const pr = (number: number, over: Partial<BoardPullRequest> = {}): BoardPullRequest => ({
  number, title: `PR ${number}`, url: `https://example.test/${number}`, state: "open",
  draft: false, checks: null, review: null, conflicts: false, ...over,
});
const tree = (name: string, over: Partial<BoardWorktree> = {}): BoardWorktree => ({
  name, path: `/w/repos/${name}`, repo: "platform", branch: `gary/${name}`,
  uncommitted: 0, unpushed: 0, pr: null, verdict: "local", ...over,
});
const handoff = (name: string) => ({ name, relPath: `docs/plans/handoff/${name}.md`, title: `About ${name}`, modified: 1 });
const stream = (ticket: string, over: Partial<BoardStream> = {}): BoardStream => ({
  ticket, url: `https://tracker.test/${ticket}`, title: `Title of ${ticket}`, status: "In Progress",
  statusDetail: "", parent: null, section: "Active tickets", next: "", handoff: null, missingHandoff: null,
  worktrees: [], prs: [], ...over,
});
const data = (over: Partial<BoardData> = {}): BoardData => ({
  project: "/w", hasBoardFile: true, streams: [], handoffs: [], worktrees: [], gathered: 0, ...over,
});
const group = (...tickets: BoardStream[]) => groupStreams(tickets)[0]!;
const name = (row: BoardRow): string =>
  row.kind === "group" ? row.group.key
    : row.kind === "ticket" ? `${"  ".repeat(row.depth)}${row.stream.ticket}`
    : row.kind === "handoff" ? row.handoff.name
    : row.kind === "worktree" ? row.worktree.name
    : `▸${row.title}:${row.count}`;

describe("gathering tickets into streams", () => {
  it("puts tickets that share a handoff in one stream, in the order first met", () => {
    const groups = groupStreams([
      stream("W-1", { handoff: handoff("metrics") }),
      stream("W-2", { handoff: handoff("shots") }),
      stream("W-3", { handoff: handoff("metrics") }),
    ]);
    expect(groups.map((g) => [g.key, g.tickets.map((t) => t.ticket)])).toEqual([
      ["metrics", ["W-1", "W-3"]],
      ["shots", ["W-2"]],
    ]);
  });

  it("leaves a ticket with no handoff as a stream of its own", () => {
    expect(groupStreams([stream("W-1"), stream("W-2")]).map((g) => g.key)).toEqual(["W-1", "W-2"]);
  });

  it("lists a worktree several tickets share once", () => {
    const shared = tree("metrics");
    const g = group(
      stream("W-1", { handoff: handoff("metrics"), worktrees: [shared] }),
      stream("W-2", { handoff: handoff("metrics"), worktrees: [shared, tree("other")] }),
    );
    expect(g.worktrees.map((w) => w.name)).toEqual(["metrics", "other"]);
  });
});

describe("what a pull request is waiting on", () => {
  it("wants its author when it conflicts, fails or has changes asked for", () => {
    expect(wantsAuthor(pr(1, { conflicts: true }))).toBe(true);
    expect(wantsAuthor(pr(1, { checks: "failing" }))).toBe(true);
    expect(wantsAuthor(pr(1, { review: "changes" }))).toBe(true);
  });

  it("wants its author when approved with nothing left to wait for", () => {
    expect(wantsAuthor(pr(1, { review: "approved", checks: "passing" }))).toBe(true);
    expect(wantsAuthor(pr(1, { review: "approved", checks: "running" }))).toBe(false);
  });

  it("does not want its author while waiting on checks or a reviewer, or once closed", () => {
    expect(wantsAuthor(pr(1, { checks: "running" }))).toBe(false);
    expect(wantsAuthor(pr(1, { review: "required", checks: "passing" }))).toBe(false);
    expect(wantsAuthor(pr(1, { state: "merged", conflicts: true }))).toBe(false);
  });
});

describe("what a stream needs", () => {
  const withPr = (p: BoardPullRequest, status = "In Progress") =>
    group(stream("W-1", { status, worktrees: [tree("a", { pr: p })] }));

  it("needs you when a pull request does", () => {
    expect(stageOf(withPr(pr(1, { checks: "failing" })))).toBe("needs-you");
  });

  it("is in review while a pull request is open and waiting on others", () => {
    expect(stageOf(withPr(pr(1, { checks: "running" })))).toBe("in-review");
  });

  it("is to be closed out when the pull request merged and a ticket is still open", () => {
    expect(stageOf(withPr(pr(1, { state: "merged" })))).toBe("close-out");
  });

  it("is done when every ticket is, merged or not", () => {
    expect(stageOf(withPr(pr(1, { state: "merged" }), "Done"))).toBe("done");
    expect(stageOf(group(stream("W-1", { status: "Done" })))).toBe("done");
  });

  it("is in progress with work under way and no pull request", () => {
    expect(stageOf(group(stream("W-1", { status: "In Progress" })))).toBe("in-progress");
    expect(stageOf(group(stream("W-1", { status: "In Review" })))).toBe("in-progress");
  });

  it("is queued when nothing in it has started", () => {
    expect(stageOf(group(stream("W-1", { status: "Backlog" }), stream("W-2", { status: "Todo" })))).toBe("queued");
    expect(stageOf(group(stream("W-1", { status: "" })))).toBe("queued");
  });

  it("goes by its most pressing ticket", () => {
    const g = group(
      stream("W-1", { handoff: handoff("m"), status: "Backlog" }),
      stream("W-2", { handoff: handoff("m"), status: "In Progress" }),
    );
    expect(stageOf(g)).toBe("in-progress");
    expect(openTickets(g).map((t) => t.ticket)).toEqual(["W-1", "W-2"]);
  });

  it("an open pull request outranks a merged one on the same stream", () => {
    const g = group(stream("W-1", { worktrees: [tree("a", { pr: pr(1, { state: "merged" }) }), tree("b", { pr: pr(2, { checks: "running" }) })] }));
    expect(stageOf(g)).toBe("in-review");
    expect(leadPullRequest(g)!.number).toBe(2);
  });
});

describe("the board by need", () => {
  const d = data({
    streams: [
      stream("W-1", { handoff: handoff("failing"), worktrees: [tree("a", { pr: pr(1, { checks: "failing" }) })] }),
      stream("W-2", { handoff: handoff("waiting"), worktrees: [tree("b", { pr: pr(2, { checks: "running" }) })] }),
      stream("W-3", { handoff: handoff("merged"), worktrees: [tree("c", { pr: pr(3, { state: "merged" }) })] }),
      stream("W-4", { handoff: handoff("working") }),
      stream("W-5", { handoff: handoff("later"), status: "Backlog" }),
      stream("W-6", { handoff: handoff("finished"), status: "Done" }),
      stream("W-7", { section: "Deferred tickets", status: "Todo" }),
    ],
    handoffs: [handoff("orphan")],
    worktrees: [tree("stray"), tree("gone", { verdict: "finished" })],
  });

  it("opens on what is to be acted on and folds the rest to a heading with a count", () => {
    const sections = boardSections(d);
    expect(sections.map((s) => `${s.folded ? "▸" : ""}${s.title}:${s.rows.length}`)).toEqual([
      "Needs you:1", "In review:1", "Close out:1", "In progress:1",
      "▸Queued:1", "▸Done:1", "▸Deferred tickets:1", "▸Handoffs with no ticket:1", "▸Worktrees not on the board:2",
    ]);
    expect(visibleRows(sections).map(name)).toEqual([
      "failing", "waiting", "merged", "working",
      "▸Queued:1", "▸Done:1", "▸Deferred tickets:1", "▸Handoffs with no ticket:1", "▸Worktrees not on the board:2",
    ]);
  });

  it("unfolds a section that has been toggled, and folds an open one", () => {
    const sections = boardSections(d, "need", new Set(["queued", "needs-you"]));
    expect(visibleRows(sections).map(name).slice(0, 5)).toEqual(["▸Needs you:1", "waiting", "merged", "working", "later"]);
  });

  it("leaves out sections that hold nothing", () => {
    expect(boardSections(data({ streams: [stream("W-1")] })).map((s) => s.title)).toEqual(["In progress"]);
    expect(boardSections(data())).toEqual([]);
  });

  it("says how many unlisted worktrees could go, and puts those first", () => {
    const worktrees = boardSections(d, "need", new Set(["worktrees"])).at(-1)!;
    expect(worktrees.hint).toBe("1 finished");
    expect(worktrees.rows.map(name)).toEqual(["gone", "stray"]);
  });

  it("counts the streams at each stage", () => {
    expect(stageCounts(d)).toEqual({
      "needs-you": 1, "in-review": 1, "close-out": 1, "in-progress": 1, queued: 1, done: 1,
    });
  });
});

describe("the board by parent", () => {
  const d = data({
    streams: [
      stream("W-10", { title: "Metrics" }),
      stream("W-11", { parent: "W-10" }),
      stream("W-12", { parent: "W-11" }),
      stream("W-13", { parent: "W-10" }),
      stream("W-20", { parent: "W-99" }),
      stream("W-30"),
    ],
  });
  const sections = boardSections(d, "parent");

  it("heads a section with each ticket others sit under, and nests theirs beneath", () => {
    expect(sections[0]!.title).toBe("W-10");
    expect(sections[0]!.rows.map(name)).toEqual(["W-10", "  W-11", "    W-12", "  W-13"]);
  });

  it("heads a section with a parent that is not on the board, by its id", () => {
    expect(sections[1]!.title).toBe("W-99");
    expect(sections[1]!.hint).toBe("not on the board");
    expect(sections[1]!.rows.map(name)).toEqual(["W-20"]);
  });

  it("puts tickets with no parent and no children together, folded", () => {
    const last = sections[2]!;
    expect([last.title, last.folded, last.rows.map(name)]).toEqual(["No parent recorded", true, ["W-30"]]);
  });

  it("shows the unparented tickets open when no ticket has a parent at all", () => {
    const flat = boardSections(data({ streams: [stream("W-1"), stream("W-2")] }), "parent");
    expect(flat.map((s) => [s.title, s.folded])).toEqual([["No parent recorded", false]]);
  });

  it("survives a ticket that names itself or a loop as its parent", () => {
    const loop = data({ streams: [stream("W-1", { parent: "W-2" }), stream("W-2", { parent: "W-1" }), stream("W-3", { parent: "W-3" })] });
    const rows = boardSections(loop, "parent", new Set(["parent:none"])).flatMap((s) => s.rows);
    expect(rows.filter((r) => r.kind === "ticket").length).toBeGreaterThanOrEqual(3);
  });
});

describe("searching the board", () => {
  const d = data({
    streams: [
      stream("W-214", { title: "Make the metrics page explorable", handoff: handoff("model-metrics"), worktrees: [tree("platform-metrics", { pr: pr(1559, { state: "merged" }) })], prs: [1559], parent: "W-100" }),
      stream("W-230", { title: "Possessions with selective pose", status: "Backlog" }),
    ],
    handoffs: [handoff("court-quality")],
    worktrees: [tree("stray")],
  });
  const found = (q: string) => visibleRows(filterSections(boardSections(d), q)).map(name);

  it("leaves the board as it was when nothing is typed", () => {
    expect(found("")).toEqual(visibleRows(boardSections(d)).map(name));
  });

  it("finds a stream by ticket, title, status, parent, handoff, worktree, branch or pull request", () => {
    for (const q of ["w-214", "METRICS page", "in progress", "w-100", "model-metrics", "platform-metrics", "gary/platform", "#1559"]) {
      expect(found(q), q).toEqual(["model-metrics"]);
    }
  });

  it("looks inside folded sections and shows what it finds there", () => {
    expect(found("pose")).toEqual(["W-230"]);
    expect(found("court")).toEqual(["court-quality"]);
    expect(found("stray")).toEqual(["stray"]);
  });

  it("needs every word to be there", () => {
    expect(found("metrics pose")).toEqual([]);
  });
});

describe("moving by section", () => {
  const sections = boardSections(
    data({
      streams: [
        stream("W-1", { handoff: handoff("a"), worktrees: [tree("a", { pr: pr(1, { checks: "failing" }) })] }),
        stream("W-2", { handoff: handoff("b"), worktrees: [tree("b", { pr: pr(2, { checks: "failing" }) })] }),
        stream("W-3", { handoff: handoff("c") }),
        stream("W-4", { handoff: handoff("d") }),
        stream("W-5", { status: "Backlog" }),
      ],
    }),
  );
  // Rows: 0,1 needs-you · 2,3 in-progress · 4 the folded Queued heading.

  it("jumps to the start of the next section, stopping at the last", () => {
    expect(sectionJump(sections, 0, 1)).toBe(2);
    expect(sectionJump(sections, 3, 1)).toBe(4);
    expect(sectionJump(sections, 4, 1)).toBe(4);
  });

  it("jumps back to the start of this section, then the one before", () => {
    expect(sectionJump(sections, 3, -1)).toBe(2);
    expect(sectionJump(sections, 2, -1)).toBe(0);
    expect(sectionJump(sections, 0, -1)).toBe(0);
  });

  it("knows which section a row is in", () => {
    expect(sectionAt(sections, 1)!.id).toBe("needs-you");
    expect(sectionAt(sections, 4)!.id).toBe("queued");
    expect(sectionAt(sections, 9)).toBeNull();
  });
});

describe("summaries and opening", () => {
  it("counts each removable worktree once, on the board or off it", () => {
    const shared = tree("shared", { verdict: "finished" });
    const d = data({
      streams: [stream("W-1", { worktrees: [shared] }), stream("W-2", { worktrees: [shared] })],
      worktrees: [tree("other", { verdict: "finished" }), tree("busy", { verdict: "merged-dirty" })],
    });
    expect(finishedCount(d)).toBe(2);
  });

  it("opens a stream on the project with its handoff, and has nothing to open without one", () => {
    const withHandoff = group(stream("W-1", { handoff: handoff("model-metrics") }));
    expect(openTarget({ kind: "group", group: withHandoff, stage: "in-progress" }, "/w")).toEqual({
      path: "/w", handoff: "docs/plans/handoff/model-metrics.md",
    });
    expect(openTarget({ kind: "group", group: group(stream("W-1")), stage: "in-progress" }, "/w")).toBeNull();
  });

  it("opens a ticket, a loose handoff and a worktree each on the right thing", () => {
    expect(openTarget({ kind: "ticket", stream: stream("W-1", { handoff: handoff("m") }), depth: 0 }, "/w")).toEqual({
      path: "/w", handoff: "docs/plans/handoff/m.md",
    });
    expect(openTarget({ kind: "handoff", handoff: handoff("orphan") }, "/w")).toEqual({
      path: "/w", handoff: "docs/plans/handoff/orphan.md",
    });
    expect(openTarget({ kind: "worktree", worktree: tree("stray") }, "/w")).toEqual({ path: "/w/repos/stray", handoff: null });
    expect(openTarget({ kind: "fold", id: "queued", title: "Queued", count: 1, hint: "" }, "/w")).toBeNull();
  });
});
