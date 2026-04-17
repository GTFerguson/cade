/**
 * @vitest-environment node
 *
 * Tests for the shared TUI menu navigation controller.
 * Pure utilities are tested directly. MenuNav state transitions
 * are tested with lightweight DOM mocks.
 */

import { describe, it, expect, vi } from "vitest";
import { escapeHtml, renderHelpBar, MenuNav, type MenuNavConfig } from "./menu-nav";

// ─── escapeHtml ──────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
    );
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('value="foo"')).toBe("value=&quot;foo&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("escapes multiple entities in one string", () => {
    expect(escapeHtml('<a href="x">&')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;"
    );
  });
});

// ─── renderHelpBar ───────────────────────────────────────────────────

describe("renderHelpBar", () => {
  it("renders a single binding", () => {
    expect(renderHelpBar([{ key: "enter", label: "select" }])).toBe(
      '<span class="help-key">enter</span> select'
    );
  });

  it("joins multiple bindings with non-breaking spaces", () => {
    const html = renderHelpBar([
      { key: "j/k", label: "navigate" },
      { key: "enter", label: "select" },
      { key: "esc", label: "cancel" },
    ]);
    expect(html).toContain("&nbsp;&nbsp;");
    expect(html.split("&nbsp;&nbsp;")).toHaveLength(3);
  });

  it("returns empty string for empty bindings", () => {
    expect(renderHelpBar([])).toBe("");
  });
});

// ─── MenuNav ─────────────────────────────────────────────────────────

/** Minimal mock element with classList.toggle tracking. */
function mockElement(): HTMLElement & { _classes: Set<string> } {
  const classes = new Set<string>();
  return {
    _classes: classes,
    tagName: "DIV",
    classList: {
      toggle(cls: string, force?: boolean) {
        if (force) classes.add(cls);
        else classes.delete(cls);
      },
      remove(cls: string) {
        classes.delete(cls);
      },
      contains(cls: string) {
        return classes.has(cls);
      },
    },
    addEventListener: vi.fn(),
    focus: vi.fn(),
  } as unknown as HTMLElement & { _classes: Set<string> };
}

/** Minimal mock input element. */
function mockInput(): HTMLInputElement & { _classes: Set<string>; blurred: boolean } {
  const el = mockElement() as any;
  el.tagName = "INPUT";
  el.blurred = false;
  el.blur = () => { el.blurred = true; };
  return el;
}

function mockKeyEvent(
  key: string,
  target?: HTMLElement,
  opts?: { altKey?: boolean }
): KeyboardEvent {
  return {
    key,
    altKey: opts?.altKey ?? false,
    target: target || { tagName: "DIV" },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

function createNav(
  options: HTMLElement[],
  overrides: Partial<MenuNavConfig> = {}
): { nav: MenuNav; onSelect: ReturnType<typeof vi.fn> } {
  const onSelect = overrides.onSelect
    ? (overrides.onSelect as ReturnType<typeof vi.fn>)
    : vi.fn();

  const nav = new MenuNav({
    getOptions: () => options,
    onSelect,
    ...overrides,
  });
  return { nav, onSelect };
}

describe("MenuNav", () => {
  describe("renderSelection", () => {
    it("marks only the selected option", () => {
      const opts = [mockElement(), mockElement(), mockElement()];
      const { nav } = createNav(opts);
      nav.selectedIndex = 1;
      nav.renderSelection();

      expect(opts[0]!._classes.has("selected")).toBe(false);
      expect(opts[1]!._classes.has("selected")).toBe(true);
      expect(opts[2]!._classes.has("selected")).toBe(false);
    });

    it("updates when selectedIndex changes", () => {
      const opts = [mockElement(), mockElement()];
      const { nav } = createNav(opts);

      nav.selectedIndex = 0;
      nav.renderSelection();
      expect(opts[0]!._classes.has("selected")).toBe(true);
      expect(opts[1]!._classes.has("selected")).toBe(false);

      nav.selectedIndex = 1;
      nav.renderSelection();
      expect(opts[0]!._classes.has("selected")).toBe(false);
      expect(opts[1]!._classes.has("selected")).toBe(true);
    });
  });

  describe("navigate", () => {
    it("moves forward and wraps", () => {
      const opts = [mockElement(), mockElement(), mockElement()];
      const { nav } = createNav(opts);

      nav.navigate(1);
      expect(nav.selectedIndex).toBe(1);
      nav.navigate(1);
      expect(nav.selectedIndex).toBe(2);
      nav.navigate(1);
      expect(nav.selectedIndex).toBe(0);
    });

    it("moves backward and wraps", () => {
      const opts = [mockElement(), mockElement(), mockElement()];
      const { nav } = createNav(opts);

      nav.navigate(-1);
      expect(nav.selectedIndex).toBe(2);
    });

    it("calls onNavigate after each move", () => {
      const opts = [mockElement(), mockElement()];
      const onNavigate = vi.fn();
      const { nav } = createNav(opts, { onNavigate });

      nav.navigate(1);
      expect(onNavigate).toHaveBeenCalledWith(1);
    });

    it("jumps to last input field when going up from index 0", () => {
      const opts = [mockElement(), mockElement()];
      const input1 = mockInput();
      const input2 = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input1, input2],
      });

      nav.selectedIndex = 0;
      nav.navigate(-1);

      // Should focus the last input, not wrap to index 1
      expect((input2.focus as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
      expect(nav.selectedIndex).toBe(0);
    });

    it("wraps normally when no input fields", () => {
      const opts = [mockElement(), mockElement(), mockElement()];
      const { nav } = createNav(opts);

      nav.selectedIndex = 0;
      nav.navigate(-1);
      expect(nav.selectedIndex).toBe(2);
    });
  });

  describe("handleKeyDown", () => {
    it("navigates down on j", () => {
      const opts = [mockElement(), mockElement()];
      const { nav } = createNav(opts);

      const handled = nav.handleKeyDown(mockKeyEvent("j"));
      expect(handled).toBe(true);
      expect(nav.selectedIndex).toBe(1);
    });

    it("navigates down on ArrowDown", () => {
      const opts = [mockElement(), mockElement()];
      const { nav } = createNav(opts);

      nav.handleKeyDown(mockKeyEvent("ArrowDown"));
      expect(nav.selectedIndex).toBe(1);
    });

    it("navigates up on k", () => {
      const opts = [mockElement(), mockElement(), mockElement()];
      const { nav } = createNav(opts);
      nav.selectedIndex = 2;

      nav.handleKeyDown(mockKeyEvent("k"));
      expect(nav.selectedIndex).toBe(1);
    });

    it("navigates up on ArrowUp", () => {
      const opts = [mockElement(), mockElement(), mockElement()];
      const { nav } = createNav(opts);
      nav.selectedIndex = 2;

      nav.handleKeyDown(mockKeyEvent("ArrowUp"));
      expect(nav.selectedIndex).toBe(1);
    });

    it("calls onSelect on Enter", () => {
      const opts = [mockElement(), mockElement()];
      const { nav, onSelect } = createNav(opts);
      nav.selectedIndex = 1;

      nav.handleKeyDown(mockKeyEvent("Enter"));
      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it("calls onSelect on l", () => {
      const opts = [mockElement()];
      const { nav, onSelect } = createNav(opts);

      nav.handleKeyDown(mockKeyEvent("l"));
      expect(onSelect).toHaveBeenCalledWith(0);
    });

    it("calls onSelect on Space", () => {
      const opts = [mockElement()];
      const { nav, onSelect } = createNav(opts);

      nav.handleKeyDown(mockKeyEvent(" "));
      expect(onSelect).toHaveBeenCalledWith(0);
    });

    it("calls onBack on h when configured", () => {
      const opts = [mockElement()];
      const onBack = vi.fn();
      const { nav } = createNav(opts, { onBack });

      const handled = nav.handleKeyDown(mockKeyEvent("h"));
      expect(handled).toBe(true);
      expect(onBack).toHaveBeenCalled();
    });

    it("calls onBack on Backspace when configured", () => {
      const opts = [mockElement()];
      const onBack = vi.fn();
      const { nav } = createNav(opts, { onBack });

      nav.handleKeyDown(mockKeyEvent("Backspace"));
      expect(onBack).toHaveBeenCalled();
    });

    it("ignores h when onBack not configured", () => {
      const opts = [mockElement()];
      const { nav } = createNav(opts);

      const handled = nav.handleKeyDown(mockKeyEvent("h"));
      expect(handled).toBe(false);
    });

    it("calls onCancel on Escape when configured", () => {
      const opts = [mockElement()];
      const onCancel = vi.fn();
      const { nav } = createNav(opts, { onCancel });

      const handled = nav.handleKeyDown(mockKeyEvent("Escape"));
      expect(handled).toBe(true);
      expect(onCancel).toHaveBeenCalled();
    });

    it("ignores Escape when onCancel not configured", () => {
      const opts = [mockElement()];
      const { nav } = createNav(opts);

      const handled = nav.handleKeyDown(mockKeyEvent("Escape"));
      expect(handled).toBe(false);
    });

    it("ignores unknown keys", () => {
      const opts = [mockElement()];
      const { nav } = createNav(opts);

      const handled = nav.handleKeyDown(mockKeyEvent("x"));
      expect(handled).toBe(false);
    });

    it("calls preventDefault on handled keys", () => {
      const opts = [mockElement(), mockElement()];
      const { nav } = createNav(opts);

      const e = mockKeyEvent("j");
      nav.handleKeyDown(e);
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it("does not call preventDefault on unhandled keys", () => {
      const opts = [mockElement()];
      const { nav } = createNav(opts);

      const e = mockKeyEvent("x");
      nav.handleKeyDown(e);
      expect(e.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe("input field handling", () => {
    it("blurs input on Escape", () => {
      const opts = [mockElement()];
      const input = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input],
      });

      const e = mockKeyEvent("Escape", input);
      const handled = nav.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(input.blurred).toBe(true);
    });

    it("navigates between input fields on ArrowDown", () => {
      const opts = [mockElement()];
      const input1 = mockInput();
      const input2 = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input1, input2],
      });

      const e = mockKeyEvent("ArrowDown", input1);
      nav.handleKeyDown(e);

      expect((input2.focus as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    it("jumps from last input to first option on ArrowDown", () => {
      const opts = [mockElement(), mockElement()];
      const input1 = mockInput();
      const input2 = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input1, input2],
      });

      const e = mockKeyEvent("ArrowDown", input2);
      nav.handleKeyDown(e);

      expect(input2.blurred).toBe(true);
      expect(nav.selectedIndex).toBe(0);
    });

    it("navigates between input fields on Alt+j", () => {
      const opts = [mockElement()];
      const input1 = mockInput();
      const input2 = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input1, input2],
      });

      const e = mockKeyEvent("j", input1, { altKey: true });
      nav.handleKeyDown(e);

      expect((input2.focus as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    it("navigates between input fields on Alt+k", () => {
      const opts = [mockElement()];
      const input1 = mockInput();
      const input2 = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input1, input2],
      });

      const e = mockKeyEvent("k", input2, { altKey: true });
      nav.handleKeyDown(e);

      expect((input1.focus as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    });

    it("jumps from last input to first option on Alt+j", () => {
      const opts = [mockElement(), mockElement()];
      const input1 = mockInput();
      const input2 = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input1, input2],
      });

      const e = mockKeyEvent("j", input2, { altKey: true });
      nav.handleKeyDown(e);

      expect(input2.blurred).toBe(true);
      expect(nav.selectedIndex).toBe(0);
    });

    it("delegates to onInputKey for non-navigation keys", () => {
      const opts = [mockElement()];
      const input = mockInput();
      const onInputKey = vi.fn().mockReturnValue(true);
      const { nav } = createNav(opts, {
        getInputFields: () => [input],
        onInputKey,
      });

      const e = mockKeyEvent("Enter", input);
      const handled = nav.handleKeyDown(e);

      expect(handled).toBe(true);
      expect(onInputKey).toHaveBeenCalledWith(e, input);
    });

    it("returns false for unhandled input keys without onInputKey", () => {
      const opts = [mockElement()];
      const input = mockInput();
      const { nav } = createNav(opts, {
        getInputFields: () => [input],
      });

      const e = mockKeyEvent("a", input);
      const handled = nav.handleKeyDown(e);

      expect(handled).toBe(false);
    });
  });

  describe("wireClickHandlers", () => {
    it("adds click listeners to all options", () => {
      const opts = [mockElement(), mockElement()];
      const { nav } = createNav(opts);

      nav.wireClickHandlers();

      expect((opts[0]!.addEventListener as ReturnType<typeof vi.fn>))
        .toHaveBeenCalledWith("click", expect.any(Function));
      expect((opts[1]!.addEventListener as ReturnType<typeof vi.fn>))
        .toHaveBeenCalledWith("click", expect.any(Function));
    });

    it("sets selectedIndex and calls onSelect on click", () => {
      const opts = [mockElement(), mockElement()];
      const { nav, onSelect } = createNav(opts);

      nav.wireClickHandlers();

      // Simulate clicking option 1
      const clickHandler = (opts[1]!.addEventListener as ReturnType<typeof vi.fn>)
        .mock.calls[0]![1] as () => void;
      clickHandler();

      expect(nav.selectedIndex).toBe(1);
      expect(onSelect).toHaveBeenCalledWith(1);
    });
  });

  describe("reset", () => {
    it("resets selectedIndex to 0", () => {
      const opts = [mockElement(), mockElement()];
      const { nav } = createNav(opts);

      nav.selectedIndex = 3;
      nav.reset();
      expect(nav.selectedIndex).toBe(0);
    });
  });
});
