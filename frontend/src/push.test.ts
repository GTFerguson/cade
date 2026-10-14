import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./push";
import { attentionTitle } from "./ui/attention-notify";

describe("urlBase64ToUint8Array", () => {
  it("decodes url-safe base64 without padding", () => {
    // "hi?" → aGk_ in url-safe base64 (standard: aGk/)
    expect(Array.from(urlBase64ToUint8Array("aGk_"))).toEqual([104, 105, 63]);
  });
});

describe("attentionTitle", () => {
  it("phrases the two states", () => {
    expect(attentionTitle("cade", "input")).toBe("cade: needs you");
    expect(attentionTitle("cade", "idle")).toBe("cade: done");
  });
});
