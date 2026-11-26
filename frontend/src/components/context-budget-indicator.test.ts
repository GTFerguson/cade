import { describe, expect, it } from "vitest";
import { contextTokensOf } from "./context-budget-indicator";

describe("contextTokensOf", () => {
  it("prefers the reply's context size over the summed prompt tokens", () => {
    // A reply that ran tools: usage sums every call, contextTokens is the last one.
    expect(
      contextTokensOf({
        contextTokens: 1230,
        usage: { prompt_tokens: 3300, completion_tokens: 60 },
      }),
    ).toBe(1230);
  });

  it("falls back to prompt_tokens when the backend sends no context size", () => {
    expect(contextTokensOf({ usage: { prompt_tokens: 800, completion_tokens: 20 } })).toBe(800);
  });

  it("returns 0 when there is no usage at all", () => {
    expect(contextTokensOf({})).toBe(0);
  });
});
