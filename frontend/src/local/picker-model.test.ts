/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import type { LiveSessionInfo } from "../types";
import {
  RECENTS_LIMIT,
  RECENTS_SHOWN,
  SESSIONS_SHOWN,
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
  sessionTask,
  sessionsByNeed,
  withRecent,
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
  openTabs: [],
  recents: [],
  sessions: [],
  projects: null,
  dirs: [],
  browsePath: "/home/me/projects",
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
    case "open":
      return `open:${e.name}${e.isActive ? "!" : ""}`;
    case "recent":
      return `recent:${e.name}`;
    case "handoff":
      return `handoff:${e.handoff.name}`;
    case "more":
      return `more:${e.count}`;
    default:
      return e.kind;
  }
};
const summary = (sections: PickerSection[]) => sections.map((s) => [s.title, s.entries.map(name)]);

describe("browseSections", () => {
  it("offers open projects first, once each, the active tab's leading", () => {
    const i = input({
      openTabs: [
        { path: "/p/a", isActive: false },
        { path: "/p/b", isActive: true },
        { path: "/p/a", isActive: false },
      ],
      projects: [],
    });
    expect(summary(browseSections(i))[0]).toEqual(["open", ["open:b!", "open:a"]]);
  });

  it("offers recent projects next, leaving out the ones already open", () => {
    const i = input({
      openTabs: [{ path: "/p/a", isActive: true }],
      recents: ["/p/a", "/p/z"],
      projects: [],
    });
    expect(summary(browseSections(i))[1]).toEqual(["recent", ["recent:z"]]);
  });

  it("shows only the most recent few", () => {
    const recents = Array.from({ length: 12 }, (_, n) => `/p/r${n}`);
    const shown = browseSections(input({ recents })).find((s) => s.title === "recent")!.entries;
    expect(shown.length).toBe(RECENTS_SHOWN);
  });

  it("lists every project in the order given, marking the ones with a tab", () => {
    const i = input({
      openTabs: [{ path: "/home/me/projects/nkrdn", isActive: true }],
      projects: [project("cade"), project("nkrdn")],
    });
    expect(summary(browseSections(i))).toEqual([
      ["open", ["open:nkrdn!"]],
      ["/home/me/projects", ["project:cade", "project:nkrdn*"]],
    ]);
  });

  it("does not offer the projects folder itself as a project", () => {
    expect(browseSections(input({ projects: [project("cade")] })).flatMap((s) => s.entries).map(name)).not.toContain("here");
  });

  it("lists plain folders away from the projects folder, and the folder itself", () => {
    const i = input({ browsePath: "/srv", dirs: [{ name: "site", path: "/srv/site" }] });
    expect(summary(browseSections(i))).toEqual([["/srv", ["dir:site", "here"]]]);
  });

  it("orders sections: open, running elsewhere, recent, the folder, then the system explorer", () => {
    const i = input({
      openTabs: [{ path: "/p/a", isActive: true }],
      sessions: [session("s1", "/p/x")],
      recents: ["/p/z"],
      projects: [project("cade")],
      native: true,
    });
    expect(summary(browseSections(i))).toEqual([
      ["open", ["open:a!"]],
      ["running without a tab", ["session:s1"]],
      ["recent", ["recent:z"]],
      ["/home/me/projects", ["project:cade", "system"]],
    ]);
  });
});

describe("sessions without a tab", () => {
  const withState = (id: string, attention: string | null) =>
    ({ ...session(id, "/p/x"), attention }) as LiveSessionInfo;

  it("shows only the first few and says how many are left", () => {
    const sessions = Array.from({ length: SESSIONS_SHOWN + 3 }, (_, n) => session(`s${n}`, "/p/x"));
    const entries = browseSections(input({ sessions, projects: [] }))[0]!.entries.map(name);
    expect(entries).toEqual(["session:s0", "session:s1", "session:s2", "session:s3", "more:3"]);
  });

  it("shows them all when asked", () => {
    const sessions = Array.from({ length: SESSIONS_SHOWN + 3 }, (_, n) => session(`s${n}`, "/p/x"));
    const entries = browseSections(input({ sessions, allSessions: true, projects: [] }))[0]!.entries;
    expect(entries.length).toBe(sessions.length);
  });

  it("puts the ones waiting on the user first, then finished, then working", () => {
    const sessions = [withState("plain", null), withState("busy", "working"), withState("done", "idle"), withState("ask", "input")];
    expect(sessionsByNeed(sessions).map((s) => s.id)).toEqual(["ask", "done", "busy", "plain"]);
  });

  it("names a session by its task, without the project or the state the row already shows", () => {
    const s = (label: string | null) => ({ label, projectPath: "/home/me/projects/airplai" });
    expect(sessionTask(s("Action Required | Review model metrics | airplai"))).toBe("Review model metrics");
    expect(sessionTask(s("Review model metrics | airplai"))).toBe("Review model metrics");
    expect(sessionTask(s("release prep"))).toBe("release prep");
    expect(sessionTask(s("airplai"))).toBe("");
    expect(sessionTask(s(null))).toBe("");
  });
});

describe("projectSections", () => {
  it("offers a new session first, then the handoffs in the order given", () => {
    const sections = projectSections("/p/cade", [handoff("b", "Second"), handoff("a", "First")]);
    expect(summary(sections)).toEqual([
      ["/p/cade", ["new"]],
      ["handoffs", ["handoff:b.md", "handoff:a.md"]],
    ]);
  });

  it("has no handoffs heading for a project without any", () => {
    expect(summary(projectSections("/p/cade", []))).toEqual([["/p/cade", ["new"]]]);
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

  it("matches a project once when it is both open and in the folder", () => {
    const sections = browseSections(
      input({
        openTabs: [{ path: "/home/me/projects/cade", isActive: true }],
        projects: [project("cade")],
      }),
    );
    expect(filterSections(sections, "cade").map(name)).toEqual(["open:cade!"]);
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

describe("recents", () => {
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

  it("asks the agent to report and wait, not to start work", () => {
    const prompt = handoffPrompt("docs/plans/handoff/x.md");
    expect(prompt).toContain("wait for my go-ahead");
    expect(prompt).not.toMatch(/resume the work|continue the work/);
  });
});
