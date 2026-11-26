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

  constructor(
    private host: HTMLElement,
    private rows: () => WorkspaceRow[],
  ) {
    window.addEventListener("keyup", this.onKey, true);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("pointerdown", this.release, true);
    window.addEventListener("blur", this.release);
    document.addEventListener("visibilitychange", this.release);
  }

  /** A switch was just made with the key; show the list if the hold goes on. */
  noteSwitch(): void {
    if (this.el) {
      this.draw();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.el = document.createElement("div");
        this.el.className = "workspace-switcher";
        this.host.appendChild(this.el);
        this.draw();
      }, HOLD_MS);
    }
  }

  isShown(): boolean {
    return this.el !== null;
  }

  dispose(): void {
    this.release();
    window.removeEventListener("keyup", this.onKey, true);
    window.removeEventListener("keydown", this.onKey, true);
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
    if (!e.altKey) this.release();
  };

  private release = (): void => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
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
