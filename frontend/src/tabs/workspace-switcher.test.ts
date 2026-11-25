// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HOLD_MS, UNGROUPED_LABEL, WorkspaceSwitcher, type WorkspaceRow } from "./workspace-switcher";

let host: HTMLElement;
let rows: WorkspaceRow[];
let switcher: WorkspaceSwitcher;

const list = () => host.querySelector(".workspace-switcher");
const names = () =>
  [...host.querySelectorAll(".workspace-switcher-row")].map(
    (r) => `${r.classList.contains("open") ? ">" : ""}${r.querySelector(".workspace-switcher-name")!.textContent}`,
  );
const letGo = (key = "Alt") => window.dispatchEvent(new KeyboardEvent("keyup", { key }));

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  rows = [
    { name: null, colour: undefined, tabs: 1, waiting: 0, open: false },
    { name: "Work", colour: "purple", tabs: 3, waiting: 2, open: true },
    { name: "Home", colour: "green", tabs: 2, waiting: 0, open: false },
  ];
  switcher = new WorkspaceSwitcher(host, () => rows);
});

afterEach(() => {
  switcher.dispose();
  vi.useRealTimers();
});

describe("the list of workspaces", () => {
  it("stays away for a tap of the key", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS - 1);
    letGo();
    vi.advanceTimersByTime(HOLD_MS);
    expect(list()).toBeNull();
  });

  it("appears when the key is held, marking the open workspace", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    expect(names()).toEqual([UNGROUPED_LABEL, ">Work", "Home"]);
  });

  it("follows further presses while it is up", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    rows = rows.map((r) => ({ ...r, open: r.name === "Home" }));
    switcher.noteSwitch();
    expect(names()).toEqual([UNGROUPED_LABEL, "Work", ">Home"]);
  });

  it("goes away when the key is let go, and on losing the window", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    letGo();
    expect(list()).toBeNull();

    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    window.dispatchEvent(new Event("blur"));
    expect(list()).toBeNull();
  });

  it("ignores other keys being let go", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    letGo("j");
    expect(list()).not.toBeNull();
  });

  it("shows how many tabs are waiting, only where some are", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    const waiting = [...host.querySelectorAll(".workspace-switcher-row")].map(
      (r) => r.querySelector(".workspace-switcher-waiting")?.textContent ?? null,
    );
    expect(waiting).toEqual([null, "! 2", null]);
  });
});
