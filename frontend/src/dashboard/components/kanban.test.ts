// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { KanbanComponent, movePatch } from "./kanban";
import type {
  DashboardAction,
  DashboardConfig,
  EntityConfig,
  PanelConfig,
} from "../types";

const COLUMNS = [
  { status: "draft", label: "Draft" },
  { status: "active", label: "Active" },
  { status: "done", label: "Done" },
];

function panel(onMove?: Record<string, unknown>): PanelConfig {
  return {
    component: "kanban",
    source: "plans",
    fields: [],
    columns: COLUMNS,
    badges: [],
    filter: {},
    sortable: false,
    filterable: [],
    searchable: [],
    inline_edit: [],
    options: {},
    ...(onMove ? { on_move: onMove } : {}),
    extra: {},
  };
}

function config(entity?: Partial<EntityConfig>): DashboardConfig {
  return {
    dashboard: { title: "T" },
    data_sources: {
      plans: {
        name: "plans",
        type: "directory",
        ...(entity
          ? { entity: { id_field: "id", statuses: [], transitions: {}, ...entity } }
          : {}),
      },
    },
    views: [],
    stats: [],
  };
}

function mount(opts: {
  onMove?: Record<string, unknown>;
  entity?: Partial<EntityConfig>;
  rows?: Record<string, unknown>[];
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const actions: DashboardAction[] = [];
  const onAction = vi.fn((a: DashboardAction) => actions.push(a));
  const comp = new KanbanComponent();
  comp.render(container, {
    panel: panel(opts.onMove),
    data: opts.rows ?? [{ id: "p1", key: "plan-one", title: "One", status: "draft" }],
    allData: {},
    config: config(opts.entity),
    onAction,
  });
  return { container, actions, onAction };
}

function column(container: HTMLElement, status: string): HTMLElement {
  return container.querySelector(
    `.dash-kanban-cards[data-status="${status}"]`,
  ) as HTMLElement;
}

function dragEvent(type: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: { effectAllowed: "", dropEffect: "" },
  });
  return e;
}

function drag(container: HTMLElement, toStatus: string): void {
  const card = container.querySelector(".dash-kanban-card") as HTMLElement;
  card.dispatchEvent(dragEvent("dragstart"));
  column(container, toStatus).dispatchEvent(dragEvent("drop"));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("movePatch", () => {
  it("falls back to setting status when on_move has no patch", () => {
    expect(movePatch(undefined, "done")).toEqual({ status: "done" });
    expect(movePatch({ action: "patch" }, "done")).toEqual({ status: "done" });
  });

  it("substitutes $column in the patch template", () => {
    expect(
      movePatch({ patch: { stage: "$column", note: "moved to $column", n: 1 } }, "done"),
    ).toEqual({ stage: "done", note: "moved to done", n: 1 });
  });
});

describe("KanbanComponent moves", () => {
  it("sends the on_move patch with the column substituted", () => {
    const { container, actions } = mount({ onMove: { patch: { stage: "$column" } } });
    drag(container, "active");
    expect(actions).toEqual([
      { action: "patch", source: "plans", entityId: "p1", patch: { stage: "active" } },
    ]);
  });

  it("sends the id read through the source's id_field", () => {
    const { container, actions } = mount({ entity: { id_field: "key" } });
    drag(container, "active");
    expect(actions[0]?.entityId).toBe("plan-one");
  });

  it("refuses a drop the transitions do not allow and leaves the card in place", () => {
    const { container, onAction } = mount({
      entity: { transitions: { draft: ["active"] } },
    });
    drag(container, "done");
    expect(onAction).not.toHaveBeenCalled();
    expect(column(container, "draft").querySelector(".dash-kanban-card")).not.toBeNull();
    expect(column(container, "done").querySelector(".dash-kanban-card")).toBeNull();
  });

  it("accepts a drop the transitions allow", () => {
    const { container, actions } = mount({
      entity: { transitions: { draft: ["active"] } },
    });
    drag(container, "active");
    expect(actions).toHaveLength(1);
    expect(column(container, "active").querySelector(".dash-kanban-card")).not.toBeNull();
  });

  it("does nothing when a card is dropped on its own column", () => {
    const { container, onAction } = mount({});
    drag(container, "draft");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("offers only allowed columns in the move menu", () => {
    const { container, actions } = mount({
      entity: { transitions: { draft: ["active"] } },
      onMove: { patch: { status: "$column" } },
    });
    const card = container.querySelector(".dash-kanban-card") as HTMLElement;
    card.click();
    const options = Array.from(
      container.querySelectorAll(".dash-kanban-move-menu > div"),
    ) as HTMLElement[];
    expect(options.map((o) => o.textContent)).toEqual(["→ Active"]);
    options[0]!.click();
    expect(actions).toEqual([
      { action: "patch", source: "plans", entityId: "p1", patch: { status: "active" } },
    ]);
  });
});
