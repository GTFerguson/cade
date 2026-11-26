// @vitest-environment jsdom
// The checklist and table send patches keyed by the row's entity id, which
// the source names through `entity.id_field`.
import { afterEach, describe, expect, it } from "vitest";
import { ChecklistComponent } from "./checklist";
import { TableComponent } from "./table";
import type {
  DashboardAction,
  DashboardComponent,
  DashboardConfig,
  PanelConfig,
} from "../types";

const ROW = { id: "wrong", key: "job-9", text: "Apply", title: "Job", status: "new" };

function panel(overrides: Partial<PanelConfig>): PanelConfig {
  return {
    component: "table",
    source: "jobs",
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
    ...overrides,
  };
}

const CONFIG: DashboardConfig = {
  dashboard: { title: "T" },
  data_sources: {
    jobs: {
      name: "jobs",
      type: "rest",
      entity: { id_field: "key", statuses: ["new", "applied"], transitions: {} },
    },
  },
  views: [],
  stats: [],
};

function mount(comp: DashboardComponent, p: PanelConfig) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const actions: DashboardAction[] = [];
  comp.render(container, {
    panel: p,
    data: [ROW],
    allData: {},
    config: CONFIG,
    onAction: (a) => actions.push(a),
  });
  return { container, actions };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("patch entity ids", () => {
  it("checklist sends the id_field value", () => {
    const { container, actions } = mount(
      new ChecklistComponent(),
      panel({ component: "checklist", on_check: { patch: { status: "done" } } }),
    );
    const box = container.querySelector("input[type=checkbox]") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(actions[0]?.entityId).toBe("job-9");
  });

  it("table inline edit sends the id_field value", () => {
    const { container, actions } = mount(
      new TableComponent(),
      panel({ columns: ["title", "status"], inline_edit: ["status"] }),
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    select.value = "applied";
    select.dispatchEvent(new Event("change"));
    expect(actions[0]).toMatchObject({
      action: "patch",
      source: "jobs",
      entityId: "job-9",
      patch: { status: "applied" },
    });
  });
});
