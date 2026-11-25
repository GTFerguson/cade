import { describe, it, expect } from "vitest";
import { indicatorText } from "./indicator-text";

describe("the terminal's corner label", () => {
  it("says nothing on the agent's own terminal", () => {
    expect(indicatorText("[claude]", "claude")).toBe("");
    expect(indicatorText("[codex]", "codex")).toBe("");
  });

  it("still names the shell and the chat", () => {
    expect(indicatorText("[shell]", "claude")).toBe("[shell]");
    expect(indicatorText("[chat]", "claude")).toBe("[chat]");
    expect(indicatorText("[minimax-m2.7]", "claude")).toBe("[minimax-m2.7]");
  });
});
