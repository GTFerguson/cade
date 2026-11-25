/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import type { LiveSessionInfo } from "../types";
import {
  ago,
  browseSections,
  filterSections,
  folderName,
  handoffPrompt,
  initialAgent,
  nextAgent,
  nextGroupChoice,
  parentPath,
  parseQuery,
  projectSections,
  type AgentInfo,
  type BrowseInput,
  type PickerEntry,
  type PickerSection,
} from "./picker-model";

const session = (id: string, projectPath: string, label: string | null = null) =>
  ({ id, projectPath, label, agent: "claude", alive: true }) as LiveSessionInfo;

const project = (name: string, handoffs = 0, modified = 1000) => ({
  name,
  path: `/home/me/projects/${name}`,
  modified,
  handoffs,
});

const handoff = (name: string, title: string, modified = 1000) => ({
  name: `${name}.md`,
  relPath: `docs/plans/handoff/${name}.md`,
  title,
  modified,
});

const input = (over: Partial<BrowseInput> = {}): BrowseInput => ({
  sessions: [],
  projects: null,
  dirs: [],
  browsePath: "/home/me/projects",
  openPaths: new Set(),
  native: false,
  ...over,
});

const name = (e: PickerEntry): string => {
  switch (e.kind) {
    case "project":
      return `project:${e.project.name}${e.open ? "*" : ""}`;
    case "session":
      return `session:${e.session.id}`;
    case "dir":
      return `dir:${e.name}`;
    case "handoff":
      return `handoff:${e.handoff.name}`;
    default:
      return e.kind;
  }
};
const summary = (sections: PickerSection[]) => sections.map((s) => [s.title, s.entries.map(name)]);

describe("browseSections", () => {
  it("lists projects in the order given, marking the ones with a tab", () => {
    const i = input({
      projects: [project("cade"), project("nkrdn")],
      openPaths: new Set(["/home/me/projects/nkrdn"]),
    });
    expect(summary(browseSections(i))).toEqual([["/home/me/projects", ["project:cade", "project:nkrdn*"]]]);
  });

  it("does not offer the projects folder itself as a project", () => {
    expect(browseSections(input({ projects: [project("cade")] })).flatMap((s) => s.entries).map(name)).not.toContain("here");
  });

  it("lists plain folders away from the projects folder, and the folder itself", () => {
    const i = input({ browsePath: "/srv", dirs: [{ name: "site", path: "/srv/site" }] });
    expect(summary(browseSections(i))).toEqual([["/srv", ["dir:site", "here"]]]);
  });

  it("puts sessions to attach to first and the system dialog last", () => {
    const i = input({ sessions: [session("s1", "/p/x")], projects: [project("cade")], native: true });
    expect(summary(browseSections(i))).toEqual([
      ["running, no tab here", ["session:s1"]],
      ["/home/me/projects", ["project:cade", "system"]],
    ]);
  });
});

describe("projectSections", () => {
  it("offers a new session first, then the handoffs in the order given", () => {
    const sections = projectSections("/p/cade", [handoff("b", "Second"), handoff("a", "First")]);
    expect(summary(sections)).toEqual([
      ["/p/cade", ["new"]],
      ["handoffs", ["handoff:b.md", "handoff:a.md"]],
      [null, ["folders"]],
    ]);
  });

  it("has no handoffs heading for a project without any", () => {
    expect(summary(projectSections("/p/cade", []))).toEqual([
      ["/p/cade", ["new"]],
      [null, ["folders"]],
    ]);
  });
});

describe("filterSections", () => {
  const browse = browseSections(
    input({
      sessions: [session("s1", "/p/airplai-api", "release prep")],
      projects: [project("cade"), project("padarax"), project("nkrdn")],
      native: true,
    }),
  );

  it("matches projects by name and sessions by label", () => {
    expect(filterSections(browse, "pada").map(name)).toEqual(["project:padarax"]);
    expect(filterSections(browse, "release").map(name)).toEqual(["session:s1"]);
  });

  it("leaves out actions, which have nothing to match", () => {
    expect(filterSections(browse, "s").map(name)).not.toContain("system");
  });

  it("matches handoffs by title or file name", () => {
    const sections = projectSections("/p/cade", [handoff("tab-groups", "Organisation roadmap"), handoff("remote", "Phone work")]);
    expect(filterSections(sections, "roadmap").map(name)).toEqual(["handoff:tab-groups.md"]);
    expect(filterSections(sections, "remote").map(name)).toEqual(["handoff:remote.md"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterSections(browse, "zzzz")).toEqual([]);
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

describe("paths", () => {
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
});

describe("tab group choice", () => {
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

describe("agent choice", () => {
  const agent = (id: string, available: boolean, isDefault = false): AgentInfo => ({
    id,
    name: id,
    available,
    default: isDefault,
  });
  const both = [agent("claude-code", true, true), agent("codex", true)];

  it("starts on the agent chosen last time", () => {
    expect(initialAgent(both, "codex")).toBe("codex");
  });

  it("starts on the backend's default when nothing is remembered", () => {
    expect(initialAgent(both, null)).toBe("claude-code");
  });

  it("does not start on an agent that is not installed", () => {
    const agents = [agent("claude-code", true, true), agent("codex", false)];
    expect(initialAgent(agents, "codex")).toBe("claude-code");
  });

  it("falls back to whatever is installed when the default is not", () => {
    expect(initialAgent([agent("claude-code", false, true), agent("codex", true)], null)).toBe("codex");
  });

  it("has no agent to offer when none is installed", () => {
    expect(initialAgent([agent("codex", false)], null)).toBeNull();
    expect(nextAgent([agent("codex", false)], null)).toBeNull();
  });

  it("switches between the installed agents only", () => {
    expect(nextAgent(both, "claude-code")).toBe("codex");
    expect(nextAgent(both, "codex")).toBe("claude-code");
    expect(nextAgent([agent("claude-code", true), agent("codex", false)], "claude-code")).toBe("claude-code");
  });
});

describe("ago", () => {
  const now = 100_000_000;
  it.each([
    [now - 5, "just now"],
    [now - 5 * 60, "5m ago"],
    [now - 3 * 3600, "3h ago"],
    [now - 2 * 86400, "2d ago"],
    [now - 90 * 86400, "3mo ago"],
    [0, ""],
  ])("%d -> %s", (then, text) => {
    expect(ago(then, now)).toBe(text);
  });
});

describe("handoffPrompt", () => {
  it("tells the agent which brief to read", () => {
    expect(handoffPrompt("docs/plans/handoff/x.md")).toContain("`docs/plans/handoff/x.md`");
  });
});
