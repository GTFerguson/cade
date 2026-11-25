/**
 * The list of workspaces shown while the workspace key is held.
 *
 * A tap of the key moves one workspace along and shows nothing. Keeping the
 * modifier down brings up every workspace with the open one marked, so that
 * further presses can be aimed; letting go puts the list away. The switch
 * itself happens on each press, so the list is a view, never a pending choice.
 */

import { groupColourVar } from "./tab-groups";

export interface WorkspaceRow {
  /** The group's name, or null for the tabs that are in no group. */
  name: string | null;
  colour: string | undefined;
  tabs: number;
  /** Tabs waiting on the user. */
  waiting: number;
  open: boolean;
}

/** How long the modifier is held after a switch before the list appears. */
export const HOLD_MS = 250;

export const UNGROUPED_LABEL = "no workspace";

export class WorkspaceSwitcher {
  private el: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private host: HTMLElement,
    private rows: () => WorkspaceRow[],
    private holdKey = "Alt",
  ) {
    window.addEventListener("keyup", this.onKeyup, true);
    window.addEventListener("blur", this.release);
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
    window.removeEventListener("keyup", this.onKeyup, true);
    window.removeEventListener("blur", this.release);
  }

  private onKeyup = (e: KeyboardEvent): void => {
    if (e.key === this.holdKey) this.release();
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
      rowEl.style.setProperty("--group-colour", groupColourVar(row.colour));

      const name = document.createElement("span");
      name.className = "workspace-switcher-name";
      name.textContent = row.name ?? UNGROUPED_LABEL;
      rowEl.appendChild(name);

      if (row.waiting > 0) {
        const waiting = document.createElement("span");
        waiting.className = "workspace-switcher-waiting";
        waiting.textContent = `! ${row.waiting}`;
        waiting.title = "Tabs waiting on you";
        rowEl.appendChild(waiting);
      }

      const count = document.createElement("span");
      count.className = "workspace-switcher-count";
      count.textContent = String(row.tabs);
      rowEl.appendChild(count);

      this.el.appendChild(rowEl);
    }
  }
}
