/**
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import {
  carryStops,
  GROUP_COLOURS,
  arrangeByGroup,
  groupAutoAdds,
  groupColourVar,
  groupRollup,
  moveWithinRun,
  nearestVisible,
  newGroupName,
  nextGroupColour,
  parentFolder,
  tabRuns,
  visibleTabs,
  withAutoAdd,
  withGroupDef,
  withGroupRenamed,
  withoutGroupDef,
} from "./tab-groups";

function tab(id: string, group?: string) {
  return group ? { id, group } : { id };
}

const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id).join(" ");

describe("arrangeByGroup", () => {
  it("pulls a group's tabs together where its first tab stands", () => {
    const tabs = [tab("a"), tab("w1", "Work"), tab("b"), tab("w2", "Work"), tab("c")];
    expect(ids(arrangeByGroup(tabs))).toBe("a w1 w2 b c");
  });

  it("keeps two interleaved groups apart", () => {
    const tabs = [tab("w1", "Work"), tab("p1", "Home"), tab("w2", "Work"), tab("p2", "Home")];
    expect(ids(arrangeByGroup(tabs))).toBe("w1 w2 p1 p2");
  });

  it("leaves an already arranged list alone", () => {
    const tabs = [tab("a"), tab("w1", "Work"), tab("w2", "Work"), tab("b")];
    expect(arrangeByGroup(tabs)).toEqual(tabs);
  });
});

describe("tabRuns", () => {
  it("splits into group runs and runs of ungrouped tabs", () => {
    const runs = tabRuns([tab("a"), tab("b"), tab("w1", "Work"), tab("w2", "Work"), tab("c")]);
    expect(runs.map((r) => [r.group, ids(r.tabs)])).toEqual([
      [null, "a b"],
      ["Work", "w1 w2"],
      [null, "c"],
    ]);
  });
});

describe("visibleTabs", () => {
  it("hides the tabs of collapsed groups only", () => {
    const tabs = [tab("a"), tab("w1", "Work"), tab("p1", "Home")];
    expect(ids(visibleTabs(tabs, new Set(["Work"])))).toBe("a p1");
  });
});

describe("moveWithinRun", () => {
  const tabs = [tab("a"), tab("w1", "Work"), tab("w2", "Work"), tab("w3", "Work"), tab("b")];

  it("reorders inside the group", () => {
    expect(ids(moveWithinRun(tabs, "w1", 2))).toBe("a w2 w3 w1 b");
    expect(ids(moveWithinRun(tabs, "w3", 0))).toBe("a w3 w1 w2 b");
  });

  it("cannot carry a tab past the end of its group", () => {
    expect(ids(moveWithinRun(tabs, "w1", 9))).toBe("a w2 w3 w1 b");
  });

  it("keeps an ungrouped tab on its own side of a group", () => {
    expect(moveWithinRun(tabs, "b", 0)).toBe(tabs);
  });

  it("ignores an unknown tab", () => {
    expect(moveWithinRun(tabs, "zz", 0)).toBe(tabs);
  });
});

describe("nearestVisible", () => {
  const tabs = [tab("a"), tab("w1", "Work"), tab("w2", "Work"), tab("b")];

  it("prefers the next tab on show", () => {
    expect(nearestVisible(tabs, "w1", new Set(["Work"]))?.id).toBe("b");
  });

  it("falls back to an earlier tab", () => {
    expect(nearestVisible(tabs.slice(0, 3), "w2", new Set(["Work"]))?.id).toBe("a");
  });

  it("is null when every other tab is hidden", () => {
    expect(nearestVisible([tab("w1", "Work"), tab("w2", "Work")], "w1", new Set(["Work"]))).toBeNull();
  });
});

describe("groupRollup", () => {
  it("counts the tabs waiting on the user", () => {
    expect(groupRollup(["input", "idle", "input", "working"])).toEqual({ state: "input", waiting: 2 });
  });

  it("shows working when nothing waits", () => {
    expect(groupRollup(["idle", "working", null])).toEqual({ state: "working", waiting: 0 });
  });

  it("does not count finished tabs", () => {
    expect(groupRollup(["idle", "idle", "idle", "idle", "idle"])).toEqual({ state: "idle", waiting: 0 });
  });

  it("is quiet when no tab reports anything", () => {
    expect(groupRollup([null, null])).toEqual({ state: "none", waiting: 0 });
    expect(groupRollup([])).toEqual({ state: "none", waiting: 0 });
  });
});

describe("naming and colours", () => {
  it("numbers new groups past the names taken", () => {
    expect(newGroupName([])).toBe("Group");
    expect(newGroupName(["Group", "Group 2"])).toBe("Group 3");
  });

  it("gives a new group the first colour not in use", () => {
    const defs = [{ name: "A", colour: GROUP_COLOURS[0], paths: [] }];
    expect(nextGroupColour(defs)).toBe(GROUP_COLOURS[1]);
  });

  it("reuses the first colour once all are taken", () => {
    const defs = GROUP_COLOURS.map((colour) => ({ name: colour, colour, paths: [] }));
    expect(nextGroupColour(defs)).toBe(GROUP_COLOURS[0]);
  });

  it("draws an unknown or missing colour as the default", () => {
    expect(groupColourVar("chartreuse")).toBe(groupColourVar(undefined));
  });
});

describe("folders", () => {
  it("finds the folder above a project", () => {
    expect(parentFolder("/home/me/work/repo")).toBe("/home/me/work");
    expect(parentFolder("/home/me/work/repo/")).toBe("/home/me/work");
    expect(parentFolder("/repo")).toBeNull();
  });

  it("knows whether a group already auto-adds a folder", () => {
    const def = { name: "Work", colour: "blue", paths: ["/home/me/work/"] };
    expect(groupAutoAdds(def, "/home/me/work")).toBe(true);
    expect(groupAutoAdds(def, "/home/me/workshop")).toBe(false);
    expect(groupAutoAdds(undefined, "/home/me/work")).toBe(false);
  });
});

describe("definitions", () => {
  const work = { name: "Work", colour: "blue", paths: ["/w"] };
  const home = { name: "Home", colour: "green", paths: ["/h"] };

  it("changes one group's colour and leaves the rest", () => {
    expect(withGroupDef([work, home], "Work", { colour: "red" })).toEqual([{ ...work, colour: "red" }, home]);
  });

  it("defines a group that had no definition", () => {
    const defs = withGroupDef([{ name: "A", colour: GROUP_COLOURS[0], paths: [] }], "New");
    expect(defs[1]).toEqual({ name: "New", colour: GROUP_COLOURS[1], paths: [] });
  });

  it("renames a definition", () => {
    expect(withGroupRenamed([work, home], "Work", "AirPLAi")).toEqual([{ ...work, name: "AirPLAi" }, home]);
  });

  it("merges folders when renamed onto an existing group", () => {
    expect(withGroupRenamed([work, home], "Work", "Home")).toEqual([{ ...home, paths: ["/h", "/w"] }]);
  });

  it("leaves definitions alone when the renamed group had none", () => {
    expect(withGroupRenamed([home], "Work", "X")).toEqual([home]);
  });

  it("removes a definition", () => {
    expect(withoutGroupDef([work, home], "Work")).toEqual([home]);
  });

  it("adds and removes an auto-add folder without duplicates", () => {
    expect(withAutoAdd(work, "/w/", true)).toEqual(["/w/"]);
    expect(withAutoAdd(work, "/x", true)).toEqual(["/w", "/x"]);
    expect(withAutoAdd(work, "/w", false)).toEqual([]);
    expect(withAutoAdd(undefined, "/x", true)).toEqual(["/x"]);
  });
});

describe("where a tab can be carried", () => {
  it("lists workspaces with tabs first, then defined ones that are still empty", () => {
    expect(carryStops([null, "Work"], ["Personal", "Work"])).toEqual([null, "Work", "Personal"]);
  });

  it("is only the workspaces in use when nothing else is defined", () => {
    expect(carryStops(["Work", "Personal"], ["Work", "Personal"])).toEqual(["Work", "Personal"]);
  });
});
