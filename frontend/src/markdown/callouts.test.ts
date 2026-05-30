import { describe, it, expect, beforeAll } from "vitest";
import { marked } from "marked";
import { registerCallouts } from "./callouts";

beforeAll(() => {
  registerCallouts();
});

const render = (md: string) => marked.parse(md) as string;

describe("callout extension", () => {
  it("converts a bare [!NOTE] blockquote into a framed callout", () => {
    const html = render("> [!NOTE]\n> All three keys work everywhere.");
    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('class="callout-glyph">▸<');
    expect(html).toContain('class="callout-label">NOTE<');
    expect(html).toContain("All three keys work everywhere.");
    // The marker line must not leak into the body.
    expect(html).not.toContain("[!NOTE]");
  });

  it("uses a custom title when one follows the marker", () => {
    const html = render("> [!TIP] Use variables\n> body text");
    expect(html).toContain("callout-tip");
    // A custom title flips the modifier class so CSS keeps the author's casing.
    expect(html).toContain("callout--titled");
    expect(html).toContain('class="callout-label">Use variables<');
    expect(html).toContain('class="callout-glyph">✓<');
  });

  it("does not flag the titled modifier when there is no custom title", () => {
    expect(render("> [!NOTE]\n> body")).not.toContain("callout--titled");
  });

  it("maps aliases onto the right colour key while keeping the label", () => {
    const html = render("> [!BUG]\n> something broke");
    // bug shares the red "caution" treatment but keeps its own label.
    expect(html).toContain('class="callout callout-caution"');
    expect(html).toContain('class="callout-label">BUG<');
    expect(html).toContain('class="callout-glyph">▲<');
  });

  it("distinguishes WARNING (orange) from CAUTION (red)", () => {
    expect(render("> [!WARNING]\n> careful")).toContain("callout-warning");
    expect(render("> [!CAUTION]\n> danger")).toContain("callout-caution");
  });

  it("falls back to the note treatment for unknown types, preserving the label", () => {
    const html = render("> [!CUSTOM]\n> hi");
    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain('class="callout-label">CUSTOM<');
  });

  it("parses nested markdown inside the body", () => {
    const html = render("> [!IMPORTANT]\n> Section headers must be **13px**.\n>\n> - one\n> - two");
    expect(html).toContain("<strong>13px</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("preserves the fold indicator on data-fold", () => {
    expect(render("> [!NOTE]-\n> collapsed")).toContain('data-fold="-"');
    expect(render("> [!NOTE]+\n> expanded")).toContain('data-fold="+"');
  });

  it("leaves a normal blockquote untouched", () => {
    const html = render("> just a quote\n> second line");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("callout");
  });

  it("handles a marker-only callout with an empty body", () => {
    const html = render("> [!EXAMPLE]");
    expect(html).toContain('class="callout callout-example"');
    expect(html).toContain('class="callout-label">EXAMPLE<');
  });
});
