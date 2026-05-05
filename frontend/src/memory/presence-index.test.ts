import { describe, it, expect, beforeEach } from "vitest";
import { MemoryPresenceIndex } from "./presence-index";
import type { NkrdnGraphMessage } from "./types";

function fakeWS(): any {
  return { on: () => {}, off: () => {} };
}

function mkSym(name: string, file: string, memTypes: ("decision" | "attempt" | "note")[]): any {
  return {
    uuid: name,
    name,
    fqn: name,
    kind: "function",
    file,
    memories: memTypes.map((t, i) => ({
      uuid: `${name}-mem-${i}`,
      type: t,
      title: `${t} ${i}`,
      date: "2026-05-05",
    })),
    children: [],
  };
}

function graph(syms: any[]): NkrdnGraphMessage {
  return {
    type: "nkrdn-graph",
    modules: [{ name: "root", path: "", children: syms }],
    tombstoned: [],
    orphans: [],
    stats: { symbols: syms.length, memories: 0, orphans: 0 },
  };
}

describe("MemoryPresenceIndex", () => {
  let idx: MemoryPresenceIndex;

  beforeEach(() => {
    idx = new MemoryPresenceIndex(fakeWS());
  });

  it("returns null for files with no memory", () => {
    idx.ingest(graph([mkSym("Foo", "src/foo.ts", [])]));
    expect(idx.getCountsForFile("src/foo.ts")).toBeNull();
  });

  it("counts memories per type per file", () => {
    idx.ingest(graph([
      mkSym("Foo", "src/foo.ts", ["decision", "decision", "note"]),
      mkSym("Bar", "src/foo.ts", ["attempt"]),
      mkSym("Baz", "src/baz.ts", ["note"]),
    ]));
    expect(idx.getCountsForFile("src/foo.ts")).toEqual({
      decision: 2, attempt: 1, note: 1, total: 4,
    });
    expect(idx.getCountsForFile("src/baz.ts")).toEqual({
      decision: 0, attempt: 0, note: 1, total: 1,
    });
  });

  it("excludes archived and superseded entries", () => {
    const sym = mkSym("Foo", "src/foo.ts", ["decision", "decision", "note"]);
    sym.memories[0].archived = true;
    sym.memories[1].superseded_by = "some-other";
    idx.ingest(graph([sym]));
    expect(idx.getCountsForFile("src/foo.ts")).toEqual({
      decision: 0, attempt: 0, note: 1, total: 1,
    });
  });

  it("matches absolute paths under the project root", () => {
    idx.setProjectRoot("/home/gary/projects/cade");
    idx.ingest(graph([mkSym("Foo", "backend/main.py", ["decision"])]));
    expect(idx.getCountsForFile("/home/gary/projects/cade/backend/main.py"))
      .toEqual({ decision: 1, attempt: 0, note: 0, total: 1 });
    expect(idx.getCountsForFile("backend/main.py"))
      .toEqual({ decision: 1, attempt: 0, note: 0, total: 1 });
  });

  it("normalizes Windows-style backslash paths", () => {
    idx.ingest(graph([mkSym("Foo", "src\\foo.ts", ["note"])]));
    expect(idx.getCountsForFile("src/foo.ts")?.total).toBe(1);
    expect(idx.getCountsForFile("src\\foo.ts")?.total).toBe(1);
  });

  it("walks nested module trees", () => {
    const nested: NkrdnGraphMessage = {
      type: "nkrdn-graph",
      modules: [
        {
          name: "src",
          path: "src",
          children: [
            { name: "lib", path: "src/lib", children: [
              mkSym("Deep", "src/lib/deep.ts", ["decision"]),
            ] },
          ],
        },
      ],
      tombstoned: [], orphans: [],
      stats: { symbols: 1, memories: 1, orphans: 0 },
    };
    idx.ingest(nested);
    expect(idx.getCountsForFile("src/lib/deep.ts")?.total).toBe(1);
  });

  it("returns first symbol for a file", () => {
    const a = mkSym("Alpha", "src/x.ts", ["decision"]);
    const b = mkSym("Beta", "src/x.ts", ["note"]);
    idx.ingest(graph([a, b]));
    expect(idx.getFirstSymbolForFile("src/x.ts")?.name).toBe("Alpha");
  });

  it("notifies subscribers on ingest", () => {
    let calls = 0;
    idx.subscribe(() => { calls++; });
    idx.ingest(graph([mkSym("Foo", "src/foo.ts", ["note"])]));
    idx.ingest(graph([]));
    expect(calls).toBe(2);
  });

  it("clears stale data on re-ingest", () => {
    idx.ingest(graph([mkSym("Foo", "src/foo.ts", ["note"])]));
    idx.ingest(graph([]));
    expect(idx.getCountsForFile("src/foo.ts")).toBeNull();
  });

  it("returns null for paths outside the project root", () => {
    idx.setProjectRoot("/home/gary/projects/cade");
    idx.ingest(graph([mkSym("Foo", "src/foo.ts", ["note"])]));
    expect(idx.getCountsForFile("/some/other/repo/src/foo.ts")).toBeNull();
  });
});
