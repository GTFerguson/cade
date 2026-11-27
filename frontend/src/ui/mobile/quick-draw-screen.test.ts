// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { QuickDrawScreen, type QueueCardSession } from "./quick-draw-screen";

function setup(initial: QueueCardSession[], screens: Record<string, string[]> = {}) {
  let sessions = initial;
  const onGoTo = vi.fn();
  const screen = new QuickDrawScreen({
    getSessions: () => sessions,
    getScreenLines: (id) => screens[id] ?? null,
    onGoTo,
    onBack: vi.fn(),
    requestRefresh: vi.fn(),
  });
  screen.render();
  const card = () => screen.element.querySelector<HTMLElement>(".quick-draw-card");
  const click = (cls: string) => screen.element.querySelector<HTMLButtonElement>(cls)!.click();
  const set = (next: QueueCardSession[]) => {
    sessions = next;
    screen.render();
  };
  return { screen, card, click, set, onGoTo };
}

const perm: QueueCardSession = {
  id: "p", name: "cade", group: "Work", attention: "input", attentionKind: "permission",
  attentionAt: 10, message: "Claude needs your permission to use Bash",
};
const done: QueueCardSession = { id: "d", name: "nkrdn", attention: "idle", attentionAt: 5 };

describe("the quick-draw screen", () => {
  it("deals the blocked session first, naming it and what it wants", () => {
    const { card } = setup([done, perm]);
    expect(card()!.dataset["session"]).toBe("p");
    expect(card()!.querySelector(".quick-draw-who")!.textContent).toBe("Work cade");
    expect(card()!.querySelector(".quick-draw-what")!.textContent).toMatch(/^wants permission/);
    expect(card()!.querySelector(".quick-draw-message")!.textContent).toContain("use Bash");
  });

  it("quotes the bottom of the agent's screen when this device has it open", () => {
    const { card } = setup([perm], { p: ["Do you want to proceed?", "❯ 1. Yes", "  2. No", "", ""] });
    expect(card()!.querySelector(".quick-draw-screen")!.textContent).toBe(
      "Do you want to proceed?\n❯ 1. Yes\n  2. No",
    );
  });

  it("quotes nothing for a session this device does not have open", () => {
    const { card } = setup([perm]);
    expect(card()!.querySelector(".quick-draw-screen")).toBeNull();
  });

  it("opens the session from its card", () => {
    const { click, onGoTo } = setup([perm]);
    click(".quick-draw-go");
    expect(onGoTo).toHaveBeenCalledWith("p");
  });

  it("puts a card aside and deals the next one", () => {
    const { card, click } = setup([perm, done]);
    expect(card()!.querySelector(".quick-draw-next")!.textContent).toBe("next · 1 more");
    click(".quick-draw-next");
    expect(card()!.dataset["session"]).toBe("d");
  });

  it("offers the put-aside cards again once the queue is dealt", () => {
    const { screen, card, click } = setup([perm]);
    click(".quick-draw-next");
    expect(card()).toBeNull();
    expect(screen.element.querySelector(".quick-draw-empty")!.textContent).toBe("1 put aside");
    click(".quick-draw-again");
    expect(card()!.dataset["session"]).toBe("p");
  });

  it("deals a put-aside session again when it starts a new wait", () => {
    const { card, click, set } = setup([perm]);
    click(".quick-draw-next");
    set([{ ...perm, attentionAt: 20 }]);
    expect(card()!.dataset["session"]).toBe("p");
  });

  it("drops a card answered elsewhere without anyone acting on it", () => {
    const { card, set } = setup([perm, done]);
    set([{ ...perm, attention: "working" }, done]);
    expect(card()!.dataset["session"]).toBe("d");
  });

  it("says so when nothing is waiting", () => {
    const { screen, card } = setup([{ ...done, attention: "working" }]);
    expect(card()).toBeNull();
    expect(screen.element.querySelector(".quick-draw-empty")!.textContent).toBe("nothing waiting");
    expect(screen.element.querySelector(".mobile-screen-header")!.textContent).toBe("[ queue ]");
  });
});
