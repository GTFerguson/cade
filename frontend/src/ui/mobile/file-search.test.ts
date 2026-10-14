// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { FileSearch, highlightMatch } from "./file-search";

describe("highlightMatch", () => {
  it("wraps matched characters and escapes the rest", () => {
    expect(highlightMatch({ path: "a<b", score: 0, positions: [0] })).toBe("<mark>a</mark>&lt;b");
  });
});

describe("FileSearch", () => {
  it("asks for files on show and lists matches as they are typed", () => {
    const requestFiles = vi.fn();
    const onFileSelect = vi.fn();
    const screen = new FileSearch({ requestFiles, onFileSelect, onBack: vi.fn() });
    screen.onShow();
    expect(requestFiles).toHaveBeenCalledTimes(1);

    screen.setFiles(["src/terminal/terminal.ts", "docs/readme.md"], false);
    const input = screen.element.querySelector("input")!;
    input.value = "term";
    input.dispatchEvent(new Event("input"));

    const rows = screen.element.querySelectorAll(".search-result");
    expect(rows).toHaveLength(1);
    (rows[0] as HTMLElement).click();
    expect(onFileSelect).toHaveBeenCalledWith("src/terminal/terminal.ts");
    screen.dispose();
  });

  it("marks a truncated listing in the status", () => {
    const screen = new FileSearch({ requestFiles: vi.fn(), onFileSelect: vi.fn(), onBack: vi.fn() });
    screen.setFiles(["a", "b"], true);
    expect(screen.element.querySelector(".status-file")!.textContent).toBe("2+ files");
  });
});
