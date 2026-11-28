// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_SETTLE_MS, QuickDrawScreen, type QueueCardSession } from "./quick-draw-screen";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
/** Let a newly dealt card take answers. */
const settle = () => vi.advanceTimersByTime(CARD_SETTLE_MS);

function setup(initial: QueueCardSession[], screens: Record<string, string[]> = {}) {
  let sessions = initial;
  const onGoTo = vi.fn();
  const onAnswer = vi.fn();
  const screen = new QuickDrawScreen({
    getSessions: () => sessions,
    getScreenLines: (id) => screens[id] ?? null,
    onGoTo,
    onAnswer,
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
  return { screen, card, click, set, onGoTo, onAnswer };
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
    const { screen, card, click } = setup([perm, done]);
    expect(screen.element.querySelector(".quick-draw-next")!.textContent).toBe("[next]1 more");
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

const DIALOG = [
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and switch to auto mode",
  "   3. No",
  "",
  " Esc to cancel · Tab to amend",
];
const claude = { ...perm, agent: "claude-code" };
const answers = (screen: QuickDrawScreen) =>
  [...screen.element.querySelectorAll<HTMLElement>(".quick-draw-answer")].map((b) => [
    b.dataset["key"],
    b.dataset["label"],
  ]);
const answerRow = (screen: QuickDrawScreen, key: string) =>
  screen.element.querySelector<HTMLElement>(`.quick-draw-answer[data-key="${key}"]`)!;

describe("answering from a card", () => {
  it("offers the dialog's own options under their own keys, as bracketed options", () => {
    const { screen } = setup([claude], { p: DIALOG });
    expect(answers(screen)).toEqual([
      ["1", "Yes"],
      ["2", "Yes, and switch to auto mode"],
      ["3", "No"],
    ]);
    expect(answerRow(screen, "3").querySelector(".option-label")!.textContent).toBe("[no]");
  });

  it("quotes what the dialog asks about, not its options a second time", () => {
    const { card } = setup([claude], { p: DIALOG });
    expect(card()!.querySelector(".quick-draw-screen")!.textContent).toBe(" Do you want to proceed?");
  });

  it("starts a new card on [go to it], so a stray Enter approves nothing", () => {
    const { screen, onGoTo, onAnswer } = setup([claude], { p: DIALOG });
    screen.onShow();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    screen.onHide();
    expect(onGoTo).toHaveBeenCalledWith("p");
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("ignores answers until a newly dealt card has settled", () => {
    const { screen, onAnswer } = setup([claude], { p: DIALOG });
    answerRow(screen, "1").click();
    expect(onAnswer).not.toHaveBeenCalled();
    settle();
    answerRow(screen, "1").click();
    expect(onAnswer).toHaveBeenCalledWith("p", "1");
  });

  it("does not let a double tap answer the next card too", () => {
    const second = { ...claude, id: "q", attentionAt: 11 };
    const { screen, card, onAnswer } = setup([claude, second], { p: DIALOG, q: DIALOG });
    settle();
    answerRow(screen, "1").click();
    expect(card()!.dataset["session"]).toBe("q");
    answerRow(screen, "1").click();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a tap on a row a redraw has replaced", () => {
    const { screen, onAnswer, set } = setup([claude], { p: DIALOG });
    settle();
    const stale = answerRow(screen, "3");
    set([claude]);
    stale.click();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("offers no answers for an agent whose keys have not been checked", () => {
    const { screen } = setup([{ ...perm, agent: "codex" }], { p: DIALOG });
    expect(answers(screen)).toEqual([]);
  });

  it("offers no answers on a finished card or without a dialog on screen", () => {
    expect(answers(setup([{ ...done, agent: "claude-code" }], { d: DIALOG }).screen)).toEqual([]);
    expect(answers(setup([claude], { p: ["● Working…"] }).screen)).toEqual([]);
  });

  it("sends the option's key and deals the next card", () => {
    const { screen, card, onAnswer } = setup([claude, done], { p: DIALOG });
    settle();
    answerRow(screen, "3").click();
    expect(onAnswer).toHaveBeenCalledWith("p", "3");
    expect(card()!.dataset["session"]).toBe("d");
  });

  it("cannot answer the same wait twice, even before the backend hears", () => {
    const { screen, card, onAnswer, set } = setup([claude], { p: DIALOG });
    settle();
    const yes = answerRow(screen, "1");
    yes.click();
    yes.click();
    set([claude]);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
  });

  it("sends nothing when the dialog changed after the card was drawn", () => {
    const screens: Record<string, string[]> = { p: DIALOG };
    const { screen, onAnswer } = setup([claude], screens);
    settle();
    const no = answerRow(screen, "3");
    screens["p"] = DIALOG.map((l) => l.replace("3. No", "3. Yes, and always allow"));
    no.click();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(answers(screen)[2]).toEqual(["3", "Yes, and always allow"]);
  });
});
