import { describe, expect, it } from "vitest";
import { offersOrchestrator } from "./chat-pane";

describe("the ORCH button", () => {
  it("shows only when the backend offers /orch", () => {
    // The backend leaves /orch out when spawn_agent is turned off, and a
    // button for a mode that cannot start would only produce an error.
    expect(offersOrchestrator([{ name: "orch" }])).toBe(true);
    expect(offersOrchestrator([{ name: "code" }])).toBe(false);
    expect(offersOrchestrator([])).toBe(false);
  });
});
