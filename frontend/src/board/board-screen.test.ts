// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BoardScreen, pullRequestText, type BoardRead, type BoardResult } from "./board-screen";
import type { BoardData, BoardStream, BoardWorktree } from "./board-model";

const NOW = 10_000;
const tree = (name: string, over: Partial<BoardWorktree> = {}): BoardWorktree => ({
  name, path: `/w/repos/${name}`, repo: "platform", branch: `gary/${name}`,
  uncommitted: 0, unpushed: 0, pr: null, verdict: "local", ...over,
});
const stream = (ticket: string, over: Partial<BoardStream> = {}): BoardStream => ({
  ticket, url: `https://tracker.test/${ticket}`, title: `Title of ${ticket}`, status: "In Progress",
  statusDetail: "", section: "Active tickets", next: "", handoff: null, missingHandoff: null,
  worktrees: [], prs: [], ...over,
});
const handoff = (name: string) => ({ name, relPath: `docs/plans/handoff/${name}.md`, title: name, modified: NOW - 120 });

const MERGED = { number: 1559, title: "Metrics", url: "https://example.test/pull/1559", state: "merged" as const };
const DATA: BoardData = {
  project: "/w",
  hasBoardFile: true,
  gathered: NOW - 30,
  streams: [
    stream("W-214", {
      title: "Make the metrics page explorable",
      statusDetail: "25 Nov readback",
      next: "Repair the release",
      handoff: handoff("model-metrics"),
      worktrees: [tree("platform-metrics", { pr: MERGED, verdict: "finished" })],
    }),
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
const labels = () => [...host.querySelectorAll(".picker-option-label")].map((n) => n.textContent);
const sections = () => [...host.querySelectorAll(".picker-column-main .picker-section")].map((n) => n.textContent);
const selected = () => host.querySelector(".picker-option.selected .picker-option-label")?.textContent;
const detail = () => host.querySelector(".board-detail")!.textContent!;

async function open(load: (how: BoardRead) => Promise<BoardData | null> = async () => DATA) {
  openUrl = vi.fn();
  const screen = new BoardScreen(host, { project: "/w", load, openUrl, now: () => NOW });
  result = screen.show();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("the board screen", () => {
  it("says it is reading until the board arrives", async () => {
    let arrive!: (d: BoardData) => void;
    await open(() => new Promise((r) => (arrive = r)));
    expect(host.querySelector(".picker-empty")!.textContent).toContain("reading the board");
    arrive(DATA);
    await flush();
    expect(labels()).toContain("W-214");
  });

  it("shows the tickets at once and fills in the worktrees when they arrive", async () => {
    const partial: BoardData = {
      ...DATA, partial: true, worktrees: [],
      streams: DATA.streams.map((s) => ({ ...s, worktrees: [] })),
    };
    let arrive!: (d: BoardData) => void;
    await open((how) => (how === "quick" ? Promise.resolve(partial) : new Promise((r) => (arrive = r))));
    await flush();
    expect(labels()).toEqual(["W-214", "W-230", "orphan"]);
    expect(host.querySelector(".board-summary")!.textContent).toContain("reading worktrees");
    expect(detail()).toContain("reading…");

    press("j");
    arrive(DATA);
    await flush();
    await flush();
    expect(labels()).toEqual(["W-214", "W-230", "orphan", "[stray/]"]);
    // The selection stays on the row it was on.
    expect(selected()).toBe("W-230");
    expect(host.querySelector(".board-summary")!.textContent).toContain("read ");
  });

  it("lists tickets by status, then handoffs with no ticket, then unlisted worktrees", async () => {
    await open();
    expect(sections()).toEqual([
      "In Progress · 1", "Backlog · 1", "Handoffs with no ticket · 1", "Worktrees not on the board · 1",
    ]);
    expect(labels()).toEqual(["W-214", "W-230", "orphan", "[stray/]"]);
  });

  it("names the project and sums the board up", async () => {
    await open();
    expect(host.querySelector(".picker-header")!.textContent).toBe("[ W ]");
    expect(host.querySelector(".board-summary")!.textContent).toContain("2 tickets");
    expect(host.querySelector(".board-summary")!.textContent).toContain("1 worktrees finished");
  });

  it("shows everything known about the selected ticket", async () => {
    await open();
    expect(detail()).toContain("Make the metrics page explorable");
    expect(detail()).toContain("In Progress · 25 Nov readback");
    expect(detail()).toContain("model-metrics");
    expect(detail()).toContain("platform-metrics · gary/platform-metrics · finished");
    expect(detail()).toContain("#1559 merged");
    expect(detail()).toContain("Repair the release");
  });

  it("moves with j and k and shows the gaps for what it lands on", async () => {
    await open();
    press("j");
    expect(selected()).toBe("W-230");
    expect(detail()).toContain("handoffnone");
    expect(detail()).toContain("none found");
    press("G");
    expect(selected()).toBe("[stray/]");
    expect(detail()).toContain("2 uncommitted");
    press("k");
    expect(selected()).toBe("orphan");
    press("g");
    expect(selected()).toBe("W-214");
  });

  it("opens a tab on the ticket's handoff", async () => {
    await open();
    press("Enter");
    expect(await result).toEqual({ path: "/w", handoff: "docs/plans/handoff/model-metrics.md" });
    expect(host.querySelector(".board-screen")).toBeNull();
  });

  it("stays open on a ticket that has no handoff to start from", async () => {
    await open();
    press("j");
    press("Enter");
    expect(host.querySelector(".board-screen")).not.toBeNull();
  });

  it("opens the ticket and the pull request in the browser without closing", async () => {
    await open();
    press("t");
    press("p");
    expect(openUrl.mock.calls.map((c) => c[0])).toEqual([
      "https://tracker.test/W-214", "https://example.test/pull/1559",
    ]);
    expect(host.querySelector(".board-screen")).not.toBeNull();
  });

  it("filters as you type, and clears with escape", async () => {
    await open();
    press("/");
    const input = host.querySelector<HTMLInputElement>(".picker-filter-input")!;
    input.value = "pose";
    input.dispatchEvent(new Event("input"));
    expect(labels()).toEqual(["W-230"]);
    press("Escape");
    expect(labels()).toHaveLength(4);
    expect(host.querySelector(".board-screen")).not.toBeNull();
  });

  it("reads the board again on r, past the cache", async () => {
    const load = vi.fn(async (_how: BoardRead) => DATA);
    await open(load);
    press("r");
    await flush();
    expect(load.mock.calls.map((c) => c[0])).toEqual(["quick", "full", "fresh"]);
  });

  it("closes on escape with nothing chosen", async () => {
    await open();
    press("Escape");
    expect(await result).toBeNull();
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

describe("a pull request in a few words", () => {
  it("says merged and closed plainly", () => {
    expect(pullRequestText(MERGED)).toEqual({ text: "#1559 merged", tone: "good" });
    expect(pullRequestText({ ...MERGED, state: "closed" }).text).toBe("#1559 closed");
  });

  it("gives an open one its state and mark", () => {
    const failing = { ...MERGED, state: "open" as const, checks: "failing" as const, review: null, conflicts: false, draft: false };
    expect(pullRequestText(failing)).toEqual({ text: "#1559 ✗ checks failing", tone: "bad" });
  });
});
