import { describe, expect, it } from "vitest";
import { canTransition, entityConfigFor, entityIdOf } from "./entity";
import type { DashboardConfig, EntityConfig, PanelConfig } from "./types";

function panel(source?: string): PanelConfig {
  return {
    component: "table",
    ...(source ? { source } : {}),
    fields: [],
    columns: [],
    badges: [],
    filter: {},
    sortable: false,
    filterable: [],
    searchable: [],
    inline_edit: [],
    options: {},
    extra: {},
  };
}

function config(entity?: Partial<EntityConfig>): DashboardConfig {
  return {
    dashboard: { title: "T" },
    data_sources: {
      jobs: {
        name: "jobs",
        type: "json_file",
        ...(entity
          ? { entity: { id_field: "id", statuses: [], transitions: {}, ...entity } }
          : {}),
      },
    },
    views: [],
    stats: [],
  };
}

describe("entityIdOf", () => {
  it("reads the field the source names as its id", () => {
    const row = { id: "wrong", key: "j-7" };
    expect(entityIdOf(row, panel("jobs"), config({ id_field: "key" }))).toBe("j-7");
  });

  it("falls back to id when the source declares no entity", () => {
    expect(entityIdOf({ id: 3 }, panel("jobs"), config())).toBe("3");
  });

  it("falls back to id when the panel has no source", () => {
    expect(entityIdOf({ id: "a" }, panel(), config({ id_field: "key" }))).toBe("a");
  });

  it("returns an empty string when the row lacks the field", () => {
    expect(entityIdOf({ id: "a" }, panel("jobs"), config({ id_field: "key" }))).toBe("");
  });
});

describe("entityConfigFor", () => {
  it("returns the panel's source entity", () => {
    const entity = entityConfigFor(panel("jobs"), config({ statuses: ["a"] }));
    expect(entity?.statuses).toEqual(["a"]);
  });

  it("returns undefined for an undeclared source", () => {
    expect(entityConfigFor(panel("other"), config({}))).toBeUndefined();
  });
});

describe("canTransition", () => {
  const entity: EntityConfig = {
    id_field: "id",
    statuses: ["draft", "active", "done"],
    transitions: { draft: ["active"], active: ["done", "draft"] },
  };

  it("allows a listed transition", () => {
    expect(canTransition(entity, "draft", "active")).toBe(true);
  });

  it("refuses an unlisted transition", () => {
    expect(canTransition(entity, "draft", "done")).toBe(false);
  });

  it("treats a status with no entry as final", () => {
    expect(canTransition(entity, "done", "draft")).toBe(false);
  });

  it("allows any move when no transitions are declared", () => {
    expect(canTransition({ ...entity, transitions: {} }, "done", "draft")).toBe(true);
    expect(canTransition(undefined, "done", "draft")).toBe(true);
  });
});
