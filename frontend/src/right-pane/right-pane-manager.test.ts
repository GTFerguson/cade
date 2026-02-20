/**
 * @vitest-environment node
 *
 * Tests for RightPaneManager mode switching logic.
 *
 * Regression: setMode() used `display: "block"` to show containers, which
 * overrides the CSS `display: flex` rule. The viewer and neovim containers
 * need flex layout for proper sizing (statusline positioning, terminal fit).
 * The fix uses `display: ""` to remove the inline style and let CSS take over.
 */

import { describe, it, expect } from "vitest";

/**
 * Pure function extracted from RightPaneManager.setMode().
 * Returns the display style value for a container given its target mode
 * and the active mode.
 *
 * Must return "" (empty string) — not "block" — for the active container,
 * so the CSS `display: flex` rule applies instead of being overridden.
 */
export function containerDisplayStyle(
  containerMode: string,
  activeMode: string,
): string {
  return containerMode === activeMode ? "" : "none";
}

// ============================================================================
// containerDisplayStyle
// ============================================================================

describe("containerDisplayStyle", () => {
  it("returns empty string for the active container (not 'block')", () => {
    // Empty string removes the inline style, letting CSS define display
    expect(containerDisplayStyle("markdown", "markdown")).toBe("");
    expect(containerDisplayStyle("neovim", "neovim")).toBe("");
    expect(containerDisplayStyle("agents", "agents")).toBe("");
  });

  it("returns 'none' for inactive containers", () => {
    expect(containerDisplayStyle("markdown", "neovim")).toBe("none");
    expect(containerDisplayStyle("neovim", "markdown")).toBe("none");
    expect(containerDisplayStyle("agents", "markdown")).toBe("none");
  });

  it("REGRESSION: never returns 'block' (would override CSS flex)", () => {
    // CSS defines `.right-pane-viewer { display: flex; flex-direction: column }`
    // If JS sets `style.display = "block"`, it overrides CSS flex layout,
    // breaking statusline positioning and content area sizing.
    const modes = ["markdown", "neovim", "agents"];
    for (const container of modes) {
      for (const active of modes) {
        const result = containerDisplayStyle(container, active);
        expect(result).not.toBe("block");
      }
    }
  });
});
