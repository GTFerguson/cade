/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import type { LiveSessionInfo } from "../types";
import {
  RECENTS_LIMIT,
  buildSections,
  filterEntries,
  folderName,
  nextGroupChoice,
  parentPath,
  parseQuery,
  withRecent,
  type PickerInput,
} from "./picker-model";

const session = (id: string, projectPath: string, label: string | null = null) =>
  ({ id, projectPath, label, agent: "claude", alive: true }) as LiveSessionInfo;

const input = (over: Partial<PickerInput> = {}): PickerInput => ({
  openTabs: [],
  sessions: [],
  recents: [],
  dirs: [],
  browsePath: "/home/me/projects",
  native: false,
  ...over,
});

const summary = (i: PickerInput) =>
  buildSections(i).map((s) => [
    s.title,
    s.entries.map((e) => ("path" in e ? `${e.kind}:${e.path}` : e.kind === "session" ? `session:${e.session.id}` : e.kind)),
  ]);

describe("buildSections", () => {
  it("offers only the folder itself when there is nothing else", () => {
    expect(summary(input())).toEqual([["/home/me/projects", ["here:/home/me/projects"]]]);
  });

  it("lists open projects once each, the active tab's first", () => {
    const tabs = [
      { path: "/p/a", name: "a", isActive: false },
      { path: "/p/b", name: "b: renamed", isActive: true },
      { path: "/p/a", name: "a second", isActive: false },
    ];
    expect(summary(input({ openTabs: tabs }))[0]).toEqual(["open", ["open:/p/b", "open:/p/a"]]);
  });

  it("names an open project by its folder, not the tab's own name", () => {
    const tabs = [{ path: "/p/b", name: "b: renamed", isActive: true }];
    expect(buildSections(input({ openTabs: tabs }))[0]!.entries[0]).toMatchObject({ name: "b" });
  });

  it("does not repeat an open project under recent", () => {
    const i = input({
      openTabs: [{ path: "/p/a", name: "a", isActive: true }],
      recents: ["/p/a", "/p/z"],
    });
    expect(summary(i)[1]).toEqual(["recent", ["recent:/p/z"]]);
  });

  it("orders sections: open, running elsewhere, recent, then the folder listing", () => {
    const i = input({
      openTabs: [{ path: "/p/a", name: "a", isActive: true }],
      sessions: [session("s1", "/p/s")],
      recents: ["/p/z"],
      dirs: [{ name: "d", path: "/home/me/projects/d" }],
      native: true,
    });
    expect(summary(i)).toEqual([
      ["open", ["open:/p/a"]],
      ["running, no tab here", ["session:s1"]],
      ["recent", ["recent:/p/z"]],
      ["/home/me/projects", ["dir:/home/me/projects/d", "here:/home/me/projects", "system"]],
    ]);
  });

  it("shows only the most recent few until something is typed", () => {
    const recents = Array.from({ length: 12 }, (_, n) => `/p/r${n}`);
    const shown = buildSections(input({ recents })).find((s) => s.title === "recent")!.entries;
    expect(shown.length).toBeLessThan(recents.length);
    expect(filterEntries(input({ recents }), "r11").map((e) => ("path" in e ? e.path : ""))).toEqual(["/p/r11"]);
  });
});

describe("filterEntries", () => {
  const i = input({
    openTabs: [{ path: "/p/cade", name: "cade", isActive: true }],
    sessions: [session("s1", "/p/airplai-api", "release prep")],
    recents: ["/p/padarax"],
    dirs: [{ name: "nkrdn", path: "/home/me/projects/nkrdn" }],
    native: true,
  });
  const kinds = (q: string) => filterEntries(i, q).map((e) => e.kind);

  it("searches open projects, sessions, recents and folders together", () => {
    expect(kinds("cade")).toEqual(["open"]);
    expect(kinds("release")).toEqual(["session"]);
    expect(kinds("pada")).toEqual(["recent"]);
    expect(kinds("nk")).toEqual(["dir"]);
  });

  it("leaves out the actions, which have nothing to match", () => {
    expect(kinds("")).not.toContain("here");
    expect(kinds("")).not.toContain("system");
  });

  it("returns nothing when nothing matches", () => {
    expect(kinds("zzzz")).toEqual([]);
  });
});

describe("parseQuery", () => {
  it("treats plain text as a filter", () => {
    expect(parseQuery("cade")).toEqual({ browse: null, filter: "cade" });
  });

  it("splits a path into the folder to list and a filter for it", () => {
    expect(parseQuery("/home/me/pro")).toEqual({ browse: "/home/me", filter: "pro" });
    expect(parseQuery("~/projects/")).toEqual({ browse: "~/projects", filter: "" });
    expect(parseQuery("/et")).toEqual({ browse: "/", filter: "et" });
  });

  it("waits for a slash before browsing from the home folder", () => {
    expect(parseQuery("~")).toEqual({ browse: null, filter: "" });
  });
});

describe("paths and recents", () => {
  it("names a folder", () => {
    expect(folderName("/home/me/projects/cade/")).toBe("cade");
  });

  it("finds the folder above and stops at the top", () => {
    expect(parentPath("/home/me/projects")).toBe("/home/me");
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/")).toBe("/");
    expect(parentPath("~/projects")).toBe("~");
    expect(parentPath("~")).toBe("~");
  });

  it("moves a reopened project to the front without repeating it", () => {
    expect(withRecent(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
  });

  it("forgets the oldest past the limit", () => {
    const full = Array.from({ length: RECENTS_LIMIT }, (_, n) => `/p/${n}`);
    const next = withRecent(full, "/new");
    expect(next.length).toBe(RECENTS_LIMIT);
    expect(next[0]).toBe("/new");
    expect(next).not.toContain(`/p/${RECENTS_LIMIT - 1}`);
  });
});

describe("nextGroupChoice", () => {
  it("cycles from automatic through each group and back", () => {
    const groups = ["Work", "Home"];
    expect(nextGroupChoice(null, groups)).toBe("Work");
    expect(nextGroupChoice("Work", groups)).toBe("Home");
    expect(nextGroupChoice("Home", groups)).toBeNull();
  });

  it("stays automatic when there are no groups", () => {
    expect(nextGroupChoice(null, [])).toBeNull();
  });
});
