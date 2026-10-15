import { describe, expect, it } from "vitest";
import { attachOptionLabel } from "./splash-attach";

describe("attachOptionLabel", () => {
  it("names the session, agent and attention", () => {
    expect(attachOptionLabel({ label: "cade", projectPath: "/p/cade", agent: "claude-code", attention: "input" }))
      .toBe("ATTACH cade · claude-code · needs you");
  });

  it("falls back to the project folder", () => {
    expect(attachOptionLabel({ label: null, projectPath: "/p/nkrdn", agent: "codex", attention: null }))
      .toBe("ATTACH nkrdn · codex");
  });
});
