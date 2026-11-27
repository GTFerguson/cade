import { describe, expect, it } from "vitest";
import { cardKind, drawQueue, queueSummary, screenTail, type QueueSession } from "./quick-draw";

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
