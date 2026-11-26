/**
 * The list of workspaces shown while the workspace key is held.
 *
 * A tap of the key moves one workspace along and shows nothing. Keeping Alt
 * down brings up every workspace with the open one marked, so that further
 * presses can be aimed; letting go puts the list away. The switch itself
 * happens on each press, so the list is a view, never a pending choice.
 *
 * It slides in at the right, under the tab bar: out of the way of the
 * terminal, which is what is being switched and wants looking at.
 */

import { groupColourVar, type GroupRollup } from "./tab-groups";

export interface WorkspaceRow {
  /** The group's name, or null for the tabs that are in no group. */
  name: string | null;
  colour: string | undefined;
  tabs: number;
  /** What its tabs need: the most pressing state, and how many are waiting. */
  rollup: GroupRollup;
  open: boolean;
}

/** How long Alt is held after a switch before the list appears. */
export const HOLD_MS = 250;

/**
 * How long the list stays after the last press when nothing has said Alt was
 * let go. The list is a view, not a choice in progress, so putting it away
 * loses nothing, and the next press brings it back.
 */
export const LINGER_MS = 4000;

export const UNGROUPED_LABEL = "no workspace";

/** The same marks a tab and a closed chip use for these states. */
const MARKS: Record<GroupRollup["state"], string> = {
  input: "!",
  working: "●",
  idle: "✓",
  none: "",
};

export class WorkspaceSwitcher {
  private el: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private lastKey = "no key event";

  /**
   * `onMissedRelease` is told when the list had to be put away without a
   * key event saying Alt was up, with what was last seen. The desktop window
   * cannot be inspected, so this is the only account of why that happened.
   */
  constructor(
    private host: HTMLElement,
    private rows: () => WorkspaceRow[],
    private onMissedRelease: (detail: string) => void = () => {},
  ) {
    window.addEventListener("keyup", this.onKey, true);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("pointermove", this.onPointerMove, true);
    window.addEventListener("pointerdown", this.release, true);
    window.addEventListener("blur", this.release);
    document.addEventListener("visibilitychange", this.release);
  }

  /** A switch was just made with the key; show the list if the hold goes on. */
  noteSwitch(): void {
    if (this.el) {
      this.draw();
      this.linger();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.el = document.createElement("div");
        this.el.className = "workspace-switcher";
        this.host.appendChild(this.el);
        this.draw();
        this.linger();
      }, HOLD_MS);
    }
  }

  /** Start, or start again, the wait after which the list goes by itself. */
  private linger(): void {
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(() => this.missedRelease("timed out"), LINGER_MS);
  }

  private missedRelease(how: string): void {
    const at = document.activeElement;
    const focus = at ? `${at.tagName.toLowerCase()}.${at.className}` : "nothing";
    this.onMissedRelease(
      `${how}; last key event: ${this.lastKey}; focus on ${focus}; window focused: ${document.hasFocus()}`,
    );
    this.release();
  }

  isShown(): boolean {
    return this.el !== null;
  }

  dispose(): void {
    this.release();
    window.removeEventListener("keyup", this.onKey, true);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("pointermove", this.onPointerMove, true);
    window.removeEventListener("pointerdown", this.release, true);
    window.removeEventListener("blur", this.release);
    document.removeEventListener("visibilitychange", this.release);
  }

  /**
   * The list goes when Alt is no longer down, judged by the modifier the
   * event carries and not by which key it names. With Shift held (going
   * back is Alt+Shift+w), letting go of Alt arrives as a key-up of "Meta",
   * so waiting for a key-up named "Alt" left the list on screen. Checking
   * every key event also clears a list whose key-up was never delivered.
   */
  private onKey = (e: KeyboardEvent): void => {
    this.lastKey = `${e.type} ${e.key} alt=${e.altKey}`;
    if (!e.altKey) this.release();
  };

  /**
   * A moving pointer carries the modifiers too. If it says Alt is up while
   * the list is still showing, the key-up never reached the page.
   */
  private onPointerMove = (e: PointerEvent): void => {
    if (this.el !== null && !e.altKey) this.missedRelease("pointer moved without Alt");
  };

  private release = (): void => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.el?.remove();
    this.el = null;
  };

  private draw(): void {
    if (!this.el) return;
    this.el.innerHTML = "";
    for (const row of this.rows()) {
      const rowEl = document.createElement("div");
      rowEl.className = `workspace-switcher-row${row.open ? " open" : ""}`;
      rowEl.dataset["status"] = row.rollup.state;
      rowEl.style.setProperty("--group-colour", groupColourVar(row.colour));

      const mark = document.createElement("span");
      mark.className = "workspace-switcher-mark";
      const several = row.rollup.waiting > 1;
      mark.classList.toggle("workspace-switcher-mark--count", several);
      mark.textContent = several ? String(row.rollup.waiting) : MARKS[row.rollup.state];
      rowEl.appendChild(mark);

      const name = document.createElement("span");
      name.className = "workspace-switcher-name";
      name.textContent = row.name ?? UNGROUPED_LABEL;
      rowEl.appendChild(name);

      const count = document.createElement("span");
      count.className = "workspace-switcher-count";
      count.textContent = String(row.tabs);
      rowEl.appendChild(count);

      this.el.appendChild(rowEl);
    }
  }
}
