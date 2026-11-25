import { describe, it, expect } from "vitest";
import { McpAuthNudge } from "./mcp-auth-nudge";

const SIGNED_OUT = { name: "alphaxiv", authenticated: false, serverUrl: "https://example.test/mcp" };

function nudge() {
  const asked: string[] = [];
  return { asked, nudge: new McpAuthNudge((name) => asked.push(name)) };
}

describe("asking the user to sign in to an MCP server", () => {
  it("stays quiet while the tab is on a terminal agent", () => {
    const { asked, nudge: n } = nudge();
    n.report([SIGNED_OUT], true);
    expect(asked).toEqual([]);
  });

  it("asks once the chat comes on screen, and only once", () => {
    const { asked, nudge: n } = nudge();
    n.report([SIGNED_OUT], true);
    n.setChatVisible(true);
    expect(asked).toEqual(["alphaxiv"]);

    n.setChatVisible(false);
    n.setChatVisible(true);
    expect(asked).toEqual(["alphaxiv"]);
  });

  it("asks straight away when the chat is already on screen", () => {
    const { asked, nudge: n } = nudge();
    n.setChatVisible(true);
    n.report([SIGNED_OUT], true);
    expect(asked).toEqual(["alphaxiv"]);
  });

  it("does not ask for a restored session's report", () => {
    const { asked, nudge: n } = nudge();
    n.setChatVisible(true);
    n.report([SIGNED_OUT], false);
    expect(asked).toEqual([]);
  });

  it("goes by the latest report when the chat opens", () => {
    const { asked, nudge: n } = nudge();
    n.report([SIGNED_OUT], true);
    n.report([{ ...SIGNED_OUT, authenticated: true }], false);
    n.setChatVisible(true);
    expect(asked).toEqual([]);
  });

  it("does not ask about a server the user signed in to meanwhile", () => {
    const { asked, nudge: n } = nudge();
    const other = { name: "other", authenticated: false, serverUrl: "https://example.test/o" };
    n.report([SIGNED_OUT, other], true);
    n.amend([{ ...SIGNED_OUT, authenticated: true }]);
    n.setChatVisible(true);
    expect(asked).toEqual(["other"]);
  });

  it("skips servers that are signed in or have no address to sign in at", () => {
    const { asked, nudge: n } = nudge();
    n.setChatVisible(true);
    n.report(
      [
        { name: "ok", authenticated: true, serverUrl: "https://example.test/a" },
        { name: "nowhere", authenticated: false },
        SIGNED_OUT,
      ],
      true,
    );
    expect(asked).toEqual(["alphaxiv"]);
  });

  it("keeps the latest report for a chat pane created later", () => {
    const { nudge: n } = nudge();
    n.report([SIGNED_OUT], true);
    expect(n.status()).toEqual([SIGNED_OUT]);
  });
});
