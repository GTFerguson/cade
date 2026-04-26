/**
 * @vitest-environment node
 *
 * Tests for ChatInput double-Escape interrupt and send-while-disabled queue behaviour.
 *
 * Uses lightweight DOM mocks rather than jsdom — avoids an environment dependency
 * while still exercising the event-handling code paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Minimal DOM stubs ──────────────────────────────────────────────────────

type Listener = (e: Event) => void;

function makeElement(tag: string) {
  const listeners: Record<string, Listener[]> = {};
  const classes = new Set<string>();
  let _disabled = false;
  let _value = "";
  let _placeholder = "";

  const el: any = {
    tagName: tag.toUpperCase(),
    className: "",
    dataset: {} as Record<string, string>,
    rows: 1,
    style: {} as CSSStyleDeclaration,
    get disabled() { return _disabled; },
    set disabled(v: boolean) { _disabled = v; },
    get value() { return _value; },
    set value(v: string) { _value = v; },
    get placeholder() { return _placeholder; },
    set placeholder(v: string) { _placeholder = v; },
    get scrollHeight() { return 18; },
    get scrollTop() { return 0; },
    set scrollTop(_v: number) {},
    classList: {
      add: (...names: string[]) => names.forEach(n => classes.add(n)),
      remove: (...names: string[]) => names.forEach(n => classes.delete(n)),
      contains: (n: string) => classes.has(n),
    },
    setAttribute: () => {},
    appendChild: (_child: any) => {},
    blur: () => {},
    focus: () => {},
    addEventListener(type: string, fn: Listener) {
      (listeners[type] ??= []).push(fn);
    },
    dispatchEvent(event: Event) {
      (listeners[(event as any).type] ?? []).forEach(fn => fn(event));
      return true;
    },
  };
  return el;
}

function makeDocument() {
  const elements: Record<string, any> = {};

  const doc = {
    createElement(tag: string) {
      const el = makeElement(tag);
      elements[tag] = el;
      return el;
    },
    body: { appendChild: () => {} },
  };
  return { doc, elements };
}

// Stub global document before importing ChatInput
const { doc, elements: _elements } = makeDocument();
(globalThis as any).document = doc;

// Import AFTER patching globalThis.document so the module picks up the stub
const { ChatInput } = await import("./chat-input");

// ── Helpers ───────────────────────────────────────────────────────────────

function makeInput() {
  const container = makeElement("div");
  const onSend = vi.fn();
  const onCancel = vi.fn();
  const input = new ChatInput(container as unknown as HTMLElement, onSend);
  input.setOnCancel(onCancel);
  // ChatInput appended the textarea to the row; find it via the stub
  // The last element created with tag "textarea" is ours
  const textarea: any = (globalThis as any)._lastTextarea;
  return { input, container, onSend, onCancel, textarea };
}

// We need to track the textarea that ChatInput creates.
// Patch createElement to record the last textarea.
const _origCreate = doc.createElement.bind(doc);
doc.createElement = (tag: string) => {
  const el = _origCreate(tag);
  if (tag === "textarea") {
    (globalThis as any)._lastTextarea = el;
  }
  return el;
};

function fireKeydown(textarea: any, key: string, opts: { shift?: boolean } = {}) {
  const event = {
    type: "keydown",
    key,
    shiftKey: opts.shift ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
  textarea.dispatchEvent(event);
  return event as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ChatInput — send while disabled", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("calls onSend when Enter is pressed even while disabled", () => {
    const { input, onSend, textarea } = makeInput();
    input.setDisabled(true);
    textarea.value = "hello";
    fireKeydown(textarea, "Enter");
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("clears the textarea after send while disabled", () => {
    const { input, textarea } = makeInput();
    input.setDisabled(true);
    textarea.value = "hello";
    fireKeydown(textarea, "Enter");
    expect(textarea.value).toBe("");
  });

  it("does not call onSend for blank input while disabled", () => {
    const { input, onSend, textarea } = makeInput();
    input.setDisabled(true);
    textarea.value = "   ";
    fireKeydown(textarea, "Enter");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("still sends normally when not disabled", () => {
    const { onSend, textarea } = makeInput();
    textarea.value = "world";
    fireKeydown(textarea, "Enter");
    expect(onSend).toHaveBeenCalledWith("world");
  });
});

describe("ChatInput — double-Escape interrupt", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does NOT call onCancel on first Escape", () => {
    const { onCancel, textarea } = makeInput();
    fireKeydown(textarea, "Escape");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel on second Escape within 400ms", () => {
    const { onCancel, textarea } = makeInput();
    fireKeydown(textarea, "Escape");
    vi.advanceTimersByTime(200);
    fireKeydown(textarea, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onCancel if second Escape arrives after 400ms", () => {
    const { onCancel, textarea } = makeInput();
    fireKeydown(textarea, "Escape");
    vi.advanceTimersByTime(401);
    fireKeydown(textarea, "Escape");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("resets window after double-tap so third Escape does not re-fire", () => {
    const { onCancel, textarea } = makeInput();
    fireKeydown(textarea, "Escape");
    vi.advanceTimersByTime(100);
    fireKeydown(textarea, "Escape"); // fires onCancel
    vi.advanceTimersByTime(100);
    fireKeydown(textarea, "Escape"); // starts a new window, no call
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("single Escape while disabled does NOT call onCancel", () => {
    const { input, onCancel, textarea } = makeInput();
    input.setDisabled(true);
    fireKeydown(textarea, "Escape");
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("ChatInput — showQueued / setDisabled", () => {
  it("showQueued sets value and adds queued class", () => {
    const { input, textarea } = makeInput();
    input.setDisabled(true);
    input.showQueued("queued message");
    expect(textarea.value).toBe("queued message");
    expect(textarea.classList.contains("chat-input--queued")).toBe(true);
  });

  it("setDisabled(false) removes the queued class", () => {
    const { input, textarea } = makeInput();
    input.setDisabled(true);
    input.showQueued("queued message");
    input.setDisabled(false);
    expect(textarea.classList.contains("chat-input--queued")).toBe(false);
  });

  it("placeholder reflects streaming state", () => {
    const { input, textarea } = makeInput();
    input.setDisabled(true);
    expect(textarea.placeholder).toContain("Esc");
    input.setDisabled(false);
    expect(textarea.placeholder).toBe("Send a message...");
  });
});
