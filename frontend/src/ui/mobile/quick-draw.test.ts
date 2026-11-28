import { describe, expect, it } from "vitest";
import { cardKind, drawQueue, promptContext, promptOptions, queueSummary, screenTail, type QueueSession } from "./quick-draw";

const s = (id: string, over: Partial<QueueSession> = {}): QueueSession => ({ id, ...over });

describe("the card a session gets", () => {
  it("is a permission card only when the agent said it wants permission", () => {
    expect(cardKind(s("a", { attention: "input", attentionKind: "permission" }))).toBe("permission");
    expect(cardKind(s("a", { attention: "input", attentionKind: "question" }))).toBe("question");
  });

  it("is a question when a waiting agent did not say what it wants", () => {
    expect(cardKind(s("a", { attention: "input" }))).toBe("question");
    expect(cardKind(s("a", { attention: "input", attentionKind: null }))).toBe("question");
  });

  it("is a finished card for a finished turn, and none for a working or quiet session", () => {
    expect(cardKind(s("a", { attention: "idle" }))).toBe("finished");
    expect(cardKind(s("a", { attention: "working" }))).toBeNull();
    expect(cardKind(s("a", { attention: null }))).toBeNull();
    expect(cardKind(s("a"))).toBeNull();
  });
});

describe("the quick-draw queue", () => {
  it("deals permission prompts, then questions, then finished turns", () => {
    const queue = drawQueue([
      s("done", { attention: "idle", attentionAt: 1 }),
      s("ask", { attention: "input", attentionKind: "question", attentionAt: 2 }),
      s("busy", { attention: "working", attentionAt: 0 }),
      s("perm", { attention: "input", attentionKind: "permission", attentionAt: 3 }),
    ]);
    expect(queue.map((c) => [c.session.id, c.kind])).toEqual([
      ["perm", "permission"],
      ["ask", "question"],
      ["done", "finished"],
    ]);
  });

  it("deals the longest waiting first within a kind", () => {
    const queue = drawQueue([
      s("new", { attention: "input", attentionKind: "permission", attentionAt: 30 }),
      s("old", { attention: "input", attentionKind: "permission", attentionAt: 10 }),
      s("mid", { attention: "input", attentionKind: "permission", attentionAt: 20 }),
    ]);
    expect(queue.map((c) => c.session.id)).toEqual(["old", "mid", "new"]);
  });

  it("is empty when nothing wants the user", () => {
    expect(drawQueue([s("a", { attention: "working" }), s("b")])).toEqual([]);
  });
});

describe("the bottom of an agent's screen", () => {
  it("ends at the last row with text and keeps the rows above it", () => {
    expect(screenTail(["a", "b", "c", "", "  "], 2)).toEqual(["b", "c"]);
  });

  it("keeps everything when the screen is short, and nothing when it is blank", () => {
    expect(screenTail(["a", "b"], 5)).toEqual(["a", "b"]);
    expect(screenTail(["", ""], 5)).toEqual([]);
  });

  it("drops trailing spaces from each row", () => {
    expect(screenTail(["❯ 1. Yes   "])).toEqual(["❯ 1. Yes"]);
  });
});

describe("the queue's size in words", () => {
  it("counts blocked and finished apart", () => {
    expect(queueSummary(["permission", "question", "finished"])).toBe("2 blocked · 1 finished");
    expect(queueSummary(["finished"])).toBe("1 finished");
    expect(queueSummary([])).toBe("nothing waiting");
  });
});

// Screens as Claude Code 2.1.332 drew them in a scratch session, 27 Nov 2026.
const PERMISSION_SCREEN = [
  " touch probe-four.txt",
  "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and always allow access to",
  "      /tmp/cc-probe from this",
  "      project",
  "   3. Yes, and switch to auto mode · auto mode handles these prompts for you",
  "   4. No",
  "",
  " Esc to cancel · Tab to amend",
];
const QUESTION_SCREEN = [
  " ☐ Colour",
  "",
  "Red or blue?",
  "",
  "❯ 1. Red",
  "     Choose red",
  "  2. Blue",
  "     Choose blue",
  "  3. Type something.",
  "────────────────────────────────────────",
  "  4. Chat about this",
  "",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
];

describe("the options of the dialog on screen", () => {
  it("reads a permission dialog's options and keys, wrapped lines included", () => {
    const options = promptOptions(PERMISSION_SCREEN)!;
    expect(options.map((o) => [o.key, o.label])).toEqual([
      ["1", "Yes"],
      ["2", "Yes, and always allow access to"],
      ["3", "Yes, and switch to auto mode · auto mode handles these prompts for you"],
      ["4", "No"],
    ]);
    expect(options[1]!.detail).toBe("/tmp/cc-probe from this project");
  });

  it("reads a question's answers and leaves out those a key cannot finish", () => {
    const options = promptOptions(QUESTION_SCREEN)!;
    expect(options.map((o) => [o.key, o.label, o.detail])).toEqual([
      ["1", "Red", "Choose red"],
      ["2", "Blue", "Choose blue"],
    ]);
  });

  it("offers nothing when no dialog is on screen", () => {
    expect(promptOptions(["● Done.", "❯ ", "  ⏸ manual mode on · ? for shortcuts"])).toBeNull();
    expect(promptOptions(["1. a list in the agent's reply", "2. not a dialog"])).toBeNull();
  });

  it("offers nothing for a multi-select or multi-question dialog", () => {
    const multi = QUESTION_SCREEN.map((l) => l.replace("1. Red", "1. [ ] Red").replace("2. Blue", "2. [ ] Blue"));
    expect(promptOptions(multi)).toBeNull();
    const tabs = [" ←  ☐ Colour  ☐ Size  ✔ Submit  →", ...QUESTION_SCREEN.slice(1)];
    expect(promptOptions(tabs)).toBeNull();
  });

  it("does not take numbered lines above the dialog as options", () => {
    const options = promptOptions(["1. step one from the reply", "2. step two", ...PERMISSION_SCREEN])!;
    expect(options[0]!.label).toBe("Yes");
    expect(options).toHaveLength(4);
  });
});

describe("the screen above a dialog", () => {
  it("is what the dialog asks about, without its options", () => {
    expect(screenTail(promptContext(PERMISSION_SCREEN))).toEqual([
      " touch probe-four.txt",
      "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
      " Do you want to proceed?",
    ]);
  });

  it("is the whole screen when there is no dialog", () => {
    expect(promptContext(["● Done."])).toEqual(["● Done."]);
  });
});
