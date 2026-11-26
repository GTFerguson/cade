// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HOLD_MS,
  LINGER_MS,
  UNGROUPED_LABEL,
  WorkspaceSwitcher,
  type WorkspaceRow,
} from "./workspace-switcher";

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
    { name: null, colour: undefined, tabs: 1, rollup: { state: "none", waiting: 0 }, open: false },
    { name: "Work", colour: "purple", tabs: 3, rollup: { state: "input", waiting: 2 }, open: true },
    { name: "Home", colour: "green", tabs: 2, rollup: { state: "working", waiting: 0 }, open: false },
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

  it("goes away when Alt is let go while Shift is still down, which is reported as another key", () => {
    // Going back is Alt+Shift+w. Letting go of Alt first, with Shift held,
    // arrives on Linux as a key-up of "Meta", not "Alt".
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", altKey: false, shiftKey: true }));
    expect(list()).toBeNull();
  });

  it("goes away at the next key or click made without Alt, in case its release was never seen", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", altKey: false }));
    expect(list()).toBeNull();

    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    window.dispatchEvent(new MouseEvent("pointerdown"));
    expect(list()).toBeNull();
  });

  it("goes away when the pointer moves without Alt, since a moving mouse says so too", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    window.dispatchEvent(new MouseEvent("pointermove", { altKey: true }));
    expect(list()).not.toBeNull();
    window.dispatchEvent(new MouseEvent("pointermove", { altKey: false }));
    expect(list()).toBeNull();
  });

  it("goes away by itself when nothing ever says Alt was let go", () => {
    // In the desktop window the key-up sometimes never reaches the page.
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS + LINGER_MS - 1);
    expect(list()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(list()).toBeNull();
  });

  it("waits afresh after each further press", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS + LINGER_MS - 1);
    switcher.noteSwitch();
    vi.advanceTimersByTime(LINGER_MS - 1);
    expect(list()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(list()).toBeNull();
  });

  it("says what it last saw when it had to go away by itself", () => {
    const seen: string[] = [];
    switcher.dispose();
    switcher = new WorkspaceSwitcher(host, () => rows, (detail) => seen.push(detail));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", altKey: true }));
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS + LINGER_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("keydown w alt=true");

    // Let go in the ordinary way: nothing to report.
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    letGo();
    expect(seen).toHaveLength(1);
  });

  it("stays while Alt is held and other keys come and go", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", altKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", altKey: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", altKey: true }));
    expect(list()).not.toBeNull();
  });

  it("never shows if Alt was let go, by whatever name, before the hold ran out", () => {
    switcher.noteSwitch();
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", altKey: false }));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(list()).toBeNull();
  });

  it("ignores other keys being let go", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "j", altKey: true }));
    expect(list()).not.toBeNull();
  });

  it("shows what each workspace's tabs need, in the marks a tab uses", () => {
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    const marks = [...host.querySelectorAll(".workspace-switcher-row")].map((r) => [
      (r as HTMLElement).dataset["status"],
      r.querySelector(".workspace-switcher-mark")!.textContent,
    ]);
    // Several waiting becomes their number; one state gets its mark; quiet gets none.
    expect(marks).toEqual([["none", ""], ["input", "2"], ["working", "\u25cf"]]);
    expect(host.querySelector(".workspace-switcher-mark--count")!.textContent).toBe("2");
  });

  it("shows a single waiting tab as the waiting mark, not a count", () => {
    rows = [{ name: "Work", colour: "purple", tabs: 3, rollup: { state: "input", waiting: 1 }, open: true }];
    switcher.noteSwitch();
    vi.advanceTimersByTime(HOLD_MS);
    expect(host.querySelector(".workspace-switcher-mark")!.textContent).toBe("!");
    expect(host.querySelector(".workspace-switcher-mark--count")).toBeNull();
  });
});
