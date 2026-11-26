// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BoardScreen, compactTickets, groupAside, pullRequestText, type BoardRead, type BoardResult } from "./board-screen";
import { groupStreams, type BoardData, type BoardPullRequest, type BoardStream, type BoardWorktree } from "./board-model";

const NOW = 10_000;
const pr = (number: number, over: Partial<BoardPullRequest> = {}): BoardPullRequest => ({
  number, title: `PR ${number}`, url: `https://example.test/pull/${number}`, state: "open",
  draft: false, checks: null, review: null, conflicts: false, ...over,
});
const tree = (name: string, over: Partial<BoardWorktree> = {}): BoardWorktree => ({
  name, path: `/w/repos/${name}`, repo: "platform", branch: `gary/${name}`,
  uncommitted: 0, unpushed: 0, pr: null, verdict: "local", ...over,
});
const handoff = (name: string) => ({ name, relPath: `docs/plans/handoff/${name}.md`, title: `About ${name}`, modified: NOW - 120 });
const stream = (ticket: string, over: Partial<BoardStream> = {}): BoardStream => ({
  ticket, url: `https://tracker.test/${ticket}`, title: `Title of ${ticket}`, status: "In Progress",
  statusDetail: "", parent: null, section: "Active tickets", next: "", handoff: null, missingHandoff: null,
  worktrees: [], prs: [], ...over,
});

const DATA: BoardData = {
  project: "/w",
  hasBoardFile: true,
  gathered: NOW - 30,
  streams: [
    stream("W-214", {
      title: "Make the metrics page explorable", handoff: handoff("model-metrics"), next: "Repair the release",
      worktrees: [tree("platform-metrics", { uncommitted: 3, pr: pr(1561, { checks: "failing" }), verdict: "in-review" })],
    }),
    stream("W-215", { handoff: handoff("model-metrics"), parent: "W-214", next: "Verify the release" }),
    stream("W-198", { handoff: handoff("shot-precision"), worktrees: [tree("shot", { pr: pr(1540, { checks: "running" }), verdict: "in-review" })] }),
    stream("W-180", { handoff: handoff("decode"), worktrees: [tree("decode", { pr: pr(1498, { state: "merged" }), verdict: "finished" })] }),
    stream("W-300", { title: "Camera work" }),
    stream("W-230", { title: "Possessions with selective pose", status: "Backlog" }),
  ],
  handoffs: [handoff("orphan")],
  worktrees: [tree("stray", { uncommitted: 2 })],
};

let host: HTMLElement;
let openUrl: ReturnType<typeof vi.fn>;
let result: Promise<BoardResult | null>;

const press = (key: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const flush = () => new Promise((r) => setTimeout(r, 0));
const labels = () => [...host.querySelectorAll(".board-row .picker-option-label")].map((n) => n.textContent);
const headings = () => [...host.querySelectorAll(".board-section-title")].map((n) => n.textContent);
const selected = () => host.querySelector(".board-row.selected .picker-option-label")?.textContent;
const detail = () => host.querySelector(".board-detail")!.textContent!;
const summary = () => host.querySelector(".board-summary")!.textContent!;
const search = (text: string) => {
  press("/");
  const input = host.querySelector<HTMLInputElement>(".picker-filter-input")!;
  input.dispatchEvent(new Event("focus"));
  input.value = text;
  input.dispatchEvent(new Event("input"));
};

async function open(load: (how: BoardRead) => Promise<BoardData | null> = async () => DATA) {
  openUrl = vi.fn();
  const screen = new BoardScreen(host, { project: "/w", load, openUrl, now: () => NOW });
  result = screen.show();
  await flush();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("what the board opens on", () => {
  it("lists streams by what they need, and folds the rest to headings", async () => {
    await open();
    expect(headings()).toEqual(["Needs you", "In review", "Close out", "In progress"]);
    expect(labels()).toEqual([
      "model-metrics", "shot-precision", "decode", "W-300",
      "+ Queued", "+ Handoffs with no ticket", "+ Worktrees not on the board",
    ]);
  });

  it("shows one row for a handoff however many tickets it carries", async () => {
    await open();
    const row = host.querySelector(".board-row")!;
    expect(row.querySelector(".picker-option-meta")!.textContent).toBe("W-214 215");
    expect(row.querySelector(".picker-option-aside")!.textContent).toBe("#1561 ✗ checks failing");
  });

  it("sums up what there is to do", async () => {
    await open();
    expect(summary()).toContain("1 needs you");
    expect(summary()).toContain("1 in review");
    expect(summary()).toContain("1 to close out");
    expect(summary()).toContain("1 in progress");
    expect(summary()).toContain("1 worktrees finished");
    expect(summary()).toContain("by what it needs");
  });

  it("offers the search line without being asked", async () => {
    await open();
    const input = host.querySelector<HTMLInputElement>(".picker-filter-input")!;
    expect(host.querySelector<HTMLElement>(".board-filter")!.hidden).toBe(false);
    expect(input.placeholder).toContain("search");
  });

  it("says it is reading until the board arrives", async () => {
    let arrive!: (d: BoardData) => void;
    await open(() => new Promise((r) => (arrive = r)));
    expect(host.querySelector(".picker-empty")!.textContent).toContain("reading the board");
    arrive(DATA);
    await flush();
    await flush();
    expect(labels()).toContain("model-metrics");
  });

  it("shows the tickets at once and fills in the worktrees when they arrive", async () => {
    const partial: BoardData = {
      ...DATA, partial: true, worktrees: [],
      streams: DATA.streams.map((s) => ({ ...s, worktrees: [] })),
    };
    let arrive!: (d: BoardData) => void;
    await open((how) => (how === "quick" ? Promise.resolve(partial) : new Promise((r) => (arrive = r))));
    // With no worktrees read, nothing is known to need anyone yet.
    expect(headings()).toEqual(["In progress"]);
    expect(summary()).toContain("reading worktrees");
    press("j");
    const held = selected();
    arrive(DATA);
    await flush();
    await flush();
    expect(headings()).toEqual(["Needs you", "In review", "Close out", "In progress"]);
    expect(selected()).toBe(held);
  });
});

describe("a stream's detail", () => {
  it("lists its tickets, what carries it and what is next", async () => {
    await open();
    expect(detail()).toContain("About model-metrics");
    expect(detail()).toContain("2 tickets");
    expect(detail()).toContain("W-214In ProgressMake the metrics page explorable");
    expect(detail()).toContain("under W-214");
    expect(detail()).toContain("platform-metrics · gary/platform-metrics · 3 uncommitted · in review");
    expect(detail()).toContain("#1561 ✗ checks failing");
    expect(detail()).toContain("W-214  Repair the release");
    expect(detail()).toContain("W-215  Verify the release");
  });

  it("says what a stream with no handoff or worktree is missing", async () => {
    await open();
    press("G");
    press("k"); press("k"); press("k");
    expect(selected()).toBe("W-300");
    expect(detail()).toContain("handoffnone");
    expect(detail()).toContain("none found");
  });
});

describe("moving about", () => {
  it("jumps between sections with ] and [", async () => {
    await open();
    press("]");
    expect(selected()).toBe("shot-precision");
    press("]"); press("]"); press("]");
    expect(selected()).toBe("+ Queued");
    press("["); press("[");
    expect(selected()).toBe("decode");
  });

  it("unfolds a folded section on enter and lands on what was inside", async () => {
    await open();
    press("]"); press("]"); press("]"); press("]");
    expect(selected()).toBe("+ Queued");
    expect(detail()).toContain("1 folded away");
    press("Enter");
    expect(headings()).toContain("Queued");
    expect(selected()).toBe("W-230");
  });

  it("folds the section the selection is in with h, and stays on its heading", async () => {
    await open();
    press("h");
    expect(headings()).toEqual(["In review", "Close out", "In progress"]);
    expect(selected()).toBe("+ Needs you");
  });

  it("switches to the view by parent and back", async () => {
    await open();
    press("v");
    expect(summary()).toContain("by parent ticket");
    expect(headings()).toEqual(["W-214"]);
    expect(labels().slice(0, 2)).toEqual(["W-214", "W-215"]);
    expect(host.querySelectorAll('.board-row[data-nested="true"]')).toHaveLength(1);
    press("v");
    expect(summary()).toContain("by what it needs");
  });
});

describe("searching", () => {
  it("finds things inside folded sections", async () => {
    await open();
    search("pose");
    expect(labels()).toEqual(["W-230"]);
    search("stray");
    expect(labels()).toEqual(["[stray/]"]);
  });

  it("gives the whole board back on the first escape and closes on the second", async () => {
    await open();
    search("pose");
    press("Enter");
    expect(labels()).toEqual(["W-230"]);
    press("Escape");
    expect(labels()).toHaveLength(7);
    expect(host.querySelector(".board-screen")).not.toBeNull();
    press("Escape");
    expect(await result).toBeNull();
  });
});

describe("acting on a row", () => {
  it("opens a tab on the stream's handoff", async () => {
    await open();
    press("Enter");
    expect(await result).toEqual({ path: "/w", handoff: "docs/plans/handoff/model-metrics.md" });
    expect(host.querySelector(".board-screen")).toBeNull();
  });

  it("stays open on a stream that has no handoff to start from", async () => {
    await open();
    press("]"); press("]"); press("]");
    expect(selected()).toBe("W-300");
    press("Enter");
    expect(host.querySelector(".board-screen")).not.toBeNull();
  });

  it("opens the ticket and the pull request in the browser without closing", async () => {
    await open();
    press("t");
    press("p");
    expect(openUrl.mock.calls.map((c) => c[0])).toEqual([
      "https://tracker.test/W-214", "https://example.test/pull/1561",
    ]);
    expect(host.querySelector(".board-screen")).not.toBeNull();
  });

  it("reads the board again on r, past the cache", async () => {
    const load = vi.fn(async (_how: BoardRead) => DATA);
    await open(load);
    press("r");
    await flush();
    expect(load.mock.calls.map((c) => c[0])).toEqual(["quick", "full", "fresh"]);
  });

  it("says so when the board cannot be read", async () => {
    await open(async () => null);
    expect(host.querySelector(".picker-empty")!.textContent).toContain("could not be read");
  });

  it("swallows plain keys so they are not typed into the terminal behind", async () => {
    await open();
    const e = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("the words on a row", () => {
  const groupOf = (...tickets: BoardStream[]) => groupStreams(tickets)[0]!;

  it("writes a stream's tickets with their shared prefix once", () => {
    expect(compactTickets(["PLAI-1462", "PLAI-1614", "PLAI-1615"])).toBe("PLAI-1462 1614 1615");
    expect(compactTickets(["PLAI-1462"])).toBe("PLAI-1462");
    expect(compactTickets(["PLAI-1", "OPS-2"])).toBe("PLAI-1 OPS-2");
    expect(compactTickets([])).toBe("");
  });

  it("says a merged stream has tickets left to close", () => {
    const g = groupOf(
      stream("W-1", { handoff: handoff("m"), worktrees: [tree("a", { pr: pr(9, { state: "merged" }) })] }),
      stream("W-2", { handoff: handoff("m"), status: "Done" }),
    );
    expect(groupAside(g, "close-out")).toEqual({ text: "#9 merged · 1 to close", tone: "warn" });
  });

  it("says an approved pull request is ready to merge", () => {
    const g = groupOf(stream("W-1", { worktrees: [tree("a", { pr: pr(9, { review: "approved", checks: "passing" }) })] }));
    expect(groupAside(g, "needs-you").text).toBe("#9 ✓ ready to merge");
  });

  it("says merged and closed pull requests plainly, and gives an open one its state", () => {
    expect(pullRequestText(pr(1559, { state: "merged" }))).toEqual({ text: "#1559 merged", tone: "good" });
    expect(pullRequestText(pr(1559, { state: "closed" })).text).toBe("#1559 closed");
    expect(pullRequestText(pr(1559, { checks: "failing" }))).toEqual({ text: "#1559 ✗ checks failing", tone: "bad" });
  });
});
