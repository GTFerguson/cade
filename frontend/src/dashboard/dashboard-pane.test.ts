// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DashboardPane, setConfigWarningsShown } from "./dashboard-pane";
import type { WebSocketClient } from "../platform/websocket";
import type { DashboardConfig } from "./types";

function config(warnings?: string[]): DashboardConfig {
  return {
    dashboard: { title: "T" },
    data_sources: {},
    views: [{ id: "v", title: "V", panels: [], sidebar_filters: [] }],
    stats: [],
    ...(warnings ? { warnings } : {}),
  };
}

function mount(): { pane: DashboardPane; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const ws = { send: () => {} } as unknown as WebSocketClient;
  const pane = new DashboardPane(container, ws);
  pane.initialize();
  return { pane, container };
}

function noticeText(container: HTMLElement): string {
  const el = container.querySelector(".dashboard-notices") as HTMLElement | null;
  if (!el || el.style.display === "none") return "";
  return el.textContent ?? "";
}

afterEach(() => {
  document.body.innerHTML = "";
  setConfigWarningsShown(true);
});

describe("DashboardPane notices", () => {
  it("shows the config's warnings", () => {
    const { pane, container } = mount();
    pane.setConfig(config(["views[v]: key 'default' is not read and has no effect"]));
    expect(noticeText(container)).toContain("key 'default' is not read");
  });

  it("keeps config warnings from the players of a kiosk dashboard, and still shows them refused changes", () => {
    // A kiosk dashboard is a game screen. Its config may name components
    // another renderer supplies, which CADE warns about, and a player can do
    // nothing with that. A change the server refused is still theirs to know.
    setConfigWarningsShown(false);
    const { pane, container } = mount();
    pane.setConfig(config(["views[v]: unknown component 'party'"]));
    expect(noticeText(container)).toBe("");
    pane.showError("Cannot save the change");
    expect(noticeText(container)).toContain("Cannot save the change");
    expect(noticeText(container)).not.toContain("party");
  });

  it("shows nothing for a config without warnings", () => {
    const { pane, container } = mount();
    pane.setConfig(config([]));
    expect(noticeText(container)).toBe("");
  });

  it("replaces old warnings when a new config arrives", () => {
    const { pane, container } = mount();
    pane.setConfig(config(["first problem"]));
    pane.setConfig(config(["second problem"]));
    expect(noticeText(container)).not.toContain("first problem");
    expect(noticeText(container)).toContain("second problem");
  });

  it("shows an error the server sent about a change", () => {
    const { pane, container } = mount();
    pane.setConfig(config());
    pane.showError("Cannot save the change: 'todo' is a markdown source, which is read-only");
    expect(noticeText(container)).toContain("read-only");
  });

  it("clears notices when the config is removed", () => {
    const { pane, container } = mount();
    pane.setConfig(config(["a problem"]));
    pane.clearConfig();
    expect(noticeText(container)).toBe("");
  });
});
