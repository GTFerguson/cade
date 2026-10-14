/**
 * Mobile input bar: a composer row and a scrollable key strip, fixed to the
 * bottom of the viewport.
 *
 * The composer is a native text field. Mobile keyboards mangle xterm's
 * hidden textarea (autocorrect, composition, no way to edit before
 * sending), so prompts for the agent are typed here and sent as one
 * bracketed paste followed by Enter. Tapping the terminal still focuses
 * xterm for raw keystrokes (vim, shell editing).
 *
 * The bar repositions above the virtual keyboard when it opens and
 * publishes its own height as a CSS variable so the panes above it can
 * clear it whatever its current row count.
 */

import type { Component } from "../types";
import { ComposerHistory } from "./mobile/composer-history";

interface ToolbarKey {
  label: string;
  /** Bytes sent to the PTY, or null for keys with their own action. */
  data: string | null;
  action?: "font-down" | "font-up" | "repaint";
  className?: string;
  ariaLabel?: string;
}

const TOOLBAR_KEYS: ToolbarKey[] = [
  { label: "esc", data: "\x1b" },
  { label: "tab", data: "\t" },
  { label: "^c", data: "\x03", ariaLabel: "control c" },
  { label: "^d", data: "\x04", ariaLabel: "control d" },
  { label: "↑", data: "\x1b[A", ariaLabel: "arrow up" },
  { label: "↓", data: "\x1b[B", ariaLabel: "arrow down" },
  { label: "⏎", data: "\r", ariaLabel: "enter" },
  { label: "y", data: "y\r", ariaLabel: "yes" },
  { label: "n", data: "n\r", ariaLabel: "no" },
  { label: "A-", data: null, action: "font-down", ariaLabel: "smaller text" },
  { label: "A+", data: null, action: "font-up", ariaLabel: "larger text" },
  { label: "⟳", data: null, action: "repaint", ariaLabel: "redraw" },
];

const RESIZE_DEBOUNCE_MS = 150;
const COMPOSER_MAX_ROWS = 4;

export interface TouchToolbarCallbacks {
  /** Raw bytes for the active terminal. */
  sendInput: (data: string) => void;
  /** A composed prompt: pasted as one block, then Enter. */
  sendComposed: (text: string) => void;
  onCmd: () => void;
  onFontStep: (direction: 1 | -1) => void;
  onRepaint: () => void;
  /** The on-screen keyboard opened or closed. */
  onKeyboardChange?: (open: boolean) => void;
}

export class TouchToolbar implements Component {
  private toolbar: HTMLElement;
  private cmdButton: HTMLButtonElement | null = null;
  private composer: HTMLTextAreaElement | null = null;
  private resizeTimer: number | null = null;
  private boundViewportResize: () => void;
  private prevVvHeight = 0;
  private keyboardOpen = false;
  private heightObserver: ResizeObserver | null = null;
  private history = new ComposerHistory();

  constructor(private callbacks: TouchToolbarCallbacks) {
    this.toolbar = document.getElementById("touch-toolbar") as HTMLElement;
    this.boundViewportResize = () => this.handleViewportResize();
  }

  initialize(): void {
    this.build();
    this.setupViewportListeners();
    this.observeHeight();
    this.show();
  }

  private build(): void {
    this.toolbar.innerHTML = "";

    // Composer row: [cmd] [ prompt… ] [send]
    const composerRow = document.createElement("div");
    composerRow.className = "touch-composer";

    const cmd = document.createElement("button");
    cmd.className = "touch-toolbar-btn key-cmd";
    cmd.textContent = "[cmd]";
    cmd.setAttribute("aria-label", "command menu");
    cmd.addEventListener("click", (e) => {
      e.preventDefault();
      this.callbacks.onCmd();
    });
    this.cmdButton = cmd;

    const input = document.createElement("textarea");
    input.className = "touch-composer-input";
    input.rows = 1;
    input.placeholder = "prompt…";
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("enterkeyhint", "send");
    input.setAttribute("aria-label", "prompt");
    input.addEventListener("input", () => this.autosize());
    input.addEventListener("keydown", (e) => this.handleComposerKey(e));
    this.composer = input;

    const send = document.createElement("button");
    send.className = "touch-composer-send";
    send.textContent = "send";
    send.setAttribute("aria-label", "send prompt");
    // mousedown rather than click so the textarea keeps focus and the
    // keyboard stays up for the next prompt.
    send.addEventListener("mousedown", (e) => e.preventDefault());
    send.addEventListener("touchend", (e) => {
      e.preventDefault();
      this.submitComposer();
    });
    send.addEventListener("click", (e) => {
      e.preventDefault();
      this.submitComposer();
    });

    composerRow.appendChild(cmd);
    composerRow.appendChild(input);
    composerRow.appendChild(send);

    // Key strip: scrolls sideways when the phone is too narrow for all keys.
    const keys = document.createElement("div");
    keys.className = "touch-keys";
    for (const key of TOOLBAR_KEYS) {
      const btn = document.createElement("button");
      btn.className = "touch-toolbar-btn" + (key.className ? ` ${key.className}` : "");
      btn.textContent = key.label;
      btn.setAttribute("aria-label", key.ariaLabel ?? key.label);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.runKey(key);
      });
      keys.appendChild(btn);
    }

    this.toolbar.appendChild(composerRow);
    this.toolbar.appendChild(keys);
  }

  private runKey(key: ToolbarKey): void {
    switch (key.action) {
      case "font-down":
        this.callbacks.onFontStep(-1);
        return;
      case "font-up":
        this.callbacks.onFontStep(1);
        return;
      case "repaint":
        this.callbacks.onRepaint();
        return;
      default:
        if (key.data !== null) this.callbacks.sendInput(key.data);
    }
  }

  private handleComposerKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
      e.preventDefault();
      this.submitComposer();
      return;
    }
    if (!this.composer) return;
    // Up/down recall history only from an empty or recalled composer, so
    // cursor movement inside a multi-line prompt still works.
    const browsing = this.composer.value === "" || this.composer.dataset["recalled"] === "1";
    if (e.key === "ArrowUp" && browsing) {
      const prev = this.history.prev();
      if (prev !== null) {
        e.preventDefault();
        this.setComposerValue(prev, true);
      }
    } else if (e.key === "ArrowDown" && browsing) {
      const next = this.history.next();
      if (next !== null) {
        e.preventDefault();
        this.setComposerValue(next, next !== "");
      }
    }
  }

  private setComposerValue(value: string, recalled: boolean): void {
    if (!this.composer) return;
    this.composer.value = value;
    if (recalled) this.composer.dataset["recalled"] = "1";
    else delete this.composer.dataset["recalled"];
    this.autosize();
  }

  /** Send the composer's text (if any) and clear it. */
  submitComposer(): void {
    if (!this.composer) return;
    const text = this.composer.value.replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (text.trim() === "") return;
    this.history.push(text);
    this.callbacks.sendComposed(text);
    this.setComposerValue("", false);
  }

  private autosize(): void {
    if (!this.composer) return;
    const el = this.composer;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = line * COMPOSER_MAX_ROWS + 12;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }

  focusComposer(): void {
    this.composer?.focus();
  }

  private setupViewportListeners(): void {
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", this.boundViewportResize);
      window.visualViewport.addEventListener("scroll", this.boundViewportResize);
    }
  }

  /**
   * Publish the bar's rendered height so the terminal pane and screens
   * above can size themselves from it rather than a hardcoded number.
   */
  private observeHeight(): void {
    const publish = () => {
      const h = this.toolbar.offsetHeight;
      if (h > 0) {
        document.documentElement.style.setProperty("--touch-toolbar-height", `${h}px`);
      }
    };
    if (typeof ResizeObserver !== "undefined") {
      this.heightObserver = new ResizeObserver(publish);
      this.heightObserver.observe(this.toolbar);
    }
    publish();
  }

  /**
   * Reposition toolbar above the virtual keyboard and trigger terminal re-fit.
   */
  private handleViewportResize(): void {
    if (!window.visualViewport) return;

    const vv = window.visualViewport;
    const keyboardHeight = window.innerHeight - vv.height;
    const viewportShrank = this.prevVvHeight > 0 && vv.height < this.prevVvHeight;
    this.prevVvHeight = vv.height;
    this.toolbar.style.bottom = `${Math.max(0, keyboardHeight)}px`;

    const open = keyboardHeight > 0;
    if (open !== this.keyboardOpen) {
      this.keyboardOpen = open;
      // Before the pane shrinks and refits, so the row lock is in place.
      this.callbacks.onKeyboardChange?.(open);
    } else if (open && viewportShrank) {
      this.callbacks.onKeyboardChange?.(true);
    }

    this.syncViewportHeight(vv.height, open);

    // When keyboard is visible, safe-area padding is unnecessary
    this.toolbar.style.paddingBottom = open ? "0" : "";

    this.debouncedRefit();
  }

  /**
   * Keep the app container height locked to the visual viewport so the chat
   * feed clears the keyboard on iOS Safari. Setting an inline style bypasses
   * CSS cascade ambiguity; the --vvh variable is a secondary fallback for the
   * terminal-pane calc() rule.
   */
  private syncViewportHeight(height: number, keyboardOpen = false): void {
    const appEl = document.getElementById("app");
    if (!appEl) return;
    if (keyboardOpen) {
      // iOS Safari: 100dvh doesn't shrink with the keyboard, so we switch #app
      // to position:fixed which also prevents the body-scroll iOS triggers on
      // input focus from shifting the container out of view.
      appEl.style.position = "fixed";
      appEl.style.top = "0";
      appEl.style.left = "0";
      appEl.style.right = "0";
      appEl.style.height = `${height}px`;
    } else {
      appEl.style.position = "";
      appEl.style.top = "";
      appEl.style.left = "";
      appEl.style.right = "";
      appEl.style.height = "";
    }
  }

  /**
   * Debounced dispatch of resize event so xterm re-fits to available space.
   */
  private debouncedRefit(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      window.dispatchEvent(new Event("resize"));
    }, RESIZE_DEBOUNCE_MS);
  }

  show(): void {
    this.toolbar.style.display = "flex";
  }

  hide(): void {
    this.toolbar.style.display = "none";
  }

  getHeight(): number {
    return this.toolbar.offsetHeight;
  }

  /**
   * Show a notification indicator on the [cmd] button.
   */
  showCmdIndicator(): void {
    this.cmdButton?.classList.add("has-indicator");
  }

  clearCmdIndicator(): void {
    this.cmdButton?.classList.remove("has-indicator");
  }

  dispose(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }

    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.boundViewportResize);
      window.visualViewport.removeEventListener("scroll", this.boundViewportResize);
    }
    this.heightObserver?.disconnect();
    this.heightObserver = null;

    this.hide();
    this.toolbar.innerHTML = "";
    this.cmdButton = null;
    this.composer = null;
  }
}
